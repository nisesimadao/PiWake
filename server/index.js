import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sendMagicPacket, parseMac } from './lib/wol.js';
import { ping, remoteReady, tcpOpen } from './lib/probe.js';
import { hostSnapshot } from './lib/metrics.js';
import { scanNeighbours } from './lib/scan.js';
import { readJson, writeJson, dataDir } from './lib/store.js';

const PORT = Number(process.env.PIWAKE_PORT) || 8787;
const TOKEN = process.env.PIWAKE_TOKEN || '';
const WAKE_TIMEOUT_MS = (Number(process.env.PIWAKE_WAKE_TIMEOUT) || 90) * 1000;
const BROADCAST = process.env.PIWAKE_BROADCAST || '255.255.255.255';
const STATUS_INTERVAL_MS = (Number(process.env.PIWAKE_STATUS_INTERVAL) || 10) * 1000;
const ALLOWED_HOSTS = (process.env.PIWAKE_ALLOWED_HOSTS || '')
  .split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean);
const STATIC_DIR = process.env.PIWAKE_STATIC_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const VERSION = '1.1.0';
const JOB_RETENTION_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- state

let devices = readJson('devices', { version: 1, devices: [] }).devices;
let activity = readJson('activity', []);
let schedules = readJson('schedules', []);
const jobs = new Map();
const sseClients = new Set();

function persistDevices() {
  writeJson('devices', { version: 1, devices });
}

function persistSchedules() {
  writeJson('schedules', schedules);
}

// Pinned devices sort first; insertion order is preserved within each group.
function sortedDevices() {
  return devices.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

function logActivity(deviceName, action, result = 'neutral') {
  activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), deviceName, action, result });
  activity = activity.slice(0, 200);
  writeJson('activity', activity);
}

function publicDevice(device) {
  const { id, name, kind, mac, ip, localIp, location, user, status, lastSeenAt, pinned, os, sshPort, rdpPort, webUrl } = device;
  return {
    id, name, kind, mac, ip, localIp, location, user,
    status: status || 'offline', lastSeenAt: lastSeenAt || null, pinned: Boolean(pinned),
    os: os || null, sshPort: sshPort || null, rdpPort: rdpPort || null, webUrl: webUrl || null,
  };
}

function devicePorts(device) {
  return [device.sshPort || 22, device.rdpPort || 3389];
}

// ------------------------------------------------- server-sent events

