// Her big quickhacks over your screen (app.js), after the game and the show: the Blackwall, Reboot
// Optics, Cyberpsychosis, Sandevistan, Overheat, System Reset. Each is a 'custom' item on the effects
// layer (fx.js) that paints itself at 24 fps while it lasts, over a picture of your screen taken the
// moment before (main.js fx:screen: kept in memory, never written).

import { rand, pick, clamp } from './util.js';
import { COLORS } from './fx.js';

const HEX = '0123456789ABCDEF';

// The picture of your screen, as an image (null if there's none to be had).
export async function screenPicture(host) {
  const url = await host.fxScreen().catch(() => null);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  return img.naturalWidth ? img : null;
}

// One of her own frames from the show (assets/capri), loaded once.
const faces = new Map();
function face(name) {
  if (!faces.has(name)) {
    const img = new Image();
    img.src = `../../assets/capri/${name}.png`;
    faces.set(name, img);
  }
  const img = faces.get(name);
  return img.complete && img.naturalWidth ? img : null;
}
face('face-laugh'); // ready before Cyberpsychosis needs it

// The picture drawn over the screen it was taken of, `k` times as big around its middle, moved by dx, dy.
function cover(ctx, img, dx = 0, dy = 0, k = 1) {
  const sw = window.screen.width;
  const sh = window.screen.height;
  ctx.drawImage(img, dx - (sw * (k - 1)) / 2, dy - (sh * (k - 1)) / 2, sw * k, sh * k);
}

// A canvas the size of the screen, at `scale`, painted once by fn(ctx, w, h).
function offscreen(scale, fn) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(window.screen.width * scale));
  c.height = Math.max(1, Math.round(window.screen.height * scale));
  fn(c.getContext('2d'), c.width, c.height);
  return c;
}

// The picture in one colour (grey first, then that colour over it).
function tinted(img, color, scale = 0.5, filter = 'grayscale(1) contrast(1.5) brightness(1.15)') {
  return offscreen(scale, (c, w, h) => {
    c.filter = filter;
    c.drawImage(img, 0, 0, w, h);
    c.filter = 'none';
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
  });
}

// The picture's red, green and blue apart: added back together on black, slid apart, for a split.
function channelsOf(img) {
  return ['#ff0000', '#00ff00', '#0000ff'].map((color) => offscreen(0.5, (c, w, h) => {
    c.drawImage(img, 0, 0, w, h);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
  }));
}

function split(ctx, channels, w, h, dx, dy = 0) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  channels.forEach((channel, i) => cover(ctx, channel, (i - 1) * dx, (i - 1) * dy));
  ctx.globalCompositeOperation = 'source-over';
}

// Static: a little canvas of random grey, redrawn every drawing, stretched over the screen unsmoothed.
function staticNoise() {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 135;
  const g = c.getContext('2d');
  const data = g.createImageData(c.width, c.height);
  return () => {
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    return c;
  };
}

// Text with its colours split apart, cut into `strips` knocked sideways when `torn`.
function tornText(ctx, text, x, y, size, { colors = [COLORS.violet, COLORS.blue, COLORS.red], alpha = 1, torn = false, strips = 6, spread = 26, font = 'Chakra Petch' } = {}) {
  ctx.font = `700 ${size}px "${font}", sans-serif`;
  ctx.textAlign = 'center';
  for (let s = 0; s < strips; s++) {
    const top = y - size * 0.8 + (s * size) / strips;
    const shift = torn ? rand(-spread, spread) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, ctx.canvas.width, size / strips + 1);
    ctx.clip();
    colors.forEach((color, i) => {
      ctx.globalAlpha = alpha * (i === colors.length - 1 ? 1 : 0.6);
      ctx.fillStyle = color;
      ctx.fillText(text, x + shift + (i - colors.length + 1) * 4, y + (i - colors.length + 1) * -2);
    });
    ctx.restore();
  }
}

function mono(ctx, text, x, y, { size = 16, color = COLORS.paper, align = 'center', alpha = 1 } = {}) {
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${size}px "JetBrains Mono", monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// Lightning from a to b, with forks, in her colours.
function lightning(fx, a, b, width = 3, forks = 2) {
  const pts = fx.jag(a, b, Math.min(26, Math.max(8, Math.hypot(b.x - a.x, b.y - a.y) * 0.06)), true);
  fx.stroke(pts, COLORS.violet, width + 2, -2, 2);
  fx.stroke(pts, COLORS.red, width);
  fx.stroke(pts, COLORS.paper, Math.max(1, width * 0.35));
  for (let f = 0; f < forks; f++) {
    const [x, y] = pts[1 + Math.floor(rand(0, pts.length - 2))];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + rand(-1.2, 1.2);
    const l = rand(40, 140);
    const fork = fx.jag({ x, y }, { x: x + Math.cos(ang) * l, y: y + Math.sin(ang) * l }, 9);
    fx.stroke(fork, COLORS.red, Math.max(1, width * 0.6));
    fx.stroke(fork, COLORS.paper, 0.8);
  }
}

// a point on the edge of the screen, at random
function edgePoint(w, h) {
  const side = Math.floor(rand(0, 4));
  return side === 0 ? { x: rand(0, w), y: 0 } : side === 1 ? { x: w, y: rand(0, h) } : side === 2 ? { x: rand(0, w), y: h } : { x: 0, y: rand(0, h) };
}

// ---------- the Blackwall ----------
// After your images: your screen corrupting and dripping red, then the dark, and the wall itself, a red
// lattice of beams and beaded lines with no end to it, slowly turning; red code falling in columns,
// red rain streaking down it all, lightning striking in from the edges, a red heart pulsing in it and
// strobing; its name a ghost of blue. The whole screen shakes. At the end it bleeds away.

export function blackwall(fx, img, { life = 9000 } = {}) {
  const { w, h } = fx.size;
  const cols = Array.from({ length: Math.ceil(w / 26) }, (_, i) => ({
    x: i * 26 + rand(-5, 5), speed: rand(160, 520), offset: rand(0, h), len: Math.floor(rand(8, 28)), dim: Math.random() < 0.35,
  }));
  const drips = Array.from({ length: 110 }, () => ({ x: rand(0, w), width: rand(1.5, 8), speed: rand(0.35, 1.3), at: rand(0, 0.25) }));
  const rain = Array.from({ length: 70 }, () => ({ x: rand(0, w), y: rand(-h, h), len: rand(80, 360), speed: rand(500, 1500), width: rand(1, 3.5) }));
  const slabs = new Set(Array.from({ length: 48 }, () => `${Math.floor(rand(0, 10))},${Math.floor(rand(0, 4))},${Math.floor(rand(0, 10))}`));
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintBlackwall(ctx, fx, img, it, age, frame, { cols, drips, rain, slabs }) });
}

