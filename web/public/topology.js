/* ---------------------------------------------------------------- */
/* State                                                             */
/* ---------------------------------------------------------------- */

const state = {
  viewport: { x: 0, y: 0, scale: 1 },
  diagrams: [],
  current: null,
  selection: { kind: null, id: null },
  mode: "select",
  connectFrom: null,
  dirty: false,
  devices: new Map(),
  liveStatus: new Map(),
  ipStatus: new Map(),
};

/* ---------------------------------------------------------------- */
/* DOM refs                                                          */
/* ---------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const dom = {
  viewport: $("viewport"),
  world: $("world"),
  linksSvg: $("linksSvg"),
  canvasHint: $("canvasHint"),
  wsStatus: $("wsStatus"),
  dirtyFlag: $("dirtyFlag"),

  diagramSelect: $("diagramSelect"),
  newDiagramBtn: $("newDiagramBtn"),
  renameDiagramBtn: $("renameDiagramBtn"),
  deleteDiagramBtn: $("deleteDiagramBtn"),

  selectModeBtn: $("selectModeBtn"),
  connectModeBtn: $("connectModeBtn"),
  addNodeBtn: $("addNodeBtn"),
  addDeviceBtn: $("addDeviceBtn"),
  zoomInBtn: $("zoomInBtn"),
  zoomOutBtn: $("zoomOutBtn"),
  zoomResetBtn: $("zoomResetBtn"),
  saveBtn: $("saveBtn"),

  propsPanel: $("propsPanel"),
  propsTitle: $("propsTitle"),
  closeProps: $("closeProps"),
  nodeProps: $("nodeProps"),
  linkProps: $("linkProps"),
  propType: $("propType"),
  propIp: $("propIp"),
  propHostname: $("propHostname"),
  propMac: $("propMac"),
  propNotes: $("propNotes"),
  propDevice: $("propDevice"),
  propLiveInfo: $("propLiveInfo"),
  propLiveStatus: $("propLiveStatus"),
  propLiveRtt: $("propLiveRtt"),
  deleteNodeBtn: $("deleteNodeBtn"),
  propLinkLabel: $("propLinkLabel"),
  deleteLinkBtn: $("deleteLinkBtn"),

  deviceDrawer: $("deviceDrawer"),
  closeDeviceDrawer: $("closeDeviceDrawer"),
  deviceSearch: $("deviceSearch"),
  deviceList: $("deviceList"),
};

/* ---------------------------------------------------------------- */
/* SVG icons (24×24, stroke-based)                                   */
/* ---------------------------------------------------------------- */

