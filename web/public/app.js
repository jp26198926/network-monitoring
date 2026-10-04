/* ---------------------------------------------------------------- */
/* State                                                             */
/* ---------------------------------------------------------------- */

const state = {
  devices: new Map(), // id → device
  summary: {},
  filterStatus: "all",
  searchQuery: "",
  selectedId: null,
};

/* ---------------------------------------------------------------- */
/* DOM refs                                                          */
/* ---------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const dom = {
  tileTotal: $("tileTotal"),
  tileUp: $("tileUp"),
  tileDown: $("tileDown"),
  tileAvg: $("tileAvg"),
  subnetLabel: $("subnetLabel"),
  wsStatus: $("wsStatus"),
  refreshBtn: $("refreshBtn"),
  searchBox: $("searchBox"),
  deviceRows: $("deviceRows"),
  emptyState: $("emptyState"),
  detailDrawer: $("detailDrawer"),
  closeDrawer: $("closeDrawer"),
  detailTitle: $("detailTitle"),
  detailStatus: $("detailStatus"),
  detailIp: $("detailIp"),
  detailHostname: $("detailHostname"),
  detailMac: $("detailMac"),
  detailFirstSeen: $("detailFirstSeen"),
  detailLastSeen: $("detailLastSeen"),
  detailChart: $("detailChart"),
  detailEvents: $("detailEvents"),
};

/* ---------------------------------------------------------------- */
/* Utilities                                                         */
/* ---------------------------------------------------------------- */

function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatTs(ts) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/* ---------------------------------------------------------------- */
/* SVG sparkline                                                     */
/* ---------------------------------------------------------------- */