function paintBlackwall(ctx, fx, img, it, age, frame, { cols, drips, rain, slabs }) {
  const { w, h } = fx.size;
  const k = age / it.life;
  const dark = clamp((age - 450) / 700, 0, 1) * (1 - clamp((age - (it.life - 800)) / 800, 0, 1));
  const torn = frame % 7 < 2;
  const beat = (age % 900) / 900; // the wall's pulse
  const pulse = Math.exp(-beat * 6);
  const shake = 3 + 9 * pulse * dark;
  ctx.save();
  ctx.translate(rand(-shake, shake), rand(-shake, shake));

  // 1. your screen corrupting: red, then dripping down in streaks (and again as it goes, at the end)
  const melt = age < 1500 ? clamp(age / 1300, 0, 1) : clamp((age - (it.life - 1300)) / 1100, 0, 1);
  if (img && (age < 1500 || age > it.life - 1300)) {
    ctx.globalAlpha = 1 - dark * 0.9;
    cover(ctx, img, torn ? rand(-10, 10) : 0, 0);
    const sx = img.naturalWidth / window.screen.width;
    for (const d of drips) {
      const fall = clamp(melt - d.at, 0, 1) * h * d.speed;
      if (fall <= 0) continue;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, d.x * sx, 0, d.width * sx, Math.max(1, (h - fall) * sx), d.x, fall, d.width, h - fall);
      ctx.fillStyle = `rgba(255, 33, 82, ${0.55 * clamp(melt * 2, 0, 1)})`;
      ctx.fillRect(d.x, 0, d.width, fall + 30);
    }
    ctx.globalAlpha = 0.3 * melt;
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }

  // 2. the dark, with a red heart in it beating
  ctx.globalAlpha = dark * 0.95;
  ctx.fillStyle = '#050102';
  ctx.fillRect(-20, -20, w + 40, h + 40);
  if (dark > 0) {
    const core = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * (0.35 + 0.1 * pulse));
    core.addColorStop(0, `rgba(255, 33, 82, ${0.35 * pulse + 0.08})`);
    core.addColorStop(1, 'rgba(255, 33, 82, 0)');
    ctx.globalAlpha = dark;
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);

    // 3. the wall: a lattice of beams, seen from above at an angle, turning; on glitch drawings a
    //    second copy of it knocked aside in blue
    if (torn) {
      ctx.save();
      ctx.translate(rand(-18, 18), rand(-6, 6));
      lattice(ctx, w, h, age / 1000, dark * 0.5, slabs, true, '#3d6bff');
      ctx.restore();
    }
    lattice(ctx, w, h, age / 1000, dark, slabs, torn, COLORS.red);
    // 4. red code falling in columns, a few in the wall's blue
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const col of cols) {
      const span = h + col.len * 15;
      const head = (col.offset + (age / 1000) * col.speed) % span;
      for (let i = 0; i < col.len; i += 1) {
        const y = head - i * 15;
        if (y < -15 || y > h + 15) continue;
        ctx.globalAlpha = dark * (i === 0 ? 0.95 : (col.dim ? 0.3 : 0.65) * (1 - i / col.len));
        ctx.fillStyle = i === 0 ? COLORS.paper : (col.x + i) % 11 < 1 ? COLORS.blue : COLORS.red;
        ctx.fillText(HEX[(frame + i * 7 + Math.floor(col.x)) % 16], col.x, y);
      }
    }
    // 5. red rain streaking down over it all, like your second picture
    for (const r of rain) {
      const y = ((r.y + (age / 1000) * r.speed) % (h + r.len * 2)) - r.len;
      const g = ctx.createLinearGradient(0, y, 0, y + r.len);
      g.addColorStop(0, 'rgba(255, 33, 82, 0)');
      g.addColorStop(1, 'rgba(255, 90, 126, 0.9)');
      ctx.globalAlpha = dark;
      ctx.fillStyle = g;
      ctx.fillRect(r.x, y, r.width, r.len);
    }
    // the bright red bars down the sides, like your third picture
    for (let i = 0; i < 16; i++) {
      const x = i < 8 ? (i * w) / 44 + rand(-2, 2) : w - ((i - 8) * w) / 44 + rand(-2, 2);
      ctx.globalAlpha = dark * rand(0.15, 0.6);
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(x, 0, rand(1, 5), h);
    }
    // 6. lightning: crackling across it, and striking in from the edges at the heart on its beat
    ctx.globalAlpha = dark;
    if (frame % 3 !== 2) {
      for (let i = 0; i < 4; i++) {
        const a = { x: rand(w * 0.08, w * 0.92), y: rand(h * 0.1, h * 0.9) };
        lightning(fx, a, { x: a.x + rand(-300, 300), y: a.y + rand(-180, 180) }, 3, 2);
      }
    }
    if (pulse > 0.5) {
      for (let i = 0; i < 3; i++) lightning(fx, edgePoint(w, h), { x: w / 2 + rand(-60, 60), y: h / 2 + rand(-40, 40) }, 6, 4);
    }
    // 7. its name, a ghost of blue in the middle, flaring on the beat
    const size = Math.min(180, w / 6.5);
    tornText(ctx, 'BLACKWALL', w / 2, h * 0.5, size, {
      colors: ['rgba(61, 107, 255, 0.55)', 'rgba(255, 33, 82, 0.45)', 'rgba(140, 165, 255, 0.7)'], alpha: dark * (0.45 + 0.5 * pulse), torn, spread: 60,
    });
    mono(ctx, 'NETWATCH // ROGUE AI CONTAINMENT. TURN BACK.', w / 2, h * 0.5 + size * 0.55, { size: 15, color: COLORS.red, alpha: dark * (frame % 14 < 10 ? 0.9 : 0.2) });
    // the strobe
    if (pulse > 0.85) {
      ctx.globalAlpha = 0.22 * dark;
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
  }
  // tears across everything, heavy
  for (let i = 0; i < (torn ? 5 : 1); i++) {
    ctx.globalAlpha = rand(0.3, 0.8);
    ctx.fillStyle = pick([COLORS.red, COLORS.ink, COLORS.violet, COLORS.paper]);
    ctx.fillRect(-20, rand(0, h), w + 40, rand(2, torn ? 22 : 6));
  }
  if (k > 0.97) {
    ctx.globalAlpha = (1 - k) * 25;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }
  ctx.restore();
}

