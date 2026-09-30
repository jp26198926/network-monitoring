const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULTS = {
  adapterName: null,
  subnetOverride: null,
  concurrency: 48,
  fullSweepMs: 90000,
  fastLaneMs: 15000,
  missThreshold: 3,
  retentionDays: 14,
  eventRetentionDays: 90,
  pingTimeoutMs: 1000,
};

let cached = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  if (cached) {
    return cached;
  }

  ensureDataDir();

  let fileSettings = {};

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      fileSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    }
  } catch (error) {
    console.warn("Failed to read settings.json:", error.message);
  }

  cached = { ...DEFAULTS, ...fileSettings };

  return cached;
}

function get(key) {
  return load()[key];
}

function getAll() {
  return { ...load() };
}

function save(partial) {
  ensureDataDir();

  cached = { ...load(), ...partial };

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cached, null, 2), "utf-8");

  return { ...cached };
}

module.exports = {
  DATA_DIR,
  SETTINGS_FILE,
  DEFAULTS,
  load,
  get,
  getAll,
  save,
};
