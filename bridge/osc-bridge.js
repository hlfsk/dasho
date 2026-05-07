#!/usr/bin/env node
// osc-bridge.js — простой UDP-OSC → WebSocket мост.
// Запускается без npm install (только встроенные модули Node.js).
//
// Слушает OSC по UDP на порту 9000.
// Раздаёт принятые сообщения как WebSocket на порту 8080.
// Любое iOS-приложение (ZIG SIM, GyrOSC, SeeOSC, Mrmr и т.п.) может слать
// OSC на (IP_МАКА:9000) → наш браузер ловит на ws://localhost:8080.
//
// Запуск: ./start-bridge.command (или: node osc-bridge.js)

const dgram = require('dgram');
const http = require('http');
const crypto = require('crypto');
const os = require('os');

// ──────────────────────────────────────────────────────────────────────
// Конфигурация
const OSC_PORT = parseInt(process.env.OSC_PORT || '9000', 10);
const WS_PORT  = parseInt(process.env.WS_PORT  || '8080', 10);

// ──────────────────────────────────────────────────────────────────────
// 1. OSC parser (минимальный, поддерживает s/f/i/d/T/F/N/I)
function parseOSC(buf) {
  let off = 0;
  const readStr = () => {
    const start = off;
    while (off < buf.length && buf[off] !== 0) off++;
    const s = buf.slice(start, off).toString('ascii');
    off = (Math.floor(off / 4) + 1) * 4; // pad to 4
    return s;
  };
  const readInt32 = () => { const v = buf.readInt32BE(off); off += 4; return v; };
  const readFloat32 = () => { const v = buf.readFloatBE(off); off += 4; return v; };
  const readFloat64 = () => { const v = buf.readDoubleBE(off); off += 8; return v; };

  const address = readStr();
  if (!address.startsWith('/')) return null; // bundle? skip

  const tag = readStr();
  if (!tag.startsWith(',')) return { address, args: [] };

  const args = [];
  for (let i = 1; i < tag.length; i++) {
    switch (tag[i]) {
      case 'i': args.push(readInt32()); break;
      case 'f': args.push(readFloat32()); break;
      case 'd': args.push(readFloat64()); break;
      case 's': args.push(readStr()); break;
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      default:
        // unknown — пропускаем
        break;
    }
  }
  return { address, args };
}

// ──────────────────────────────────────────────────────────────────────
// 2. Минимальный WebSocket server (server→client only, текстовые сообщения)
const clients = new Set();

function makeFrame(payload) {
  const data = Buffer.from(payload);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]); // FIN + text frame, no mask
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function broadcast(text) {
  const frame = makeFrame(text);
  for (const c of clients) {
    try { c.write(frame); } catch {}
  }
}

const wsServer = http.createServer();
wsServer.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  clients.add(socket);
  console.log(`✓ браузер подключился (всего: ${clients.size})`);
  socket.on('end', () => { clients.delete(socket); console.log(`× браузер отключился (всего: ${clients.size})`); });
  socket.on('error', () => { clients.delete(socket); });
  // Игнорируем входящие фреймы от клиента — только отправляем сами
  socket.on('data', () => {});
});
wsServer.listen(WS_PORT, () => {
  console.log(`WebSocket для браузера: ws://localhost:${WS_PORT}`);
});

// ──────────────────────────────────────────────────────────────────────
// 3. UDP OSC listener
const sock = dgram.createSocket('udp4');
sock.on('message', (msg, rinfo) => {
  const parsed = parseOSC(msg);
  if (!parsed) return;
  broadcast(JSON.stringify(parsed));
  // Минимальный лог
  const arg = parsed.args[0];
  console.log(`OSC ← ${rinfo.address}: ${parsed.address} ${typeof arg === 'number' ? arg.toFixed(2) : arg}`);
});
sock.on('error', (err) => {
  console.error('UDP error:', err);
});
sock.bind(OSC_PORT, () => {
  console.log(`OSC UDP: порт ${OSC_PORT} (открыт)`);
});

// ──────────────────────────────────────────────────────────────────────
// 4. Информация по запуску — IP-адреса для мобильных приложений
function localIPs() {
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) list.push(i.address);
    }
  }
  return list;
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  lupsmachine-v2 OSC bridge');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log('  В мобильных приложениях (ZIG SIM, GyrOSC, SeeOSC, Mrmr и т.п.)');
console.log('  укажи как target host:');
for (const ip of localIPs()) {
  console.log(`    ${ip} : ${OSC_PORT}`);
}
console.log('');
console.log(`  В нодах OSC-вход / NDI+OSC введи:`);
console.log(`    ws://localhost:${WS_PORT}`);
console.log('');
console.log('  Чтобы остановить — Ctrl+C в этом окне.');
console.log('═══════════════════════════════════════════════════════════════');
