const projectPathInput = document.getElementById("projectPath");
const browseButton = document.getElementById("browseButton");
const commandInput = document.getElementById("command");
const argumentsInput = document.getElementById("arguments");
const hostInput = document.getElementById("host");
const portInput = document.getElementById("port");
const serverForm = document.getElementById("serverForm");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const restartButton = document.getElementById("restartButton");
const saveButton = document.getElementById("saveButton");
const statusText = document.getElementById("status");
const pidRow = document.getElementById("pidRow");
const pidText = document.getElementById("pid");
const localUrl = document.getElementById("localUrl");
const networkUrl = document.getElementById("networkUrl");
const message = document.getElementById("message");

let busy = false;
let statusPollTimer = null;

function showMessage(text) {
  message.textContent = text;
}

function getConfig() {
  return {
    projectPath: projectPathInput.value.trim(),
    command: commandInput.value.trim(),
    arguments: argumentsInput.value.trim(),
    host: hostInput.value.trim(),
    port: portInput.value.trim(),
  };
}

function setConfig(config) {
  if (config.projectPath) {
    projectPathInput.value = config.projectPath;
  }

  if (config.command) {
    commandInput.value = config.command;
  }

  if (config.arguments !== undefined && config.arguments !== null) {
    argumentsInput.value = config.arguments;
  }

  if (config.host) {
    hostInput.value = config.host;
  }

  if (config.port) {
    portInput.value = config.port;
  }
}

function setBusy(isBusy) {
  busy = isBusy;

  const running = statusText.classList.contains("running");
  const starting = statusText.classList.contains("starting");

  browseButton.disabled = isBusy;
  saveButton.disabled = isBusy;

  startButton.disabled = isBusy || running || starting;
  stopButton.disabled = isBusy || !(running || starting);
  restartButton.disabled = isBusy || !running;
}

function applyStatus(status, result) {
  const running = !!(status && status.running);
  const ready = !!(status && status.ready);
  const alive = !!(status && (status.alive || status.running));

  if (running && ready) {
    statusText.textContent = "● Running";
    statusText.className = "running";

    const port = status.port || result?.port;
    localUrl.textContent =
      status.localUrl || result?.localUrl || (port ? `http://127.0.0.1:${port}` : "-");
    networkUrl.textContent = status.networkUrl || result?.networkUrl || "-";

    if (status.pid) {
      pidRow.hidden = false;
      pidText.textContent = String(status.pid);
    } else {
      pidRow.hidden = true;
    }
  } else if (alive) {
    /*
     * Process is up but nothing is listening yet (or stopped
     * responding). Never call this "Running".
     */
    statusText.textContent = "● Starting…";
    statusText.className = "starting";

    localUrl.textContent = "-";
    networkUrl.textContent = "-";
    pidRow.hidden = !status.pid;
    if (status.pid) pidText.textContent = String(status.pid);
  } else {
    statusText.textContent = "● Stopped";
    statusText.className = "stopped";

    localUrl.textContent = "-";
    networkUrl.textContent = "-";
    pidRow.hidden = true;
    pidText.textContent = "—";
  }

  setBusy(busy);
}

async function refreshStatus(reason = "poll") {
  try {
    const status = await window.electronAPI.getServerStatus();
    applyStatus(status);
    return status;
  } catch (error) {
    console.warn("status refresh failed", reason, error);
    return null;
  }
}