function renderSparkline(values, width = 120, height = 28, color = "#3b82f6") {
  if (!values || values.length < 2) {
    return `<svg width="${width}" height="${height}"><text x="4" y="${height / 2 + 4}" fill="#8b9bb4" font-size="10">no data</text></svg>`;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points.join(" ")}"/>
  </svg>`;
}

function renderDetailChart(samples, width = 360, height = 140) {
  const values = samples.map((s) => s.rttMs).filter((v) => v !== null);

  if (values.length < 2) {
    return `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:32px 0">Not enough samples yet</div>`;
  }

  const max = Math.max(...values);
  const min = 0;
  const range = max - min || 1;
  const pad = 24;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = samples.map((s, i) => {
    const x = pad + (i / (samples.length - 1)) * innerW;
    const y = s.rttMs === null ? pad + innerH : pad + innerH - ((s.rttMs - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const y = pad + innerH * (1 - pct);
    return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#2d3a4f" stroke-width="1"/>
            <text x="4" y="${y + 3}" fill="#8b9bb4" font-size="9">${(max * pct).toFixed(0)}ms</text>`;
  }).join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${gridLines}
    <polyline fill="none" stroke="#3b82f6" stroke-width="2" points="${points.join(" ")}"/>
  </svg>`;
}

/* ---------------------------------------------------------------- */
/* Render: summary tiles                                             */
/* ---------------------------------------------------------------- */

function renderSummary() {
  const s = state.summary;
  dom.tileTotal.textContent = s.total ?? "—";
  dom.tileUp.textContent = s.up ?? "—";
  dom.tileDown.textContent = s.down ?? "—";
  dom.tileAvg.textContent = s.avgRtt != null ? `${s.avgRtt} ms` : "—";

  if (s.subnet) {
    dom.subnetLabel.textContent =
      `${s.adapter || "?"} · ${s.subnet} · ${s.targets ?? "?"} targets` +
      (s.lastSweepMs ? ` · sweep ${s.lastSweepMs}ms` : "");
  }
}

/* ---------------------------------------------------------------- */
/* Render: device table                                              */
/* ---------------------------------------------------------------- */

function getFilteredDevices() {
  const q = state.searchQuery.toLowerCase();

  return [...state.devices.values()]
    .filter((d) => {
      if (state.filterStatus !== "all" && d.status !== state.filterStatus) {
        return false;
      }
      if (!q) return true;
      return (
        (d.ip || "").toLowerCase().includes(q) ||
        (d.hostname || "").toLowerCase().includes(q) ||
        (d.mac || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // up first, then by IP
      const order = { up: 0, unknown: 1, down: 2 };
      const diff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
      return diff || (a.ip || "").localeCompare(b.ip || "", undefined, { numeric: true });
    });
}

function renderDeviceTable() {
  const devices = getFilteredDevices();

  if (!devices.length) {
    dom.deviceRows.innerHTML = "";
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  dom.deviceRows.innerHTML = devices.map((d) => {
    const spark = renderSparkline(d._samples || [], 120, 28, d.status === "down" ? "#e74c3c" : "#3b82f6");
    const selected = state.selectedId === d.id ? "selected" : "";

    return `<tr data-id="${d.id}" class="${selected}">
      <td><span class="badge ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
      <td class="mono">${escapeHtml(d.ip)}</td>
      <td>${escapeHtml(d.hostname) || '<span class="text-muted">—</span>'}</td>
      <td class="mono text-muted">${escapeHtml(d.mac) || "—"}</td>
      <td>${d._rtt != null ? d._rtt + " ms" : '<span class="text-muted">—</span>'}</td>
      <td>${spark}</td>
      <td class="text-muted">${timeAgo(d.lastSeen)}</td>
    </tr>`;
  }).join("");
}

/* ---------------------------------------------------------------- */
/* Detail drawer                                                     */
/* ---------------------------------------------------------------- */

async function openDetail(deviceId) {
  state.selectedId = deviceId;
  renderDeviceTable();

  const device = state.devices.get(deviceId);
  if (!device) return;

  dom.detailDrawer.classList.remove("hidden");
  dom.detailTitle.textContent = device.hostname || device.ip;
  dom.detailStatus.innerHTML = `<span class="badge ${escapeHtml(device.status)}">${escapeHtml(device.status)}</span>`;
  dom.detailIp.textContent = device.ip || "—";
  dom.detailHostname.textContent = device.hostname || "—";
  dom.detailMac.textContent = device.mac || "—";
  dom.detailFirstSeen.textContent = formatTs(device.firstSeen);
  dom.detailLastSeen.textContent = formatTs(device.lastSeen);
  dom.detailChart.innerHTML = renderDetailChart(device._samples || []);
  dom.detailEvents.innerHTML = "";

  try {
    const res = await fetch(`/api/devices/${deviceId}`);
    if (!res.ok) return;
    const data = await res.json();

    const history = await fetch(`/api/devices/${deviceId}/history?hours=24`);
    const histData = history.ok ? await history.json() : { samples: [], events: [] };

    dom.detailChart.innerHTML = renderDetailChart(histData.samples || []);

    dom.detailEvents.innerHTML = (histData.events || []).slice(0, 50).map((e) => `
      <li>
        <span class="event-type ${escapeHtml(e.type)}">${escapeHtml(e.type)}</span>
        <span class="text-muted">${formatTs(e.ts)}</span>
      </li>
    `).join("") || '<li class="text-muted">No events</li>';
  } catch {
    /* ignore */
  }
}

function closeDetail() {
  state.selectedId = null;
  dom.detailDrawer.classList.add("hidden");
  renderDeviceTable();
}

/* ---------------------------------------------------------------- */
/* Live updates (socket.io)                                          */
/* ---------------------------------------------------------------- */

function setLiveStatus(status) {
  if (status === "live") {
    dom.wsStatus.textContent = "Live";
    dom.wsStatus.className = "ws-status online";
  } else {
    dom.wsStatus.textContent = "Connecting…";
    dom.wsStatus.className = "ws-status offline";
  }
}

function handleSnapshot(data) {
  const prev = state.devices;
  state.devices = new Map();
  for (const d of data.devices || []) {
    const existing = prev.get(d.id);
    state.devices.set(d.id, {
      ...d,
      _samples: existing?._samples || [],
      _rtt: existing?._rtt ?? null,
    });
  }
  if (data.summary) {
    state.summary = data.summary;
  }
  renderSummary();
  renderDeviceTable();
}

function handleSummary(summary) {
  state.summary = summary || {};
  renderSummary();
}

function handleDevice(type, d) {
  if (!d || d.id == null) return;

  const existing = state.devices.get(d.id) || { id: d.id, _samples: [], _rtt: null };
  state.devices.set(d.id, {
    ...existing,
    ...d,
    status: d.status || existing.status,
    lastSeen: d.lastSeen ?? existing.lastSeen,
  });

  if (type === "device.up" && d.rttMs != null) {
    const dev = state.devices.get(d.id);
    dev._rtt = d.rttMs;
    pushSample(dev, d.rttMs);
  }

  renderDeviceTable();
}

function handleLatency(samples) {
  for (const s of samples || []) {
    const dev = state.devices.get(s.deviceId);
    if (dev) {
      dev._rtt = s.rttMs;
      pushSample(dev, s.rttMs);
    }
  }
  renderDeviceTable();
}

function pushSample(device, rttMs) {
  if (!device._samples) device._samples = [];
  device._samples.push(rttMs);
  if (device._samples.length > 20) {
    device._samples = device._samples.slice(-20);
  }
}

/* ---------------------------------------------------------------- */
/* Initial data load                                                 */
/* ---------------------------------------------------------------- */

async function loadDevices() {
  try {
    const res = await fetch("/api/devices");
    const data = await res.json();

    for (const d of data.devices || []) {
      const existing = state.devices.get(d.id);
      state.devices.set(d.id, {
        ...d,
        _samples: existing?._samples || [],
        _rtt: existing?._rtt ?? null,
      });
    }

    renderDeviceTable();
  } catch {
    /* ignore */
  }

  try {
    const res = await fetch("/api/summary");
    state.summary = await res.json();
    renderSummary();
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- */
/* Events                                                            */
/* ---------------------------------------------------------------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.filterStatus = tab.dataset.status;
    renderDeviceTable();
  });
});

dom.searchBox.addEventListener("input", () => {
  state.searchQuery = dom.searchBox.value.trim();
  renderDeviceTable();
});

dom.deviceRows.addEventListener("click", (event) => {
  const tr = event.target.closest("tr[data-id]");
  if (tr) {
    openDetail(Number(tr.dataset.id));
  }
});

dom.closeDrawer.addEventListener("click", closeDetail);

dom.refreshBtn.addEventListener("click", async () => {
  if (!Auth.canMutate()) {
    if (!Auth.isLoggedIn()) {
      await Auth.openLogin();
      applyAuthUi();
    } else {
      Modal.alert("Your role does not allow scanning.");
    }
    return;
  }

  dom.refreshBtn.disabled = true;
  fetch("/api/scan", { method: "POST", credentials: "same-origin" }).finally(() => {
    setTimeout(() => {
      dom.refreshBtn.disabled = false;
    }, 2000);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDetail();
  }
});

/* ---------------------------------------------------------------- */
/* Auth gating                                                       */
/* ---------------------------------------------------------------- */

function applyAuthUi() {
  const can = Auth.canMutate();
  dom.refreshBtn.disabled = !can;
  dom.refreshBtn.title = can ? "Force full sweep" : "Login as admin or technician to scan";
}

window.addEventListener("auth:changed", applyAuthUi);

/* ---------------------------------------------------------------- */
/* Boot                                                              */
/* ---------------------------------------------------------------- */

Auth.ensure().then(applyAuthUi);
loadDevices();
Live.connect({
  handlers: {
    snapshot: handleSnapshot,
    summary: handleSummary,
    "device.up": (d) => handleDevice("device.up", d),
    "device.down": (d) => handleDevice("device.down", d),
    "device.update": (d) => handleDevice("device.update", d),
    latency: handleLatency,
  },
  onStatus: setLiveStatus,
});
