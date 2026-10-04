/*
|--------------------------------------------------------------------------
| Live updates (socket.io)
|--------------------------------------------------------------------------
|
| Primary: socket.io push (polling → websocket transport upgrade, built-in
| reconnect). Consumers register per-event handlers; Live owns connection
| lifecycle and reports status ("connecting" | "live" | "reconnecting").
|
*/

const Live = (() => {
  let socket = null;
  let onStatus = null;
  let closed = false;

  function setStatus(next) {
    if (onStatus) onStatus(next);
  }

  function connect({ handlers = {}, onStatus: statusHandler } = {}) {
    onStatus = statusHandler;
    closed = false;
    setStatus("connecting");

    socket = io();

    for (const [event, fn] of Object.entries(handlers)) {
      socket.on(event, fn);
    }

    socket.on("connect", () => {
      if (closed) return;
      setStatus("live");
      socket.emit("hello");
    });

    socket.on("disconnect", () => {
      if (closed) return;
      setStatus("reconnecting");
    });

    socket.on("connect_error", () => {
      if (closed) return;
      setStatus("reconnecting");
    });
  }

  function close() {
    closed = true;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    setStatus("reconnecting");
  }

  return {
    connect,
    close,
  };
})();
