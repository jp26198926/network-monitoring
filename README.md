# LAN Monitor

Electron desktop launcher + LAN network monitoring server with a real-time dashboard and a Packet Tracer-style topology editor.

## What it does

- **Discovers devices** on your local subnet (ping sweep + ARP enrichment)
- **Tracks status** — online/offline with a 3-miss threshold, round-trip latency, uptime history
- **Live dashboard** — WebSocket-pushed updates, device grid with sparklines, filter/search
- **Topology editor** — drag-and-drop network diagram with typed device icons, connectors, zoom/pan, and live status badges
- **Monitors custom/public IPs** — any node with a free-text IP (e.g. `8.8.8.8`) is probed automatically
- **Persists history** — SQLite database (14-day samples, 90-day events) survives restarts

## Quick start

```bash
# 1. Install dependencies
npm install          # Electron (root)
cd web && npm install # ws (web server)

# 2a. Launch via the Electron desktop shell
npm start
# Click "Open Server Launcher" → set project to ./web, command `npm`, args `run dev`, host `0.0.0.0`, port `3000`

# 2b. Or Manually run the monitoring server directly without electron
cd web && npm run dev
# Dashboard:  http://localhost:3000
# Topology:   http://localhost:3000/topology


```

From any other device on your LAN, open `http://<host-ip>:3000` (the LAN URL is shown in the launcher after start).

## Packaging

Build a distributable that ships `web/` (including `ws`) with the app. Packaged builds auto-start the bundled monitor with Electron's own Node — **the target machine does not need Node.js or npm**.

```bash
# Windows installer (run on Windows)
npm run build        # → dist/LAN Monitor-1.0.0-setup.exe

# Unpacked smoke test (no installer)
npm run build:dir    # → dist/win-unpacked/LAN Monitor.exe

# macOS (run on a Mac)
npm run build:mac    # → dist/LAN Monitor-1.0.0.dmg + .zip

# Linux (run on Linux)
npm run build:linux  # → dist/LAN Monitor-1.0.0.AppImage + .deb
```

Build on the target OS (macOS `.dmg` cannot be built from Windows). After changing anything under `web/`, just re-run the build script — it reinstalls web production deps and recopies `web/` into the package.

| | |
|---|---|
| **Auto-start** | Packaged app launches the bundled LAN Monitor on start (dashboard at `http://localhost:3000`) |
| **No Node required** | Server runs via `ELECTRON_RUN_AS_NODE` on Electron's bundled Node 24 |
| **Custom projects** | Server Launcher still accepts any folder + command (needs Node/npm on that machine) |
| **Data location** | Packaged: `%APPDATA%\LAN Monitor\lan-monitor\` (Windows), `~/Library/Application Support/LAN Monitor/lan-monitor/` (macOS), `~/.config/LAN Monitor/lan-monitor/` (Linux) |
| **Ports** | Default `3000` / host `0.0.0.0` — first run may prompt Windows Firewall (allow for LAN access) |

## Architecture

```
electron/                  Desktop shell (launcher, process lifecycle)
├── main.js                Windows, menu, IPC handlers
├── server-manager.js      Spawns the web server as a child process
└── preload.js             Context-isolated IPC bridge

web/                       Monitoring server + dashboard (Node 24)
├── server.js              Entry point (HTTP + WebSocket + monitor engine)
├── config.js              Settings (web/data/settings.json)
├── lib/
│   ├── subnet.js          NIC selection, CIDR math, adapter denylist
│   ├── ping.js            ICMP probe via system ping (locale-aware parse)
│   ├── arp.js             MAC enrichment from `arp -a`
│   ├── hostname.js        Reverse DNS + nbtstat fallback
│   ├── db.js              SQLite via node:sqlite (devices, samples, events)
│   ├── monitor.js         Scan scheduler, worker pool, state machine
│   ├── api.js             REST API + static file serving
│   ├── ws-hub.js          WebSocket broadcast hub
│   └── topology-store.js  Topology diagram persistence (JSON)
└── public/
    ├── index.html/js/css  Monitoring dashboard
    └── topology.html/js/css  Topology editor
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

| Method  | Path                                | Description                                |
| ------- | ----------------------------------- | ------------------------------------------ |
| GET     | `/api/summary`                      | Totals, online/offline counts, avg latency |
| GET     | `/api/devices`                      | Device list (filter by `?status=`, `?q=`)  |
| GET     | `/api/devices/:id`                  | Device detail + recent samples             |
| GET     | `/api/devices/:id/history?hours=24` | Latency samples + up/down events           |
| GET     | `/api/events`                       | Recent up/down events                      |
| GET/PUT | `/api/settings`                     | Scan intervals, concurrency, retention     |
| GET     | `/api/adapters`                     | Network interfaces (for settings dropdown) |
| POST    | `/api/scan`                         | Force immediate full sweep                 |
| GET     | `/api/topologies`                   | List saved diagrams                        |
| GET     | `/api/topologies/:id`               | Full diagram (nodes + links)               |
| POST    | `/api/topologies`                   | Create diagram                             |
| PUT     | `/api/topologies/:id`               | Save diagram                               |
| DELETE  | `/api/topologies/:id`               | Delete diagram                             |

## WebSocket (`/ws`)

Server → client (JSON):

| Type                        | Payload                                                |
| --------------------------- | ------------------------------------------------------ |
| `snapshot`                  | Full device list + summary (on connect)                |
| `device.up` / `device.down` | `{device: {id, ip, hostname, mac, rttMs, lastSeen}}`   |
| `device.update`             | Hostname/MAC enrichment                                |
| `latency`                   | `{samples: [{deviceId, ip, ts, rttMs}]}` (batched ~1s) |
| `summary`                   | Live counters                                          |

Client → server: `{"type":"hello"}` (request snapshot), `{"type":"refresh"}` (force sweep).

## Topology editor

Open `/topology` to design network diagrams:

- **Add nodes** — from the scanned device list (auto-fills IP/hostname/MAC, guesses type) or create blank nodes with a type picker
- **Device types** — router, switch, PC, server, printer, phone, firewall, cloud, generic (each with a distinct icon)
- **Connect nodes** — Connect mode (or `C` key), click node A → B, label the link (e.g. `gig0/1`)
- **Drag & zoom** — drag nodes to move, scroll to zoom (cursor-anchored, 0.25–2.5×), drag background to pan
- **Properties** — edit type, IP, hostname, MAC, notes per node; bind to a scanned device for live status
- **Live status** — nodes with an IP show a green/red ring and latency chip, updated live via WebSocket (works for custom/public IPs too)
- **Save/load** — named diagrams persisted to `web/data/topologies.json`, survive restarts

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
| `web/data/monitor.db`      | SQLite: devices, latency samples, up/down events       |
| `web/data/settings.json`   | Scan configuration (intervals, concurrency, retention) |
| `web/data/topologies.json` | Saved topology diagrams                                |

In development, all runtime data lives in `web/data/` (gitignored). Packaged builds write to the app data directory instead (`LAN Monitor/lan-monitor/` under userData — see Packaging above) so updates never wipe history.

## Configuration

Settings are editable via `PUT /api/settings` or the dashboard:

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
- **`ws`** — WebSocket server (only runtime dependency)
- **`node:sqlite`** — built-in SQLite, no native compilation
- **Vanilla HTML/CSS/JS** — no framework, no bundler, no CDN
