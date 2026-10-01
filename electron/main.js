const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");

const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  startServer,
  stopServer,
  waitForServer,
  getServerStatus,
  checkServerPort,
} = require("./server-manager");

let mainWindow = null;
let launcherWindow = null;

/*
|--------------------------------------------------------------------------
| Configuration File
|--------------------------------------------------------------------------
*/

const configFile = path.join(app.getPath("userData"), "server-config.json");

/*
|--------------------------------------------------------------------------
| Bundled Web Application
|--------------------------------------------------------------------------
|
| When packaged, the LAN Monitor server ships under resources/web and
| is started with Electron's own Node (ELECTRON_RUN_AS_NODE). The target
| machine does not need Node.js or npm installed.
|
*/

function getBundledWebRoot() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.join(app.getAppPath(), "web");

  return fs.existsSync(path.join(root, "server.js")) ? root : null;
}

function buildBundledConfig() {
  const webRoot = getBundledWebRoot();

  if (!webRoot) {
    return null;
  }

  let savedPort = 3000;

  try {
    if (fs.existsSync(configFile)) {
      const saved = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      if (saved?.port) {
        savedPort = saved.port;
      }
    }
  } catch {
    /* fall through to default port */
  }

  return {
    projectPath: webRoot,
    command: "bundled",
    arguments: "",
    host: "0.0.0.0",
    port: String(savedPort),
    bundled: true,
    dataDir: path.join(app.getPath("userData"), "lan-monitor"),
  };
}

/*
|--------------------------------------------------------------------------
| Auto-Start Bundled Server
|--------------------------------------------------------------------------
|
| Packaged builds boot straight into the bundled LAN Monitor.
| Dev (npm start) is unchanged — open the Launcher manually.
|
*/

async function startBundledAndLoad() {
  if (!app.isPackaged) {
    return;
  }

  const config = buildBundledConfig();

  if (!config) {
    return;
  }

  const port = Number(config.port);

  if (await checkServerPort(port, "127.0.0.1")) {
    dialog.showErrorBox(
      "Port in use",
      `Port ${config.port} is already in use.\n\n` +
        "Close the other application or change the port in the Server Launcher.",
    );

    return;
  }

  const result = await startServer(config);

  if (!result.success) {
    dialog.showErrorBox("Failed to start LAN Monitor", result.error);

    return;
  }

  try {
    await waitForServer(port, "127.0.0.1", 30000);
  } catch (error) {
    stopServer();

    dialog.showErrorBox("LAN Monitor did not start", error.message);

    return;
  }

  if (mainWindow) {
    await mainWindow.loadURL(`http://localhost:${config.port}`);
  }
}

/*
|--------------------------------------------------------------------------
| Get Local Network IP Address
|--------------------------------------------------------------------------
*/

