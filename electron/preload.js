const { contextBridge, ipcRenderer } = require("electron");

/*
|--------------------------------------------------------------------------
| File-Page Only API
|--------------------------------------------------------------------------
|
| Expose the privileged bridge ONLY to our own file:// pages (placeholder
| + launcher). After mainWindow navigates to http://localhost:<port> the
| served web app must not be able to call server:stop / config:save.
|
*/

const isLocalFilePage = (() => {
  try {
    return typeof location !== "undefined" && location.protocol === "file:";
  } catch {
    return false;
  }
})();

if (isLocalFilePage) {
  contextBridge.exposeInMainWorld("electronAPI", {
    /*
     * Launcher
     */

    openLauncher: () => {
      return ipcRenderer.invoke("launcher:open");
    },

    /*
     * Folder picker
     */

    selectProjectFolder: () => {
      return ipcRenderer.invoke("project:select");
    },

    /*
     * Server
     */

    startServer: (config) => {
      return ipcRenderer.invoke("server:start", config);
    },

    stopServer: () => {
      return ipcRenderer.invoke("server:stop");
    },

    restartServer: (config) => {
      return ipcRenderer.invoke("server:restart", config);
    },

    getServerStatus: () => {
      return ipcRenderer.invoke("server:status");
    },

    /*
     * Live status push (start / exit / crash / stop).
     * Returns an unsubscribe function.
     */

    onServerStatus: (callback) => {
      const listener = (_event, payload) => {
        try {
          callback(payload);
        } catch {
          /* never let a renderer callback break the bridge */
        }
      };

      ipcRenderer.on("server:status-changed", listener);

      return () => {
        ipcRenderer.removeListener("server:status-changed", listener);
      };
    },

    /*
     * Configuration
     */

    saveConfig: (config) => {
      return ipcRenderer.invoke("config:save", config);
    },

    loadConfig: () => {
      return ipcRenderer.invoke("config:load");
    },
  });
}
