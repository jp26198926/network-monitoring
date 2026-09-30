const { execFile } = require("child_process");

let cache = { map: new Map(), fetchedAt: 0 };

const CACHE_TTL_MS = 60000;

/**
 * Parse `arp -a` output into Map<ip, mac>.
 *
 * Windows output looks like:
 *   Interface: 10.10.1.135 --- 0x5
 *     Internet Address      Physical Address      Type
 *     10.10.1.1             aa-bb-cc-dd-ee-ff     dynamic
 *
 * Filter out IPv6 rows, "invalid" entries, and the interface header.
 */
function parseArpOutput(raw) {
  const map = new Map();

  if (!raw) {
    return map;
  }

  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{1,2}[:\-][0-9a-f]{1,2}[:\-][0-9a-f]{1,2}[:\-][0-9a-f]{1,2}[:\-][0-9a-f]{1,2}[:\-][0-9a-f]{1,2})/i,
    );

    if (!match) {
      continue;
    }

    const ip = match[1];
    const mac = match[2].toLowerCase().replace(/-/g, ":");

    if (mac === "00:00:00:00:00:00" || ip.startsWith("224.") || ip.startsWith("239.")) {
      continue;
    }

    map.set(ip, mac);
  }

  return map;
}

function fetchArpTable() {
  return new Promise((resolve) => {
    execFile("arp", ["-a"], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(cache.map);
        return;
      }

      cache = {
        map: parseArpOutput(stdout),
        fetchedAt: Date.now(),
      };

      resolve(cache.map);
    });
  });
}

async function getMac(ip) {
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    await fetchArpTable();
  }

  return cache.map.get(ip) || null;
}

async function getMacMap() {
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    await fetchArpTable();
  }

  return new Map(cache.map);
}

module.exports = {
  parseArpOutput,
  fetchArpTable,
  getMac,
  getMacMap,
};
