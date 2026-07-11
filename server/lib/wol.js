import dgram from 'node:dgram';

export function parseMac(mac) {
  const parts = String(mac).trim().split(/[:\-]/);
  if (parts.length !== 6 || parts.some(part => !/^[0-9a-fA-F]{2}$/.test(part))) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return Buffer.from(parts.map(part => parseInt(part, 16)));
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
