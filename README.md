# LAN Monitor

Electron desktop launcher + LAN network monitoring server with a real-time dashboard, a Packet Tracer-style topology editor, and role-based user management.

## What it does

- **Discovers devices** on your local subnet (ping sweep + ARP enrichment)
- **Tracks status** — online/offline with a 3-miss threshold, round-trip latency, uptime history
- **Live dashboard** — socket.io-pushed updates, device grid with sparklines, filter/search
- **Topology editor** — drag-and-drop network diagram with typed device icons, connectors, zoom/pan, and live status badges
- **Monitors custom/public IPs** — any node with a free-text IP (e.g. `8.8.8.8`) is probed automatically
- **Persists history** — SQLite database (14-day samples, 90-day events) survives restarts
- **User accounts & roles** — login popup, three roles (admin / technician / viewer), admin-managed users page

## Quick start

```bash
# 1. Install dependencies
npm install          # Electron (root)
cd web && npm install # socket.io (web server)

# 2a. Launch via the Electron desktop shell
npm start
# Open "Server Launcher" from the Application menu — the bundled ./web
# project is pre-filled as the default (command `bundled`). Just click Start.

# 2b. Or Manually run the monitoring server directly without electron
cd web && npm run dev
# Dashboard:  http://localhost:3000
# Topology:   http://localhost:3000/topology
# Users:      http://localhost:3000/users  (admin only)

```

From any other device on your LAN, open `http://<host-ip>:3000` (the LAN URL is shown in the launcher after start).

### Default login

| Username | Password | Role  |
| -------- | -------- | ----- |
| `admin`  | `admin`  | admin |

Seeded automatically on first boot. Change it right away via **Account → Change password** or the Users page. Dashboard and topology are viewable without logging in; mutations (scan, settings, topology edits) and the Users page require signing in via the header **Login** button.

## Packaging

Build a distributable that ships `web/` (including `socket.io`) with the app. Packaged builds auto-start the bundled monitor with Electron's own Node — **the target machine does not need Node.js or npm**.

```bash
# Windows installer (run on Windows)
npm run build        # → dist/LAN Monitor-1.2.1-setup.exe

# Unpacked smoke test (no installer)
npm run build:dir    # → dist/win-unpacked/LAN Monitor.exe

# macOS (run on a Mac)
npm run build:mac    # → dist/LAN Monitor-1.2.1.dmg + .zip

# Linux (run on Linux)
npm run build:linux  # → dist/LAN Monitor-1.2.1.AppImage + .deb
```

Build on the target OS (macOS `.dmg` cannot be built from Windows). After changing anything under `web/`, just re-run the build script — it reinstalls web production deps and recopies `web/` into the package.

| | |
|---|---|
| **Auto-start** | Packaged app launches the bundled LAN Monitor on start (dashboard at `http://localhost:3000`) |
| **No Node required** | Server runs via `ELECTRON_RUN_AS_NODE` on Electron's bundled Node 24 |
| **Custom projects** | Server Launcher still accepts any folder + command (needs Node/npm on that machine). With no saved config it auto-fills the bundled `web/` project as the default |
| **Data location** | Packaged: `%APPDATA%\LAN Monitor\lan-monitor\` (Windows), `~/Library/Application Support/LAN Monitor/lan-monitor/` (macOS), `~/.config/LAN Monitor/lan-monitor/` (Linux) |
| **Ports** | Default `3000` / host `0.0.0.0` — first run may prompt Windows Firewall (allow for LAN access) |

## Architecture

```
electron/                  Desktop shell (launcher, process lifecycle)
├── main.js                Windows, menu, IPC handlers
├── server-manager.js      Spawns the web server as a child process
└── preload.js             Context-isolated IPC bridge

web/                       Monitoring server + dashboard (Node 24)
├── server.js              Entry point (HTTP + socket.io + monitor engine)
├── config.js              Settings (web/data/settings.json)
├── lib/
│   ├── subnet.js          NIC selection, CIDR math, adapter denylist
│   ├── ping.js            ICMP probe via system ping (locale-aware parse)
│   ├── arp.js             MAC enrichment from `arp -a`
│   ├── hostname.js        Reverse DNS + nbtstat fallback
│   ├── db.js              SQLite via node:sqlite (devices, samples, events, users)
│   ├── auth.js            Password hashing (scrypt) + cookie sessions
│   ├── monitor.js         Scan scheduler, worker pool, state machine
│   ├── api.js             REST API + static file serving + role gates
│   ├── ws-hub.js          socket.io broadcast hub
│   └── topology-store.js  Topology diagram persistence (JSON)
└── public/
    ├── index.html/js/css  Monitoring dashboard
    ├── topology.html/js/css  Topology editor
    ├── users.html/js      User management (admin only)
    ├── auth.js            Login modal, account menu, role helpers
    ├── live.js            socket.io client
    └── modal.js           Shared alert/confirm/prompt dialogs
