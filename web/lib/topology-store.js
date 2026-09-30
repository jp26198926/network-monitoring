const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");

const FILE = path.join(config.DATA_DIR, "topologies.json");

let cache = null;

function ensureFile() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

function loadAll() {
  if (cache) {
    return cache;
  }

  ensureFile();

  try {
    if (fs.existsSync(FILE)) {
      cache = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    } else {
      cache = [];
    }
  } catch {
    cache = [];
  }

  return cache;
}

function persist() {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function list() {
  return loadAll().map((d) => ({
    id: d.id,
    name: d.name,
    updatedAt: d.updatedAt,
    nodeCount: d.nodes.length,
    linkCount: d.links.length,
  }));
}

function get(id) {
  return loadAll().find((d) => d.id === id) || null;
}

function create({ name, nodes, links } = {}) {
  const diagram = {
    id: crypto.randomUUID(),
    name: name || "Untitled",
    updatedAt: Date.now(),
    nodes: Array.isArray(nodes) ? nodes : [],
    links: Array.isArray(links) ? links : [],
  };

  loadAll().push(diagram);
  persist();

  return diagram;
}

function update(id, data) {
  const all = loadAll();
  const index = all.findIndex((d) => d.id === id);

  if (index === -1) {
    return null;
  }

  const existing = all[index];

  const updated = {
    id: existing.id,
    name: data.name !== undefined ? String(data.name) : existing.name,
    updatedAt: Date.now(),
    nodes: Array.isArray(data.nodes) ? data.nodes : existing.nodes,
    links: Array.isArray(data.links) ? data.links : existing.links,
  };

  all[index] = updated;
  persist();

  return updated;
}

function remove(id) {
  const all = loadAll();
  const index = all.findIndex((d) => d.id === id);

  if (index === -1) {
    return false;
  }

  all.splice(index, 1);
  persist();

  return true;
}

module.exports = {
  FILE,
  list,
  get,
  create,
  update,
  remove,
};
