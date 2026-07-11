import net from 'node:net';
import { execFile } from 'node:child_process';

const PING_ARGS = process.platform === 'win32'
  ? host => ['-n', '1', '-w', '1500', host]
  : host => ['-c', '1', '-W', '2', host];

export function ping(host) {
  if (!host) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile('ping', PING_ARGS(host), { timeout: 4000 }, error => resolve(!error));
  });
}

export function tcpOpen(host, port, timeoutMs = 2000) {
  if (!host) return Promise.resolve(false);
  return new Promise(resolve => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const done = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// A device counts as remotely usable once any remote-access port answers.
export async function remoteReady(host, ports = [22, 3389]) {
  const results = await Promise.all(ports.map(port => tcpOpen(host, port)));
  return results.some(Boolean);
}