```

The Electron shell is optional — `web/` runs standalone. The launcher just manages the child process and loads the dashboard in a BrowserWindow.

## How monitoring works

1. **Subnet detection** — reads `os.networkInterfaces()`, picks the real LAN adapter (hypervisor NICs like VMware/vEthernet are denied), computes the CIDR range
2. **Full sweep** — every 90s, pings every host in the subnet (2000+ addresses) with a worker pool (48 concurrent, adaptive 16–64)
3. **Fast lane** — every 15s, re-pings only recently-seen or online devices
4. **Custom IPs** — IPs set on topology nodes are added to the probe list automatically
5. **State machine** — a device goes offline after 3 consecutive missed pings; first-seen successes create a device row
6. **Enrichment** — MAC addresses from `arp -a`, hostnames from reverse DNS / `nbtstat`

## API

Public reads are open; writes require a session cookie (see [Users & access control](#users--access-control)).

| Method  | Path                                | Access              | Description                                |
| ------- | ----------------------------------- | ------------------- | ------------------------------------------ |
| GET     | `/api/summary`                      | public              | Totals, online/offline counts, avg latency |
| GET     | `/api/devices`                      | public              | Device list (filter by `?status=`, `?q=`)  |
| GET     | `/api/devices/:id`                  | public              | Device detail + recent samples             |
| GET     | `/api/devices/:id/history?hours=24` | public              | Latency samples + up/down events           |
| GET     | `/api/events`                       | public              | Recent up/down events                      |
| GET     | `/api/adapters`                     | public              | Network interfaces (for settings dropdown) |
| GET     | `/api/settings`                     | public              | Read scan configuration                    |
| PUT     | `/api/settings`                     | admin, technician   | Update scan intervals / retention          |
| POST    | `/api/scan`                         | admin, technician   | Force immediate full sweep                 |
| GET     | `/api/topologies`                   | public              | List saved diagrams                        |
| GET     | `/api/topologies/:id`               | public              | Full diagram (nodes + links)               |
| POST    | `/api/topologies`                   | admin, technician   | Create diagram                             |
| PUT     | `/api/topologies/:id`               | admin, technician   | Save diagram                               |
| DELETE  | `/api/topologies/:id`               | admin, technician   | Delete diagram                             |
| POST    | `/api/auth/login`                   | public              | Sign in → sets `lan_session` cookie        |
| POST    | `/api/auth/logout`                  | any                 | Clear session                              |
| GET     | `/api/auth/me`                      | any                 | Current user `{id, username, role}`        |
| PUT     | `/api/auth/password`                | any                 | Change own password                        |
| GET     | `/api/users`                        | admin               | List users                                 |
| POST    | `/api/users`                        | admin               | Create user `{username, password, role}`   |
| GET     | `/api/users/:id`                    | admin               | Get one user                               |
| PUT     | `/api/users/:id`                    | admin               | Update user (blank password = keep)        |
| DELETE  | `/api/users/:id`                    | admin               | Delete user (not self / not last admin)    |

Errors: `401 {error}` when not signed in, `403 {error}` when the role is insufficient, `400 {error}` on validation failures.

## Users & access control

Sessions are HttpOnly cookies (`lan_session`, 7-day TTL). Passwords are hashed with `node:crypto` scrypt. A default `admin`/`admin` account is seeded when the `users` table is empty.

| Role          | Dashboard (view) | Scan / settings | Topology (edit) | Users page |
| ------------- | ---------------- | --------------- | --------------- | ---------- |
| **admin**     | ✓                | ✓               | ✓               | ✓          |
| **technician**| ✓                | ✓               | ✓               | ✗          |
| **viewer**    | ✓                | ✗               | ✗               | ✗          |
| **anonymous** | ✓                | ✗               | ✗               | ✗          |

- Dashboard and topology are readable without logging in — the header **Login** button opens a popup modal when a mutation is attempted.
- Unauthorized actions are gated in layers: the control is hidden (or disabled for read-only fields), and any path that is still reachable (keyboard shortcuts, node dragging) falls back to a login prompt when anonymous or a "role does not allow editing" modal for viewer.
- Any signed-in user can change their own password via **Account**. Only admins can create/edit/delete other users (including resetting passwords and assigning roles).
- The Users page lives at `/users`; non-admins get an access-denied screen (the nav link is hidden for them).
- Guardrails: you cannot delete your own account, demote the last admin, or create duplicate usernames.

## Realtime (socket.io)

Named events over socket.io (default `/socket.io` path; the client is served from the server at `/socket.io/socket.io.js`).

Server → client:

| Event                                       | Payload                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `snapshot`                                  | `{devices, summary}` — full state (on connect and on `hello`) |
| `device.up` / `device.down` / `device.update` | device object `{id, ip, hostname, mac, rttMs, lastSeen}` |
| `latency`                                   | samples array `[{deviceId, ip, ts, rttMs}]` (batched ~1s) |
| `summary`                                   | live counters                                          |
| `topology.created` / `topology.updated`     | `{clientId, diagram}`                                  |
| `topology.deleted`                          | `{clientId, id}`                                       |

Client → server: `hello` (re-request snapshot). Transports fall back from websocket to long-polling automatically, and socket.io handles reconnection.

## Topology editor

Open `/topology` to design network diagrams:

- **Add nodes** — from the scanned device list (auto-fills IP/hostname/MAC, guesses type) or create blank nodes with a type picker
- **Device types** — router, switch, PC, server, printer, phone, firewall, cloud, generic (each with a distinct icon)
- **Connect nodes** — Connect mode (or `C` key), click node A → B, label the link (e.g. `gig0/1`)
- **Drag & zoom** — drag nodes to move, scroll to zoom (cursor-anchored, 0.25–2.5×), drag background to pan
- **Properties** — edit type, IP, hostname, MAC, notes per node; bind to a scanned device for live status
- **Live status** — nodes with an IP show a green/red ring and latency chip, updated live via socket.io (works for custom/public IPs too)
- **Save/load** — named diagrams persisted to `web/data/topologies.json`, survive restarts
- **Access** — viewing is open to everyone. Adding, editing, connecting, saving and deleting requires an admin or technician login; for viewer/anonymous the mutating buttons are hidden, the properties panel becomes a read-only inspector, and any edit shortcut or drag attempt shows a login prompt (anonymous) or a "role does not allow editing" modal

### Keyboard shortcuts

| Key                    | Action                           |
| ---------------------- | -------------------------------- |
| `V`                    | Select mode                      |
| `C`                    | Connect mode                     |
| `Delete` / `Backspace` | Remove selection                 |
| `Escape`               | Clear selection / cancel connect |
| `Ctrl+S`               | Save diagram                     |
| `Ctrl+0`               | Reset zoom                       |
| `+` / `-`              | Zoom in / out                    |

## Data storage

| File                       | Contents                                               |
| -------------------------- | ------------------------------------------------------ |
| `web/data/monitor.db`      | SQLite: devices, latency samples, up/down events, users |
| `web/data/settings.json`   | Scan configuration (intervals, concurrency, retention) |
| `web/data/topologies.json` | Saved topology diagrams                                |

In development, all runtime data lives in `web/data/` (gitignored). Packaged builds write to the app data directory instead (`LAN Monitor/lan-monitor/` under userData — see Packaging above) so updates never wipe history.

## Configuration

Settings are editable via `PUT /api/settings` (admin or technician) or the dashboard:

| Setting              | Default | Description                                      |
| -------------------- | ------- | ------------------------------------------------ |
| `concurrency`        | 48      | Parallel pings per sweep (16–64)                 |
| `fullSweepMs`        | 90000   | Full subnet sweep interval                       |
| `fastLaneMs`         | 15000   | Online-device re-check interval                  |
| `missThreshold`      | 3       | Misses before a device is marked offline         |
| `retentionDays`      | 14      | How long latency samples are kept                |
| `eventRetentionDays` | 90      | How long up/down events are kept                 |
| `adapterName`        | auto    | Force a specific network adapter                 |
| `subnetOverride`     | —       | Manually set the scan range (e.g. `10.0.0.0/24`) |

## Platform notes (Windows)

- `npm`/`npx` are rewritten to `.cmd` and spawned via `cmd.exe /c` (avoids `EINVAL` without `shell: true`)
- Process stop uses `taskkill /T /F` (synchronous) to kill the full process tree
- The LAN dashboard may require a Windows Firewall allow rule for Node.js (private networks)
- ICMP ping works without admin privileges (uses the system `ping` command)

## Tech stack

- **Electron 44** — desktop shell (optional)
- **Node.js 24** — monitoring server (bundled via Electron's Node when packaged)
- **electron-builder** — Windows NSIS / macOS dmg / Linux AppImage+deb packaging
- **`socket.io`** — realtime server + served client (only runtime dependency)
- **`node:sqlite`** — built-in SQLite, no native compilation
- **`node:crypto` scrypt** — password hashing (no bcrypt/argon2 dependency)
- **Vanilla HTML/CSS/JS** — no framework, no bundler, no CDN
