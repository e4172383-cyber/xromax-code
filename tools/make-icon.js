// Эмблема XroMax Code: чёрный скруглённый квадрат, белый пиксельный «X» (как в логотипе xromax)
// и маленькая фиолетовая искра UltraCode в углу. Рисуется без зависимостей → build/icon.png (512×512).
//   node tools/make-icon.js [out.png] [size]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const out = process.argv[2] || path.join(__dirname, "..", "build", "icon.png");
const S = Number(process.argv[3]) || 512;
const px = Buffer.alloc(S * S * 4);

const put = (x, y, [r, g, b], a) => {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const A = a / 255;
  const da = px[i + 3] / 255;
  const oa = A + da * (1 - A);
  for (let k = 0; k < 3; k++) px[i + k] = Math.round(([r, g, b][k] * A + px[i + k] * da * (1 - A)) / (oa || 1));
  px[i + 3] = Math.round(oa * 255);
};

// скруглённый квадрат со сглаживанием (4×4 выборки на пиксель)
function roundRect(x0, y0, w, h, rad, color) {
  for (let y = Math.floor(y0); y < y0 + h; y++)
    for (let x = Math.floor(x0); x < x0 + w; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4;
          const fy = y + (sy + 0.5) / 4;
          const cx = Math.min(Math.max(fx, x0 + rad), x0 + w - rad);
          const cy = Math.min(Math.max(fy, y0 + rad), y0 + h - rad);
          if ((fx - cx) ** 2 + (fy - cy) ** 2 <= rad * rad) hit++;
        }
      put(x, y, color, (hit / 16) * 255);
    }
}

const k = S / 512;
// фон: чёрный с лёгким градиентом сверху вниз
roundRect(16 * k, 16 * k, 480 * k, 480 * k, 108 * k, [10, 10, 10]);
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!px[i + 3]) continue;
    const t = y / S;
    const v = Math.round(26 - t * 18);
    px[i] = px[i + 1] = px[i + 2] = Math.max(px[i], v);
  }

// пиксельный «X» 5×5, как буква x в логотипе
const X = ["1...1", ".1.1.", "..1..", ".1.1.", "1...1"];
const cell = 56 * k;
const gap = 4 * k;
const ox = (S - 5 * cell) / 2;
const oy = (S - 5 * cell) / 2 + 4 * k;
X.forEach((row, y) =>
  [...row].forEach((c, x) => {
    if (c !== "1") return;
    const shade = (x + y) % 3 === 0 ? [214, 214, 214] : [248, 248, 248];
    roundRect(ox + x * cell + gap / 2, oy + y * cell + gap / 2, cell - gap, cell - gap, 9 * k, shade);
  })
);

// фиолетовая искра UltraCode в правом верхнем углу
const sx = 428 * k;
const sy = 88 * k;
const R = 30 * k;
for (let y = Math.floor(sy - R); y <= sy + R; y++)
  for (let x = Math.floor(sx - R); x <= sx + R; x++) {
    const dx = Math.abs(x + 0.5 - sx) / R;
    const dy = Math.abs(y + 0.5 - sy) / R;
    // четырёхконечная звезда: |x|^0.5 + |y|^0.5 <= 1
    const d = Math.sqrt(dx) + Math.sqrt(dy);
    if (d <= 1) put(x, y, [167, 139, 250], Math.min(255, (1 - d) * 255 * 6));
    const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 1.1);
    if (glow > 0) put(x, y, [139, 92, 246], glow * 70);
  }

// PNG
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
console.log("icon", out, S + "px");
