const { spawn, spawnSync } = require("child_process");
const { EventEmitter } = require("events");
const net = require("net");
const fs = require("fs");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Process State Bus
|--------------------------------------------------------------------------
|
| Emits "change" whenever the child process transitions (started, exited,
| failed). Main process forwards this to every window so the Launcher UI
| never keeps showing "Running" after a crash.
|
*/

const bus = new EventEmitter();
bus.setMaxListeners(20);

let serverProcess = null;
let currentServerConfig = null;
let lastSpawnError = null;
let stderrTail = [];

const STDERR_TAIL_LIMIT = 40;

function isAlive(child) {
  return !!(child && child.exitCode === null && child.killed === false && child.pid);
}

function pushStderrLine(line) {
  const text = String(line).replace(/\s+$/, "");
  if (!text) return;

  stderrTail.push(text);

  if (stderrTail.length > STDERR_TAIL_LIMIT) {
    stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
  }
}

function captureStream(stream, sink) {
  if (!stream) return;

  let buffer = "";

  stream.on("data", (chunk) => {
    sink.write(chunk);

    buffer += chunk.toString("utf8");
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || "";

    for (const line of parts) {
      pushStderrLine(line);
    }
  });

  stream.on("end", () => {
    if (buffer) pushStderrLine(buffer);
  });
}

function clearProcessState() {
  serverProcess = null;
  currentServerConfig = null;
}

/**
 * Pick the most useful line from captured stderr for a user-facing error.
 * Stack tails like "Node.js v24.18.0" are noise — prefer the real message.
 */
function summarizeStderrTail() {
  if (!stderrTail.length) {
    return null;
  }

  const noise = /^(Node\.js v|Error: Cannot find module|Require stack:|at |{$|}$|\^$|\s*$)/i;

  for (let i = stderrTail.length - 1; i >= 0; i--) {
    const line = stderrTail[i];
    if (
      /error|cannot find|exception|eaddrinuse|eacces|enoent|failed|throw/i.test(line) &&
      !/^at /.test(line)
    ) {
      return line;
    }
  }

  for (let i = stderrTail.length - 1; i >= 0; i--) {
    const line = stderrTail[i];
    if (line.trim() && !noise.test(line)) {
      return line;
    }
  }

  return stderrTail[stderrTail.length - 1] || null;
}

function emitChange(reason, detail = {}) {
  bus.emit("change", {
    reason,
    ...detail,
    status: getServerStatus(),
  });
}

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
 * Convert the argument string from the Launcher into an array.
 * Supports double-quoted segments so paths with spaces survive.
 *
 * Example:
 * 'run dev' → ["run", "dev"]
 * 'node "C:\\My Project\\server.js"' → ["node", "C:\\My Project\\server.js"]
 */
function parseArguments(argumentString) {
  if (!argumentString) {
    return [];
  }

  const args = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match;

  while ((match = re.exec(argumentString)) !== null) {
    args.push(match[1] !== undefined ? match[1] : match[2]);
  }

  return args.filter(Boolean);
}

/**
 * Windows requires .cmd for npm/npx when shell execution is disabled.
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
 * On Windows, only .cmd/.bat files need cmd.exe (they throw EINVAL when
 * spawned directly). Wrapping every command in cmd.exe would interpret
 * & | > %VAR% in user arguments — so we only wrap what actually needs it.
 */
function spawnCommand(command, args, options) {
  if (
    process.platform === "win32" &&
    /\.(cmd|bat)$/i.test(command)
  ) {
    return spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], options);
  }

  return spawn(command, args, options);
}

/**
 * Start the user's web server.
 *
 * Resolves only after the OS reports the process handle. Async spawn
 * failures (ENOENT, …) reject with the real error message instead of
 * pretending success and dying silently during waitForServer.
 */
