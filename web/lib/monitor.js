const { EventEmitter } = require("events");

const config = require("../config");
const db = require("./db");
const subnet = require("./subnet");
const { ping } = require("./ping");
const arp = require("./arp");
const hostname = require("./hostname");

class Monitor extends EventEmitter {
  constructor() {
    super();
    this.targets = [];
    this.extraTargets = new Set();
    this.subnetInfo = null;
    this.fullTimer = null;
    this.fastTimer = null;
    this.pruneTimer = null;
    this.sweeping = false;
    this.running = false;
    this.concurrency = config.get("concurrency") || 48;
    this.lastSweepAt = null;
    this.lastSweepMs = null;
    this.hostnameCache = new Map();
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.rebuildTargets();

    this.scheduleFull();
    this.scheduleFast();
    this.schedulePrune();

    // kick off an initial sweep shortly after boot
    setTimeout(() => this.forceFullSweep(), 500);

    console.log(
      `[monitor] started — subnet ${this.subnetInfo?.cidr || "unknown"}` +
        ` targets=${this.targets.length} concurrency=${this.concurrency}`,
    );
  }

  stop() {
    this.running = false;
    clearInterval(this.fullTimer);
    clearInterval(this.fastTimer);
    clearInterval(this.pruneTimer);
    this.fullTimer = null;
    this.fastTimer = null;
    this.pruneTimer = null;
  }

  rebuildTargets() {
    this.subnetInfo = subnet.resolveSubnet(config.getAll());
    this.refreshExtraTargets();

    if (!this.subnetInfo) {
      this.targets = [...this.extraTargets];
      console.warn("[monitor] no usable network adapter found");
      return;
    }

    const subnetHosts = subnet.usableHosts(this.subnetInfo, this.subnetInfo.ownAddress);
    const merged = new Set(subnetHosts);

    for (const ip of this.extraTargets) {
      merged.add(ip);
    }

    this.targets = [...merged];
    this.concurrency = config.get("concurrency") || 48;

    console.log(
      `[monitor] targets rebuilt: ${this.subnetInfo.cidr}` +
        ` (${subnetHosts.length} subnet + ${this.extraTargets.size} custom` +
        ` = ${this.targets.length}, own=${this.subnetInfo.ownAddress})`,
    );
  }

