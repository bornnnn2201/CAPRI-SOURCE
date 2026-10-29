// Her cut-out in the show's colours (run after build-sprite.py): in the show her arms and both legs
// are red like the rest of her, black only as linework, while the cut-out has her arm (which the
// shader mirrors for the other one) and her left leg filled in black. Those black fills go red,
// the crimson of the rest of her (the shader grades it to the show's hot red), keeping a pixel of
// black along every edge so her lines stay. The green shard by her shin goes red too, and her mask is
// drawn again at the show's size, with her white zigzag of a mouth. The black spikes around her head,
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

// Her mask, the show's size: a tilted green face (her own green), black almond eyes with her green
// ring, blue iris and white pupil in each, black under it with her white zigzag of a mouth. Drawn
// over the small one, around FACE (sprite.js), anti-aliased (4x4 samples a pixel).
const sample = (test) => {
  const got = [];
  for (let y = 112; y < 148; y++) for (let x = 100; x < 145; x++) if (test(at(x, y))) got.push(at(x, y));
  if (!got.length) return null;
  const m = (k) => got.map((i) => px[i + k]).sort((p, q) => p - q)[got.length >> 1];
  return [m(0), m(1), m(2)];
};
const GREEN = sample(green) || [24, 200, 90];
const BLUE = [24, 96, 250]; // the show's (the small old eyes had gone teal)
const INK = [12, 8, 18], WHITE = [250, 246, 248];
const C = { x: 121, y: 131 }, TILT = -0.38;
const toLocal = (x, y) => {
  const dx = x - C.x, dy = y - C.y, c = Math.cos(-TILT), s = Math.sin(-TILT);
  return [dx * c - dy * s, dx * s + dy * c];
};
const inPoly = (pts, u, v) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, vi] = pts[i], [uj, vj] = pts[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
};
const nearLine = (pts, u, v, w) => pts.slice(1).some(([u1, v1], k) => {
  const [u0, v0] = pts[k];
  const du = u1 - u0, dv = v1 - v0;
  const t = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv)));
  return Math.hypot(u - (u0 + du * t), v - (v0 + dv * t)) <= w;
});
const FACE_POLY = [[-23, 4], [-12, -8], [23, -14], [20, 0], [12, 8], [-14, 9]];
const CHIN = [[-15, 8], [13, 7], [9, 17], [-1, 20], [-11, 17]];
const MOUTH = [[-9, 12.5], [-5, 15], [-2, 12], [2, 15], [5, 12], [9, 14]];
const EYES = [[-8, 0.5], [8, -2.5]];
// what's at a point of it, painted last-on-top, or null outside it
const paint = (u, v) => {
  let col = null;
  if (inPoly(CHIN, u, v)) col = INK;
  if (inPoly(FACE_POLY, u, v)) col = GREEN;
  if (col && nearLine(MOUTH, u, v, 0.55)) col = WHITE;
  for (const [eu, ev] of EYES) {
    const r = Math.hypot((u - eu) / 5.6, (v - ev) / 4.2);
    if (r <= 1) {
      const d = Math.hypot(u - eu, v - ev);
      col = d <= 1.2 ? WHITE : d <= 2.9 ? BLUE : d <= 3.6 ? GREEN : INK;
    }
  }
  // her ink line around the green
  if (col === GREEN && !inPoly(FACE_POLY.map(([a, b]) => [a * 0.93, b * 0.88]), u, v)) col = INK;
  return col;
};
let mask = 0;
for (let y = C.y - 26; y <= C.y + 26; y++) {
  for (let x = C.x - 28; x <= C.x + 28; x++) {
    const acc = [0, 0, 0];
    let hits = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const [u, v] = toLocal(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
        const col = paint(u, v);
        if (!col) continue;
        hits++;
        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
      }
    }
    if (!hits) continue;
    const i = at(x, y);
    const k = hits / 16;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - k) + (acc[c] / hits) * k);
    px[i + 3] = Math.max(px[i + 3], Math.round(255 * k));
    mask++;
  }
}

fs.writeFileSync(raw, px);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', raw, FILE]);
fs.rmSync(raw, { force: true });
console.log(`recoloured ${changed} pixels to rgb(${RED.join(', ')}), ${shard} of the shin shard, mask over ${mask} pixels`);
