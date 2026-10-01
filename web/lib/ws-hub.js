const { WebSocketServer } = require("ws");

const monitor = require("./monitor");

let wss = null;
let heartbeatTimer = null;
let latencyBuffer = [];
let latencyFlushTimer = null;

function attach(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.isAlive = true;

    console.log(`[ws] client connected (${wss.clients.size} total)`);

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(socket, msg);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.on("error", () => {
      /* ignore */
    });

    socket.on("close", () => {
      console.log(`[ws] client disconnected (${wss.clients.size} total)`);
    });

    // greet with a full snapshot
    socket.send(
      JSON.stringify({ type: "snapshot", ...monitor.snapshot() }),
    );
  });

  // wire monitor events → broadcast
  monitor.on("device.up", (device) => broadcast({ type: "device.up", device }));
  monitor.on("device.down", (device) => broadcast({ type: "device.down", device }));
  monitor.on("device.update", (device) => broadcast({ type: "device.update", device }));

  monitor.on("latency", (sample) => {
    latencyBuffer.push(sample);
  });

  // batch latency samples into ~1s frames
  latencyFlushTimer = setInterval(() => {
    if (!latencyBuffer.length) {
      return;
    }

    broadcast({ type: "latency", samples: latencyBuffer });
    latencyBuffer = [];
  }, 1000);

  monitor.on("summary", (summary) => {
    broadcast({ type: "summary", summary });
  });

  // heartbeat: ping every 30s, drop dead sockets
  heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);

  console.log("[ws] hub attached at /ws");
}

function handleClientMessage(socket, msg) {
  if (msg.type === "hello") {
    socket.send(JSON.stringify({ type: "snapshot", ...monitor.snapshot() }));
    return;
  }

  if (msg.type === "refresh") {
    monitor.forceFullSweep();
  }
}

function broadcast(payload) {
  if (!wss) {
    return;
  }

  const frame = JSON.stringify(payload);

  for (const socket of wss.clients) {
    if (socket.readyState === 1) {
      socket.send(frame);
    }
  }
}

function close() {
  clearInterval(heartbeatTimer);
  clearInterval(latencyFlushTimer);
  heartbeatTimer = null;
  latencyFlushTimer = null;

  if (wss) {
    for (const socket of wss.clients) {
      socket.terminate();
    }
    wss.close();
    wss = null;
  }
}

module.exports = {
  attach,
  broadcast,
  close,
};
