const { contextBridge, ipcRenderer } = require("electron");

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
   * Configuration
   */

  saveConfig: (config) => {
    return ipcRenderer.invoke("config:save", config);
  },

  loadConfig: () => {
    return ipcRenderer.invoke("config:load");
  },
});
