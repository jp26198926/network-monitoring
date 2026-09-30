const dns = require("dns").promises;
const { execFile } = require("child_process");

function reverseLookup(ip, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);

    dns.reverse(ip)
      .then((names) => {
        clearTimeout(timer);
        resolve(names && names.length ? names[0] : null);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function nbtstatLookup(ip, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }

    execFile(
      "nbtstat",
      ["-A", ip],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }

        const match = stdout.match(/^\s*(\S+)\s+<00>\s+UNIQUE\s+Registered/mi);
        resolve(match ? match[1] : null);
      },
    );
  });
}

async function lookup(ip) {
  const reverse = await reverseLookup(ip);

  if (reverse) {
    return reverse;
  }

  return nbtstatLookup(ip);
}

module.exports = {
  reverseLookup,
  nbtstatLookup,
  lookup,
};
