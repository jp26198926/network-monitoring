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
const localUrl = document.getElementById("localUrl");
const networkUrl = document.getElementById("networkUrl");
const message = document.getElementById("message");

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

function setRunningState(running, result) {
  if (running) {
    statusText.textContent = "● Running";
    statusText.className = "running";

    if (result) {
      localUrl.textContent = result.localUrl;

      if (result.networkUrl) {
        networkUrl.textContent = result.networkUrl;
      }
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    restartButton.disabled = false;
  } else {
    statusText.textContent = "● Stopped";
    statusText.className = "stopped";

    localUrl.textContent = "-";
    networkUrl.textContent = "-";

    startButton.disabled = false;
    stopButton.disabled = true;
    restartButton.disabled = true;
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
  }

  // IMPORTANT:
  // Check the real server state from Electron main process.
  const status = await window.electronAPI.getServerStatus();

  if (status.running) {
    setConfig({
      projectPath: status.projectPath,
      command: status.command,
      arguments: status.arguments,
      host: status.host,
      port: status.port,
    });

    setRunningState(true, {
      localUrl: `http://localhost:${status.port}`,
      networkUrl: status.networkUrl,
    });
  } else {
    setRunningState(false);
  }
}

browseButton.addEventListener("click", async () => {
  const result = await window.electronAPI.selectProjectFolder();

  if (result.success && result.path) {
    projectPathInput.value = result.path;
  }
});

serverForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const config = getConfig();

  showMessage("Starting server...");

  startButton.disabled = true;

  const result = await window.electronAPI.startServer(config);

  if (result.success) {
    setRunningState(true, result);
    showMessage("Server started successfully.");
  } else {
    startButton.disabled = false;
    showMessage(`Failed to start server: ${result.error}`);
  }
});

stopButton.addEventListener("click", async () => {
  showMessage("Stopping server...");

  const result = await window.electronAPI.stopServer();

  if (result.success) {
    setRunningState(false);
    showMessage("Server stopped.");
  } else {
    showMessage(`Failed to stop server: ${result.error}`);
  }
});

restartButton.addEventListener("click", async () => {
  const config = getConfig();

  showMessage("Restarting server...");

  const result = await window.electronAPI.restartServer(config);

  if (result.success) {
    setRunningState(true, result);
    showMessage("Server restarted successfully.");
  } else {
    showMessage(`Failed to restart server: ${result.error}`);
  }
});

saveButton.addEventListener("click", async () => {
  const config = getConfig();

  const result = await window.electronAPI.saveConfig(config);

  if (result.success) {
    showMessage("Configuration saved.");
  } else {
    showMessage(`Failed to save configuration: ${result.error}`);
  }
});

loadConfiguration();