function startStatusPolling() {
  stopStatusPolling();

  /*
   * Belt-and-braces: even if a push event is missed, the panel
   * re-validates against the real process every few seconds.
   */
  statusPollTimer = setInterval(() => {
    if (!busy) {
      refreshStatus("poll");
    }
  }, 4000);
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

async function loadConfiguration() {
  const result = await window.electronAPI.loadConfig();

  if (result.success) {
    if (result.defaults) {
      setConfig(result.defaults);
    }

    if (result.config) {
      setConfig(result.config);
      showMessage("Saved configuration loaded.");
    } else if (result.defaults && result.defaults.command === "bundled") {
      showMessage("Bundled defaults applied.");
    }
  } else if (result.error) {
    showMessage(`Failed to load configuration: ${result.error}`);
  }

  // IMPORTANT:
  // Check the real server state from Electron main process.
  const status = await refreshStatus("open");

  if (status && status.running) {
    setConfig({
      projectPath: status.projectPath,
      command: status.command,
      arguments: status.arguments,
      host: status.host,
      port: status.port,
    });
  }

  startStatusPolling();
}

/*
|--------------------------------------------------------------------------
| Live status push from main process
|--------------------------------------------------------------------------
|
| Fires when the child starts, exits, crashes, or is stopped from
| anywhere (menu, other window, main-window close).
|
*/

if (window.electronAPI.onServerStatus) {
  window.electronAPI.onServerStatus((payload) => {
    if (busy && payload?.reason !== "exit" && payload?.reason !== "stopped") {
      return;
    }

    applyStatus(payload || {});

    const reason = payload?.reason;

    if (reason === "exit") {
      showMessage("Server process exited.");
      setBusy(false);
    } else if (reason === "spawn-error") {
      showMessage(`Server failed to start: ${payload?.error || "unknown error"}`);
      setBusy(false);
    } else if (reason === "stopped") {
      if (!busy) showMessage("Server stopped.");
      setBusy(false);
    }
  });
}

browseButton.addEventListener("click", async () => {
  const result = await window.electronAPI.selectProjectFolder();

  if (result.success && result.path) {
    projectPathInput.value = result.path;
  }
});

serverForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (busy) return;

  const config = getConfig();

  showMessage("Starting server…");
  setBusy(true);
  statusText.textContent = "● Starting…";
  statusText.className = "starting";

  const result = await window.electronAPI.startServer(config);

  if (result.success) {
    applyStatus({ running: true, alive: true, ready: true, ...result }, result);
    showMessage("Server started successfully.");
    setBusy(false);
  } else {
    setBusy(false);
    await refreshStatus("start-failed");
    showMessage(`Failed to start server: ${result.error}`);
  }
});

stopButton.addEventListener("click", async () => {
  if (busy) return;

  showMessage("Stopping server…");
  setBusy(true);

  const result = await window.electronAPI.stopServer();

  setBusy(false);

  if (result.success) {
    applyStatus({ running: false, alive: false, ready: false });
    showMessage("Server stopped.");
  } else {
    await refreshStatus("stop-failed");
    showMessage(`Failed to stop server: ${result.error || "unknown error"}`);
  }
});

restartButton.addEventListener("click", async () => {
  if (busy) return;

  const config = getConfig();

  showMessage("Restarting server…");
  setBusy(true);
  statusText.textContent = "● Starting…";
  statusText.className = "starting";

  const result = await window.electronAPI.restartServer(config);

  if (result.success) {
    applyStatus({ running: true, alive: true, ready: true, ...result }, result);
    showMessage("Server restarted successfully.");
    setBusy(false);
  } else {
    /*
     * Critical: a failed restart leaves the server STOPPED.
     * Never keep the previous "Running" panel on screen.
     */
    setBusy(false);
    await refreshStatus("restart-failed");
    showMessage(`Failed to restart server: ${result.error}`);
  }
});

saveButton.addEventListener("click", async () => {
  if (busy) return;

  const config = getConfig();

  if (!config.projectPath || !config.command || !config.port) {
    showMessage("Project path, command, and port are required to save.");
    return;
  }

  const result = await window.electronAPI.saveConfig(config);

  if (result.success) {
    showMessage("Configuration saved.");
  } else {
    showMessage(`Failed to save configuration: ${result.error}`);
  }
});

window.addEventListener("beforeunload", () => {
  stopStatusPolling();
});

loadConfiguration();