// The lattice: N×N pillars on four levels (bigger than the screen), joined by beams, some of its
// cells a dark slab, all seen in perspective from above, turning with time `t` (s). Pillars beaded.
function lattice(ctx, w, h, t, alpha, slabs, torn, color) {
  const N = 10;
  const LEVELS = 4;
  const yaw = 0.55 + t * 0.12;
  const pitch = 0.82;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const f = Math.max(w, h) * 1.15; // big: it runs off every edge, no end to it
  const P = (gx, gy, gz) => {
    const x = (gx / (N - 1)) * 2 - 1;
    const y = (gy / (LEVELS - 1)) * 1.6 - 0.8;
    const z = (gz / (N - 1)) * 2 - 1;
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const d = f / (z2 + 2.4);
    return [w / 2 + x1 * d, h / 2 + y1 * d + (torn ? rand(-2, 2) : 0), d / f];
  };
  const pts = [];
  for (let i = 0; i < N; i++) for (let l = 0; l < LEVELS; l++) for (let j = 0; j < N; j++) pts.push(P(i, l, j));
  const at = (i, l, j) => pts[(i * LEVELS + l) * N + j];
  ctx.lineWidth = 1;
  for (const key of slabs) {
    const [i, l, j] = key.split(',').map(Number);
    if (i >= N - 1 || j >= N - 1) continue;
    const q = [at(i, l, j), at(i + 1, l, j), at(i + 1, l, j + 1), at(i, l, j + 1)];
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#12040a';
    ctx.beginPath();
    q.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  for (let l = 0; l < LEVELS; l++) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = at(i, l, j);
        for (const b of [i < N - 1 && at(i + 1, l, j), j < N - 1 && at(i, l, j + 1)]) {
          if (!b) continue;
          ctx.globalAlpha = alpha * clamp(a[2] * 1.4, 0.15, 0.95);
          ctx.lineWidth = Math.max(0.6, a[2] * 2.6);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
    }
  }
  ctx.setLineDash([2, 7]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color === COLORS.red ? '#ff5a7e' : color;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = at(i, 0, j);
      const b = at(i, LEVELS - 1, j);
      ctx.globalAlpha = alpha * clamp(a[2] * 1.6, 0.2, 1);
      ctx.lineWidth = Math.max(1.5, a[2] * 5);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
}

// ---------- Reboot Optics ----------
// The quickhack that blinds: your view splits into its colours and burns out white; eyelids slam shut
// over it with an iris closing; static and broken blocks behind them; black, and Kiroshi's optics
// reboot; then the lids open again onto your screen, its colours sliding back into place under a
// scan line, Kiroshi's targeting brackets locking on as it comes back.

const BOOT = [
  '> OPTICAL SENSOR FAULT: 0x7F4E',
  '> FLUSHING VISUAL BUFFER ............ OK',
  '> RECALIBRATING IRIS ................ OK',
  '> KIROSHI OS 2.0.77 // VISUAL LINK RESTORED',
];

export function rebootOptics(fx, img, { life = 6400 } = {}) {
  const noise = staticNoise();
  const small = img && document.createElement('canvas');
  const channels = img && channelsOf(img);
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintOptics(ctx, fx, img, it, age, frame, noise, small, channels) });
}

// eyelids: black from top and bottom, `shut` of the way closed (0 open, 1 shut), with a red rim
function lids(ctx, w, h, shut) {
  const gap = (h / 2) * (1 - shut);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h / 2 - gap);
  ctx.quadraticCurveTo(w / 2, h / 2 - gap * 1.6, 0, h / 2 - gap);
  ctx.closePath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, h);
  ctx.lineTo(w, h / 2 + gap);
  ctx.quadraticCurveTo(w / 2, h / 2 + gap * 1.6, 0, h / 2 + gap);
  ctx.closePath();
  ctx.fill();
  if (shut > 0.02 && shut < 0.98) {
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 - gap);
    ctx.quadraticCurveTo(w / 2, h / 2 - gap * 1.6, w, h / 2 - gap);
    ctx.moveTo(0, h / 2 + gap);
    ctx.quadraticCurveTo(w / 2, h / 2 + gap * 1.6, w, h / 2 + gap);
    ctx.stroke();
  }
}

// an iris of `blades` closing to `open` (0..1) around the middle
function iris(ctx, w, h, open, turn) {
  const R = Math.hypot(w, h) / 2;
  const r = R * open;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(turn);
  ctx.fillStyle = '#07070a';
  ctx.strokeStyle = 'rgba(255, 33, 82, 0.6)';
  ctx.lineWidth = 2;
  const blades = 8;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a + 0.9) * R * 1.2, Math.sin(a + 0.9) * R * 1.2);
    ctx.lineTo(Math.cos(a - 0.3) * R * 1.2, Math.sin(a - 0.3) * R * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function brackets(ctx, w, h, k) {
  const inset = 40 + (1 - k) * 140;
  const L = 60;
  ctx.strokeStyle = COLORS.red;
  ctx.lineWidth = 3;
  ctx.globalAlpha = k;
  for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * L);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * L, y);
    ctx.stroke();
  }
}

function paintOptics(ctx, fx, img, it, age, frame, noise, small, channels) {
  const { w, h } = fx.size;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (age < 600) {
    // the hit: colours knocked apart, burning out white, the lids slamming
    const k = age / 600;
    if (channels) split(ctx, channels, w, h, 30 + k * 40, rand(-8, 8));
    ctx.globalAlpha = clamp(k * 1.4, 0, 0.9);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    lids(ctx, w, h, clamp((k - 0.45) * 2, 0, 1) ** 2);
  } else if (age < 1900) {
    // behind the shut lids: static and broken blocks, an iris closing over them
    const k = (age - 600) / 1300;
    if (img && small) {
      const block = Math.round(8 + k * 70);
      small.width = Math.max(1, Math.round(w / block));
      small.height = Math.max(1, Math.round(h / block));
      small.getContext('2d').drawImage(img, 0, 0, small.width, small.height);
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.drawImage(small, 0, 0, w, h);
    }
    ctx.globalAlpha = clamp(0.4 + k, 0, 1);
    ctx.drawImage(noise(), 0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = pick([COLORS.red, COLORS.green, COLORS.blue, COLORS.paper, '#000']);
      ctx.fillRect(rand(0, w), rand(0, h), rand(30, 240), rand(8, 60));
    }
    ctx.globalAlpha = 0.4;
    for (let y = (frame * 7) % 6; y < h; y += 6) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, y, w, 2);
    }
    iris(ctx, w, h, 1 - k, k * 1.2);
  } else if (age < 3800) {
    // dark, and the reboot
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#020204';
    ctx.fillRect(0, 0, w, h);
    const k = (age - 1900) / 1900;
    const x = w * 0.28;
    let y = h * 0.36;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.red;
    ctx.font = '700 32px "Chakra Petch", sans-serif';
    ctx.fillText(frame % 8 < 6 ? 'KIROSHI OPTICS // REBOOTING' : 'KIROSHI OPTICS // REBOOT1NG', x, y);
    y += 48;
    const shown = Math.floor(k * (BOOT.length + 0.6) * 46);
    BOOT.forEach((line, i) => {
      const chars = clamp(shown - i * 46, 0, line.length);
      if (chars) mono(ctx, line.slice(0, chars), x, y + i * 30, { size: 17, align: 'left', color: i === BOOT.length - 1 ? COLORS.green : i === 0 ? COLORS.red : COLORS.paper });
    });
    const bw = w * 0.44;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + BOOT.length * 30 + 10, bw, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(x + 2, y + BOOT.length * 30 + 12, (bw - 4) * clamp(k * 1.1, 0, 1), 8);
    if (frame % 6 < 4) {
      ctx.strokeStyle = COLORS.red;
      ctx.lineWidth = 2;
      const r = 26 + 6 * Math.sin(age / 90);
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.74, r, 0, Math.PI * 2);
      ctx.moveTo(w / 2 - r - 14, h * 0.74);
      ctx.lineTo(w / 2 - r + 6, h * 0.74);
      ctx.moveTo(w / 2 + r - 6, h * 0.74);
      ctx.lineTo(w / 2 + r + 14, h * 0.74);
      ctx.stroke();
    }
  } else {
    // back: the lids opening, the colours sliding into place under a scan line, the brackets locking on
    const k = (age - 3800) / (it.life - 3800);
    if (channels) split(ctx, channels, w, h, 26 * (1 - k));
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    const line = h * clamp(k * 1.4, 0, 1);
    ctx.globalAlpha = 1 - clamp(k * 1.4, 0, 1) * 0.0;
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(0, line - 2, w, 3);
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, line - 70, w, 70);
    brackets(ctx, w, h, clamp(k * 2, 0, 1));
    if (k > 0.3 && k < 0.85 && frame % 6 < 4) mono(ctx, 'OPTICS ONLINE // TARGET ACQUIRED', w / 2, h - 60, { size: 16, color: COLORS.red });
    lids(ctx, w, h, clamp(1 - k * 2.2, 0, 1));
    if (k > 0.88 && img) {
      ctx.globalAlpha = (k - 0.88) / 0.12;
      cover(ctx, img);
    }
  }
  ctx.restore();
}