const ICONS = {
  router: `<svg viewBox="0 0 24 24"><rect x="2" y="8" width="20" height="10" rx="2"/><path d="M7 13h10"/><path d="M9 11l-2 2 2 2"/><path d="M15 11l2 2-2 2"/></svg>`,
  switch: `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="11" rx="2"/><rect x="5" y="15" width="3" height="2" rx="0.5"/><rect x="9" y="15" width="3" height="2" rx="0.5"/><rect x="13" y="15" width="3" height="2" rx="0.5"/><rect x="17" y="15" width="3" height="2" rx="0.5"/></svg>`,
  pc: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="12" rx="1.5"/><path d="M9 15v2"/><path d="M15 15v2"/><rect x="6" y="17" width="12" height="1.5" rx="0.5"/></svg>`,
  server: `<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`,
  printer: `<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="5" rx="0.5"/><rect x="3" y="7" width="18" height="9" rx="1.5"/><rect x="7" y="16" width="10" height="6" rx="0.5"/><line x1="10" y1="11" x2="14" y2="11"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="5" x2="14" y2="5"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`,
  firewall: `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="13" x2="22" y2="13"/><line x1="2" y1="18" x2="22" y2="18"/><line x1="8" y1="3" x2="8" y2="8"/><line x1="16" y1="3" x2="16" y2="8"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="8" y1="13" x2="8" y2="18"/><line x1="16" y1="13" x2="16" y2="18"/><line x1="12" y1="18" x2="12" y2="21"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24"><path d="M6 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 10a3.5 3.5 0 0 1 .5 7H6z"/></svg>`,
  generic: `<svg viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
};

function guessType(hostname) {
  const h = (hostname || "").toLowerCase();
  if (/switch|\bsw\b/.test(h)) return "switch";
  if (/rtr|router/.test(h)) return "router";
  if (/print/.test(h)) return "printer";
  if (/phone|mobile|android|iphone/.test(h)) return "phone";
  if (/firewall|\bfw\b|asa/.test(h)) return "firewall";
  if (/vm|server|esxi|nas/.test(h)) return "server";
  return "pc";
}

function typeLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/* ---------------------------------------------------------------- */
/* Utils                                                             */
/* ---------------------------------------------------------------- */

function uuid() {
  // crypto.randomUUID is secure-context only (localhost/HTTPS).
  // LAN browsers on http://<ip> do not have it.
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function markDirty() {
  state.dirty = true;
  dom.dirtyFlag.classList.remove("hidden");
}

function clearDirty() {
  state.dirty = false;
  dom.dirtyFlag.classList.add("hidden");
}

/* ---------------------------------------------------------------- */
/* Client identity (ignore self-originated WS topology events)       */
/* ---------------------------------------------------------------- */

const CLIENT_ID = uuid();

let remotePromptActive = false;
let pendingRemoteDiagram = null;

/* ---------------------------------------------------------------- */
/* Viewport: transform                                               */
/* ---------------------------------------------------------------- */

function applyTransform() {
  const { x, y, scale } = state.viewport;
  dom.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function screenToWorld(sx, sy) {
  const rect = dom.viewport.getBoundingClientRect();
  const { x, y, scale } = state.viewport;
  return {
    x: (sx - rect.left - x) / scale,
    y: (sy - rect.top - y) / scale,
  };
}

/* ---------------------------------------------------------------- */
/* Node rendering                                                    */
/* ---------------------------------------------------------------- */

function renderNodes() {
  // remove existing node elements
  dom.world.querySelectorAll(".node").forEach((el) => el.remove());

  if (!state.current) {
    dom.canvasHint.classList.remove("hidden");
    return;
  }

  if (state.current.nodes.length) {
    dom.canvasHint.classList.add("hidden");
  } else {
    dom.canvasHint.classList.remove("hidden");
  }

  for (const node of state.current.nodes) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    if (state.selection.kind === "node" && state.selection.id === node.id) {
      el.classList.add("selected");
    }

    if (state.connectFrom === node.id) {
      el.classList.add("connect-source");
    }

    let live = node.deviceId ? state.liveStatus.get(node.deviceId) : null;
    if (!live && node.ip) live = state.ipStatus.get(node.ip);
    const status = live ? live.status : null;

    if (status === "up") el.classList.add("is-up");
    else if (status === "down") el.classList.add("is-down");

    el.innerHTML = `
      <div class="node-icon">
        <div class="node-status-ring ${status || ""}"></div>
        ${ICONS[node.type] || ICONS.generic}
      </div>
      <div class="node-label">${escapeHtml(node.hostname || node.ip || node.id)}</div>
      <div class="node-ip">${escapeHtml(node.ip || "")}</div>
      ${live && live.rttMs != null
        ? `<div class="node-latency ${live.status === "down" ? "down" : ""}">${live.rttMs} ms</div>`
        : ""}
    `;

    dom.world.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* ---------------------------------------------------------------- */
/* Link rendering                                                    */
/* ---------------------------------------------------------------- */

function renderLinks() {
  dom.linksSvg.innerHTML = "";

  if (!state.current) return;

  for (const link of state.current.links) {
    const src = state.current.nodes.find((n) => n.id === link.source);
    const dst = state.current.nodes.find((n) => n.id === link.target);
    if (!src || !dst) continue;

    const x1 = src.x + 48;
    const y1 = src.y + 36;
    const x2 = dst.x + 48;
    const y2 = dst.y + 36;

    // hit-area (invisible fat line for click detection)
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hit.setAttribute("x1", x1); hit.setAttribute("y1", y1);
    hit.setAttribute("x2", x2); hit.setAttribute("y2", y2);
    hit.setAttribute("class", "hit-area");
    hit.dataset.linkId = link.id;
    dom.linksSvg.appendChild(hit);

    // visible line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.dataset.linkId = link.id;

    if (state.selection.kind === "link" && state.selection.id === link.id) {
      line.classList.add("selected");
    }

    dom.linksSvg.appendChild(line);

    // label at midpoint
    if (link.label) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", (x1 + x2) / 2);
      text.setAttribute("y", (y1 + y2) / 2 - 6);
      text.textContent = link.label;
      dom.linksSvg.appendChild(text);
    }
  }
}

function updateNodeLinks(nodeId) {
  if (!state.current) return;

  for (const link of state.current.links) {
    if (link.source !== nodeId && link.target !== nodeId) continue;

    const src = state.current.nodes.find((n) => n.id === link.source);
    const dst = state.current.nodes.find((n) => n.id === link.target);
    if (!src || !dst) continue;

    const x1 = src.x + 48, y1 = src.y + 36;
    const x2 = dst.x + 48, y2 = dst.y + 36;

    dom.linksSvg.querySelectorAll(`[data-link-id="${link.id}"]`).forEach((el) => {
      el.setAttribute("x1", x1); el.setAttribute("y1", y1);
      el.setAttribute("x2", x2); el.setAttribute("y2", y2);
    });

    // update label position
    const labels = dom.linksSvg.querySelectorAll("text");
    labels.forEach((t) => {
      if (t.textContent === link.label) {
        t.setAttribute("x", (x1 + x2) / 2);
        t.setAttribute("y", (y1 + y2) / 2 - 6);
      }
    });
  }
}

function renderAll() {
  renderNodes();
  renderLinks();
  applyTransform();
}

/* ---------------------------------------------------------------- */
/* Selection & properties                                            */
/* ---------------------------------------------------------------- */

function selectNode(nodeId) {
  state.selection = { kind: "node", id: nodeId };
  const node = state.current?.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  renderNodes();
  renderLinks();
  openProps();

  dom.propsTitle.textContent = "Node";
  dom.nodeProps.classList.remove("hidden");
  dom.linkProps.classList.add("hidden");

  dom.propType.value = node.type;
  dom.propIp.value = node.ip || "";
  dom.propHostname.value = node.hostname || "";
  dom.propMac.value = node.mac || "";
  dom.propNotes.value = node.notes || "";

  // populate device dropdown
  dom.propDevice.innerHTML = `<option value="">None</option>`;
  for (const dev of state.devices.values()) {
    const opt = document.createElement("option");
    opt.value = dev.id;
    opt.textContent = `${dev.ip} ${dev.hostname || ""}`.trim();
    if (node.deviceId && Number(node.deviceId) === dev.id) opt.selected = true;
    dom.propDevice.appendChild(opt);
  }

  // live info
  if (node.deviceId && state.liveStatus.has(node.deviceId)) {
    const live = state.liveStatus.get(node.deviceId);
    dom.propLiveInfo.classList.remove("hidden");
    dom.propLiveStatus.textContent = live.status;
    dom.propLiveRtt.textContent = live.rttMs != null ? `${live.rttMs} ms` : "—";
  } else {
    dom.propLiveInfo.classList.add("hidden");
  }
}

function selectLink(linkId) {
  state.selection = { kind: "link", id: linkId };
  const link = state.current?.links.find((l) => l.id === linkId);
  if (!link) return;

  renderNodes();
  renderLinks();
  openProps();

  dom.propsTitle.textContent = "Link";
  dom.nodeProps.classList.add("hidden");
  dom.linkProps.classList.remove("hidden");
  dom.propLinkLabel.value = link.label || "";
}

function clearSelection() {
  state.selection = { kind: null, id: null };
  closeProps();
  renderNodes();
  renderLinks();
}

function openProps() {
  dom.propsPanel.classList.remove("hidden");
}

function closeProps() {
  dom.propsPanel.classList.add("hidden");
  dom.nodeProps.classList.add("hidden");
  dom.linkProps.classList.add("hidden");
}

/* ---------------------------------------------------------------- */
/* Property editing                                                  */
/* ---------------------------------------------------------------- */

function bindPropsEvents() {
  const nodeFields = [
    [dom.propType, "type"],
    [dom.propIp, "ip"],
    [dom.propHostname, "hostname"],
    [dom.propMac, "mac"],
    [dom.propNotes, "notes"],
  ];

  for (const [el, key] of nodeFields) {
    el.addEventListener("input", () => {
      if (state.selection.kind !== "node") return;
      const node = state.current.nodes.find((n) => n.id === state.selection.id);
      if (!node) return;
      node[key] = el.value;
      markDirty();
      if (key === "type" || key === "hostname" || key === "ip") {
        renderNodes();
      }
    });
    el.addEventListener("change", () => {
      if (state.selection.kind !== "node") return;
      const node = state.current.nodes.find((n) => n.id === state.selection.id);
      if (!node) return;
      node[key] = el.value;
      markDirty();
      renderNodes();
    });
  }

  dom.propDevice.addEventListener("change", () => {
    if (state.selection.kind !== "node") return;
    const node = state.current.nodes.find((n) => n.id === state.selection.id);
    if (!node) return;
    node.deviceId = dom.propDevice.value ? Number(dom.propDevice.value) : null;
    markDirty();

    // hydrate from device data
    if (node.deviceId) {
      const dev = state.devices.get(node.deviceId);
      if (dev) {
        node.ip = node.ip || dev.ip;
        node.hostname = node.hostname || dev.hostname;
        node.mac = node.mac || dev.mac;
        dom.propIp.value = node.ip;
        dom.propHostname.value = node.hostname;
        dom.propMac.value = node.mac;
      }
    }

    renderNodes();
    selectNode(node.id);
  });

  dom.propLinkLabel.addEventListener("input", () => {
    if (state.selection.kind !== "link") return;
    const link = state.current.links.find((l) => l.id === state.selection.id);
    if (!link) return;
    link.label = dom.propLinkLabel.value;
    markDirty();
    renderLinks();
  });

  dom.deleteNodeBtn.addEventListener("click", () => deleteSelection());
  dom.deleteLinkBtn.addEventListener("click", () => deleteSelection());
}

async function deleteSelection() {
  if (!(await ensureCanMutate())) return;
  if (!state.current) return;

  if (state.selection.kind === "node") {
    const id = state.selection.id;
    state.current.nodes = state.current.nodes.filter((n) => n.id !== id);
    state.current.links = state.current.links.filter(
      (l) => l.source !== id && l.target !== id,
    );
  } else if (state.selection.kind === "link") {
    state.current.links = state.current.links.filter(
      (l) => l.id !== state.selection.id,
    );
  }

  markDirty();
  clearSelection();
  renderAll();
}

/* ---------------------------------------------------------------- */
/* Pan / zoom                                                        */
/* ---------------------------------------------------------------- */

let panState = null;
let dragState = null;

function initViewport() {
  // wheel zoom — non-passive so we can preventDefault
  dom.viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    const rect = dom.viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { x: vx, y: vy, scale } = state.viewport;

    const newScale = clamp(scale * Math.exp(-e.deltaY * 0.001), 0.25, 2.5);

    state.viewport.x = cx - (cx - vx) * (newScale / scale);
    state.viewport.y = cy - (cy - vy) * (newScale / scale);
    state.viewport.scale = newScale;

    applyTransform();
  }, { passive: false });

  dom.viewport.addEventListener("pointerdown", async (e) => {
    const nodeEl = e.target.closest(".node");
    const linkEl = e.target.closest("[data-link-id]");

    // connect mode: click nodes
    if (state.mode === "connect") {
      if (nodeEl) {
        handleConnectClick(nodeEl.dataset.nodeId);
        return;
      }
      // click empty canvas cancels connect
      if (state.connectFrom) {
        state.connectFrom = null;
        renderNodes();
      }
      return;
    }

    // select mode
    if (nodeEl) {
      const nodeId = nodeEl.dataset.nodeId;
      selectNode(nodeId);

      if (!(await ensureCanMutate())) return;

      const node = state.current.nodes.find((n) => n.id === nodeId);
      const worldStart = screenToWorld(e.clientX, e.clientY);

      dragState = {
        nodeId,
        startWorldX: worldStart.x,
        startWorldY: worldStart.y,
        nodeStartX: node.x,
        nodeStartY: node.y,
        moved: false,
      };

      nodeEl.classList.add("dragging");
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    if (linkEl) {
      selectLink(linkEl.dataset.linkId);
      return;
    }

    // empty canvas → pan + clear selection
    clearSelection();
    panState = {
      startX: e.clientX,
      startY: e.clientY,
      vx: state.viewport.x,
      vy: state.viewport.y,
    };
    dom.viewport.classList.add("grabbing");
    dom.viewport.setPointerCapture(e.pointerId);
  });

  dom.viewport.addEventListener("pointermove", (e) => {
    if (dragState) {
      const world = screenToWorld(e.clientX, e.clientY);
      const dx = world.x - dragState.startWorldX;
      const dy = world.y - dragState.startWorldY;

      const node = state.current.nodes.find((n) => n.id === dragState.nodeId);
      if (node) {
        node.x = dragState.nodeStartX + dx;
        node.y = dragState.nodeStartY + dy;
        dragState.moved = dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;

        const el = dom.world.querySelector(`[data-node-id="${node.id}"]`);
        if (el) {
          el.style.left = `${node.x}px`;
          el.style.top = `${node.y}px`;
        }

        updateNodeLinks(node.id);
      }
      return;
    }

    if (panState) {
      state.viewport.x = panState.vx + (e.clientX - panState.startX);
      state.viewport.y = panState.vy + (e.clientY - panState.startY);
      applyTransform();
    }
  });

  dom.viewport.addEventListener("pointerup", (e) => {
    if (dragState) {
      const el = dom.world.querySelector(`[data-node-id="${dragState.nodeId}"]`);
      if (el) el.classList.remove("dragging");
      if (dragState.moved) markDirty();
      dragState = null;
    }

    if (panState) {
      panState = null;
      dom.viewport.classList.remove("grabbing");
    }

    dom.viewport.releasePointerCapture(e.pointerId);
  });

  dom.viewport.addEventListener("pointercancel", () => {
    dragState = null;
    panState = null;
    dom.viewport.classList.remove("grabbing");
    dom.world.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  });
}

/* ---------------------------------------------------------------- */
/* Connect mode                                                      */
/* ---------------------------------------------------------------- */

function setMode(mode) {
  state.mode = mode;
  state.connectFrom = null;

  dom.selectModeBtn.classList.toggle("active", mode === "select");
  dom.connectModeBtn.classList.toggle("active", mode === "connect");
  dom.viewport.classList.toggle("connect-mode", mode === "connect");

  renderNodes();
}

function handleConnectClick(nodeId) {
  if (!state.connectFrom) {
    state.connectFrom = nodeId;
    renderNodes();
    return;
  }

  if (state.connectFrom === nodeId) {
    state.connectFrom = null;
    renderNodes();
    return;
  }

  // create link
  const link = {
    id: uuid(),
    source: state.connectFrom,
    target: nodeId,
    label: "",
  };

  state.current.links.push(link);
  state.connectFrom = null;
  markDirty();
  setMode("select");
  renderAll();
  selectLink(link.id);
}

/* ---------------------------------------------------------------- */
/* Add node                                                          */
/* ---------------------------------------------------------------- */

function addNode(type = "generic", data = {}) {
  if (!state.current) {
    Modal.alert("Create or open a diagram first, then add nodes.", {
      title: "No diagram",
    });
    return;
  }

  // place at viewport center in world coords
  const rect = dom.viewport.getBoundingClientRect();
  const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);

  const node = {
    id: uuid(),
    type,
    x: Math.round(center.x - 48 + (Math.random() * 60 - 30)),
    y: Math.round(center.y - 36 + (Math.random() * 60 - 30)),
    ip: data.ip || "",
    hostname: data.hostname || "",
    mac: data.mac || "",
    notes: data.notes || "",
    deviceId: data.deviceId || null,
  };

  state.current.nodes.push(node);
  markDirty();
  renderAll();
  selectNode(node.id);
}

/* ---------------------------------------------------------------- */
/* Diagram manager                                                   */
/* ---------------------------------------------------------------- */

async function loadDiagramList() {
  try {
    const res = await fetch("/api/topologies");
    const data = await res.json();
    state.diagrams = data.topologies || [];

    const prev = state.current?.id || dom.diagramSelect.value;
    dom.diagramSelect.innerHTML = "";

    if (!state.diagrams.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— No diagrams —";
      dom.diagramSelect.appendChild(opt);
      return;
    }

    for (const d of state.diagrams) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name;
      dom.diagramSelect.appendChild(opt);
    }

    if (prev) dom.diagramSelect.value = prev;
  } catch {
    /* ignore */
  }
}

async function openDiagram(id) {
  try {
    const res = await fetch(`/api/topologies/${id}`);
    const data = await res.json();
    state.current = data.diagram;
    state.selection = { kind: null, id: null };
    clearDirty();
    closeProps();
    renderAll();
    dom.diagramSelect.value = id;
    dom.canvasHint.classList.toggle("hidden", state.current.nodes.length > 0);
  } catch {
    /* ignore */
  }
}

async function applyRemoteDiagram(diagram) {
  const prevSelection = state.selection;
  state.current = diagram;
  clearDirty();

  if (prevSelection.kind === "node" && state.current.nodes.some((n) => n.id === prevSelection.id)) {
    state.selection = prevSelection;
  } else if (prevSelection.kind === "link" && state.current.links.some((l) => l.id === prevSelection.id)) {
    state.selection = prevSelection;
  } else {
    state.selection = { kind: null, id: null };
    closeProps();
  }

  renderAll();
  dom.diagramSelect.value = diagram.id;
  dom.canvasHint.classList.toggle("hidden", state.current.nodes.length > 0);
}

async function handleRemoteDeleted(id) {
  await loadDiagramList();
  if (!state.current || state.current.id !== id) return;

  state.current = null;
  state.selection = { kind: null, id: null };
  clearDirty();
  closeProps();

  if (state.diagrams.length) {
    await openDiagram(state.diagrams[0].id);
  } else {
    renderAll();
    dom.canvasHint.classList.remove("hidden");
    dom.diagramSelect.value = "";
  }
}

async function promptRemoteReload(diagram) {
  if (remotePromptActive) {
    pendingRemoteDiagram = diagram;
    return;
  }

  remotePromptActive = true;
  const reload = await Modal.confirm(
    `"${diagram.name}" was changed by another client.\nReload and discard your unsaved edits?`,
    {
      title: "Diagram changed",
      okLabel: "Reload",
      cancelLabel: "Keep mine",
    },
  );
  remotePromptActive = false;

  const next = pendingRemoteDiagram || diagram;
  pendingRemoteDiagram = null;

  if (reload) {
    await applyRemoteDiagram(next);
  }
}

async function createDiagram(name) {
  try {
    const res = await fetch("/api/topologies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": CLIENT_ID,
      },
      body: JSON.stringify({ name: name || "Untitled", nodes: [], links: [] }),
    });
    const data = await res.json();
    await loadDiagramList();
    await openDiagram(data.diagram.id);
  } catch {
    /* ignore */
  }
}

async function saveDiagram() {
  if (!state.current) return;

  try {
    const res = await fetch(`/api/topologies/${state.current.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": CLIENT_ID,
      },
      body: JSON.stringify({
        name: state.current.name,
        nodes: state.current.nodes,
        links: state.current.links,
      }),
    });

    if (res.ok) {
      clearDirty();
      dom.saveBtn.textContent = "Saved ✓";
      setTimeout(() => { dom.saveBtn.textContent = "Save"; }, 1200);
      await loadDiagramList();
    }
  } catch {
    /* ignore */
  }
}

