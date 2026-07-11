import dgram from 'node:dgram';

export function parseMac(mac) {
  const bytes = String(mac).trim().split(/[:\-]/).map(part => parseInt(part, 16));
  if (bytes.length !== 6 || bytes.some(byte => Number.isNaN(byte) || byte < 0 || byte > 255)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return Buffer.from(bytes);
}

export function sendMagicPacket(mac, { address = '255.255.255.255', port = 9 } = {}) {
  const macBytes = parseMac(mac);
  const payload = Buffer.alloc(102, 0xff);
  for (let offset = 6; offset < payload.length; offset += 6) macBytes.copy(payload, offset);

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', error => { socket.close(); reject(error); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(payload, port, address, error => {
        socket.close();
        if (error) reject(error); else resolve();
      });
    });
  });
}
