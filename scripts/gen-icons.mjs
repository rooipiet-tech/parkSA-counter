/**
 * Generates public/icons/icon-192.png and icon-512.png.
 * Pure Node (zlib) PNG writer — no canvas or image tooling required.
 * The generated icons are checked in; re-run only if you want a new look.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  // RGBA pixel grid
  const px = Buffer.alloc(size * size * 4);
  const bg = [0x10, 0x14, 0x18, 0xff];
  const green = [0x38, 0xb2, 0x6a, 0xff];
  const white = [0xf2, 0xf6, 0xfa, 0xff];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  // "P" glyph geometry (relative to size)
  const barX0 = size * 0.38;
  const barX1 = size * 0.46;
  const barY0 = size * 0.28;
  const barY1 = size * 0.72;
  const bowlX1 = size * 0.64;
  const bowlTop0 = size * 0.28;
  const bowlTop1 = size * 0.36;
  const bowlMid0 = size * 0.44;
  const bowlMid1 = size * 0.52;
  const bowlRight0 = size * 0.56;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = bg;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) c = green;
      const inBar = x >= barX0 && x < barX1 && y >= barY0 && y < barY1;
      const inTop = x >= barX0 && x < bowlX1 && y >= bowlTop0 && y < bowlTop1;
      const inMid = x >= barX0 && x < bowlX1 && y >= bowlMid0 && y < bowlMid1;
      const inRight = x >= bowlRight0 && x < bowlX1 && y >= bowlTop0 && y < bowlMid1;
      if (inBar || inTop || inMid || inRight) c = white;
      px.set(c, (y * size + x) * 4);
    }
  }

  // Add filter byte (0 = None) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`wrote ${file}`);
}
