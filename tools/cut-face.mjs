// Her face from the show, for her sprite: a still of Edgerunners 2 with her facing you (600x800, her
// eyes wide open, her zigzag of a mouth: the close-up as she meets D) cut down to her mask, its eyes,
// her black jaw and mouth, the red of her mane around it left out (and the strand of it across her
// mask, between her eyes, filled in with the mask's green). Writes assets/capri/capri-mask.png at the
// frame's own pixels; tools/recolor-sprite.mjs turns it to her sprite's head and sets it in.
//
//   node tools/cut-face.mjs still.png      (a PNG of that still; needs ffmpeg, or FFMPEG=...)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FF = process.env.FFMPEG || 'ffmpeg';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'assets', 'capri', 'capri-mask.png');
const frame = process.argv[2];
if (!frame) throw new Error('which frame? node tools/cut-face.mjs frame.png');

// around her face in that frame: the mask, the jaw under it, the violet line of her chin
const BOX = { x: 105, y: 180, w: 262, h: 192 };
const AROUND = [[113.3, 266.7], [346.7, 188.3], [358.3, 303.3], [313.3, 333.3], [310, 363.3], [206.7, 366.7], [146.7, 351.7]];
const MASK = [[116.7, 266.7], [348.3, 191.7], [355, 301.7], [148.3, 346.7]]; // the green of it
const GREEN = [40, 235, 110];

const raw = path.join(os.tmpdir(), `capri-face-${process.pid}.raw`);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', frame, '-vf', `crop=${BOX.w}:${BOX.h}:${BOX.x}:${BOX.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
const px = fs.readFileSync(raw);
const within = (pts, x, y) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
let kept = 0;
for (let y = 0; y < BOX.h; y++) {
  for (let x = 0; x < BOX.w; x++) {
    const i = (y * BOX.w + x) * 4;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    // her mane's red and its pink glitter: not her face (her mouth's white is grey-white, not pink)
    const mane = r > 120 && r > g + 55 && !(Math.abs(r - g) < 45 && Math.abs(r - b) < 45);
    const fx = BOX.x + x + 0.5, fy = BOX.y + y + 0.5;
    const onMask = mane && within(MASK, fx, fy);
    if (onMask) { px[i] = GREEN[0]; px[i + 1] = GREEN[1]; px[i + 2] = GREEN[2]; }
    const keep = within(AROUND, fx, fy) && (!mane || onMask);
    px[i + 3] = keep ? 255 : 0;
    if (keep) kept++;
  }
}
fs.writeFileSync(raw, px);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${BOX.w}x${BOX.h}`, '-i', raw, OUT]);
fs.rmSync(raw, { force: true });
console.log(`her face: ${kept} pixels, ${BOX.w}x${BOX.h} at (${BOX.x}, ${BOX.y}) of the frame`);
