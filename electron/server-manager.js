const { spawn, spawnSync } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");

let serverProcess = null;
let currentServerConfig = null;

/**
 * Validate that the project folder exists.
 */
function validateProjectPath(projectPath) {
  if (!projectPath) {
    throw new Error("Project path is required.");
  }

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist:\n${projectPath}`);
  }
}

/**
 * Convert the argument string from the Launcher
 * into an array.
 *
 * Example:
 * "run dev" → ["run", "dev"]
 */
function parseArguments(argumentString) {
  if (!argumentString) {
    return [];
  }

  return argumentString.trim().split(/\s+/).filter(Boolean);
}

/**
 * Windows requires .cmd for npm/npx
 * when shell execution is disabled.
 */
function normalizeCommand(command) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npx")
  ) {
    return `${command}.cmd`;
  }

  return command;
}

/**
 * Spawn a command without shell: true.
 *
 * On Windows, .cmd/.bat files cannot be spawned directly
 * (they throw EINVAL). We run them through cmd.exe /c
 * instead of enabling shell: true, which would trigger
 * the DEP0190 deprecation warning.
 */
function spawnCommand(command, args, options) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/c", command, ...args], options);
  }

  return spawn(command, args, options);
}

/**
 * Start the user's web server.
 */
function startServer(config) {
  return new Promise((resolve) => {
    try {
      if (serverProcess) {
        resolve({
          success: false,
          error: "A server is already running.",
        });

        return;
      }

      validateProjectPath(config.projectPath);

      if (!config.port) {
        resolve({
          success: false,
          error: "Port is required.",
        });

        return;
      }

      const args = parseArguments(config.arguments);

      const command = normalizeCommand(config.command);

      /**
       * Save the current configuration in memory.
       *
       * This is important because when the Launcher
       * is reopened, we need to know what server is
       * currently running.
       */
      currentServerConfig = {
        ...config,
      };

      const env = {
        ...process.env,

        /**
         * These values are available to
         * the child web application through:
         *
         * process.env.HOST
         * process.env.PORT
         */
        HOST: config.host || "0.0.0.0",
        PORT: String(config.port),
      };

      console.log("");
      console.log("==============================");
      console.log("Starting Application");
      console.log("==============================");
      console.log(`Project: ${config.projectPath}`);
      console.log(`Command: ${config.bundled ? "bundled (electron-node)" : command}`);
      console.log("Arguments:", config.bundled ? [path.join(config.projectPath, "server.js")] : args);
      console.log(`Host: ${config.host}`);
      console.log(`Port: ${config.port}`);
      console.log("==============================");
      console.log("");

      if (config.bundled) {
        /*
         *--------------------------------------------------------------------
         * Bundled mode: run server.js on Electron's own Node.
         *--------------------------------------------------------------------
         *
         * Do NOT disable the RunAsNode fuse (@electron/fuses)
         * — ELECTRON_RUN_AS_NODE would be ignored and this
         * spawn would fail.
         */
        env.ELECTRON_RUN_AS_NODE = "1";
        env.LAN_MONITOR_PARENT_WATCH = "1";

        if (config.dataDir) {
          env.LAN_MONITOR_DATA_DIR = config.dataDir;
        }

        const entry = path.join(config.projectPath, "server.js");

        serverProcess = spawn(process.execPath, [entry], {
          cwd: config.projectPath,

          /**
           * stdin pipe is kept open by the parent so the
           * child can exit when Electron dies (see
           * web/server.js stdin watchdog).
           */
          stdio: ["pipe", "ignore", "ignore"],

          env,

          windowsHide: true,
        });
      } else {
        /**
         * Start the child process.
         *
         * We intentionally do NOT use:
         *
         * shell: true
         *
         * This avoids the Node DEP0190 warning.
         */
        serverProcess = spawnCommand(command, args, {
          cwd: config.projectPath,

          stdio: "inherit",

          env,

          windowsHide: false,
        });
      }

      let resolved = false;

      /**
       * Process failed to start.
       */
      serverProcess.once("error", (error) => {
        console.error("Failed to start server:", error);

        serverProcess = null;
        currentServerConfig = null;

        if (!resolved) {
          resolved = true;

          resolve({
            success: false,
            error: error.message,
          });
        }
      });

      /**
       * Process exited.
       */
      serverProcess.on("exit", (code, signal) => {
        console.log(`Server exited. Code: ${code}, Signal: ${signal}`);

        serverProcess = null;
        currentServerConfig = null;
      });

      /**
       * spawn() succeeded.
       *
       * IMPORTANT:
       * This does NOT mean the web server is ready yet.
       *
       * waitForServer() will check the port afterward.
       */
      if (!resolved) {
        resolved = true;

        resolve({
          success: true,
        });
      }
    } catch (error) {
      serverProcess = null;
      currentServerConfig = null;

      resolve({
        success: false,
        error: error.message,
      });
    }
  });
}

/**
 * Check whether something is listening
 * on the specified port.
 */
function checkServerPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(1000);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Wait until the web server is actually
 * listening on the configured port.
 */
async function waitForServer(port, host = "127.0.0.1", timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    /**
     * The child process already stopped.
     */
    if (!serverProcess) {
      throw new Error(
        "The server process stopped before the application became available.",
      );
    }

    const running = await checkServerPort(port, host);

    if (running) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw new Error(
    `Server did not become available within ${timeout / 1000} seconds.`,
  );
}

/**
 * Stop the server.
 *
 * On Windows we use taskkill with /T
 * so child processes such as npm -> node
 * are also terminated.
 *
 * taskkill is spawned with spawnSync so the
 * process tree is fully killed before this
 * returns. This matters on app quit, where an
 * async spawn would be abandoned mid-kill and
 * leave the web server running.
 */
function stopServer() {
  if (!serverProcess) {
    return {
      success: true,
    };
  }

  const pid = serverProcess.pid;

  console.log(`Stopping server process ${pid}...`);

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });

    if (result.status !== 0) {
      console.error(
        `taskkill failed for pid ${pid}:`,
        result.error?.message || result.stderr || `status ${result.status}`,
      );
    }
  }

  /*
   * Always try kill() as well — covers cases where
   * taskkill cannot walk the tree (cmd.exe wrapper)
   * or the PID is the real node process.
   */
  try {
    serverProcess.kill("SIGTERM");
  } catch {
    /* already dead */
  }

  serverProcess = null;
  currentServerConfig = null;

  return {
    success: true,
  };
}

/**
 * Return the actual current server state.
 *
 * This is used by the Launcher when it
 * is opened again.
 */
function getServerStatus() {
  if (!serverProcess) {
    return {
      running: false,
    };
  }

  return {
    running: true,

    pid: serverProcess.pid,

    projectPath: currentServerConfig?.projectPath || null,

    command: currentServerConfig?.command || null,

    arguments: currentServerConfig?.arguments || null,

    host: currentServerConfig?.host || "0.0.0.0",

    port: currentServerConfig?.port || null,
  };
}

module.exports = {
  startServer,
  stopServer,
  waitForServer,
  getServerStatus,
  checkServerPort,
};
