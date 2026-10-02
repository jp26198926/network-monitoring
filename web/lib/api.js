const fs = require("fs");
const path = require("path");

const db = require("./db");
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

async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const segments = pathname.split("/").filter(Boolean); // ['api', ...]

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
    monitor.forceFullSweep();
    return sendJson(res, 202, { ok: true });
  }

  /* GET /api/topologies */
  if (method === "GET" && pathname === "/api/topologies") {
    return sendJson(res, 200, { topologies: topologyStore.list() });
  }

  /* POST /api/topologies */
  if (method === "POST" && pathname === "/api/topologies") {
    try {
      const body = await readBody(req);
      const diagram = topologyStore.create(body);
      wsHub.broadcast({
        type: "topology.created",
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
      try {
        const body = await readBody(req);
        const diagram = topologyStore.update(id, body);

        if (!diagram) {
          return sendJson(res, 404, { error: "Topology not found" });
        }

        wsHub.broadcast({
          type: "topology.updated",
          clientId: req.headers["x-client-id"] || null,
          diagram,
        });
        return sendJson(res, 200, { diagram });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (method === "DELETE") {
      const ok = topologyStore.remove(id);

      if (!ok) {
        return sendJson(res, 404, { error: "Topology not found" });
      }

      wsHub.broadcast({
        type: "topology.deleted",
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