// ---------- Cyberpsychosis ----------
// After your pictures of David: your screen pounding with a heartbeat that won't slow down, its
// colours splitting on every beat, a ring of her own screaming face in green chrome spinning around
// it (his heads, in your second picture), cracks spreading with light in them, more and more yellow
// eyes opening, a black tunnel closing in, words flashing for a frame, neural integrity dropping to
// nothing, MaxTac called. It ends in a scream and white.

const WHISPERS = ['MORE CHROME', "CAN'T STOP", 'KEEP GOING', 'NO ONE CAN HEAR YOU', 'WHO ARE YOU', 'FASTER', 'MORE'];

export function cyberpsychosis(fx, img, { life = 8000 } = {}) {
  const { w, h } = fx.size;
  const channels = img && channelsOf(img);
  const chrome = img && tinted(img, '#39ff8a');
  const cracks = Array.from({ length: 8 }, () => crackTree({ x: rand(w * 0.15, w * 0.85), y: rand(h * 0.15, h * 0.85) }, rand(140, 340), 3));
  const eyes = Array.from({ length: 18 }, () => ({ x: rand(0.06, 0.94) * w, y: rand(0.1, 0.9) * h, size: rand(12, 32), at: rand(0.12, 0.8), copies: Math.floor(rand(1, 4)), look: rand(-1, 1) }));
  const beats = [];
  for (let t = 0, gap = 850; t < life; t += gap, gap = Math.max(300, gap * 0.85)) beats.push(t);
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintPsycho(ctx, fx, img, it, age, frame, { channels, chrome, cracks, eyes, beats }) });
}

function crackTree(at, len, depth) {
  const lines = [];
  const grow = (from, angle, l, d) => {
    const pts = [[from.x, from.y]];
    let { x, y } = from;
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      angle += rand(-0.5, 0.5);
      x += (Math.cos(angle) * l) / steps;
      y += (Math.sin(angle) * l) / steps;
      pts.push([x, y]);
    }
    lines.push({ pts, d });
    if (d > 0) for (let b = 0; b < 2; b++) grow({ x: pts[3 + b][0], y: pts[3 + b][1] }, angle + rand(-1.2, 1.2), l * 0.55, d - 1);
  };
  for (let a = 0; a < 3; a++) grow(at, rand(0, Math.PI * 2), len, depth);
  return lines;
}

function paintPsycho(ctx, fx, img, it, age, frame, { channels, chrome, cracks, eyes, beats }) {
  const { w, h } = fx.size;
  const k = age / it.life;
  const rage = clamp(age / 5600, 0, 1);
  const since = age - (beats.filter((b) => b <= age).pop() ?? 0);
  const pulse = Math.exp(-since / 100);
  const shake = (3 + 18 * rage) * (0.4 + pulse);
  ctx.save();
  ctx.translate(rand(-shake, shake), rand(-shake, shake));
  // your screen, pounding, its colours knocked apart on every beat
  if (channels) {
    const zoom = 1 + 0.05 * pulse + 0.03 * rage;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);
    split(ctx, channels, w, h, (6 + 40 * rage) * pulse + 4 * rage, rand(-4, 4) * rage);
    ctx.restore();
    // a green chrome copy of it, pulling away
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.2 + 0.25 * rage;
    cover(ctx, chrome, Math.sin(age / 300) * 40 * rage, Math.cos(age / 400) * 25 * rage, 1.06 + 0.06 * pulse);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.globalAlpha = 0.5 * rage;
    ctx.fillStyle = '#062012';
    ctx.fillRect(-30, -30, w + 60, h + 60);
  }
  // her screaming face, in a ring around it, spinning, more of them as it gets worse
  const scream = face('face-laugh');
  if (scream) {
    const n = 4 + Math.round(4 * rage);
    const R = Math.min(w, h) * (0.32 + 0.06 * pulse);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + age / 900;
      const s = Math.min(w, h) * (0.2 + 0.07 * pulse) * (0.8 + 0.4 * ((i * 37) % 10) / 10);
      const x = w / 2 + Math.cos(a) * R * 1.25;
      const y = h / 2 + Math.sin(a) * R;
      ctx.save();
      ctx.translate(x + rand(-shake, shake) * 0.4, y + rand(-shake, shake) * 0.4);
      ctx.rotate(Math.sin(a * 2 + age / 300) * 0.35);
      ctx.globalAlpha = clamp(rage * 2.2 - i * 0.08, 0, 0.9);
      ctx.drawImage(scream, -s / 2, -s / 2, s, s);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha *= 0.5;
      ctx.drawImage(scream, -s / 2 + 8, -s / 2 - 4, s, s);
      ctx.restore();
    }
  }
  // the tunnel closing in, red at its edge on every beat
  const tunnel = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.55 - 0.3 * rage), w / 2, h / 2, Math.max(w, h) * 0.75);
  tunnel.addColorStop(0, 'rgba(0, 0, 0, 0)');
  tunnel.addColorStop(0.55, `rgba(110, 0, 20, ${0.25 + 0.45 * pulse})`);
  tunnel.addColorStop(1, `rgba(0, 0, 0, ${0.5 + 0.45 * rage})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = tunnel;
  ctx.fillRect(-30, -30, w + 60, h + 60);
  // the cracks, growing, light through them
  const grown = clamp(age / 4500, 0, 1);
  for (const tree of cracks) {
    for (const { pts, d } of tree) {
      const reach = grown * 1.6 - (3 - d) * 0.25;
      if (reach <= 0) continue;
      const seg = pts.slice(0, Math.max(2, Math.ceil(pts.length * clamp(reach, 0, 1))));
      ctx.globalAlpha = 0.9;
      fx.stroke(seg, '#1a0608', 4 + d);
      fx.stroke(seg, pulse > 0.5 ? '#ffffff' : '#ffe7a3', 1 + d * 0.4);
    }
  }
  // the eyes: yellow, opening one after the other, their pupils doubled, tripled
  for (const e of eyes) {
    const open = clamp((k - e.at) * 7, 0, 1) * (frame % 23 === Math.floor(e.x) % 23 ? 0.1 : 1);
    if (open <= 0) continue;
    for (let c = 0; c < e.copies; c++) {
      const cx = e.x + c * e.size * 0.55 + rand(-shake, shake) * 0.3;
      const cy = e.y - c * e.size * 0.25;
      ctx.globalAlpha = c ? 0.6 : 1;
      ctx.fillStyle = '#0c0a1a';
      ctx.beginPath();
      ctx.ellipse(cx, cy, e.size * 1.35, e.size * 0.75 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8fa6ff';
      ctx.beginPath();
      ctx.ellipse(cx, cy, e.size * 1.15, e.size * 0.6 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      const px = cx + e.look * e.size * 0.3;
      const glow = ctx.createRadialGradient(px, cy, 0, px, cy, e.size * 0.8);
      glow.addColorStop(0, 'rgba(255, 255, 210, 1)');
      glow.addColorStop(0.35, 'rgba(255, 214, 40, 1)');
      glow.addColorStop(1, 'rgba(255, 200, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(px, cy, e.size * 0.55, e.size * 0.55 * open, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // words, flashed for a frame
  if (rage > 0.25 && frame % 9 === 0) {
    tornText(ctx, pick(WHISPERS), rand(w * 0.25, w * 0.75), rand(h * 0.3, h * 0.75), rand(40, 90), { colors: [COLORS.paper, COLORS.red], torn: true, spread: 20 });
  }
  // the readout: neural integrity dropping, then MaxTac
  const integrity = Math.max(0, Math.round(100 - 100 * clamp(age / (it.life * 0.85), 0, 1) ** 0.7));
  const torn = frame % 5 < 2;
  tornText(ctx, 'CYBERPSYCHOSIS', w / 2, h * 0.15, Math.min(120, w / 10), { colors: [COLORS.green, COLORS.violet, COLORS.red], torn, spread: 18 + 40 * rage });
  mono(ctx, `NEURAL INTEGRITY ${integrity}% // HUMANITY LOSS CRITICAL`, w / 2 + rand(-shake, shake) * 0.3, h * 0.15 + 46, { size: 18, color: integrity < 30 ? COLORS.red : COLORS.paper });
  if (k > 0.55 && frame % 10 < 6) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.red;
    ctx.font = '700 24px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MAXTAC NOTIFIED. STAY WHERE YOU ARE.', w / 2, h * 0.9);
  }
  for (let i = 0; i < Math.floor(rage * 6); i++) {
    ctx.globalAlpha = rand(0.2, 0.6);
    ctx.fillStyle = pick([COLORS.green, COLORS.red, COLORS.paper]);
    ctx.fillRect(-30, rand(0, h), w + 60, rand(2, 10));
  }
  if (k > 0.94) {
    ctx.globalAlpha = (1 - k) * 16;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(-30, -30, w + 60, h + 60);
  }
  ctx.restore();
}

