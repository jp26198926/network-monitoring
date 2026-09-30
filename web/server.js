const http = require("http");

const config = require("./config");
const db = require("./lib/db");
const monitor = require("./lib/monitor");
const { createHandler } = require("./lib/api");
const wsHub = require("./lib/ws-hub");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

/*
|--------------------------------------------------------------------------
| Open Database
|--------------------------------------------------------------------------
*/

try {
  db.open();
  db.prune();
  console.log(`[db] ready at ${db.DB_FILE}`);
} catch (error) {
  console.error("[db] failed to open:", error);
  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| HTTP Server
|--------------------------------------------------------------------------
*/

const server = http.createServer(createHandler());

/*
|--------------------------------------------------------------------------
| WebSocket Hub
|--------------------------------------------------------------------------
*/

wsHub.attach(server);

/*
|--------------------------------------------------------------------------
| Start Monitoring Engine
|--------------------------------------------------------------------------
*/

monitor.start();

/*
|--------------------------------------------------------------------------
| Listen
|--------------------------------------------------------------------------
*/

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("==============================");
  console.log(" LAN Monitor");
  console.log("==============================");
  console.log(` Listening:  http://${HOST}:${PORT}`);
  console.log(` Database:   ${db.DB_FILE}`);
  console.log(` Subnet:     ${monitor.subnetInfo?.cidr || "unknown"}`);
  console.log(` Targets:    ${monitor.targets.length}`);
  console.log("==============================");
  console.log("");
});

/*
|--------------------------------------------------------------------------
| Graceful Shutdown
|--------------------------------------------------------------------------
*/

function shutdown() {
  console.log("\n[server] shutting down...");

  monitor.stop();
  wsHub.close();

  server.close(() => {
    db.close();
    process.exit(0);
  });

  // force-exit fallback
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
