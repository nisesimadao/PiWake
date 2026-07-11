import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMagicPacket, parseMac } from './lib/wol.js';
import { ping, remoteReady } from './lib/probe.js';
import { hostSnapshot } from './lib/metrics.js';
import { scanNeighbours } from './lib/scan.js';
import { readJson, writeJson, dataDir } from './lib/store.js';

const PORT = Number(process.env.PIWAKE_PORT) || 8787;
const TOKEN = process.env.PIWAKE_TOKEN || '';
const WAKE_TIMEOUT_MS = (Number(process.env.PIWAKE_WAKE_TIMEOUT) || 90) * 1000;
const BROADCAST = process.env.PIWAKE_BROADCAST || '255.255.255.255';
const STATUS_INTERVAL_MS = (Number(process.env.PIWAKE_STATUS_INTERVAL) || 30) * 1000;
const STATIC_DIR = process.env.PIWAKE_STATIC_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const VERSION = '1.0.0';

// ---------------------------------------------------------------- state

let devices = readJson('devices', { version: 1, devices: [] }).devices;
let activity = readJson('activity', []);
const jobs = new Map();

function persistDevices() {
  writeJson('devices', { version: 1, devices });
}

function logActivity(deviceName, action, result = 'neutral') {
  activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), deviceName, action, result });
  activity = activity.slice(0, 200);
  writeJson('activity', activity);
}

function publicDevice(device) {
  const { id, name, kind, mac, ip, localIp, location, user, status, lastSeenAt } = device;
  return { id, name, kind, mac, ip, localIp, location, user, status: status || 'offline', lastSeenAt: lastSeenAt || null };
}

// ------------------------------------------------------- status poller

let polling = false;
async function refreshStatuses() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all(devices.map(async device => {
      const alive = await ping(device.ip) || await ping(device.localIp);
      device.status = alive ? 'online' : 'offline';
      if (alive) device.lastSeenAt = new Date().toISOString();
    }));
    persistDevices();
  } finally {
    polling = false;
  }
}
setInterval(refreshStatuses, STATUS_INTERVAL_MS);
refreshStatuses();

// ------------------------------------------------------------ wake job

async function runWakeJob(job, device) {
  const update = state => { job.state = state; job.updatedAt = new Date().toISOString(); };
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  const reachHost = device.ip || device.localIp;
  try {
    while (Date.now() < deadline) {
      if (job.state === 'cancelled') return;
      if (job.state === 'packet_sent') {
        if (await ping(device.localIp) || await ping(device.ip)) update('responding');
      } else if (job.state === 'responding') {
        if (!device.ip || await ping(device.ip)) update('reachable');
      } else if (job.state === 'reachable') {
        if (await remoteReady(reachHost)) {
          update('ready');
          device.status = 'online';
          device.lastSeenAt = new Date().toISOString();
          persistDevices();
          logActivity(device.name, 'Wake succeeded', 'success');
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
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 64 * 1024) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(TOKEN));
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = `${req.method} /${segments.slice(0, 2).join('/')}`;

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, mode: 'api', version: VERSION, authRequired: Boolean(TOKEN) });
  }
  if (!authorized(req)) {
    return json(res, 401, { error: 'Unauthorized. Set the API token in Settings.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/host') {
    return json(res, 200, await hostSnapshot());
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    return json(res, 200, devices.map(publicDevice));
  }

  if (req.method === 'POST' && url.pathname === '/api/devices') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const mac = String(body.mac || '').trim().toUpperCase();
    if (!name || name.length > 48) return json(res, 400, { error: 'A device name (max 48 chars) is required.' });
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
      status: 'offline',
      lastSeenAt: null,
    };
    devices.push(device);
    persistDevices();
    logActivity(device.name, 'Device added', 'neutral');
    refreshStatuses();
    return json(res, 201, publicDevice(device));
  }

  if (segments[1] === 'devices' && segments[2]) {
    const device = devices.find(item => item.id === segments[2]);
    if (!device) return json(res, 404, { error: 'Device not found.' });

    if (req.method === 'DELETE' && segments.length === 3) {
      devices = devices.filter(item => item.id !== device.id);
      persistDevices();
      logActivity(device.name, 'Device removed', 'neutral');
      return json(res, 204, null);
    }

    if (req.method === 'PATCH' && segments.length === 3) {
      const body = await readBody(req);
      if ('name' in body && !String(body.name || '').trim()) {
        return json(res, 400, { error: 'A device name is required.' });
      }
      for (const key of ['name', 'ip', 'localIp', 'location', 'user']) {
        if (key in body) device[key] = String(body[key] || '').trim() || null;
      }
      persistDevices();
      return json(res, 200, publicDevice(device));
    }

    if (req.method === 'POST' && segments[3] === 'wake') {
      await sendMagicPacket(device.mac, { address: BROADCAST });
      const job = {
        id: crypto.randomUUID(),
        deviceId: device.id,
        state: 'packet_sent',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);
      logActivity(device.name, 'Magic packet sent', 'neutral');
      runWakeJob(job, device);
      return json(res, 202, { jobId: job.id, deviceId: device.id, state: job.state });
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

  if (req.method === 'GET' && url.pathname === '/api/activity') {
    return json(res, 200, activity.slice(0, 50));
  }

  if (req.method === 'GET' && url.pathname === '/api/scan') {
    const managed = new Set(devices.map(device => device.mac));
    const neighbours = await scanNeighbours();
    return json(res, 200, neighbours.map(entry => ({ ...entry, managed: managed.has(entry.mac) })));
  }

  return json(res, 404, { error: `No handler for ${route}` });
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
  fs.createReadStream(filePath).pipe(res);
}

// --------------------------------------------------------------- serve

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    res.writeHead(405);
    res.end();
  } catch (error) {
    json(res, error.message === 'Invalid JSON body' ? 400 : 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`PiWake API listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Auth: ${TOKEN ? 'bearer token required' : 'open (protect via Tailscale ACL, or set PIWAKE_TOKEN)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