function getNetworkAddress() {
  const interfaces = os.networkInterfaces();

  for (const interfaceName of Object.keys(interfaces)) {
    const addresses = interfaces[interfaceName];

    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Create Main Application Window
|--------------------------------------------------------------------------
*/

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,

    minWidth: 900,
    minHeight: 600,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /*
    |--------------------------------------------------------------------------
    | Initial Application Page
    |--------------------------------------------------------------------------
    */

  mainWindow.loadFile(
    path.join(__dirname, "..", "renderer", "app", "index.html"),
  );

  mainWindow.on("closed", () => {
    mainWindow = null;

    /*
      |--------------------------------------------------------------------------
      | Stop the Web Server
      |--------------------------------------------------------------------------
      |
      | Closing the main window must also shut down
      | the child web server process.
      |
      */

    stopServer();
  });
}

/*
|--------------------------------------------------------------------------
| Create Launcher Window
|--------------------------------------------------------------------------
*/

function createLauncherWindow() {
  /*
    |--------------------------------------------------------------------------
    | If Launcher is already open
    |--------------------------------------------------------------------------
    */

  if (launcherWindow) {
    launcherWindow.show();
    launcherWindow.focus();

    return;
  }

  /*
    |--------------------------------------------------------------------------
    | Create Launcher
    |--------------------------------------------------------------------------
    */

  launcherWindow = new BrowserWindow({
    width: 650,
    height: 720,

    minWidth: 650,
    minHeight: 720,

    resizable: false,

    /*
        |--------------------------------------------------------------------------
        | Make Launcher a child of Main Window
        |--------------------------------------------------------------------------
        */

    parent: mainWindow,

    /*
        |--------------------------------------------------------------------------
        | Modal
        |--------------------------------------------------------------------------
        |
        | The user must close the Launcher before interacting
        | with the main application window.
        |
        */

    modal: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /*
    |--------------------------------------------------------------------------
    | Load Launcher HTML
    |--------------------------------------------------------------------------
    */

  launcherWindow.loadFile(
    path.join(__dirname, "..", "renderer", "launcher", "index.html"),
  );

  /*
    |--------------------------------------------------------------------------
    | When Launcher is Closed
    |--------------------------------------------------------------------------
    */

  launcherWindow.on("closed", () => {
    launcherWindow = null;
  });
}

/*
|--------------------------------------------------------------------------
| Create Application Menu
|--------------------------------------------------------------------------
*/

function createApplicationMenu() {
  const template = [
    {
      label: "Application",

      submenu: [
        {
          label: "Server Launcher",

          click: () => {
            createLauncherWindow();
          },
        },

        {
          type: "separator",
        },

        {
          label: "Quit",

          click: () => {
            app.quit();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);

  Menu.setApplicationMenu(menu);
}

/*
|--------------------------------------------------------------------------
| IPC - Open Launcher
|--------------------------------------------------------------------------
*/

ipcMain.handle("launcher:open", () => {
  createLauncherWindow();

  return {
    success: true,
  };
});

/*
|--------------------------------------------------------------------------
| IPC - Select Project Folder
|--------------------------------------------------------------------------
*/

ipcMain.handle("project:select", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Project Folder",

    properties: ["openDirectory"],
  });

  if (result.canceled) {
    return {
      success: false,
    };
  }

  return {
    success: true,
    path: result.filePaths[0],
  };
});

/*
|--------------------------------------------------------------------------
| IPC - Save Configuration
|--------------------------------------------------------------------------
*/

ipcMain.handle("config:save", async (event, config) => {
  try {
    await fs.promises.mkdir(path.dirname(configFile), {
      recursive: true,
    });

    await fs.promises.writeFile(
      configFile,

      JSON.stringify(config, null, 4),

      "utf-8",
    );

    return {
      success: true,
    };
  } catch (error) {
    console.error("Failed to save configuration:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});

/*
|--------------------------------------------------------------------------
| IPC - Load Configuration
|--------------------------------------------------------------------------
*/

ipcMain.handle("config:load", async () => {
  try {
    if (!fs.existsSync(configFile)) {
      return {
        success: true,
        config: null,
      };
    }

    const content = await fs.promises.readFile(configFile, "utf-8");

    const config = JSON.parse(content);

    return {
      success: true,
      config,
    };
  } catch (error) {
    console.error("Failed to load configuration:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});

/*
|--------------------------------------------------------------------------
| IPC - Start Server
|--------------------------------------------------------------------------
*/

ipcMain.handle("server:start", async (event, config) => {
  try {
    /*
            |--------------------------------------------------------------------------
            | Basic Validation
            |--------------------------------------------------------------------------
            */

    if (!config.projectPath) {
      throw new Error("Project path is required.");
    }

    if (!config.command) {
      throw new Error("Command is required.");
    }

    if (!config.port) {
      throw new Error("Port is required.");
    }

    /*
            |--------------------------------------------------------------------------
            | Start Child Process
            |--------------------------------------------------------------------------
            */

    const result = await startServer(config);

    if (!result.success) {
      throw new Error(result.error);
    }

    /*
            |--------------------------------------------------------------------------
            | Wait Until Server Is Ready
            |--------------------------------------------------------------------------
            |
            | Even when the child process starts successfully,
            | the web server may still need a few seconds to boot.
            |
            */

    await waitForServer(
      Number(config.port),

      /*
                |--------------------------------------------------------------------------
                | We check localhost.
                |--------------------------------------------------------------------------
                |
                | The actual server can listen on 0.0.0.0.
                | We still connect through 127.0.0.1 to check
                | whether the port is available.
                |
                */

      "127.0.0.1",

      30000,
    );

    /*
            |--------------------------------------------------------------------------
            | URLs
            |--------------------------------------------------------------------------
            */

    const localUrl = `http://localhost:${config.port}`;

    const networkAddress = getNetworkAddress();

    const networkUrl = networkAddress
      ? `http://${networkAddress}:${config.port}`
      : null;

    /*
            |--------------------------------------------------------------------------
            | Load Web Application
            |--------------------------------------------------------------------------
            */

    if (mainWindow) {
      await mainWindow.loadURL(localUrl);
    }

    /*
            |--------------------------------------------------------------------------
            | Close Launcher
            |--------------------------------------------------------------------------
            */

    if (launcherWindow) {
      launcherWindow.close();
    }

    return {
      success: true,

      localUrl,

      networkUrl,
    };
  } catch (error) {
    console.error("Failed to start server:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});

/*
|--------------------------------------------------------------------------
| IPC - Stop Server
|--------------------------------------------------------------------------
*/

ipcMain.handle("server:stop", async () => {
  try {
    const result = stopServer();

    /*
            |--------------------------------------------------------------------------
            | Return Main Window to Launcher Placeholder
            |--------------------------------------------------------------------------
            */

    if (result.success && mainWindow) {
      await mainWindow.loadFile(
        path.join(__dirname, "..", "renderer", "app", "index.html"),
      );
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Failed to stop server:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});

/*
|--------------------------------------------------------------------------
| IPC - Restart Server
|--------------------------------------------------------------------------
*/

ipcMain.handle("server:restart", async (event, config) => {
  try {
    /*
            |--------------------------------------------------------------------------
            | Stop Existing Server
            |--------------------------------------------------------------------------
            */

    stopServer();

    /*
            |--------------------------------------------------------------------------
            | Give Windows a moment to release the port
            |--------------------------------------------------------------------------
            */

    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    /*
            |--------------------------------------------------------------------------
            | Start Again
            |--------------------------------------------------------------------------
            */

    const result = await startServer(config);

    if (!result.success) {
      throw new Error(result.error);
    }

    /*
            |--------------------------------------------------------------------------
            | Wait Until Ready
            |--------------------------------------------------------------------------
            */

    await waitForServer(Number(config.port), "127.0.0.1", 30000);

    /*
            |--------------------------------------------------------------------------
            | URLs
            |--------------------------------------------------------------------------
            */

    const localUrl = `http://localhost:${config.port}`;

    const networkAddress = getNetworkAddress();

    const networkUrl = networkAddress
      ? `http://${networkAddress}:${config.port}`
      : null;

    /*
            |--------------------------------------------------------------------------
            | Load Application
            |--------------------------------------------------------------------------
            */

    if (mainWindow) {
      await mainWindow.loadURL(localUrl);
    }

    /*
            |--------------------------------------------------------------------------
            | Close Launcher
            |--------------------------------------------------------------------------
            */

    if (launcherWindow) {
      launcherWindow.close();
    }

    return {
      success: true,

      localUrl,

      networkUrl,
    };
  } catch (error) {
    console.error("Failed to restart server:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});

/*
|--------------------------------------------------------------------------
| IPC - Server Status
|--------------------------------------------------------------------------
|
| This is the important part for your issue.
|
| When the Launcher is closed and opened again,
| it asks the Main Process for the REAL server state.
|
*/

ipcMain.handle("server:status", () => {
  const status = getServerStatus();

  /*
        |--------------------------------------------------------------------------
        | Server is NOT running
        |--------------------------------------------------------------------------
        */

  if (!status.running) {
    return {
      running: false,
    };
  }

  /*
        |--------------------------------------------------------------------------
        | Server IS running
        |--------------------------------------------------------------------------
        */

  const networkAddress = getNetworkAddress();

  return {
    running: true,

    pid: status.pid,

    projectPath: status.projectPath,

    command: status.command,

    arguments: status.arguments,

    host: status.host,

    port: status.port,

    localUrl: `http://localhost:${status.port}`,

    networkUrl: networkAddress
      ? `http://${networkAddress}:${status.port}`
      : null,
  };
});

/*
|--------------------------------------------------------------------------
| Electron Ready
|--------------------------------------------------------------------------
*/

app.whenReady().then(() => {
  /*
    |--------------------------------------------------------------------------
    | Create Main Window
    |--------------------------------------------------------------------------
    */

  createMainWindow();

  /*
    |--------------------------------------------------------------------------
    | Create Application Menu
    |--------------------------------------------------------------------------
    */

  createApplicationMenu();

  /*
    |--------------------------------------------------------------------------
    | Auto-Start Bundled LAN Monitor (packaged builds only)
    |--------------------------------------------------------------------------
    */

  startBundledAndLoad();
});

/*
|--------------------------------------------------------------------------
| macOS
|--------------------------------------------------------------------------
|
| On macOS, clicking the application icon after all windows
| have been closed should recreate the window.
|
*/

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

/*
|--------------------------------------------------------------------------
| Application Quit
|--------------------------------------------------------------------------
|
| Make sure the web server is also stopped when
| Electron itself is closed.
|
*/

app.on("will-quit", () => {
  stopServer();
});

/*
|--------------------------------------------------------------------------
| Windows / Linux
|--------------------------------------------------------------------------
|
| Quit the application when all windows are closed.
|
*/

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
