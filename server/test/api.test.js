import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

function startServer(extraEnv = {}) {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwake-test-'));
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PIWAKE_PORT: String(port), PIWAKE_DATA_DIR: dataDir, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited early (${code})`)); });
  });
  const stop = () => new Promise(resolve => {
    child.on('exit', () => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); });
    child.kill();
  });
  return { port, ready, stop, base: `http://127.0.0.1:${port}` };
}

function jsonHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

// ---------------------------------------------------------- open server

const open = startServer();

before(async () => { await open.ready; });
after(async () => { await open.stop(); });

test('health responds without auth and reports authRequired=false', async () => {
  const res = await fetch(`${open.base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.authRequired, false);
});

test('rejects requests with a foreign Host header (DNS rebinding)', async () => {
  // fetch() forbids overriding Host, so issue a raw HTTP request.
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: open.port, path: '/api/health',
      headers: { Host: 'evil.example.com' },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('rejects mutating requests without application/json (CSRF)', async () => {
  const res = await fetch(`${open.base}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"name":"x","mac":"AA:BB:CC:DD:EE:01"}',
  });
  assert.equal(res.status, 415);
});

test('device CRUD with validation', async () => {
  const badMac = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name: 'Bad', mac: '1g:2h:3i:4j:5k:6l' }),
  });
  assert.equal(badMac.status, 400);

  const created = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ name: 'Test PC', mac: 'AA:BB:CC:DD:EE:02', localIp: '203.0.113.10' }),
  });
  assert.equal(created.status, 201);
  const device = await created.json();
  assert.equal(device.pinned, false);

  const duplicate = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name: 'Dup', mac: 'AA:BB:CC:DD:EE:02' }),
  });
  assert.equal(duplicate.status, 409);

  const patched = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ pinned: true, location: 'Desk' }),
  });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.pinned, true);
  assert.equal(updated.location, 'Desk');

  const emptyName = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ name: '' }),
  });
  assert.equal(emptyName.status, 400);

  const unsafeUser = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ user: '-oProxyCommand=touch /tmp/pwned' }),
  });
  assert.equal(unsafeUser.status, 400);

  const stringBoolean = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ pinned: 'false' }),
  });
  assert.equal(stringBoolean.status, 400);

  const removed = await fetch(`${open.base}/api/devices/${device.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);
});

test('pinned devices sort first in the list', async () => {
  const make = (name, mac) => fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, mac, localIp: '203.0.113.11' }),
  }).then(r => r.json());
  const first = await make('First', 'AA:BB:CC:DD:EE:11');
  const second = await make('Second', 'AA:BB:CC:DD:EE:12');
  await fetch(`${open.base}/api/devices/${second.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ pinned: true }),
  });
  const list = await fetch(`${open.base}/api/devices`).then(r => r.json());
  const names = list.map(d => d.name);
  assert.ok(names.indexOf('Second') < names.indexOf('First'), `expected Second before First in ${names}`);
  await fetch(`${open.base}/api/devices/${first.id}`, { method: 'DELETE' });
  await fetch(`${open.base}/api/devices/${second.id}`, { method: 'DELETE' });
});

test('schedule CRUD with validation, removed with its device', async () => {
  const device = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ name: 'Sched PC', mac: 'AA:BB:CC:DD:EE:21', localIp: '203.0.113.12' }),
  }).then(r => r.json());

  const badTime = await fetch(`${open.base}/api/schedules`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ deviceId: device.id, time: '25:00', days: [1] }),
  });
  assert.equal(badTime.status, 400);

  const badDevice = await fetch(`${open.base}/api/schedules`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ deviceId: 'nope', time: '07:30', days: [1] }),
  });
  assert.equal(badDevice.status, 400);

  const coercedDays = await fetch(`${open.base}/api/schedules`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ deviceId: device.id, time: '07:30', days: ['1'], enabled: 'false' }),
  });
  assert.equal(coercedDays.status, 400);

  const created = await fetch(`${open.base}/api/schedules`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ deviceId: device.id, time: '07:30', days: [5, 1, 1] }),
  });
  assert.equal(created.status, 201);
  const schedule = await created.json();
  assert.equal(schedule.time, '07:30');
  assert.deepEqual(schedule.days, [1, 5]); // deduped and sorted
  assert.equal(schedule.enabled, true);

  const toggled = await fetch(`${open.base}/api/schedules/${schedule.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ enabled: false }),
  }).then(r => r.json());
  assert.equal(toggled.enabled, false);

  // Deleting the device removes its schedules.
  await fetch(`${open.base}/api/devices/${device.id}`, { method: 'DELETE' });
  const remaining = await fetch(`${open.base}/api/schedules`).then(r => r.json());
  assert.equal(remaining.some(item => item.id === schedule.id), false);
});

test('os, port and webUrl fields validate and round-trip', async () => {
  const badOs = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ name: 'Bad OS', mac: 'AA:BB:CC:DD:EE:31', os: 'templeos' }),
  });
  assert.equal(badOs.status, 400);

  const created = await fetch(`${open.base}/api/devices`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ name: 'OS PC', mac: 'AA:BB:CC:DD:EE:32', localIp: '127.0.0.1', os: 'windows', sshPort: 2222, webUrl: 'http://127.0.0.1:5000' }),
  });
  assert.equal(created.status, 201);
  const device = await created.json();
  assert.equal(device.os, 'windows');
  assert.equal(device.sshPort, 2222);
  assert.equal(device.webUrl, 'http://127.0.0.1:5000');

  const badPort = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ sshPort: 99999 }),
  });
  assert.equal(badPort.status, 400);

  const badUrl = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ webUrl: 'ftp://nope' }),
  });
  assert.equal(badUrl.status, 400);

  const patched = await fetch(`${open.base}/api/devices/${device.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ os: 'linux', rdpPort: 3390 }),
  }).then(r => r.json());
  assert.equal(patched.os, 'linux');
  assert.equal(patched.rdpPort, 3390);

  const services = await fetch(`${open.base}/api/devices/${device.id}/services`).then(r => r.json());
  assert.equal(services.ssh.port, 2222);
  assert.equal(services.rdp.port, 3390);
  assert.equal(typeof services.ssh.up, 'boolean');
  assert.equal(services.web.url, 'http://127.0.0.1:5000');

  const pinged = await fetch(`${open.base}/api/devices/${device.id}/ping`).then(r => r.json());
  assert.equal(typeof pinged.alive, 'boolean');
  assert.equal(pinged.alive, true); // localIp is 127.0.0.1
  assert.ok(['tailscale', 'lan'].includes(pinged.via));

  await fetch(`${open.base}/api/devices/${device.id}`, { method: 'DELETE' });
});

test('SPA fallback serves HTML for app routes', async () => {
  const res = await fetch(`${open.base}/devices`);
  // 200 with the built UI, or 404 with a plain-text hint when dist/ is absent.
  assert.ok([200, 404].includes(res.status));
});

// --------------------------------------------------------- token server

test('bearer token auth', async t => {
  const secured = startServer({ PIWAKE_TOKEN: 'test-secret' });
  t.after(async () => { await secured.stop(); });
  await secured.ready;

  const health = await fetch(`${secured.base}/api/health`).then(r => r.json());
  assert.equal(health.authRequired, true);

  const noToken = await fetch(`${secured.base}/api/devices`);
  assert.equal(noToken.status, 401);

  const wrongToken = await fetch(`${secured.base}/api/devices`, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(wrongToken.status, 401);

  const withToken = await fetch(`${secured.base}/api/devices`, { headers: { Authorization: 'Bearer test-secret' } });
  assert.equal(withToken.status, 200);
});
