// Her cut-out in the show's colours (run after build-sprite.py): in the show her arms and both legs
// are red like the rest of her, black only as linework, while the cut-out has her arm (which the
// shader mirrors for the other one) and her left leg filled in black. Those black fills go red,
// the crimson of the rest of her (the shader grades it to the show's hot red), keeping a pixel of
// black along every edge so her lines stay. Her mask, the black spikes around her head, her neck and
// her hips stay as they are. Same size, same cut-out: everything in sprite.js still lines up.
//
//   node tools/recolor-sprite.mjs      (needs ffmpeg on the PATH, or FFMPEG=...)
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
fs.writeFileSync(raw, px);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', raw, FILE]);
fs.rmSync(raw, { force: true });
console.log(`recoloured ${changed} pixels to rgb(${RED.join(', ')})`);
