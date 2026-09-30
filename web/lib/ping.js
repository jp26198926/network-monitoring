const { execFile } = require("child_process");

/**
 * Probe a single host with the system ping command.
 * Returns { ok: boolean, ms: number|null, raw: string }.
 *
 * Windows:  ping -n 1 -w <timeout> <ip>
 * POSIX:    ping -c 1 -W <timeoutSec> <ip>
 */
function ping(ip, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";

    const args = isWindows
      ? ["-n", "1", "-w", String(timeoutMs), ip]
      : ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip];

    execFile(
      "ping",
      args,
      { timeout: timeoutMs + 2000, windowsHide: true },
      (error, stdout, stderr) => {
        const raw = `${stdout || ""}\n${stderr || ""}`;

        const parsed = parsePingOutput(raw);

        if (parsed.ok) {
          resolve({ ok: true, ms: parsed.ms, raw });
          return;
        }

        resolve({ ok: false, ms: null, raw: raw || (error ? error.message : "") });
      },
    );
  });
}

/**
 * Parse ping output for a successful reply and round-trip time.
 *
 * Handles English ("time=12ms", "time<1ms") and CJK/other locales
 * ("时间=12ms", "平均 = 12ms"). Any TTL= marker is treated as alive
 * even when the time value cannot be parsed.
 */
function parsePingOutput(raw) {
  if (!raw) {
    return { ok: false, ms: null };
  }

  const lessThanMatch = raw.match(/(?:time|时间)\s*<\s*1\s*ms/i);

  if (lessThanMatch) {
    return { ok: true, ms: 0 };
  }

  const timeMatch = raw.match(/(?:time|时间|czas|tiempo|tempo)\s*[=]\s*(\d+(?:\.\d+)?)\s*ms/i);

  if (timeMatch) {
    return { ok: true, ms: Number(timeMatch[1]) };
  }

  if (/TTL\s*=/i.test(raw)) {
    return { ok: true, ms: 0 };
  }

  return { ok: false, ms: null };
}

module.exports = {
  ping,
  parsePingOutput,
};
