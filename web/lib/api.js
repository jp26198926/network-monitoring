const fs = require("fs");
const path = require("path");

const db = require("./db");
const auth = require("./auth");
const config = require("../config");
const subnet = require("./subnet");
const monitor = require("./monitor");
const topologyStore = require("./topology-store");
const wsHub = require("./ws-hub");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (pathname === "/" || pathname === "") {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  if (pathname === "/topology" || pathname === "/topology/") {
    filePath = path.join(PUBLIC_DIR, "topology.html");
  }

  if (pathname === "/users" || pathname === "/users/") {
    filePath = path.join(PUBLIC_DIR, "users.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */

function getSession(req) {
  return auth.getSession(auth.getTokenFromReq(req));
}

function requireAuth(req, res, roles) {
  const session = getSession(req);

  if (!session) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }

  if (roles && !roles.includes(session.role)) {
    sendJson(res, 403, { error: "Forbidden" });
    return null;
  }

  return session;
}

async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const segments = pathname.split("/").filter(Boolean); // ['api', ...]

  /* POST /api/auth/login */
  if (method === "POST" && pathname === "/api/auth/login") {
    try {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!username || !password) {
        return sendJson(res, 400, { error: "Username and password are required" });
      }

      const user = db.getUserByUsername(username);

      if (!user || !auth.verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, { error: "Invalid username or password" });
      }

      const token = auth.createSession({
        id: user.id,
        username: user.username,
        role: user.role,
      });

      res.setHeader("Set-Cookie", auth.sessionCookie(token));

      return sendJson(res, 200, {
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  /* POST /api/auth/logout */
  if (method === "POST" && pathname === "/api/auth/logout") {
    auth.destroySession(auth.getTokenFromReq(req));
    res.setHeader("Set-Cookie", auth.clearCookie());
    return sendJson(res, 200, { ok: true });
  }

  /* GET /api/auth/me */
  if (method === "GET" && pathname === "/api/auth/me") {
    const session = getSession(req);

    if (!session) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    return sendJson(res, 200, {
      user: {
        id: session.userId,
        username: session.username,
        role: session.role,
      },
    });
  }

  /* PUT /api/auth/password */
  if (method === "PUT" && pathname === "/api/auth/password") {
    const session = requireAuth(req, res);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");

      if (!currentPassword || !newPassword) {
        return sendJson(res, 400, { error: "Current and new password are required" });
      }

      if (newPassword.length < 3) {
        return sendJson(res, 400, { error: "New password must be at least 3 characters" });
      }

      const user = db.getUserByIdWithHash(session.userId);

      if (!user || !auth.verifyPassword(currentPassword, user.password_hash)) {
        return sendJson(res, 400, { error: "Current password is incorrect" });
      }

      db.updateUser(session.userId, { password: newPassword });

      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  /* GET /api/users */
  if (method === "GET" && pathname === "/api/users") {
    const session = requireAuth(req, res, ["admin"]);

    if (!session) {
      return;
    }

    return sendJson(res, 200, { users: db.listUsers() });
  }

  /* POST /api/users */
  if (method === "POST" && pathname === "/api/users") {
    const session = requireAuth(req, res, ["admin"]);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "");

      if (!username) {
        return sendJson(res, 400, { error: "Username is required" });
      }

      if (!password) {
        return sendJson(res, 400, { error: "Password is required" });
      }

      if (!db.isValidRole(role)) {
        return sendJson(res, 400, { error: "Role must be admin, technician, or viewer" });
      }

      if (db.getUserByUsername(username)) {
        return sendJson(res, 400, { error: "Username already exists" });
      }

      const user = db.createUser({ username, password, role });

      return sendJson(res, 201, { user });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  /* GET/PUT/DELETE /api/users/:id */
  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);

  if (userMatch) {
    const session = requireAuth(req, res, ["admin"]);

    if (!session) {
      return;
    }

    const id = Number(userMatch[1]);

    if (method === "GET") {
      const user = db.getUserById(id);

      if (!user) {
        return sendJson(res, 404, { error: "User not found" });
      }

      return sendJson(res, 200, { user });
    }

    if (method === "PUT") {
      try {
        const body = await readBody(req);
        const existing = db.getUserById(id);

        if (!existing) {
          return sendJson(res, 404, { error: "User not found" });
        }

        const patch = {};

        if (body.username !== undefined) {
          const username = String(body.username).trim();

          if (!username) {
            return sendJson(res, 400, { error: "Username is required" });
          }

          const dup = db.getUserByUsername(username);

          if (dup && dup.id !== id) {
            return sendJson(res, 400, { error: "Username already exists" });
          }

          patch.username = username;
        }

        if (body.role !== undefined) {
          if (!db.isValidRole(String(body.role))) {
            return sendJson(res, 400, { error: "Role must be admin, technician, or viewer" });
          }

          if (existing.role === "admin" && body.role !== "admin" && db.countAdmins() <= 1) {
            return sendJson(res, 400, { error: "Cannot demote the last admin" });
          }

          patch.role = String(body.role);
        }

        if (body.password !== undefined && body.password !== null && body.password !== "") {
          patch.password = String(body.password);
        }

        const user = db.updateUser(id, patch);

        return sendJson(res, 200, { user });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (method === "DELETE") {
      if (id === session.userId) {
        return sendJson(res, 400, { error: "Cannot delete your own account" });
      }

      const existing = db.getUserById(id);

      if (!existing) {
        return sendJson(res, 404, { error: "User not found" });
      }

      if (existing.role === "admin" && db.countAdmins() <= 1) {
        return sendJson(res, 400, { error: "Cannot delete the last admin" });
      }

      db.deleteUser(id);

      return sendJson(res, 200, { ok: true });
    }
  }

  /* GET /api/summary */
  if (method === "GET" && pathname === "/api/summary") {
    return sendJson(res, 200, monitor.currentSummary());
  }

  /* GET /api/devices */
  if (method === "GET" && pathname === "/api/devices") {
    const devices = db.listDevices({
      status: query.get("status") || undefined,
      q: query.get("q") || undefined,
      sort: query.get("sort") || undefined,
    });

    return sendJson(res, 200, {
      devices: devices.map((d) => ({
        id: d.id,
        ip: d.ip,
        mac: d.mac,
        hostname: d.hostname,
        status: d.status,
        lastSeen: d.last_seen,
        firstSeen: d.first_seen,
        missCount: d.miss_count,
      })),
    });
  }

  /* GET /api/devices/:id */
  const deviceMatch = pathname.match(/^\/api\/devices\/(\d+)$/);

  if (method === "GET" && deviceMatch) {
    const device = db.getDeviceById(Number(deviceMatch[1]));

    if (!device) {
      return sendJson(res, 404, { error: "Device not found" });
    }

    return sendJson(res, 200, {
      device: {
        id: device.id,
        ip: device.ip,
        mac: device.mac,
        hostname: device.hostname,
        status: device.status,
        lastSeen: device.last_seen,
        firstSeen: device.first_seen,
        missCount: device.miss_count,
      },
      samples: db.getSamples(device.id, 200),
      events: db.listEventsForDevice(device.id, 50),
    });
  }

  /* GET /api/devices/:id/history?hours=24 */
  const historyMatch = pathname.match(/^\/api\/devices\/(\d+)\/history$/);

  if (method === "GET" && historyMatch) {
    const device = db.getDeviceById(Number(historyMatch[1]));

    if (!device) {
      return sendJson(res, 404, { error: "Device not found" });
    }

    const hours = Math.max(1, Number(query.get("hours")) || 24);
    const since = Date.now() - hours * 3600 * 1000;

    return sendJson(res, 200, {
      samples: db.getSamplesSince(device.id, since),
      events: db.listEventsForDevice(device.id, 200),
    });
  }

  /* GET /api/events */
  if (method === "GET" && pathname === "/api/events") {
    const limit = Math.max(1, Math.min(200, Number(query.get("limit")) || 50));
    return sendJson(res, 200, { events: db.listEvents(limit) });
  }

  /* GET /api/adapters */
  if (method === "GET" && pathname === "/api/adapters") {
    return sendJson(res, 200, { adapters: subnet.listAdapters() });
  }

  /* GET /api/settings */
  if (method === "GET" && pathname === "/api/settings") {
    return sendJson(res, 200, { settings: config.getAll() });
  }

  /* PUT /api/settings */
  if (method === "PUT" && pathname === "/api/settings") {
    const session = requireAuth(req, res, ["admin", "technician"]);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);
      const allowed = [
        "adapterName",
        "subnetOverride",
        "concurrency",
        "fullSweepMs",
        "fastLaneMs",
        "missThreshold",
        "retentionDays",
        "eventRetentionDays",
        "pingTimeoutMs",
      ];

      const partial = {};
      for (const key of allowed) {
        if (body[key] !== undefined) {
          partial[key] = body[key];
        }
      }

      const settings = config.save(partial);

      // reschedule if intervals changed
      monitor.rebuildTargets();
      monitor.scheduleFull();
      monitor.scheduleFast();

      return sendJson(res, 200, { settings });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  /* POST /api/scan */
  if (method === "POST" && pathname === "/api/scan") {
    const session = requireAuth(req, res, ["admin", "technician"]);

    if (!session) {
      return;
    }

    monitor.forceFullSweep();
    return sendJson(res, 202, { ok: true });
  }

  /* GET /api/topologies */
  if (method === "GET" && pathname === "/api/topologies") {
    return sendJson(res, 200, { topologies: topologyStore.list() });
  }

  /* POST /api/topologies */
  if (method === "POST" && pathname === "/api/topologies") {
    const session = requireAuth(req, res, ["admin", "technician"]);

    if (!session) {
      return;
    }

    try {
      const body = await readBody(req);
      const diagram = topologyStore.create(body);
      wsHub.broadcast("topology.created", {
        clientId: req.headers["x-client-id"] || null,
        diagram,
      });
      return sendJson(res, 201, { diagram });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  /* GET/PUT/DELETE /api/topologies/:id */
  const topologyMatch = pathname.match(/^\/api\/topologies\/([A-Za-z0-9-]+)$/);

  if (topologyMatch) {
    const id = topologyMatch[1];

    if (method === "GET") {
      const diagram = topologyStore.get(id);

      if (!diagram) {
        return sendJson(res, 404, { error: "Topology not found" });
      }

      return sendJson(res, 200, { diagram });
    }

    if (method === "PUT") {
      const session = requireAuth(req, res, ["admin", "technician"]);

      if (!session) {
        return;
      }

      try {
        const body = await readBody(req);
        const diagram = topologyStore.update(id, body);

        if (!diagram) {
          return sendJson(res, 404, { error: "Topology not found" });
        }

        wsHub.broadcast("topology.updated", {
          clientId: req.headers["x-client-id"] || null,
          diagram,
        });
        return sendJson(res, 200, { diagram });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (method === "DELETE") {
      const session = requireAuth(req, res, ["admin", "technician"]);

      if (!session) {
        return;
      }

      const ok = topologyStore.remove(id);

      if (!ok) {
        return sendJson(res, 404, { error: "Topology not found" });
      }

      wsHub.broadcast("topology.deleted", {
        clientId: req.headers["x-client-id"] || null,
        id,
      });
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

function createHandler() {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const query = url.searchParams;

    if (pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, pathname, query);
      } catch (error) {
        console.error("[api] error:", error);
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    serveStatic(req, res, pathname);
  };
}

module.exports = { createHandler };
