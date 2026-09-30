# AGENTS.md

Electron desktop launcher that spawns a user-chosen local web server as a child process and loads it in the main window. Small codebase — read `electron/main.js` and `electron/server-manager.js` first; they hold nearly all logic.

## Commands

- `npm start` — run the Electron app (only root script)
- `cd web && npm run dev` — run the sample target web app (`node server.js`, reads `HOST`/`PORT` from env)

There is no build step, bundler, test suite, lint, typecheck, or CI. Do not invent verification commands; `npm start` is the only check.

## Layout

- `electron/` — main process: `main.js` (windows, menu, IPC handlers), `server-manager.js` (child-process spawn/lifecycle), `preload.js` (IPC bridge)
- `renderer/app/` — placeholder main window (launcher button)
- `renderer/launcher/` — modal dialog: project path, command, args, host/port, start/stop/restart
- `web/` — **LAN host/device monitoring server** (the primary app). Node HTTP + WebSocket (`ws`) + SQLite (`node:sqlite`). Serves a single-page dashboard from `public/`. Ping/ARP/hostname probes in `lib/`. Started via `npm run dev` in `web/`, injected with `HOST`/`PORT` by the Electron launcher. Not imported by the Electron code; it is an external project the user selects at runtime.

## Architecture (non-obvious)

- Renderer never touches Node. All privileged work goes through `window.electronAPI` → `ipcRenderer.invoke` → `ipcMain.handle`. Keep `contextIsolation: true` / `nodeIntegration: false`.
- Server config is persisted to Electron `userData`/`server-config.json` (per-user OS app data), not a repo file. Don't look for config in the repo.
- `server:start` / `server:restart` spawn the user's command with `HOST`/`PORT` injected as env vars, then poll `127.0.0.1:<port>` via TCP until the server is ready (30s timeout) before `mainWindow.loadURL`.
- After a successful start the main window navigates away from `renderer/app/index.html` to `http://localhost:<port>`. Stopping reloads the placeholder.
- Launcher UI state on reopen comes from `server:status` (live in-memory state in `server-manager.js`), not from the saved config file.

## Windows-specific behavior (the machine is Windows)

- `npm` / `npx` are rewritten to `npm.cmd` / `npx.cmd` in `server-manager.js` because spawn runs without `shell: true`.
- `spawn` deliberately omits `shell: true` to avoid the Node DEP0190 warning. Keep it that way.
- On Windows, `.cmd`/`.bat` files cannot be spawned directly (Node throws `EINVAL`). `spawnCommand()` in `server-manager.js` wraps them with `cmd.exe /c` instead of `shell: true`.
- Stop uses `taskkill /pid <pid> /T /F` via `spawnSync` (not async `spawn`) to kill the whole process tree (npm → node); Unix uses `SIGTERM`. Must stay synchronous — an async kill is abandoned when Electron quits and orphans the server.
- Closing the main window stops the child server (`mainWindow.on("closed")` + `will-quit`).
- Restart inserts a 1s sleep after stop so Windows releases the port. Don't remove it.

## Conventions

- Comment style in `electron/` is Laravel-style banner blocks (`/* |---- ... ----*/`). Match it when editing those files; leave existing ones alone.
- IPC channel names are `domain:action` (e.g. `server:start`, `config:load`). Keep the pattern when adding handlers, and wire them through `preload.js` — renderer cannot call `ipcMain` directly.