async function deleteDiagram() {
  if (!state.current) return;
  const ok = await Modal.confirm(`Delete "${state.current.name}"?`, {
    title: "Delete diagram",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;

  try {
    await fetch(`/api/topologies/${state.current.id}`, {
      method: "DELETE",
      headers: { "X-Client-Id": CLIENT_ID },
    });
    state.current = null;
    await loadDiagramList();

    if (state.diagrams.length) {
      await openDiagram(state.diagrams[0].id);
    } else {
      clearSelection();
      renderAll();
      dom.canvasHint.classList.remove("hidden");
    }
  } catch {
    /* ignore */
  }
}

async function renameDiagram() {
  if (!state.current) return;
  const name = await Modal.prompt("Diagram name:", state.current.name, {
    title: "Rename diagram",
  });
  if (!name) return;

  state.current.name = name;
  markDirty();
  await saveDiagram();
  await loadDiagramList();
  dom.diagramSelect.value = state.current.id;
}

/* ---------------------------------------------------------------- */
/* Device drawer                                                     */
/* ---------------------------------------------------------------- */

async function loadDevices() {
  try {
    const res = await fetch("/api/devices");
    const data = await res.json();

    state.devices.clear();
    for (const d of data.devices || []) {
      state.devices.set(d.id, { ...d, rttMs: null });
    }

    // hydrate live status
    for (const d of data.devices || []) {
      state.liveStatus.set(d.id, { status: d.status, rttMs: null });
      if (d.ip) {
        state.ipStatus.set(d.ip, { status: d.status, rttMs: null });
      }
    }

    renderDeviceList();
  } catch {
    /* ignore */
  }
}

function renderDeviceList() {
  const query = (dom.deviceSearch.value || "").toLowerCase().trim();

  const filtered = [...state.devices.values()]
    .filter((d) => {
      if (!query) return true;
      return (
        (d.ip || "").toLowerCase().includes(query) ||
        (d.hostname || "").toLowerCase().includes(query) ||
        (d.mac || "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const order = { up: 0, unknown: 1, down: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
        (a.ip || "").localeCompare(b.ip || "", undefined, { numeric: true });
    })
    .slice(0, 200);

  dom.deviceList.innerHTML = filtered.map((d) => `
    <div class="device-row" data-id="${d.id}">
      <div class="dot ${d.status}"></div>
      <div class="dev-info">
        <div class="dev-ip">${escapeHtml(d.ip)}</div>
        <div class="dev-host">${escapeHtml(d.hostname || "—")}</div>
      </div>
    </div>
  `).join("") || `<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No devices</div>`;
}

function openDeviceDrawer() {
  dom.deviceDrawer.classList.remove("hidden");
  loadDevices();
}

function closeDeviceDrawer() {
  dom.deviceDrawer.classList.add("hidden");
}

/* ---------------------------------------------------------------- */
/* Live updates (socket.io)                                          */
/* ---------------------------------------------------------------- */

let prevLiveStatus = null;

function setLiveStatus(status) {
  if (status === "live") {
    dom.wsStatus.textContent = "Live";
    dom.wsStatus.className = "ws-status online";
  } else {
    dom.wsStatus.textContent = "Connecting…";
    dom.wsStatus.className = "ws-status offline";
  }

  if (status === "live" && prevLiveStatus && prevLiveStatus !== "live") {
    onLiveRestored();
  }
  prevLiveStatus = status;
}

async function onLiveRestored() {
  await loadDiagramList();
  if (state.current && !state.dirty) {
    await openDiagram(state.current.id);
  }
}

async function handleTopologyCreated(msg) {
  if (msg.clientId && msg.clientId === CLIENT_ID) return;
  await loadDiagramList();
}

async function handleTopologyUpdated(msg) {
  if (msg.clientId && msg.clientId === CLIENT_ID) return;
  if (!msg.diagram) return;

  await loadDiagramList();

  if (!state.current || state.current.id !== msg.diagram.id) return;

  if (state.dirty) {
    await promptRemoteReload(msg.diagram);
  } else {
    await applyRemoteDiagram(msg.diagram);
  }
}

async function handleTopologyDeleted(msg) {
  if (msg.clientId && msg.clientId === CLIENT_ID) return;
  await handleRemoteDeleted(msg.id);
}

function handleSnapshot(data) {
  for (const d of data.devices || []) {
    const prev = state.liveStatus.get(d.id);
    state.devices.set(d.id, { ...d, rttMs: prev?.rttMs ?? null });
    state.liveStatus.set(d.id, { status: d.status, rttMs: prev?.rttMs ?? null });
    if (d.ip) {
      state.ipStatus.set(d.ip, { status: d.status, rttMs: prev?.rttMs ?? null });
    }
  }
  refreshNodeStatuses();
}

function handleDevice(d) {
  if (!d) return;

  const existing = state.devices.get(d.id) || {};
  state.devices.set(d.id, { ...existing, ...d });

  const status = d.status || state.liveStatus.get(d.id)?.status;
  const rttMs = d.rttMs ?? state.liveStatus.get(d.id)?.rttMs ?? null;

  state.liveStatus.set(d.id, { status, rttMs });

  if (d.ip) {
    state.ipStatus.set(d.ip, { status, rttMs });
  }

  refreshNodeStatuses();
}

function handleLatency(samples) {
  for (const s of samples || []) {
    const live = state.liveStatus.get(s.deviceId);
    if (live) {
      live.rttMs = s.rttMs;
    } else {
      state.liveStatus.set(s.deviceId, { status: "up", rttMs: s.rttMs });
    }

    if (s.ip) {
      const ipLive = state.ipStatus.get(s.ip);
      if (ipLive) {
        ipLive.rttMs = s.rttMs;
      } else {
        state.ipStatus.set(s.ip, { status: "up", rttMs: s.rttMs });
      }
    }
  }
  refreshNodeStatuses();
}

function refreshNodeStatuses() {
  if (!state.current) return;

  for (const node of state.current.nodes) {
    // resolve live status: by deviceId first, then by IP fallback
    let live = null;

    if (node.deviceId) {
      live = state.liveStatus.get(node.deviceId);
    }

    if (!live && node.ip) {
      live = state.ipStatus.get(node.ip);
    }

    const el = dom.world.querySelector(`[data-node-id="${node.id}"]`);
    if (!el) continue;

    if (!live) {
      el.classList.remove("is-up", "is-down");
      const ring0 = el.querySelector(".node-status-ring");
      if (ring0) ring0.className = "node-status-ring";
      continue;
    }

    const ring = el.querySelector(".node-status-ring");
    if (ring) {
      ring.className = `node-status-ring ${live.status || ""}`;
    }

    el.classList.toggle("is-up", live.status === "up");
    el.classList.toggle("is-down", live.status === "down");

    let latencyEl = el.querySelector(".node-latency");
    if (live.rttMs != null) {
      if (!latencyEl) {
        latencyEl = document.createElement("div");
        latencyEl.className = "node-latency";
        el.appendChild(latencyEl);
      }
      latencyEl.textContent = `${live.rttMs} ms`;
      latencyEl.className = `node-latency ${live.status === "down" ? "down" : ""}`;
    } else if (latencyEl) {
      latencyEl.remove();
    }
  }

  // also refresh open properties
  if (state.selection.kind === "node") {
    const node = state.current.nodes.find((n) => n.id === state.selection.id);
    if (node) {
      let live = node.deviceId ? state.liveStatus.get(node.deviceId) : null;
      if (!live && node.ip) live = state.ipStatus.get(node.ip);

      if (live) {
        dom.propLiveInfo.classList.remove("hidden");
        dom.propLiveStatus.textContent = live.status;
        dom.propLiveRtt.textContent = live.rttMs != null ? `${live.rttMs} ms` : "—";
      }
    }
  }
}

/* ---------------------------------------------------------------- */
/* Events                                                            */
/* ---------------------------------------------------------------- */

async function ensureCanMutate() {
  if (Auth.canMutate()) {
    return true;
  }

  if (!Auth.isLoggedIn()) {
    await Auth.openLogin();
    applyAuthUi();
    return Auth.canMutate();
  }

  await Modal.alert("Your role does not allow editing.");
  return false;
}

function applyAuthUi() {
  const can = Auth.canMutate();

  const gatedButtons = [
    dom.newDiagramBtn,
    dom.renameDiagramBtn,
    dom.deleteDiagramBtn,
    dom.connectModeBtn,
    dom.addNodeBtn,
    dom.addDeviceBtn,
    dom.saveBtn,
    dom.deleteNodeBtn,
    dom.deleteLinkBtn,
  ];

  for (const btn of gatedButtons) {
    if (!btn) continue;
    btn.classList.toggle("hidden", !can);
  }

  const gatedFields = [
    dom.propType,
    dom.propIp,
    dom.propHostname,
    dom.propMac,
    dom.propNotes,
    dom.propDevice,
    dom.propLinkLabel,
  ];

  for (const field of gatedFields) {
    if (!field) continue;
    field.disabled = !can;
  }

  if (!can) {
    closeDeviceDrawer();
    setMode("select");
  }
}

function bindEvents() {
  // toolbar
  dom.selectModeBtn.addEventListener("click", () => setMode("select"));
  dom.connectModeBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    setMode("connect");
  });
  dom.addNodeBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    const type = await Modal.prompt("Node type:", "generic", {
      title: "Add node",
      input: "select",
      options: [
        "router",
        "switch",
        "pc",
        "server",
        "printer",
        "phone",
        "firewall",
        "cloud",
        "generic",
      ],
    });
    if (type) addNode(type.trim().toLowerCase() || "generic");
  });
  dom.addDeviceBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    openDeviceDrawer();
  });
  dom.zoomInBtn.addEventListener("click", () => zoomBy(1.2));
  dom.zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.2));
  dom.zoomResetBtn.addEventListener("click", () => {
    state.viewport = { x: 0, y: 0, scale: 1 };
    applyTransform();
  });
  dom.saveBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    saveDiagram();
  });

  // diagram
  dom.diagramSelect.addEventListener("change", () => {
    if (dom.diagramSelect.value) openDiagram(dom.diagramSelect.value);
  });
  dom.newDiagramBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    const name = await Modal.prompt("Diagram name:", "New Diagram", {
      title: "New diagram",
    });
    if (name) createDiagram(name);
  });
  dom.renameDiagramBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    renameDiagram();
  });
  dom.deleteDiagramBtn.addEventListener("click", async () => {
    if (!(await ensureCanMutate())) return;
    deleteDiagram();
  });

  // props
  dom.closeProps.addEventListener("click", clearSelection);
  bindPropsEvents();

  // device drawer
  dom.closeDeviceDrawer.addEventListener("click", closeDeviceDrawer);
  dom.deviceSearch.addEventListener("input", renderDeviceList);
  dom.deviceList.addEventListener("click", (e) => {
    const row = e.target.closest(".device-row");
    if (!row) return;
    const devId = Number(row.dataset.id);
    const dev = state.devices.get(devId);
    if (!dev) return;

    addNode(guessType(dev.hostname || dev.ip), {
      ip: dev.ip,
      hostname: dev.hostname,
      mac: dev.mac,
      deviceId: dev.id,
    });
    closeDeviceDrawer();
  });

  // keyboard
  document.addEventListener("keydown", async (e) => {
    // skip when typing in inputs
    if (e.target.matches("input, textarea, select")) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      await deleteSelection();
    } else if (e.key === "Escape") {
      if (state.connectFrom) {
        state.connectFrom = null;
        setMode("select");
      }
      clearSelection();
    } else if (e.key === "v" || e.key === "V") {
      setMode("select");
    } else if (e.key === "c" || e.key === "C") {
      if (!(await ensureCanMutate())) return;
      setMode("connect");
    } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (!(await ensureCanMutate())) return;
      saveDiagram();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      state.viewport = { x: 0, y: 0, scale: 1 };
      applyTransform();
    } else if (e.key === "+" || e.key === "=") {
      zoomBy(1.2);
    } else if (e.key === "-") {
      zoomBy(1 / 1.2);
    }
  });
}

function zoomBy(factor) {
  const rect = dom.viewport.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const { x: vx, y: vy, scale } = state.viewport;

  const newScale = clamp(scale * factor, 0.25, 2.5);

  state.viewport.x = cx - (cx - vx) * (newScale / scale);
  state.viewport.y = cy - (cy - vy) * (newScale / scale);
  state.viewport.scale = newScale;

  applyTransform();
}

/* ---------------------------------------------------------------- */
/* Boot                                                              */
/* ---------------------------------------------------------------- */

async function init() {
  initViewport();
  bindEvents();
  applyTransform();
  Live.connect({
    handlers: {
      "topology.created": handleTopologyCreated,
      "topology.updated": handleTopologyUpdated,
      "topology.deleted": handleTopologyDeleted,
      snapshot: handleSnapshot,
      "device.up": handleDevice,
      "device.down": handleDevice,
      "device.update": handleDevice,
      latency: handleLatency,
    },
    onStatus: setLiveStatus,
  });
  window.addEventListener("auth:changed", applyAuthUi);
  await Auth.ensure();
  applyAuthUi();
  await loadDevices();
  await loadDiagramList();

  if (state.diagrams.length) {
    await openDiagram(state.diagrams[0].id);
  }
}

init();
