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

export async function hostSnapshot() {
  const [temp, tailscaleIp, tsOnline] = await Promise.all([
    readCpuTempC(),
    readTailscaleIp(),
    tailscaleOnline(),
  ]);
  const cores = os.cpus().length || 1;
  return {
    name: os.hostname(),
    tempC: temp,
    cpuPercent: Math.min(100, Math.round((os.loadavg()[0] / cores) * 100)),
    uptimeSeconds: Math.round(os.uptime()),
    tailscaleIp,
    tailscaleOnline: tsOnline,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
  };
}