// ---------- Sandevistan ----------
// David's implant. A green flash and speed lines as it kicks in; down the left, the implant itself, a
// spine of segments lighting up, sync climbing, time dilating to x16. Your screen goes cold and nearly
// still under a sweep of rainbow afterimages; rain hangs in the air, each drop with its glint and its
// colours; she dashes across it all faster than you can see, leaving herself behind in colours (her
// echoes, from `her()`); the clock crawls. Then it snaps back: the afterimages slam into one,
// a shockwave, a burst of colour.

const SANDY_COLORS = ['#39ff8a', '#3df2ff', '#3d6bff', '#7b3dff', '#ff3fb4', '#ff3b3b', '#ffe14d'];

// her picture in one flat colour, her shape only (made once per colour)
const echoTints = new Map();
function echoTint(image, color) {
  if (!image?.naturalWidth && !image?.width) return null;
  const key = color;
  if (!echoTints.has(key)) {
    const c = document.createElement('canvas');
    c.width = Math.min(480, image.naturalWidth || image.width);
    c.height = Math.round(c.width * ((image.naturalHeight || image.height) / (image.naturalWidth || image.width)));
    const g = c.getContext('2d');
    g.drawImage(image, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    g.fillRect(0, 0, c.width, c.height);
    echoTints.set(key, c);
  }
  return echoTints.get(key);
}

export function sandevistan(fx, img, { life = 8000, her = null } = {}) {
  const { w, h } = fx.size;
  const trails = img && SANDY_COLORS.map((c) => tinted(img, c, 0.5, 'grayscale(1) brightness(1.35) contrast(1.2)'));
  const cold = img && offscreen(0.5, (c, cw, ch) => {
    c.filter = 'saturate(0.25) contrast(1.2) brightness(0.8) hue-rotate(-25deg)';
    c.drawImage(img, 0, 0, cw, ch);
  });
  const drops = Array.from({ length: 140 }, () => ({ x: rand(0, w), y: rand(0, h), len: rand(6, 22), drift: rand(2, 8), color: pick(SANDY_COLORS) }));
  const echoes = []; // where she's been, with when: her afterimages
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintSandy(ctx, fx, img, it, age, frame, { trails, cold, drops, her, echoes }) });
}