function broadcast(event, data) {
  if (!sseClients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

function broadcastDevices() {
  broadcast('devices', sortedDevices().map(publicDevice));
}

setInterval(() => {
  for (const client of sseClients) client.write(': ping\n\n');
}, 25000);

// ------------------------------------------------------- status poller

let polling = false;
async function refreshStatuses() {
  if (polling) return;
  polling = true;
  try {
    let changed = false;
    await Promise.all(devices.map(async snapshot => {
      const [tailscaleAlive, lanAlive] = await Promise.all([ping(snapshot.ip), ping(snapshot.localIp)]);
      const alive = tailscaleAlive || lanAlive;
      // Re-find by id: the array may have been replaced by add/delete while we pinged.
      const device = devices.find(item => item.id === snapshot.id);
      if (!device) return;
      const status = alive ? 'online' : 'offline';
      if (device.status !== status) changed = true;
      device.status = status;
      if (alive) device.lastSeenAt = new Date().toISOString();
    }));
    persistDevices();
    if (changed) broadcastDevices();
  } finally {
    polling = false;
  }
}
setInterval(refreshStatuses, STATUS_INTERVAL_MS);
refreshStatuses();

// ------------------------------------------------------------ wake job

function retireJob(job) {
  setTimeout(() => jobs.delete(job.id), JOB_RETENTION_MS).unref?.();
}

async function runWakeJob(job, device) {
  const update = state => {
    job.state = state;
    job.updatedAt = new Date().toISOString();
    broadcast('job', job);
  };
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  const reachHost = device.ip || device.localIp;
  try {
    while (Date.now() < deadline) {
      if (job.state === 'cancelled') { retireJob(job); return; }
      if (job.state === 'packet_sent') {
        const [lan, ts] = await Promise.all([ping(device.localIp), ping(device.ip)]);
        if (lan || ts) update('responding');
      } else if (job.state === 'responding') {
        if (!device.ip || await ping(device.ip)) update('reachable');
      } else if (job.state === 'reachable') {
        if (await remoteReady(reachHost, devicePorts(device))) {
          update('ready');
          device.status = 'online';
          device.lastSeenAt = new Date().toISOString();
          persistDevices();
          broadcastDevices();
          logActivity(device.name, 'Wake succeeded', 'success');
          retireJob(job);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    update('timeout');
    logActivity(device.name, 'Wake timed out', 'warning');
  } catch (error) {
    update('failed');
    job.error = error.message;
    logActivity(device.name, 'Wake failed', 'warning');
  }
  retireJob(job);
}

// ----------------------------------------------------- scheduled wakes

function startWakeJob(device) {
  const job = {
    id: crypto.randomUUID(),
    deviceId: device.id,
    state: 'packet_sent',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  runWakeJob(job, device);
  return job;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const OS_VALUES = ['windows', 'macos', 'linux', 'raspberrypi'];
const SSH_USER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function validateDeviceFields(body, { partial = false } = {}) {
  if ((!partial || 'name' in body)) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 48) {
      return { error: 'A device name (max 48 chars) is required.' };
    }
  }
  for (const key of ['ip', 'localIp']) {
    if (!(key in body) || body[key] == null || body[key] === '') continue;
    if (typeof body[key] !== 'string') return { error: `${key} must be a valid IP address or hostname.` };
    const value = body[key].trim();
    if (!net.isIP(value) && !HOSTNAME_PATTERN.test(value)) return { error: `${key} must be a valid IP address or hostname.` };
  }
  if ('user' in body && body.user != null && body.user !== '') {
    if (typeof body.user !== 'string' || !SSH_USER_PATTERN.test(body.user.trim())) {
      return { error: 'user must be a safe SSH username (letters, numbers, dot, dash, underscore; max 32).' };
    }
  }
  if ('pinned' in body && typeof body.pinned !== 'boolean') return { error: 'pinned must be a boolean.' };
  if ('os' in body && body.os != null && body.os !== '' && !OS_VALUES.includes(body.os)) {
    return { error: `os must be one of: ${OS_VALUES.join(', ')}.` };
  }
  for (const key of ['sshPort', 'rdpPort']) {
    if (!(key in body) || body[key] == null || body[key] === '') continue;
    const port = Number(body[key]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: `${key} must be a port number (1-65535).` };
  }
  if ('webUrl' in body && body.webUrl != null && body.webUrl !== '') {
    if (typeof body.webUrl !== 'string' || !/^https?:\/\//i.test(body.webUrl.trim())) {
      return { error: 'webUrl must start with http:// or https://.' };
    }
    try { new URL(body.webUrl.trim()); } catch { return { error: 'webUrl must be a valid URL.' }; }
  }
  return {};
}

function validateSchedule(body) {
  const time = String(body.time || '').trim();
  if (!TIME_PATTERN.test(time)) return { error: 'time must be HH:MM (24h).' };
  const days = Array.isArray(body.days) ? [...new Set(body.days)] : [];
  if (!days.length || days.some(day => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6)) {
    return { error: 'days must be a non-empty array of 0 (Sun) to 6 (Sat).' };
  }
  return { time, days: days.sort((a, b) => a - b) };
}

// Fires wake jobs when a schedule's local time matches; minute granularity,
// with lastFired guarding against double fires within the same minute.
async function checkSchedules() {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const currentTime = minuteKey.slice(-5);
  let dirty = false;
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.time !== currentTime) continue;
    if (!schedule.days.includes(now.getDay()) || schedule.lastFired === minuteKey) continue;
    schedule.lastFired = minuteKey;
    dirty = true;
    const device = devices.find(item => item.id === schedule.deviceId);
    if (!device) continue;
    try {
      await sendMagicPacket(device.mac, { address: BROADCAST });
      logActivity(device.name, 'Scheduled wake', 'neutral');
      startWakeJob(device);
    } catch (error) {
      logActivity(device.name, 'Scheduled wake failed', 'warning');
    }
  }
  if (dirty) persistSchedules();
}
setInterval(checkSchedules, 20000);
checkSchedules();

// ------------------------------------------------------------ shutdown

function shutdownOverSsh(device) {
  const address = device.ip || device.localIp;
  if (!address) return Promise.resolve({ sent: false, error: 'No reachable address configured.' });
  const target = `${device.user || 'pi'}@${address}`;
  const command = 'sudo -n shutdown -h now || shutdown -h now || shutdown /s /t 0';
  return new Promise(resolve => {
    execFile('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new',
      ...(device.sshPort ? ['-p', String(device.sshPort)] : []),
      target, command,
    ], { timeout: 15000 }, error => {
      // A successful shutdown usually kills the connection (non-zero exit).
      // Exit code 255 means ssh itself failed (auth/unreachable).
      if (error && error.code === 255) {
        resolve({ sent: false, error: `SSH connection to ${target} failed. Set up key-based SSH from the Pi first.` });
      } else {
        resolve({ sent: true, target });
      }
    });
  });
}

function shutdownSelf() {
  return new Promise(resolve => {
    execFile('sudo', ['-n', 'shutdown', '-h', 'now'], { timeout: 10000 }, error => {
      if (error) resolve({ sent: false, error: 'shutdown failed. Allow it in sudoers: `<user> ALL=(root) NOPASSWD: /usr/sbin/shutdown`' });
      else resolve({ sent: true });
    });
  });
}

// -------------------------------------------------------------- router

function json(res, status, body) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      data += chunk;
      if (data.length > 64 * 1024) {
        rejected = true;
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  let presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  // EventSource cannot set headers, so /api/events accepts ?token= as well.
  if (!presented && url.pathname === '/api/events') presented = url.searchParams.get('token') || '';
  if (presented.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(TOKEN));
}

// Reject requests whose Host header is not this machine — blocks DNS
// rebinding, where an attacker's domain resolves to the Pi's IP and their
// page becomes "same origin" with this API in the victim's browser.
function hostAllowed(req) {
  const raw = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!raw) return false;
  if (raw === 'localhost' || raw.startsWith('[')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return true; // LAN / Tailscale IP literal
  const hostname = os.hostname().toLowerCase();
  if (raw === hostname || raw === `${hostname}.local`) return true;
  if (raw.endsWith('.ts.net')) return true; // Tailscale MagicDNS
  return ALLOWED_HOSTS.includes(raw);
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, mode: 'api', version: VERSION, authRequired: Boolean(TOKEN) });
  }
  if (!authorized(req, url)) {
    return json(res, 401, { error: 'Unauthorized. Set the API token in Settings.' });
  }
  // Forms can't send application/json without a CORS preflight, so requiring
  // it on mutating requests blocks cross-origin CSRF (e.g. text/plain forms).
  if (['POST', 'PATCH'].includes(req.method) && !(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 415, { error: 'Content-Type must be application/json.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return handleEvents(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/host') {
    return json(res, 200, await hostSnapshot());
  }

  if (req.method === 'POST' && url.pathname === '/api/host/shutdown') {
    const result = await shutdownSelf();
    if (!result.sent) return json(res, 500, { error: result.error });
    logActivity(os.hostname(), 'Host shutdown requested', 'warning');
    return json(res, 202, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    return json(res, 200, sortedDevices().map(publicDevice));
  }

  if (req.method === 'POST' && url.pathname === '/api/devices') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const mac = String(body.mac || '').trim().toUpperCase();
    const fields = validateDeviceFields(body);
    if (fields.error) return json(res, 400, { error: fields.error });
    try { parseMac(mac); } catch { return json(res, 400, { error: 'A valid MAC address is required.' }); }
    if (devices.some(device => device.mac === mac)) return json(res, 409, { error: 'A device with this MAC address already exists.' });
    const device = {
      id: crypto.randomUUID(),
      name,
      kind: body.kind === 'server' ? 'server' : 'pc',
      mac,
      ip: String(body.ip || '').trim() || null,
      localIp: String(body.localIp || '').trim() || null,
      location: String(body.location || '').trim() || 'Home',
      user: String(body.user || '').trim() || null,
      os: OS_VALUES.includes(body.os) ? body.os : null,
      sshPort: body.sshPort ? Number(body.sshPort) : null,
      rdpPort: body.rdpPort ? Number(body.rdpPort) : null,
      webUrl: String(body.webUrl || '').trim() || null,
      status: 'offline',
      lastSeenAt: null,
      pinned: false,
    };
    devices.push(device);
    persistDevices();
    logActivity(device.name, 'Device added', 'neutral');
    broadcastDevices();
    refreshStatuses();
    return json(res, 201, publicDevice(device));
  }

  if (segments[1] === 'devices' && segments[2]) {
    const device = devices.find(item => item.id === segments[2]);
    if (!device) return json(res, 404, { error: 'Device not found.' });

    if (req.method === 'DELETE' && segments.length === 3) {
      devices = devices.filter(item => item.id !== device.id);
      persistDevices();
      const remaining = schedules.filter(schedule => schedule.deviceId !== device.id);
      if (remaining.length !== schedules.length) {
        schedules = remaining;
        persistSchedules();
      }
      logActivity(device.name, 'Device removed', 'neutral');
      broadcastDevices();
      return json(res, 204, null);
    }

    if (req.method === 'PATCH' && segments.length === 3) {
      const body = await readBody(req);
      const fields = validateDeviceFields(body, { partial: true });
      if (fields.error) return json(res, 400, { error: fields.error });
      for (const key of ['name', 'ip', 'localIp', 'location', 'user', 'os', 'webUrl']) {
        if (key in body) device[key] = String(body[key] || '').trim() || null;
      }
      for (const key of ['sshPort', 'rdpPort']) {
        if (key in body) device[key] = body[key] ? Number(body[key]) : null;
      }
      if ('pinned' in body) device.pinned = body.pinned;
      persistDevices();
      broadcastDevices();
      return json(res, 200, publicDevice(device));
    }

    if (req.method === 'POST' && segments[3] === 'wake') {
      await sendMagicPacket(device.mac, { address: BROADCAST });
      logActivity(device.name, 'Magic packet sent', 'neutral');
      const job = startWakeJob(device);
      return json(res, 202, { jobId: job.id, deviceId: device.id, state: job.state });
    }

    if (req.method === 'GET' && segments[3] === 'services') {
      const address = device.ip || device.localIp;
      const [sshPort, rdpPort] = devicePorts(device);
      let webTarget = null;
      if (device.webUrl) {
        try {
          const parsed = new URL(device.webUrl);
          webTarget = { host: parsed.hostname, port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80) };
        } catch { /* invalid stored URL — report web as unknown */ }
      }
      if (!address) return json(res, 200, { ssh: null, rdp: null, web: null });
      const [ssh, rdp, web] = await Promise.all([
        tcpOpen(address, sshPort),
        tcpOpen(address, rdpPort),
        webTarget ? tcpOpen(webTarget.host, webTarget.port) : Promise.resolve(null),
      ]);
      return json(res, 200, {
        ssh: { up: ssh, port: sshPort },
        rdp: { up: rdp, port: rdpPort },
        web: webTarget ? { up: web, url: device.webUrl } : null,
      });
    }

    if (req.method === 'POST' && segments[3] === 'shutdown') {
      const result = await shutdownOverSsh(device);
      if (!result.sent) return json(res, 502, { error: result.error });
      logActivity(device.name, 'Shutdown requested', 'neutral');
      return json(res, 202, result);
    }
  }

  if (req.method === 'GET' && segments[1] === 'jobs' && segments[2]) {
    const job = jobs.get(segments[2]);
    if (!job) return json(res, 404, { error: 'Job not found.' });
    return json(res, 200, job);
  }

  if (req.method === 'DELETE' && segments[1] === 'jobs' && segments[2]) {
    const job = jobs.get(segments[2]);
    if (job && !['ready', 'timeout', 'failed'].includes(job.state)) job.state = 'cancelled';
    return json(res, 204, null);
  }

  if (req.method === 'GET' && url.pathname === '/api/schedules') {
    return json(res, 200, schedules);
  }

  if (req.method === 'POST' && url.pathname === '/api/schedules') {
    if (schedules.length >= 50) return json(res, 400, { error: 'Too many schedules (max 50).' });
    const body = await readBody(req);
    if ('enabled' in body && typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be a boolean.' });
    const device = devices.find(item => item.id === body.deviceId);
    if (!device) return json(res, 400, { error: 'deviceId must reference an existing device.' });
    const validated = validateSchedule(body);
    if (validated.error) return json(res, 400, { error: validated.error });
    const schedule = {
      id: crypto.randomUUID(),
      deviceId: device.id,
      time: validated.time,
      days: validated.days,
      enabled: body.enabled !== false,
      lastFired: null,
    };
    schedules.push(schedule);
    persistSchedules();
    logActivity(device.name, `Schedule added (${schedule.time})`, 'neutral');
    return json(res, 201, schedule);
  }

  if (segments[1] === 'schedules' && segments[2]) {
    const schedule = schedules.find(item => item.id === segments[2]);
    if (!schedule) return json(res, 404, { error: 'Schedule not found.' });

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if ('enabled' in body && typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be a boolean.' });
      if ('time' in body || 'days' in body) {
        const validated = validateSchedule({ time: body.time ?? schedule.time, days: body.days ?? schedule.days });
        if (validated.error) return json(res, 400, { error: validated.error });
        schedule.time = validated.time;
        schedule.days = validated.days;
      }
      if ('enabled' in body) schedule.enabled = body.enabled;
      persistSchedules();
      return json(res, 200, schedule);
    }

    if (req.method === 'DELETE') {
      schedules = schedules.filter(item => item.id !== schedule.id);
      persistSchedules();
      return json(res, 204, null);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/activity') {
    return json(res, 200, activity.slice(0, 50));
  }

  if (req.method === 'GET' && url.pathname === '/api/scan') {
    const managed = new Set(devices.map(device => device.mac));
    const neighbours = await scanNeighbours();
    return json(res, 200, neighbours.map(entry => ({ ...entry, managed: managed.has(entry.mac) })));
  }

  return json(res, 404, { error: `No handler for ${req.method} ${url.pathname}` });
}

// ------------------------------------------------------- static assets

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, url) {
  const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let filePath = path.join(STATIC_DIR, requested);
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html'); // SPA fallback
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('PiWake API is running, but no UI build was found. Run `npm run build` first.');
  }
  const ext = path.extname(filePath).toLowerCase();
  const immutable = requested.startsWith('assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  stream.pipe(res);
}

// --------------------------------------------------------------- serve

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (!hostAllowed(req)) return json(res, 403, { error: 'Host not allowed. Add it to PIWAKE_ALLOWED_HOSTS.' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    res.writeHead(405);
    res.end();
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`PiWake API v${VERSION} listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Auth: ${TOKEN ? 'bearer token required' : 'open (protect via Tailscale ACL, or set PIWAKE_TOKEN)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
