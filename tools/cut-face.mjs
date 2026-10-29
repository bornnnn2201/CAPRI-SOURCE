// Her face from the show, for her sprite: a frame of Edgerunners 2 (D meeting her, ~24.75 s into
// Netflix's clip, her eyes open, 1280x720) cut down to her mask, its eyes, her black jaw and her white
// zigzag of a mouth, the red of her mane around it left out. Writes assets/capri/capri-mask.png at the
// frame's own pixels; tools/recolor-sprite.mjs turns it to her sprite's head and sets it in.
//
//   node tools/cut-face.mjs frame.png      (a PNG of that frame; needs ffmpeg, or FFMPEG=...)
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
const BOX = { x: 930, y: 44, w: 76, h: 100 };
const AROUND = [[937, 104.4], [979, 50], [985, 48.4], [999.6, 83.6], [993, 114], [985, 139.6], [943.6, 139.6], [939.6, 124]];

const raw = path.join(os.tmpdir(), `capri-face-${process.pid}.raw`);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', frame, '-vf', `crop=${BOX.w}:${BOX.h}:${BOX.x}:${BOX.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
const px = fs.readFileSync(raw);
const inside = (x, y) => {
  let hit = false;
  for (let i = 0, j = AROUND.length - 1; i < AROUND.length; j = i++) {
    const [xi, yi] = AROUND[i], [xj, yj] = AROUND[j];
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
    const keep = inside(BOX.x + x + 0.5, BOX.y + y + 0.5) && !mane;
    px[i + 3] = keep ? 255 : 0;
    if (keep) kept++;
  }
}
fs.writeFileSync(raw, px);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${BOX.w}x${BOX.h}`, '-i', raw, OUT]);
fs.rmSync(raw, { force: true });
console.log(`her face: ${kept} pixels, ${BOX.w}x${BOX.h} at (${BOX.x}, ${BOX.y}) of the frame`);
