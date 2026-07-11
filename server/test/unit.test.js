import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMac } from '../lib/wol.js';
import { parseIpNeigh, parseArp } from '../lib/scan.js';

test('parseMac accepts valid colon and dash separated MACs', () => {
  assert.deepEqual([...parseMac('AA:BB:CC:DD:EE:FF')], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  assert.deepEqual([...parseMac('aa-bb-cc-dd-ee-ff')], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  assert.deepEqual([...parseMac('00:00:00:00:00:01')], [0, 0, 0, 0, 0, 1]);
});

test('parseMac rejects malformed MACs', () => {
  for (const bad of [
    '1g:2h:3i:4j:5k:6l', // parseInt would half-parse these
    '0x1f:00:00:00:00:00',
    'AA:BB:CC:DD:EE',
    'AA:BB:CC:DD:EE:FF:00',
    'AABBCCDDEEFF',
    '',
    'A:B:C:D:E:F',
  ]) {
    assert.throws(() => parseMac(bad), new RegExp('Invalid MAC'), `should reject ${JSON.stringify(bad)}`);
  }
});

test('parseIpNeigh extracts reachable neighbours and skips FAILED entries', () => {
  const output = [
    '192.168.1.66 dev eth0 lladdr 3c:52:82:9a:11:22 REACHABLE',
    '192.168.1.90 dev eth0 lladdr 1c:69:7a:10:b8:44 STALE',
    '192.168.1.99 dev eth0  FAILED',
    'fe80::1 dev eth0 lladdr 3c:52:82:9a:11:23 REACHABLE',
  ].join('\n');
  const entries = parseIpNeigh(output);
  assert.deepEqual(entries, [
    { ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' },
    { ip: '192.168.1.90', mac: '1C:69:7A:10:B8:44' },
    { ip: 'fe80::1', mac: '3C:52:82:9A:11:23' },
  ]);
});

test('parseArp handles unix output', () => {
  const output = '? (192.168.1.66) at 3c:52:82:9a:11:22 [ether] on en0\n? (192.168.1.1) at 0:25:36:17:dd:6e on en0 ifscope [ethernet]';
  const entries = parseArp(output);
  assert.deepEqual(entries[0], { ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' });
});

test('parseArp handles Windows output regardless of locale type column', () => {
  const output = [
    'Interface: 192.168.1.5 --- 0xb',
    '  192.168.1.1           00-25-36-17-dd-6e     dynamic',
    '  192.168.1.66          3c-52-82-9a-11-22     動的',
    '  224.0.0.22            01-00-5e-00-00-16     static',
  ].join('\r\n');
  const entries = parseArp(output);
  assert.deepEqual(entries, [
    { ip: '192.168.1.1', mac: '00:25:36:17:DD:6E' },
    { ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' },
    { ip: '224.0.0.22', mac: '01:00:5E:00:00:16' },
  ]);
});
