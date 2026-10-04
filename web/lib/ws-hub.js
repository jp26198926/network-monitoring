const { Server } = require("socket.io");

const monitor = require("./monitor");

let io = null;
let latencyBuffer = [];
let latencyFlushTimer = null;

function attach(server) {
  io = new Server(server);

  io.on("connection", (socket) => {
    console.log(`[ws] client connected (${io.engine.clientsCount} total)`);

    // greet with a full snapshot
    socket.emit("snapshot", monitor.snapshot());

    socket.on("hello", () => {
      socket.emit("snapshot", monitor.snapshot());
    });

    socket.on("disconnect", () => {
      console.log(`[ws] client disconnected (${io.engine.clientsCount} total)`);
    });
  });

  // wire monitor events → broadcast
  monitor.on("device.up", (device) => broadcast("device.up", device));
  monitor.on("device.down", (device) => broadcast("device.down", device));
  monitor.on("device.update", (device) => broadcast("device.update", device));

  monitor.on("latency", (sample) => {
    latencyBuffer.push(sample);
  });

  // batch latency samples into ~1s frames
  latencyFlushTimer = setInterval(() => {
    if (!latencyBuffer.length) {
      return;
    }

    broadcast("latency", latencyBuffer);
    latencyBuffer = [];
  }, 1000);

  monitor.on("summary", (summary) => {
    broadcast("summary", summary);
  });

  console.log("[ws] hub attached at /socket.io");
}

function broadcast(event, payload) {
  if (!io) {
    return;
  }

  io.emit(event, payload);
}

function close() {
  clearInterval(latencyFlushTimer);
  latencyFlushTimer = null;
  latencyBuffer = [];

  if (io) {
    io.disconnectSockets(true);
    io = null;
  }
}

module.exports = {
  attach,
  broadcast,
  close,
};
