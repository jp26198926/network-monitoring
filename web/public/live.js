/*
|--------------------------------------------------------------------------
| Live updates (WebSocket + HTTP polling fallback)
|--------------------------------------------------------------------------
|
| Primary: WebSocket /ws push.
| Fallback: poll /api/summary + /api/devices every 2s when WS is blocked
| (some LANs / AV / proxies strip the HTTP Upgrade).
| Retries WS in the background so the client upgrades back to push.
|
*/

const Live = (() => {
  let ws = null;
  let onMessage = null;
  let onStatus = null;

  let pollTimer = null;
  let retryTimer = null;
  let reconnectDelay = 2000;
  let status = "reconnecting";
  let closed = false;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    if (onStatus) onStatus(next);
  }

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  function startPolling() {
    if (pollTimer) return;

    setStatus("polling");
    pollOnce();

    pollTimer = setInterval(pollOnce, 2000);

    if (!retryTimer) {
      retryTimer = setInterval(() => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectWs({ isRetry: true });
        }
      }, 30000);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }

  async function pollOnce() {
    try {
      const [summaryRes, devicesRes] = await Promise.all([
        fetch("/api/summary"),
        fetch("/api/devices"),
      ]);

      const summary = await summaryRes.json();
      const devicesData = await devicesRes.json();

      if (onMessage) {
        onMessage({
          type: "snapshot",
          devices: devicesData.devices || [],
          summary,
        });
      }
    } catch {
      /* keep polling */
    }
  }

  function connectWs({ isRetry = false } = {}) {
    if (closed) return;

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!isRetry && status === "reconnecting") {
      /* already showing connecting */
    }

    let socket;

    try {
      socket = new WebSocket(wsUrl());
    } catch {
      startPolling();
      return;
    }

    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;

      reconnectDelay = 2000;
      stopPolling();
      setStatus("live");

      try {
        socket.send(JSON.stringify({ type: "hello" }));
      } catch {
        /* ignore */
      }
    };

    socket.onmessage = (event) => {
      if (ws !== socket || !onMessage) return;

      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };

    socket.onclose = () => {
      if (ws !== socket) return;

      ws = null;

      if (closed) return;

      startPolling();

      if (!isRetry) {
        setTimeout(() => connectWs({ isRetry: true }), reconnectDelay);
        reconnectDelay = Math.min(15000, reconnectDelay * 1.5);
      }
    };
  }

  function connect({ onMessage: msgHandler, onStatus: statusHandler } = {}) {
    onMessage = msgHandler;
    onStatus = statusHandler;
    closed = false;
    reconnectDelay = 2000;
    setStatus("reconnecting");
    connectWs();
  }

  function close() {
    closed = true;
    stopPolling();

    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  }

  return {
    connect,
    close,
  };
})();