  /**
   * Collect custom/public IPs from topology diagrams.
   * These are probed alongside subnet hosts so custom
   * nodes show live status on the topology canvas.
   */
  refreshExtraTargets() {
    this.extraTargets.clear();

    try {
      const store = require("./topology-store");

      for (const summary of store.list()) {
        const diagram = store.get(summary.id);

        for (const node of diagram?.nodes || []) {
          if (node.ip && node.ip.trim()) {
            this.extraTargets.add(node.ip.trim());
          }
        }
      }
    } catch {
      /* topology store may not exist yet */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Scheduling                                                        */
  /* ---------------------------------------------------------------- */

  scheduleFull() {
    clearInterval(this.fullTimer);
    const interval = config.get("fullSweepMs") || 90000;

    this.fullTimer = setInterval(() => this.fullSweep(), interval);
  }

  scheduleFast() {
    clearInterval(this.fastTimer);
    const interval = config.get("fastLaneMs") || 15000;

    this.fastTimer = setInterval(() => this.fastSweep(), interval);
  }

  schedulePrune() {
    clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => {
      try {
        db.prune();
      } catch (error) {
        console.warn("[monitor] prune failed:", error.message);
      }
    }, 6 * 60 * 60 * 1000);
  }

  forceFullSweep() {
    return this.fullSweep();
  }

  /* ---------------------------------------------------------------- */
  /* Sweeps                                                            */
  /* ---------------------------------------------------------------- */

  async fullSweep() {
    if (this.sweeping) {
      return;
    }

    // refresh custom IPs from topology diagrams before probing
    this.refreshExtraTargets();

    if (!this.targets.length) {
      this.rebuildTargets();
    } else {
      // merge any new extra targets into the probe list
      const merged = new Set(this.targets);
      for (const ip of this.extraTargets) {
        merged.add(ip);
      }
      this.targets = [...merged];
    }

    this.sweeping = true;
    const started = Date.now();

    try {
      await this.probeAll(this.targets);

      this.lastSweepAt = Date.now();
      this.lastSweepMs = this.lastSweepAt - started;

      // adaptive concurrency
      if (this.lastSweepMs > 120000 && this.concurrency < 64) {
        this.concurrency = Math.min(64, this.concurrency + 8);
        config.save({ concurrency: this.concurrency });
      } else if (this.lastSweepMs < 30000 && this.concurrency > 16) {
        this.concurrency = Math.max(16, this.concurrency - 8);
        config.save({ concurrency: this.concurrency });
      }

      await this.enrichFromArp();
      await this.enrichHostnames();

      this.emit("summary", this.currentSummary());
      this.emit("sweep_complete", {
        durationMs: this.lastSweepMs,
        targets: this.targets.length,
      });

      console.log(
        `[monitor] full sweep done in ${this.lastSweepMs}ms` +
          ` (concurrency=${this.concurrency})`,
      );
    } catch (error) {
      console.error("[monitor] full sweep error:", error);
    } finally {
      this.sweeping = false;
    }
  }

  async fastSweep() {
    if (this.sweeping || !this.running) {
      return;
    }

    const since = Date.now() - 5 * 60 * 1000;
    const rows = db.listDevices();

    const fastTargets = rows
      .filter((d) => d.status === "up" || d.last_seen >= since)
      .map((d) => d.ip);

    if (!fastTargets.length) {
      return;
    }

    try {
      await this.probeAll(fastTargets);
      this.emit("summary", this.currentSummary());
    } catch (error) {
      console.warn("[monitor] fast sweep error:", error.message);
    }
  }

  async probeAll(ips) {
    const missThreshold = config.get("missThreshold") || 3;
    const timeoutMs = config.get("pingTimeoutMs") || 1000;
    const queue = [...ips];
    const workers = [];

    const worker = async () => {
      while (queue.length) {
        const ip = queue.shift();
        await this.probeOne(ip, missThreshold, timeoutMs);
      }
    };

    for (let i = 0; i < Math.min(this.concurrency, ips.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  async probeOne(ip, missThreshold, timeoutMs) {
    const result = await ping(ip, timeoutMs);
    const now = Date.now();
    let device = db.getDeviceByIp(ip);
    const previousStatus = device ? device.status : null;

    if (!device) {
      if (!result.ok) {
        // For custom/public targets, create a row even on failure
        // so permanently-down IPs still show a status badge.
        if (this.extraTargets.has(ip)) {
          device = db.upsertDevice({
            ip,
            status: "down",
            missCount: 999,
            lastSeen: now,
            firstSeen: now,
          });
        } else {
          // unknown + failed LAN host — don't create a row until it shows up
          return;
        }
      } else {
        device = db.upsertDevice({
          ip,
          status: "up",
          missCount: 0,
          lastSeen: now,
          firstSeen: now,
        });
      }
    } else {
      device = db.markProbed(device.id, {
        ok: result.ok,
        rttMs: result.ms,
        missThreshold,
        ts: now,
      });
    }

    if (!device) {
      return;
    }

    db.insertSample(device.id, now, result.ok ? result.ms : null);

    const currentStatus = device.status;

    if (result.ok && previousStatus !== "up") {
      db.insertEvent(device.id, "up");
      this.emit("device.up", {
        id: device.id,
        ip: device.ip,
        hostname: device.hostname,
        mac: device.mac,
        rttMs: result.ms,
        lastSeen: now,
      });
    }

    if (!result.ok && currentStatus === "down" && previousStatus !== "down") {
      db.insertEvent(device.id, "down", "miss threshold reached");
      this.emit("device.down", {
        id: device.id,
        ip: device.ip,
        hostname: device.hostname,
        mac: device.mac,
        lastSeen: device.last_seen,
      });
    }

    if (result.ok) {
      this.emit("latency", {
        deviceId: device.id,
        ip: device.ip,
        ts: now,
        rttMs: result.ms,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Enrichment                                                        */
  /* ---------------------------------------------------------------- */

  async enrichFromArp() {
    try {
      const macMap = await arp.getMacMap();

      for (const [ip, mac] of macMap) {
        const device = db.getDeviceByIp(ip);

        if (device && !device.mac) {
          db.updateDeviceMeta(device.id, { mac });
        }
      }
    } catch (error) {
      console.warn("[monitor] arp enrichment failed:", error.message);
    }
  }

  async enrichHostnames() {
    const rows = db.listDevices();

    for (const device of rows) {
      if (device.hostname || this.hostnameCache.has(device.ip)) {
        continue;
      }

      this.hostnameCache.set(device.ip, true);

      try {
        const name = await hostname.lookup(device.ip);

        if (name) {
          db.updateDeviceMeta(device.id, { hostname: name });
          this.emit("device.update", {
            id: device.id,
            ip: device.ip,
            hostname: name,
          });
        }
      } catch {
        /* best-effort */
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Introspection                                                     */
  /* ---------------------------------------------------------------- */

  currentSummary() {
    const s = db.summary();
    return {
      ...s,
      lastSweepAt: this.lastSweepAt,
      lastSweepMs: this.lastSweepMs,
      targets: this.targets.length,
      subnet: this.subnetInfo?.cidr || null,
      adapter: this.subnetInfo?.adapterName || null,
      concurrency: this.concurrency,
    };
  }

  snapshot() {
    return {
      summary: this.currentSummary(),
      devices: db.listDevices().map((d) => ({
        id: d.id,
        ip: d.ip,
        mac: d.mac,
        hostname: d.hostname,
        status: d.status,
        lastSeen: d.last_seen,
        firstSeen: d.first_seen,
        missCount: d.miss_count,
      })),
    };
  }
}

module.exports = new Monitor();