function startServer(config) {
  return new Promise((resolve) => {
    try {
      if (serverProcess && isAlive(serverProcess)) {
        resolve({
          success: false,
          error: "A server is already running.",
        });

        return;
      }

      /*
       * Stale handle from a previous run — clear it so we don't
       * refuse to start after a crash/exit race.
       */
      if (serverProcess) {
        clearProcessState();
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

      /*
       * Save the current configuration in memory so the Launcher
       * can show what is running when it is reopened.
       */
      currentServerConfig = {
        ...config,
      };

      const env = {
        ...process.env,

        /*
         * Available to the child as process.env.HOST / process.env.PORT.
         */
        HOST: config.host || "0.0.0.0",
        PORT: String(config.port),
      };

      stderrTail = [];
      lastSpawnError = null;

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

          /*
           * stdin pipe is kept open by the parent so the
           * child can exit when Electron dies (see
           * web/server.js stdin watchdog).
           */
          stdio: ["pipe", "pipe", "pipe"],

          env,

          windowsHide: true,
        });
      } else {
        /**
         * Start the child process.
         *
         * We intentionally do NOT use shell: true (DEP0190).
         * stdout/stderr are piped so crash diagnostics are
         * captured and mirrored to the parent console.
         */
        serverProcess = spawnCommand(command, args, {
          cwd: config.projectPath,

          stdio: ["pipe", "pipe", "pipe"],

          env,

          windowsHide: true,
        });
      }

      const child = serverProcess;

      captureStream(child.stdout, process.stdout);
      captureStream(child.stderr, process.stderr);

      let settled = false;

      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve({ success: true, pid: child.pid });
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;

        if (serverProcess === child) {
          clearProcessState();
        }

        lastSpawnError = error.message;
        emitChange("spawn-error", { error: error.message });

        resolve({
          success: false,
          error: error.message,
        });
      };

      /**
       * Process failed to start (ENOENT, EACCES, …).
       */
      child.once("error", (error) => {
        console.error("Failed to start server:", error);
        fail(error);
      });

      /**
       * Process exited.
       *
       * Identity-guarded: a late exit from an old child must not
       * wipe the state of a newly started server.
       */
      child.on("exit", (code, signal) => {
        console.log(`Server exited. Code: ${code}, Signal: ${signal}`);

        const wasCurrent = serverProcess === child;

        if (wasCurrent) {
          clearProcessState();
        }

        if (!settled) {
          settled = true;

          const detail =
            summarizeStderrTail() ||
            `exit code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`;

          lastSpawnError = detail;

          if (wasCurrent) {
            emitChange("exit", { code, signal });
          }

          resolve({
            success: false,
            error: `The server process stopped before it became available. ${detail}`,
          });

          return;
        }

        if (wasCurrent) {
          emitChange("exit", { code, signal });
        }
      });

      /*
       * spawn() succeeded at the OS level.
       *
       * Give async "error" / immediate "exit" a brief window to land
       * so a bad command fails here with a real message instead of
       * looking like a readiness timeout later.
       */
      setTimeout(() => {
        if (!isAlive(child)) {
          fail(
            new Error(
              lastSpawnError ||
                "The server process exited immediately after starting.",
            ),
          );
          return;
        }

        succeed();
      }, 75);
    } catch (error) {
      clearProcessState();

      resolve({
        success: false,
        error: error.message,
      });
    }
  });
}

/**
 * Check whether something is listening on the specified port.
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
 * Wait until the web server is actually listening on the configured port.
 */
async function waitForServer(port, host = "127.0.0.1", timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    /**
     * The child process already stopped.
     */
    if (!isAlive(serverProcess)) {
      const detail = lastSpawnError || summarizeStderrTail();

      throw new Error(
        detail
          ? `The server process stopped before the application became available. ${detail}`
          : "The server process stopped before the application became available.",
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
 * On Windows we use taskkill with /T so child processes such as
 * npm → node are also terminated. spawnSync is required: an async
 * kill is abandoned when Electron quits and orphans the server.
 *
 * After killing we wait briefly for the handle to die so a follow-up
 * Start does not race a still-holding port.
 */
function stopServer() {
  if (!serverProcess) {
    return {
      success: true,
    };
  }

  const child = serverProcess;
  const pid = child.pid;

  console.log(`Stopping server process ${pid}...`);

  if (process.platform === "win32" && pid) {
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
    child.kill("SIGTERM");
  } catch {
    /* already dead */
  }

  /*
   * Detach immediately so status reflects "stopped" from the UI's
   * point of view. The exit handler is identity-guarded, so a late
   * exit from this child cannot clobber a newer server.
   */
  if (serverProcess === child) {
    clearProcessState();
  }

  emitChange("stopped", { pid });

  return {
    success: true,
  };
}

/**
 * Return the actual current server state.
 *
 * "running" is true only when the child handle is still alive —
 * not merely non-null. A crashed process must never report as running.
 */
function getServerStatus() {
  const alive = isAlive(serverProcess);

  if (!alive) {
    if (serverProcess) {
      clearProcessState();
    }

    return {
      running: false,
      alive: false,
      ready: false,
    };
  }

  return {
    running: true,
    alive: true,

    pid: serverProcess.pid,

    projectPath: currentServerConfig?.projectPath || null,
    command: currentServerConfig?.command || null,
    arguments: currentServerConfig?.arguments ?? null,
    host: currentServerConfig?.host || "0.0.0.0",
    port: currentServerConfig?.port || null,
    bundled: !!(currentServerConfig?.bundled || currentServerConfig?.command === "bundled"),
  };
}

/**
 * Async status: also probes the port so "ready" means something
 * is actually listening (not just a live handle).
 */
async function getServerStatusDetailed() {
  const status = getServerStatus();

  if (!status.running) {
    return status;
  }

  const port = Number(status.port);
  const ready = port ? await checkServerPort(port, "127.0.0.1") : false;

  return {
    ...status,
    ready,
  };
}

module.exports = {
  startServer,
  stopServer,
  waitForServer,
  getServerStatus,
  getServerStatusDetailed,
  checkServerPort,
  bus,
};
