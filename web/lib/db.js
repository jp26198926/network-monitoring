const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const config = require("../config");
const auth = require("./auth");

const DB_FILE = path.join(config.DATA_DIR, "monitor.db");

let db = null;

function open() {
  if (db) {
    return db;
  }

  db = new DatabaseSync(DB_FILE);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      ip TEXT NOT NULL UNIQUE,
      mac TEXT,
      hostname TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      miss_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY,
      device_id INTEGER NOT NULL REFERENCES devices(id),
      ts INTEGER NOT NULL,
      rtt_ms REAL
    );

    CREATE INDEX IF NOT EXISTS idx_samples_dev_ts
      ON samples(device_id, ts DESC);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      device_id INTEGER NOT NULL REFERENCES devices(id),
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_dev_ts
      ON events(device_id, ts DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  seedDefaultAdmin();

  return db;
}

function close() {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

function upsertDevice({ ip, mac, hostname, status, missCount, lastSeen, firstSeen }) {
  const now = Date.now();

  db.prepare(`
    INSERT INTO devices (ip, mac, hostname, first_seen, last_seen, status, miss_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      mac      = COALESCE(excluded.mac, devices.mac),
      hostname = COALESCE(excluded.hostname, devices.hostname),
      last_seen = excluded.last_seen,
      status    = excluded.status,
      miss_count = excluded.miss_count
  `).run(
    ip,
    mac ?? null,
    hostname ?? null,
    firstSeen ?? now,
    lastSeen ?? now,
    status ?? "unknown",
    missCount ?? 0,
  );

  return getDeviceByIp(ip);
}

function getDeviceByIp(ip) {
  return db.prepare("SELECT * FROM devices WHERE ip = ?").get(ip) || null;
}

function getDeviceById(id) {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(id) || null;
}

function listDevices({ status, q, sort } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }

  if (q) {
    clauses.push("(ip LIKE ? OR hostname LIKE ? OR mac LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  let sql = "SELECT * FROM devices";

  if (clauses.length) {
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }

  const order = sort === "ip" ? "ip ASC" : "last_seen DESC";

  sql += ` ORDER BY ${order}`;

  return db.prepare(sql).all(...params);
}

function updateDeviceMeta(id, { mac, hostname }) {
  if (mac !== undefined) {
    db.prepare("UPDATE devices SET mac = COALESCE(?, mac) WHERE id = ?").run(mac, id);
  }

  if (hostname !== undefined) {
    db.prepare("UPDATE devices SET hostname = COALESCE(?, hostname) WHERE id = ?").run(hostname, id);
  }
}

function markProbed(id, { ok, rttMs, missThreshold, ts }) {
  const now = ts ?? Date.now();
  const device = getDeviceById(id);

  if (!device) {
    return null;
  }

  if (ok) {
    db.prepare(
      "UPDATE devices SET status='up', miss_count=0, last_seen=? WHERE id=?",
    ).run(now, id);
  } else {
    const miss = (device.miss_count || 0) + 1;
    const status = miss >= missThreshold ? "down" : device.status;

    db.prepare(
      "UPDATE devices SET miss_count=?, status=?, last_seen=? WHERE id=?",
    ).run(miss, status, now, id);
  }

  return getDeviceById(id);
}

/* ------------------------------------------------------------------ */
/* Samples                                                             */
/* ------------------------------------------------------------------ */

function insertSample(deviceId, ts, rttMs) {
  db.prepare(
    "INSERT INTO samples (device_id, ts, rtt_ms) VALUES (?, ?, ?)",
  ).run(deviceId, ts ?? Date.now(), rttMs ?? null);
}

function insertSamples(rows) {
  const stmt = db.prepare(
    "INSERT INTO samples (device_id, ts, rtt_ms) VALUES (?, ?, ?)",
  );

  for (const row of rows) {
    stmt.run(row.deviceId, row.ts ?? Date.now(), row.rttMs ?? null);
  }
}

function getSamples(deviceId, limit = 200) {
  return db
    .prepare(
      "SELECT ts, rtt_ms AS rttMs FROM samples WHERE device_id = ? ORDER BY ts DESC LIMIT ?",
    )
    .all(deviceId, limit);
}

function getSamplesSince(deviceId, sinceTs) {
  return db
    .prepare(
      "SELECT ts, rtt_ms AS rttMs FROM samples WHERE device_id = ? AND ts >= ? ORDER BY ts ASC",
    )
    .all(deviceId, sinceTs);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function insertEvent(deviceId, type, detail = null) {
  db.prepare(
    "INSERT INTO events (device_id, ts, type, detail) VALUES (?, ?, ?, ?)",
  ).run(deviceId, Date.now(), type, detail);
}

function listEvents(limit = 50) {
  return db
    .prepare(
      `SELECT e.id, e.device_id AS deviceId, e.ts, e.type, e.detail,
              d.ip, d.hostname
         FROM events e
         JOIN devices d ON d.id = e.device_id
        ORDER BY e.ts DESC
        LIMIT ?`,
    )
    .all(limit);
}

function listEventsForDevice(deviceId, limit = 100) {
  return db
    .prepare(
      "SELECT id, ts, type, detail FROM events WHERE device_id = ? ORDER BY ts DESC LIMIT ?",
    )
    .all(deviceId, limit);
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

function summary() {
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown
       FROM devices`,
    )
    .get();

  const rtt = db
    .prepare(
      `SELECT AVG(s.rtt_ms) AS avgRtt
         FROM samples s
         JOIN devices d ON d.id = s.device_id
        WHERE s.rtt_ms IS NOT NULL
          AND s.ts > ?`,
    )
    .get(Date.now() - 5 * 60 * 1000);

  return {
    total: counts.total || 0,
    up: counts.up || 0,
    down: counts.down || 0,
    unknown: counts.unknown || 0,
    avgRtt: rtt.avgRtt !== null && rtt.avgRtt !== undefined ? Math.round(rtt.avgRtt * 100) / 100 : null,
    medianRtt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

const VALID_ROLES = ["admin", "technician", "viewer"];

function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

function toUserDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seedDefaultAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

  if (count > 0) {
    return;
  }

  const now = Date.now();

  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("admin", auth.hashPassword("admin"), "admin", now, now);
}

function countUsers() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

function listUsers() {
  return db
    .prepare(
      "SELECT id, username, role, created_at, updated_at FROM users ORDER BY username ASC",
    )
    .all()
    .map(toUserDto);
}

function getUserById(id) {
  return toUserDto(
    db
      .prepare(
        "SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?",
      )
      .get(id),
  );
}

function getUserByIdWithHash(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function getUserByUsername(username) {
  return (
    db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim()) ||
    null
  );
}

function createUser({ username, password, role }) {
  const name = String(username || "").trim();
  const now = Date.now();

  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(name, auth.hashPassword(password), role, now, now);

  return getUserById(getUserByUsername(name).id);
}

function updateUser(id, { username, password, role }) {
  const existing = getUserByIdWithHash(id);

  if (!existing) {
    return null;
  }

  const name = username !== undefined ? String(username).trim() : existing.username;
  const nextRole = role !== undefined ? role : existing.role;
  const nextHash =
    password !== undefined && password !== "" && password !== null
      ? auth.hashPassword(password)
      : existing.password_hash;
  const now = Date.now();

  db.prepare(
    "UPDATE users SET username = ?, password_hash = ?, role = ?, updated_at = ? WHERE id = ?",
  ).run(name, nextHash, nextRole, now, id);

  return getUserById(id);
}

function deleteUser(id) {
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Retention / pruning                                                 */
/* ------------------------------------------------------------------ */

function prune() {
  const now = Date.now();
  const retentionMs = (config.get("retentionDays") || 14) * 86400000;
  const eventRetentionMs = (config.get("eventRetentionDays") || 90) * 86400000;

  db.prepare("DELETE FROM samples WHERE ts < ?").run(now - retentionMs);
  db.prepare("DELETE FROM events WHERE ts < ?").run(now - eventRetentionMs);

  // Downsample: keep one sample per minute per device older than 24h
  db.prepare(`
    DELETE FROM samples
     WHERE ts < ?
       AND id NOT IN (
         SELECT MAX(id) FROM samples
          WHERE ts < ?
          GROUP BY device_id, ts / 60000
       )
  `).run(now - 86400000, now - 86400000);
}

module.exports = {
  DB_FILE,
  open,
  close,
  upsertDevice,
  getDeviceByIp,
  getDeviceById,
  listDevices,
  updateDeviceMeta,
  markProbed,
  insertSample,
  insertSamples,
  getSamples,
  getSamplesSince,
  insertEvent,
  listEvents,
  listEventsForDevice,
  summary,
  prune,
  VALID_ROLES,
  isValidRole,
  seedDefaultAdmin,
  countUsers,
  countAdmins,
  listUsers,
  getUserById,
  getUserByIdWithHash,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
};
