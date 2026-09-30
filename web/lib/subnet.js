const os = require("os");

const DENY = /vmware|virtualbox|vethernet|hyper-v|wsl|loopback|docker|vboxnet/i;
const PREFER = /ethernet|wi-?fi|lan|wi-?fi/i;

function ipToInt(ip) {
  return (
    ip
      .split(".")
      .reduce((acc, part) => ((acc << 8) + (Number(part) & 0xff)) >>> 0, 0) >>> 0
  );
}

function intToIp(int) {
  return [(int >>> 24) & 0xff, (int >>> 16) & 0xff, (int >>> 8) & 0xff, int & 0xff].join(".");
}

function maskBits(mask) {
  return mask
    .split(".")
    .map((part) => Number(part) & 0xff)
    .reduce((acc, part) => acc + part.toString(2).split("1").length - 1, 0);
}

function isLinkLocal(ip) {
  return ip.startsWith("169.254.");
}

function listAdapters() {
  const interfaces = os.networkInterfaces();
  const adapters = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      adapters.push({
        name,
        address: address.address,
        netmask: address.netmask,
        cidr: `${address.address}/${maskBits(address.netmask)}`,
        linkLocal: isLinkLocal(address.address),
        denied: DENY.test(name),
        preferred: PREFER.test(name) && !DENY.test(name),
      });
    }
  }

  return adapters;
}

function selectAdapter(adapterName) {
  const adapters = listAdapters();

  if (adapterName) {
    const match = adapters.find(
      (adapter) => adapter.name === adapterName && !adapter.linkLocal,
    );

    if (match) {
      return match;
    }
  }

  const usable = adapters.filter((adapter) => !adapter.denied && !adapter.linkLocal);

  return (
    usable.find((adapter) => adapter.preferred) ||
    usable[0] ||
    adapters.find((adapter) => !adapter.linkLocal) ||
    null
  );
}

function computeSubnet(adapter) {
  if (!adapter) {
    return null;
  }

  const ip = ipToInt(adapter.address);
  const mask = ipToInt(adapter.netmask);
  const network = (ip & mask) >>> 0;
  const prefix = maskBits(adapter.netmask);
  const size = 2 ** (32 - prefix);
  const broadcast = (network + size - 1) >>> 0;

  return {
    adapterName: adapter.name,
    address: adapter.address,
    netmask: adapter.netmask,
    prefix,
    network: intToIp(network),
    broadcast: intToIp(broadcast),
    cidr: `${intToIp(network)}/${prefix}`,
    size,
  };
}

function usableHosts(subnet, ownIp) {
  if (!subnet) {
    return [];
  }

  const network = ipToInt(subnet.network);
  const broadcast = ipToInt(subnet.broadcast);
  const own = ownIp ? ipToInt(ownIp) : null;
  const hosts = [];

  for (let ip = network + 1; ip < broadcast; ip++) {
    if (own !== null && ip === own) {
      continue;
    }

    hosts.push(intToIp(ip));
  }

  return hosts;
}

function resolveSubnet(settings = {}) {
  if (settings.subnetOverride) {
    const [address, prefixStr] = String(settings.subnetOverride).split("/");
    const prefix = Number(prefixStr);

    if (!address || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
      throw new Error(`Invalid subnetOverride: ${settings.subnetOverride}`);
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ipToInt(address) & mask) >>> 0;
    const size = 2 ** (32 - prefix);

    return {
      adapterName: settings.adapterName || "manual",
      address,
      netmask: intToIp(mask),
      prefix,
      network: intToIp(network),
      broadcast: intToIp((network + size - 1) >>> 0),
      cidr: `${intToIp(network)}/${prefix}`,
      size,
      ownAddress: address,
    };
  }

  const adapter = selectAdapter(settings.adapterName);

  if (!adapter) {
    return null;
  }

  const subnet = computeSubnet(adapter);

  return { ...subnet, ownAddress: adapter.address };
}

module.exports = {
  listAdapters,
  selectAdapter,
  computeSubnet,
  usableHosts,
  resolveSubnet,
  ipToInt,
  intToIp,
};
