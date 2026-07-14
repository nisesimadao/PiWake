import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';

function exec(command, args) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

async function readCpuTempC() {
  try {
    const raw = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const milli = parseInt(raw.trim(), 10);
    if (Number.isFinite(milli)) return Math.round(milli / 1000);
  } catch { /* not a Linux SBC */ }
  const vcgencmd = await exec('vcgencmd', ['measure_temp']);
  const match = vcgencmd?.match(/temp=([\d.]+)/);
  return match ? Math.round(parseFloat(match[1])) : null;
}

async function readTailscaleIp() {
  const out = await exec('tailscale', ['ip', '-4']);
  return out?.split('\n')[0]?.trim() || null;
}

async function tailscaleOnline() {
  const out = await exec('tailscale', ['status', '--json']);
  if (!out) return null;
  try { return JSON.parse(out).BackendState === 'Running'; } catch { return null; }
}

let lastCpuInfo = os.cpus();
let lastCpuTime = Date.now();

function getCpuUsage() {
  const currentCpuInfo = os.cpus();
  const now = Date.now();
  if (now - lastCpuTime < 100 && lastCpuInfo === currentCpuInfo) {
    // Too fast or same info
  } else {
    let idleDiff = 0;
    let totalDiff = 0;
    for (let i = 0; i < currentCpuInfo.length; i++) {
      const current = currentCpuInfo[i].times;
      const last = lastCpuInfo[i].times;
      const currentTotal = current.user + current.nice + current.sys + current.idle + current.irq;
      const lastTotal = last.user + last.nice + last.sys + last.idle + last.irq;
      totalDiff += currentTotal - lastTotal;
      idleDiff += current.idle - last.idle;
    }
    lastCpuInfo = currentCpuInfo;
    lastCpuTime = now;
    if (totalDiff > 0) return Math.round(100 - (100 * idleDiff / totalDiff));
  }
  return null; // fallback
}

function getMemInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    free,
    used,
    pct: Math.round((used / total) * 100)
  };
}

export async function hostSnapshot() {
  const [temp, tailscaleIp, tsOnline] = await Promise.all([
    readCpuTempC(),
    readTailscaleIp(),
    tailscaleOnline(),
  ]);
  const cpuPct = getCpuUsage();
  return {
    name: os.hostname(),
    tempC: temp,
    load1: Math.round(os.loadavg()[0] * 10) / 10,
    uptimeSeconds: Math.round(os.uptime()),
    tailscaleIp,
    tailscaleOnline: tsOnline,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpuPct: cpuPct != null ? cpuPct : 0,
    mem: getMemInfo(),
  };
}
