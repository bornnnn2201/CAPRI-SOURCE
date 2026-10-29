// Her cut-out in the show's colours (run after build-sprite.py): in the show her arms and both legs
// are red like the rest of her, black only as linework, while the cut-out has her arm (which the
// shader mirrors for the other one) and her left leg filled in black. Those black fills go red,
// the crimson of the rest of her (the shader grades it to the show's hot red), keeping a pixel of
// black along every edge so her lines stay. The green shard by her shin goes red too, and her face is
// her face from the show (capri-mask.png, tools/cut-face.mjs), at the show's size. The black spikes around her head,
// her neck and her hips stay as they are. Same size, same cut-out: everything in sprite.js lines up.
//
//   node tools/recolor-sprite.mjs      (needs ffmpeg on the PATH, or FFMPEG=...; on build-sprite.py's
//                                       output: run it once)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FF = process.env.FFMPEG || 'ffmpeg';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const FILE = path.join(ROOT, 'assets', 'capri', 'capri-full.png');
const W = 240, H = 420;
const raw = path.join(os.tmpdir(), `capri-sprite-${process.pid}.raw`);

execFileSync(FF, ['-y', '-loglevel', 'error', '-i', FILE, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
const px = fs.readFileSync(raw);
const at = (x, y) => (y * W + x) * 4;
const black = (i) => px[i + 3] >= 128 && Math.max(px[i], px[i + 1], px[i + 2]) < 64;

// the crimson of the rest of her: the median of her red pixels
const reds = [];
for (let i = 0; i < px.length; i += 4) {
  const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
  if (a >= 200 && r > 110 && r > g * 2.2 && r > b * 1.4) reds.push([r, g, b]);
}
const mid = (k) => reds.map((c) => c[k]).sort((p, q) => p - q)[reds.length >> 1];
const RED = [mid(0), mid(1), mid(2)];

// how far each black pixel is from anything not black (4-neighbour steps)
const dist = new Int16Array(W * H).fill(-1);
const queue = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!black(at(x, y))) { dist[y * W + x] = 0; queue.push(y * W + x); }
  }
}
for (let q = 0; q < queue.length; q++) {
  const p = queue[q], x = p % W, y = (p / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx;
    if (dist[n] < 0) { dist[n] = dist[p] + 1; queue.push(n); }
  }
}

// her reaching arm (as armL() in the shader) and her left leg, below the hips
const arm = (x, y) => x <= 101 && y <= 234 && y >= 159 + (98 - x) * 0.5 && y <= (x < 50 ? 234 : 178 + (98 - x) * 0.62);
const leftLeg = (x, y) => y >= 262 && x < 117 + Math.max(0, y - 300) * 0.15;
let changed = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (!black(i) || dist[y * W + x] < 2 || !(arm(x, y) || leftLeg(x, y))) continue;
    px[i] = RED[0]; px[i + 1] = RED[1]; px[i + 2] = RED[2];
    changed++;
  }
}
// the long green shard down by her left shin: red, like the one on her other side (the show's green
// is a patch on her thigh, kept, and on her chest)
const green = (i) => px[i + 3] >= 128 && px[i + 1] > px[i] * 1.4 && px[i + 1] > px[i + 2] * 1.2 && px[i + 1] > 80;
let shard = 0;
for (let y = 268; y < H; y++) {
  for (let x = 0; x < 118; x++) {
    const i = at(x, y);
    if (!green(i)) continue;
    px[i] = RED[0]; px[i + 1] = RED[1]; px[i + 2] = RED[2]; // (its edges get her violet line from the shader)
    shard++;
  }
}

// Her face from the show (assets/capri/capri-mask.png, cut by tools/cut-face.mjs): her mask, its eyes,
// her jaw and her zigzag of a mouth, turned from the frame's angle to her sprite's head, scaled to it
// and set in at FACE (sprite.js), its mask's middle where the small one's was. Bilinear, 3x3 samples a
// pixel, its own cut-out edge for an edge.
const FACE_PNG = path.join(ROOT, 'assets', 'capri', 'capri-mask.png');
const fraw = path.join(os.tmpdir(), `capri-mask-${process.pid}.raw`);
// its size, from its PNG header
const head = fs.readFileSync(FACE_PNG);
const FW = head.readUInt32BE(16), FH = head.readUInt32BE(20);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', FACE_PNG, '-f', 'rawvideo', '-pix_fmt', 'rgba', fraw]);
const face = fs.readFileSync(fraw);
fs.rmSync(fraw, { force: true });
const fat = (x, y) => (y * FW + x) * 4;
// its mask: where the green is, and which way it runs (the long axis of the green)
let n = 0, mx = 0, my = 0;
const greens = [];
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
  const i = fat(x, y);
  if (face[i + 3] > 128 && face[i + 1] > face[i] * 1.4 && face[i + 1] > face[i + 2] * 1.2 && face[i + 1] > 90) { greens.push([x, y]); mx += x; my += y; n++; }
}
mx /= n; my /= n;
let sxx = 0, syy = 0, sxy = 0;
for (const [x, y] of greens) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy); // the green's long axis, in the frame
const along = greens.map(([x, y]) => (x - mx) * Math.cos(axis) + (y - my) * Math.sin(axis));
const length = Math.max(...along) - Math.min(...along);
// on her sprite: its middle at the small mask's, her head's tilt, about 40 sprite pixels long
const TO = { x: 121, y: 131 }, TILT = -0.38, LONG = 46;
const k = LONG / length, turn = TILT - axis;
const fromSprite = (x, y) => {
  const dx = (x - TO.x) / k, dy = (y - TO.y) / k, c = Math.cos(-turn), s = Math.sin(-turn);
  return [mx + dx * c - dy * s, my + dx * s + dy * c];
};
const bilinear = (fx, fy) => {
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const out = [0, 0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
    const i = fat(x, y), a = face[i + 3] / 255;
    out[0] += face[i] * a * w; out[1] += face[i + 1] * a * w; out[2] += face[i + 2] * a * w; out[3] += a * w;
  }
  return out;
};
let mask = 0;
const reach = Math.ceil(Math.hypot(FW, FH) * k * 0.6);
for (let y = TO.y - reach; y <= TO.y + reach; y++) {
  for (let x = TO.x - reach; x <= TO.x + reach; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const [fx, fy] = fromSprite(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
      const c = bilinear(fx, fy);
      for (let q = 0; q < 4; q++) acc[q] += c[q] / 9;
    }
    if (acc[3] < 0.02) continue;
    const i = at(x, y), a = Math.min(1, acc[3]);
    for (let q = 0; q < 3; q++) px[i + q] = Math.round(px[i + q] * (1 - a) + (acc[q] / acc[3]) * a);
    px[i + 3] = Math.max(px[i + 3], Math.round(255 * a));
    mask++;
  }
}

fs.writeFileSync(raw, px);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', raw, FILE]);
fs.rmSync(raw, { force: true });
console.log(`recoloured ${changed} pixels to rgb(${RED.join(', ')}), ${shard} of the shin shard, mask over ${mask} pixels`);