function paintSandy(ctx, fx, img, it, age, frame, { trails, cold, drops, her, echoes }) {
  const { w, h } = fx.size;
  const on = clamp(age / 350, 0, 1);
  const end = it.life - 700;
  const off = clamp((age - end) / 700, 0, 1);
  const slow = on * (1 - off);
  ctx.save();
  if (cold) {
    // 1. your screen, cold and almost still, breathing in a little
    const breathe = 1 + 0.012 * Math.sin(age / 900);
    ctx.globalAlpha = 1;
    cover(ctx, img);
    ctx.globalAlpha = slow;
    cover(ctx, cold, 0, 0, breathe);
    // 2. the afterimages: the screen again in each colour, swept out to one side and back, slowly;
    //    collapsing into one at the end
    ctx.globalCompositeOperation = 'screen';
    const sweep = Math.sin((age / 2600) * Math.PI);
    trails.forEach((t, i) => {
      const lag = (i + 1) * (12 + 30 * Math.abs(sweep)) * (1 - off);
      ctx.globalAlpha = slow * (0.34 - i * 0.035);
      cover(ctx, t, -lag * Math.sign(sweep || 1) * 1.4, lag * 0.18, breathe + (i + 1) * 0.004);
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  // 3. her, dashing about, left behind herself in colours
  // (`her()`: { image, x, y, w, h, flip } where she stands, or null; each spot she's been stays behind
  // a while, in one of the colours, fading)
  const me = her?.();
  if (me) {
    const last = echoes[echoes.length - 1];
    if (!last || Math.hypot(last.x - me.x, last.y - me.y) > 6) echoes.push({ ...me, at: age });
    while (echoes.length > 12 || (echoes.length && age - echoes[0].at > 2600)) echoes.shift();
    ctx.globalCompositeOperation = 'screen';
    echoes.forEach((e, i) => {
      const fade = 1 - (age - e.at) / 2600;
      const tint = echoTint(e.image, SANDY_COLORS[i % SANDY_COLORS.length]);
      if (!tint) return;
      // the colours of her, side by side, as if she'd moved on while they were still there
      for (let j = 0; j < 3; j++) {
        ctx.globalAlpha = slow * fade * (0.55 - j * 0.15);
        const dx = (j - 1) * 14 * (e.flip ? -1 : 1);
        ctx.save();
        ctx.translate(e.x + dx + (e.flip ? e.w : 0), e.y);
        ctx.scale(e.flip ? -1 : 1, 1);
        ctx.drawImage(tint, 0, 0, e.w, e.h);
        ctx.restore();
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  // 4. rain hanging in the air: each drop a glint with its colours streaked behind it
  for (const d of drops) {
    const x = d.x + (age / 1000) * d.drift;
    const y = d.y + (age / 1000) * d.drift * 2;
    ctx.globalAlpha = slow * 0.85;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - d.len * 0.3, y - d.len);
    ctx.stroke();
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(x - 1, y - 1, 2.5, 2.5);
  }
  // 5. speed lines, as it kicks in and as it lets go
  const burst = age < 600 ? 1 - age / 600 : off;
  if (burst > 0) {
    for (let i = 0; i < 60; i++) {
      const a = rand(0, Math.PI * 2);
      const r0 = rand(0.15, 0.4) * Math.max(w, h);
      const r1 = r0 + rand(80, 380) * burst;
      ctx.globalAlpha = burst * rand(0.3, 0.9);
      ctx.strokeStyle = pick(['#e6fff1', '#39ff8a', '#3df2ff']);
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
      ctx.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  if (age < 350) {
    ctx.globalAlpha = (1 - age / 350) * 0.85;
    ctx.fillStyle = '#e6fff1';
    ctx.fillRect(0, 0, w, h);
  }
  // 6. the implant: a spine down the left, its segments lighting up one by one
  const segs = 11;
  const lit = Math.min(segs, Math.floor((age / 900) * segs));
  for (let i = 0; i < segs; i++) {
    const y = h * 0.22 + i * ((h * 0.56) / segs);
    const glow = i < lit ? 0.5 + 0.5 * Math.sin(age / 120 - i * 0.6) : 0.12;
    ctx.globalAlpha = slow * glow;
    ctx.fillStyle = i < lit ? '#39ff8a' : '#1b3b2a';
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(70, y + 4);
    ctx.lineTo(64, y + (h * 0.56) / segs - 8);
    ctx.lineTo(40, y + (h * 0.56) / segs - 10);
    ctx.closePath();
    ctx.fill();
  }
  // 7. the readout, the slowed clock
  const dilation = Math.round(1 + 15 * slow);
  tornText(ctx, 'SANDEVISTAN', w / 2, h * 0.15, Math.min(118, w / 10), { colors: ['#3df2ff', '#ff3fb4', '#39ff8a'], alpha: slow, torn: frame % 11 < 2, spread: 22 });
  mono(ctx, `MILITECH APOGEE // NEURAL SYNC ${Math.round(100 * clamp(age / 900, 0, 1))}% // TIME DILATION x${dilation}`, w / 2, h * 0.15 + 46, { size: 17, color: '#39ff8a', alpha: slow });
  const elapsed = age / (1 + 15 * slow);
  const clock = new Date(Date.now() - age + elapsed).toLocaleTimeString(undefined, { hour12: false });
  mono(ctx, `${clock}.${String(Math.floor(elapsed % 1000)).padStart(3, '0')}`, w - 40, h - 40, { size: 26, color: COLORS.paper, align: 'right', alpha: slow * 0.9 });
  // 8. the snap back: a shockwave, a burst of colour
  if (off > 0) {
    ctx.globalAlpha = (1 - off) * 0.9;
    ctx.strokeStyle = '#e6fff1';
    ctx.lineWidth = 14 * (1 - off) + 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, off * Math.hypot(w, h) * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = off * Math.max(w, h) * rand(0.2, 0.6);
      ctx.globalAlpha = (1 - off);
      ctx.fillStyle = SANDY_COLORS[i % SANDY_COLORS.length];
      ctx.fillRect(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 6, 6);
    }
    ctx.globalAlpha = Math.sin(off * Math.PI) * 0.6;
    ctx.fillStyle = '#e6fff1';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// ---------- Overheat ----------
// The quickhack that cooks you. Your screen through a thermal camera, heating from purple to white;
// the air shimmering over it; flames climbing in layers, embers rising; holes burning through it,
// glowing at their edges; molten drips running down from the top; the temperature climbing on a
// gauge, warnings flashing. White-hot, and it melts down off the screen.

export function overheat(fx, img, { life = 8000 } = {}) {
  const { w, h } = fx.size;
  const thermal = img && thermalOf(img);
  const embers = Array.from({ length: 150 }, () => ({ x: rand(0, w), y: rand(h * 0.4, h * 1.4), speed: rand(70, 260), sway: rand(10, 50), size: rand(1.5, 5), phase: rand(0, 6) }));
  const holes = Array.from({ length: 9 }, () => ({ x: rand(0.1, 0.9) * w, y: rand(0.15, 0.8) * h, at: rand(0.25, 0.7), size: rand(40, 130), seed: rand(0, 100) }));
  const drips = Array.from({ length: 34 }, () => ({ x: rand(0, w), at: rand(0.3, 0.75), speed: rand(0.5, 1.4), width: rand(4, 14) }));
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintOverheat(ctx, fx, img, it, age, frame, { thermal, embers, holes, drips }) });
}

// the picture as a thermal camera sees it: dark cold, through purple, red, orange, to white heat
function thermalOf(img) {
  const stops = [[0, [8, 4, 30]], [0.25, [90, 10, 140]], [0.5, [220, 30, 60]], [0.7, [255, 120, 20]], [0.88, [255, 220, 80]], [1, [255, 255, 240]]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    const i = stops.findIndex(([s]) => s >= t);
    const [s1, c1] = stops[Math.max(0, i - 1)];
    const [s2, c2] = stops[i];
    const k = s2 === s1 ? 0 : (t - s1) / (s2 - s1);
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = c1[c] + (c2[c] - c1[c]) * k;
  }
  return offscreen(0.4, (c, cw, ch) => {
    c.drawImage(img, 0, 0, cw, ch);
    const data = c.getImageData(0, 0, cw, ch);
    const d = data.data;
    for (let p = 0; p < d.length; p += 4) {
      const v = Math.round(d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11);
      d[p] = lut[v * 3];
      d[p + 1] = lut[v * 3 + 1];
      d[p + 2] = lut[v * 3 + 2];
    }
    c.putImageData(data, 0, 0);
  });
}

function paintOverheat(ctx, fx, img, it, age, frame, { thermal, embers, holes, drips }) {
  const { w, h } = fx.size;
  const k = age / it.life;
  const heat = clamp(age / 5600, 0, 1);
  const melting = clamp((age - (it.life - 1100)) / 1100, 0, 1);
  ctx.save();
  // 1. your screen, then the thermal view of it, shimmering in bands; heating whiter; at the end,
  //    melting down off the screen in strips
  if (img) {
    const sx = img.naturalWidth / window.screen.width;
    const tx = thermal.width / window.screen.width;
    const band = 12;
    for (let y = 0; y < h; y += band) {
      const dx = Math.sin(y / 36 + age / 110) * (2 + 18 * heat) * (0.35 + y / h);
      const fall = melting * h * (0.6 + 0.4 * Math.sin(y * 0.7)) ** 2;
      ctx.globalAlpha = 1;
      ctx.drawImage(img, 0, y * sx, img.naturalWidth, band * sx, dx, y + fall, w, band);
      ctx.globalAlpha = clamp(age / 1000, 0, 1) * (0.55 + 0.45 * heat);
      ctx.drawImage(thermal, 0, y * tx, thermal.width, band * tx, dx, y + fall, w, band);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = heat * heat * 0.45;
    ctx.fillStyle = '#ff7a2e';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  // 2. holes burning through it: black, a ragged orange edge, smoke-dark around them
  for (const o of holes) {
    const grow = clamp((k - o.at) * 4, 0, 1);
    if (grow <= 0) continue;
    const r = o.size * grow;
    ctx.globalAlpha = 0.7 * grow;
    const scorch = ctx.createRadialGradient(o.x, o.y, r * 0.6, o.x, o.y, r * 1.9);
    scorch.addColorStop(0, 'rgba(30, 8, 0, 0.9)');
    scorch.addColorStop(1, 'rgba(30, 8, 0, 0)');
    ctx.fillStyle = scorch;
    ctx.fillRect(o.x - r * 2, o.y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let a = 0; a <= 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const rr = r * (0.75 + 0.25 * Math.sin(ang * 5 + o.seed) + 0.08 * Math.sin(age / 60 + a));
      ctx.lineTo(o.x + Math.cos(ang) * rr, o.y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#050100';
    ctx.fill();
    ctx.strokeStyle = frame % 2 ? '#ffb14d' : '#ff5a1f';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // 3. molten drips running down from the top
  for (const d of drips) {
    const run = clamp((k - d.at) * 2.5, 0, 1) * h * 0.55 * d.speed;
    if (run <= 0) continue;
    const g = ctx.createLinearGradient(0, 0, 0, run);
    g.addColorStop(0, 'rgba(255, 140, 30, 0.95)');
    g.addColorStop(1, 'rgba(255, 240, 170, 1)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(d.x, 0, d.width, run);
    ctx.beginPath();
    ctx.arc(d.x + d.width / 2, run, d.width * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  // 4. the fire: three layers of it climbing, each its own flicker
  for (const [layer, color, rise, speed] of [[0, 'rgba(160, 10, 0, 0.7)', 0.5, 70], [1, 'rgba(255, 90, 20, 0.75)', 0.38, 50], [2, 'rgba(255, 220, 120, 0.85)', 0.22, 36]]) {
    const top = h * (1 - 0.1 - rise * (0.3 + 0.7 * heat));
    ctx.globalAlpha = clamp(age / 700, 0, 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 18) {
      const flame = Math.sin(x / (40 + layer * 9) + age / speed) * 34 + Math.sin(x / (11 + layer * 3) + age / (speed * 0.6)) * 20 + rand(-8, 8);
      ctx.lineTo(x, top + flame);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  // embers
  for (const e of embers) {
    const y = e.y - (((age / 1000) * e.speed * (0.6 + heat)) % (h * 1.4));
    const x = e.x + Math.sin(age / 380 + e.phase) * e.sway;
    ctx.globalAlpha = clamp((y / h) * 1.3, 0, 1);
    ctx.fillStyle = pick(['#ffd36b', '#ff8a2e', '#ff3b1f', '#fff3c4']);
    ctx.fillRect(x, y, e.size, e.size);
  }
  // 5. the gauge on the right, the readout, the warnings
  const temp = Math.round(37 + 560 * heat ** 1.5);
  const gx = w - 70;
  const gh = h * 0.5;
  const gy = h * 0.25;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ffd36b';
  ctx.lineWidth = 2;
  ctx.strokeRect(gx, gy, 22, gh);
  const fill = ctx.createLinearGradient(0, gy + gh, 0, gy);
  fill.addColorStop(0, '#ffd36b');
  fill.addColorStop(1, '#ff1f1f');
  ctx.fillStyle = fill;
  ctx.fillRect(gx + 3, gy + gh - (gh - 6) * heat - 3, 16, (gh - 6) * heat);
  mono(ctx, `${temp}°C`, gx + 11, gy - 12, { size: 16, color: temp > 300 ? '#ff3b1f' : '#ffd36b' });
  tornText(ctx, 'OVERHEAT', w / 2, h * 0.15, Math.min(124, w / 10), { colors: ['#ffd36b', '#ff3b1f', '#ff8a2e'], torn: frame % 6 < 2, spread: 14 + 36 * heat });
  mono(ctx, `CORE TEMPERATURE ${temp}°C // COOLANT FAILURE // SKIN IGNITION IMMINENT`, w / 2, h * 0.15 + 46, { size: 17, color: temp > 300 ? '#ff3b1f' : '#ffd36b' });
  if (heat > 0.35 && frame % 6 < 3) {
    for (let i = 0; i < 3; i++) mono(ctx, '⚠ ⚠ ⚠', w * (0.2 + i * 0.3), h * 0.3, { size: 26, color: '#ff3b1f' });
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ff3b1f';
    ctx.fillRect(0, 0, w, h);
  }
  // 6. white-hot, then gone
  if (k > 0.82 && k < 0.93) {
    ctx.globalAlpha = Math.sin(((k - 0.82) / 0.11) * Math.PI) * 0.9;
    ctx.fillStyle = '#fff6e0';
    ctx.fillRect(0, 0, w, h);
  }
  if (melting > 0.85) {
    ctx.globalAlpha = (melting - 0.85) / 0.15;
    if (img) cover(ctx, img);
  }
  ctx.restore();
}

// ---------- System Reset ----------
// The quickhack, as you'd cast it in the game. A reticle locks onto your screen and the quickhack
// card uploads (SYSTEM RESET, RAM 8), data streaming in; then the breach: your screen breaks into
// blocks knocked out of place, error windows piling up on it; it collapses like an old CRT, to a
// line, to a dot; black, a boot log racing by; and it rolls back on.

const BOOT_LOG = [
  'KIROSHI BIOS v4.20.77', 'CHECKING NEURAL INTERFACE ........ FAIL', 'RETRYING ........................ OK', 'MOUNTING /dev/cortex0', 'LOADING CYBERDECK FIRMWARE', 'ICE: NOMINAL',
  'SANDBOX ......................... OK', 'RESTORING MOTOR FUNCTIONS', 'RESTORING VISUAL FEED', 'SYNCING WITH NET', 'BLACKWALL HANDSHAKE ............. REFUSED', 'USER PRESENCE: DETECTED',
  'SYSTEM RESET COMPLETE', 'WELCOME BACK, CHOOM',
];

export function systemReset(fx, img, { life = 7400 } = {}) {
  const noise = staticNoise();
  const channels = img && channelsOf(img);
  const blocks = Array.from({ length: 26 }, () => ({ x: rand(0, 1), y: rand(0, 1), w: rand(0.06, 0.3), h: rand(0.02, 0.12), dx: rand(-120, 120), dy: rand(-30, 30) }));
  const errors = Array.from({ length: 14 }, (_, i) => ({ x: rand(0.05, 0.7), y: rand(0.08, 0.75), at: 1700 + i * 70, code: `0x${Math.floor(rand(0x1000, 0xffff)).toString(16).toUpperCase()}` }));
  const data = Array.from({ length: 50 }, () => ({ a: rand(0, Math.PI * 2), r: rand(0.4, 0.75), speed: rand(0.5, 1.2) }));
  return fx.add({ type: 'custom', life, paint: (ctx, it, age, frame) => paintReset(ctx, fx, img, it, age, frame, { noise, channels, blocks, errors, data }) });
}

function crt(ctx, img, w, h, sy, sx = 1, glow = 0) {
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 1;
  ctx.fillRect(0, 0, w, h);
  const ch = Math.max(2, h * sy);
  const cw = Math.max(2, w * sx);
  if (img) {
    ctx.globalAlpha = 1;
    ctx.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch);
  }
  if (glow) {
    ctx.globalAlpha = glow;
    ctx.fillStyle = '#e8fbff';
    ctx.fillRect((w - cw) / 2, (h - ch) / 2, cw, ch);
  }
}

function errorWindow(ctx, x, y, code) {
  const ww = 300;
  const wh = 110;
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#16060c';
  ctx.fillRect(x, y, ww, wh);
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(x, y, ww, 22);
  ctx.strokeStyle = COLORS.red;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, ww, wh);
  mono(ctx, 'FATAL EXCEPTION', x + 10, y + 16, { size: 13, color: '#16060c', align: 'left' });
  mono(ctx, `NEURAL_PROCESS_HALTED ${code}`, x + 12, y + 50, { size: 13, color: COLORS.paper, align: 'left' });
  mono(ctx, 'SYSTEM RESET IN PROGRESS...', x + 12, y + 74, { size: 13, color: COLORS.red, align: 'left' });
}

function paintReset(ctx, fx, img, it, age, frame, { noise, channels, blocks, errors, data }) {
  const { w, h } = fx.size;
  ctx.save();
  if (age < 1700) {
    // 1. the quickhack uploading: reticle locked on, the card, the bar, data streaming in
    const k = age / 1700;
    if (img) cover(ctx, img);
    ctx.globalAlpha = 0.25 + 0.2 * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    for (let y = (frame * 3) % 4; y < h; y += 4) {
      ctx.globalAlpha = 0.12;
      ctx.fillRect(0, y, w, 1);
    }
    const R = 70 + 30 * (1 - Math.min(1, k * 3));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4 + (1 - Math.min(1, k * 3)) * 0.8);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 3;
    ctx.strokeRect(-R, -R, R * 2, R * 2);
    ctx.strokeStyle = '#3df2ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-R * 0.6, -R * 0.6, R * 1.2, R * 1.2);
    ctx.restore();
    for (const d of data) {
      const t = ((age / 1000) * d.speed) % 1;
      const r = d.r * Math.max(w, h) * (1 - t);
      ctx.globalAlpha = t;
      mono(ctx, pick(['01', '10', '0x', 'FF', '7E']), w / 2 + Math.cos(d.a) * r, h / 2 + Math.sin(d.a) * r, { size: 13, color: '#3df2ff' });
    }
    const cx = w / 2 + 130;
    const cy = h / 2 - 60;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(cx, cy, 340, 132);
    ctx.strokeStyle = '#3df2ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, cy, 340, 132);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.red;
    ctx.font = '700 26px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SYSTEM RESET', cx + 16, cy + 38);
    mono(ctx, 'QUICKHACK // RAM COST 8', cx + 16, cy + 62, { size: 13, color: '#3df2ff', align: 'left' });
    mono(ctx, `UPLOADING ${Math.round(100 * k)}%`, cx + 16, cy + 92, { size: 14, color: COLORS.paper, align: 'left' });
    ctx.fillStyle = '#1d3a40';
    ctx.fillRect(cx + 16, cy + 104, 308, 10);
    ctx.fillStyle = '#3df2ff';
    ctx.fillRect(cx + 16, cy + 104, 308 * k, 10);
  } else if (age < 3000) {
    // 2. the breach: colours apart, blocks of it knocked out of place, error windows piling up
    const k = (age - 1700) / 1300;
    if (channels) split(ctx, channels, w, h, 10 + 40 * k, rand(-6, 6));
    if (img) {
      const sx = img.naturalWidth / window.screen.width;
      for (const b of blocks) {
        const bx = b.x * w;
        const by = b.y * h;
        const bw = b.w * w;
        const bh = b.h * h;
        ctx.globalAlpha = 1;
        ctx.drawImage(img, bx * sx, by * sx, bw * sx, bh * sx, bx + b.dx * k * (frame % 2 ? 1 : -0.6), by + b.dy * k, bw, bh);
      }
    }
    ctx.globalAlpha = 0.25 + 0.4 * k;
    ctx.drawImage(noise(), 0, 0, w, h);
    for (const e of errors) if (age >= e.at) errorWindow(ctx, e.x * w + (frame % 3 ? 0 : rand(-4, 4)), e.y * h, e.code);
    if (frame % 4 === 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = pick([COLORS.red, COLORS.paper, '#3df2ff']);
      ctx.fillRect(0, rand(0, h), w, rand(4, 40));
    }
  } else if (age < 3700) {
    // 3. off, like an old CRT: down to a line
    const k = (age - 3000) / 700;
    crt(ctx, img, w, h, (1 - k) ** 2.2, 1 + k * 0.05, k * 0.9);
  } else if (age < 4200) {
    // the line, down to a dot
    const k = (age - 3700) / 500;
    crt(ctx, null, w, h, 0.003, 1, 0);
    ctx.globalAlpha = 1 - k * 0.3;
    ctx.fillStyle = '#e8fbff';
    const lw = Math.max(4, w * (1 - k));
    ctx.fillRect((w - lw) / 2, h / 2 - 2, lw, 4);
    const dot = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 50);
    dot.addColorStop(0, 'rgba(232, 251, 255, 1)');
    dot.addColorStop(1, 'rgba(232, 251, 255, 0)');
    ctx.fillStyle = dot;
    ctx.fillRect(w / 2 - 50, h / 2 - 50, 100, 100);
  } else if (age < 6000) {
    // 4. black, and the boot log racing by
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const k = (age - 4200) / 1800;
    const shown = Math.floor(k * BOOT_LOG.length * 1.1);
    BOOT_LOG.slice(0, shown).forEach((line, i) => {
      const color = /FAIL|REFUSED/.test(line) ? COLORS.red : i === BOOT_LOG.length - 1 ? COLORS.green : /OK|COMPLETE/.test(line) ? '#3df2ff' : COLORS.paper;
      mono(ctx, line, 60, 70 + i * 26, { size: 16, color, align: 'left' });
    });
    if (frame % 8 < 4) mono(ctx, '█', 60, 70 + shown * 26, { size: 16, color: COLORS.paper, align: 'left' });
  } else {
    // 5. on again: the picture opening out of the line, a bar rolling down it, flickering
    const k = (age - 6000) / (it.life - 6000);
    const open = clamp(k * 1.7, 0, 1) ** 0.6;
    crt(ctx, img, w, h, Math.max(0.004, open), 1, (1 - open) * 0.8);
    const bar = ((age / 4) % (h + 200)) - 100;
    ctx.globalAlpha = 0.25 * (1 - k);
    ctx.fillStyle = '#e8fbff';
    ctx.fillRect(0, bar, w, 90);
    if (frame % 3 === 0 && k < 0.6) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 0.22 * (1 - k);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, y, w, 2);
    }
    if (k > 0.85 && img) {
      ctx.globalAlpha = (k - 0.85) / 0.15;
      cover(ctx, img);
    }
  }
  ctx.restore();
}
