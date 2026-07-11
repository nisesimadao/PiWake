import { execFile } from 'node:child_process';

function exec(command, args) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

const IGNORED_MAC_PREFIXES = ['ff:ff:ff', '01:00:5e', '33:33'];

function normalizeMac(mac) {
  return mac.toUpperCase().replace(/-/g, ':');
}

function isUsable({ ip, mac }) {
  if (!ip || !mac) return false;
  if (ip.includes(':')) return false; // IPv6 neighbours are not WOL targets
  if (ip.startsWith('224.') || ip.endsWith('.255')) return false;
  return !IGNORED_MAC_PREFIXES.some(prefix => mac.toLowerCase().startsWith(prefix));
}

export function parseIpNeigh(output) {
  // "192.168.1.66 dev eth0 lladdr 3c:52:82:9a:11:22 REACHABLE"
  return output.split('\n').flatMap(line => {
    const match = line.match(/^(\S+)\s+dev\s+\S+\s+lladdr\s+([0-9a-fA-F:]{17})\s+(\S+)/);
    if (!match || match[3] === 'FAILED') return [];
    return [{ ip: match[1], mac: normalizeMac(match[2]) }];
  });
}

export function parseArp(output) {
  // unix: "? (192.168.1.66) at 3c:52:82:9a:11:22 [ether] on en0"
  // win:  "  192.168.1.66      3c-52-82-9a-11-22     dynamic"
  return output.split('\n').flatMap(line => {
    const unix = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-fA-F:]{17})/);
    if (unix) return [{ ip: unix[1], mac: normalizeMac(unix[2]) }];
    // The trailing type column is locale-dependent ("dynamic" / "動的"), so don't match on it.
    const win = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s/);
    if (win) return [{ ip: win[1], mac: normalizeMac(win[2]) }];
    return [];
  });
}

export async function scanNeighbours() {
  let entries = [];
  const neigh = await exec('ip', ['neigh', 'show']);
  if (neigh) entries = parseIpNeigh(neigh);
  if (!entries.length) {
    const arp = await exec('arp', ['-a']);
    if (arp) entries = parseArp(arp);
  }
  const seen = new Set();
  return entries.filter(isUsable).filter(entry => {
    if (seen.has(entry.mac)) return false;
    seen.add(entry.mac);
    return true;
  });
}
