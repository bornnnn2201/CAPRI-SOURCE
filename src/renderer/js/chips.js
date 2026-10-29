// Her biochip's looks (chip.js): five shards the way Edgerunners draws them, lying on their side,
// each hers. Flat cel tones, ink lines, hard glints, her violet misregistration behind, and her face
// (her mask, its eyes) on every one. Design px, CHIP_SIZE wide and high; the prongs point right.
//
//   draw(ctx, s)   s: what changes from drawing to drawing (chip.js Chip.state): eyes, look, bob,
//                  shake, glint, blink, ledOn, scan, breath, glitch, drift, twinkle, mode, flat

import { COLORS, drawMask } from './fx.js';

export const CHIP_SIZE = { w: 224, h: 68 };
const LED = { idle: COLORS.green, work: COLORS.violet, alert: COLORS.red, sleep: '#3a3346' };
const INK = COLORS.ink;

// a number from 0 to 1 that's always the same for the same (i, j)
const hash = (i, j = 0) => {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function poly(ctx, pts, dx = 0, dy = 0) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
  ctx.closePath();
}
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// drawing kept inside all of these shapes at once
function clipTo(ctx, shapes) {
  ctx.beginPath();
  for (const sh of shapes) {
    sh.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
  ctx.clip();
}

// her violet copy behind the outline (or, flat, her white impact frame): true if that's all to draw
function backing(ctx, shapes, s) {
  ctx.fillStyle = s.flat || COLORS.violet;
  for (const sh of shapes) { poly(ctx, sh, -2.4, 2); ctx.fill(); }
  if (!s.flat) return false;
  for (const sh of shapes) { poly(ctx, sh); ctx.fill(); }
  return true;
}

function outline(ctx, shapes, width = 2.2) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  for (const sh of shapes) { poly(ctx, sh); ctx.stroke(); }
}

// connector prongs off the right end: lit top edge, shadowed underside, a glint running across
function prongs(ctx, x, ys, len, s, { fill = '#9da0b8', lit = '#e6e8f6', dark = '#4c4a5e' } = {}) {
  ys.forEach((y, i) => {
    ctx.fillStyle = s.glint === i ? COLORS.paper : fill;
    ctx.fillRect(x, y, len, 4.4);
    ctx.fillStyle = lit; ctx.fillRect(x, y, len, 1.3);
    ctx.fillStyle = dark; ctx.fillRect(x, y + 3.2, len, 1.2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.strokeRect(x, y, len, 4.4);
  });
}

// glitter drifting along the glass (toward the prongs), dense along the middle like the show's
function glitter(ctx, s, x0, y0, w, h, { n = 120, colors = ['#ff8fb0', '#ff3d6e', '#ffd0de'], spread = 0.5 } = {}) {
  for (let i = 0; i < n; i++) {
    const speed = 0.5 + hash(i, 1) * 1.2;
    const x = x0 + ((hash(i, 2) * w + s.drift * speed) % w);
    const off = (hash(i, 3) + hash(i, 13) + hash(i, 23)) / 3 - 0.5; // bunched toward the middle
    const y = y0 + h / 2 + off * h * 2 * spread;
    const bright = hash(i, s.twinkle) > 0.86;
    ctx.fillStyle = bright ? COLORS.paper : colors[i % colors.length];
    const r = bright ? 1.5 : 0.6 + hash(i, 5) * 0.9;
    ctx.fillRect(x, y, r, r);
  }
}

// the glass's hard glare and the light running across it
function glass(ctx, s, x, y, w, h) {
  ctx.fillStyle = 'rgba(255, 244, 246, 0.2)';
  ctx.beginPath(); ctx.moveTo(x + w * 0.12, y); ctx.lineTo(x + w * 0.2, y); ctx.lineTo(x + w * 0.12, y + h); ctx.lineTo(x + w * 0.04, y + h); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + w * 0.24, y); ctx.lineTo(x + w * 0.26, y); ctx.lineTo(x + w * 0.18, y + h); ctx.lineTo(x + w * 0.16, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255, 244, 246, 0.5)';
  ctx.fillRect(x + 2, y + 1.5, w * 0.5, 1);
  if (s.scan >= 0) {
    const sx = x + s.scan * w;
    ctx.fillStyle = 'rgba(255, 244, 246, 0.16)'; ctx.fillRect(sx - 10, y, 11, h);
    ctx.fillStyle = 'rgba(255, 244, 246, 0.6)'; ctx.fillRect(sx, y, 1, h);
  }
}

// her face: the mask with its eyes, torn sideways for a drawing when she glitches
function face(ctx, s, x, y, k, spike = true) {
  if (s.glitch) {
    ctx.globalAlpha = 0.7;
    drawMask(ctx, x - 3, y + s.breath, k, { flat: COLORS.paper, spike });
    drawMask(ctx, x + 3, y + s.breath, k, { flat: COLORS.blue, spike });
    ctx.globalAlpha = 1;
  }
  drawMask(ctx, x + s.glitch, y + s.breath, k, { eyes: s.eyes, look: s.look, spike });
}

// just her eyes, glowing out of the dark (the mask's own eyes, the rest of it left in shadow)
function eyesOnly(ctx, s, x, y, k) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 34 * k, y - 12 * k, 68 * k, 24 * k);
  ctx.clip();
  face(ctx, s, x, y, k);
  ctx.restore();
}

function led(ctx, s, x, y, w = 5, h = 5) {
  ctx.fillStyle = s.ledOn ? LED[s.mode] || LED.idle : '#3a3346';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
}

function label(ctx, text, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px "Share Tech Mono", Consolas, monospace`;
  ctx.fillText(text, x, y);
}

function barcode(ctx, x, y, h, n, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x + i * 2.2, y, i % 3 ? 0.9 : 1.6, h);
}

// ---------- 1. Relic: the photo's shard. Silver frame, a clear channel down its length with her
// pink glitter streaming through it, a holder block on the left with her face set in it ----------

const R = {
  holder: [[6, 12], [62, 12], [66, 16], [66, 52], [62, 56], [6, 56], [2, 52], [2, 16]],
  bar: [[62, 18], [150, 18], [154, 14], [176, 14], [180, 18], [190, 18], [190, 50], [180, 50], [176, 54], [154, 54], [150, 50], [62, 50]],
  head: [[188, 16], [200, 16], [204, 20], [204, 48], [200, 52], [188, 52]],
  channel: [[68, 24], [186, 24], [186, 44], [68, 44]],
};
function relic(ctx, s) {
  const shapes = [R.holder, R.bar, R.head];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 203, [20, 28, 36, 44].map((y) => y - 1), 14, s);
  // the frame: silver, lit along its top, shadowed underneath
  for (const sh of shapes) { poly(ctx, sh); ctx.fillStyle = '#a7aac0'; ctx.fill(); }
  ctx.save();
  clipTo(ctx, shapes);
  ctx.fillStyle = '#6c6e86';
  ctx.fillRect(62, 44, 128, 12); ctx.fillRect(0, 46, 66, 12); ctx.fillRect(188, 44, 18, 10);
  ctx.fillStyle = '#e6e8f6';
  ctx.fillRect(4, 13.5, 58, 1.6); ctx.fillRect(64, 19.5, 86, 1.4); ctx.fillRect(154, 15.5, 22, 1.4);
  ctx.restore();
  // the channel: dark pink glass, her glitter streaming through it
  poly(ctx, R.channel);
  const g = ctx.createLinearGradient(0, 24, 0, 44);
  g.addColorStop(0, '#4a1030'); g.addColorStop(0.5, s.mode === 'alert' && s.blink ? '#c2185b' : '#8c1446'); g.addColorStop(1, '#3a0b26');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, R.channel); ctx.clip();
  const glow = ctx.createLinearGradient(0, 24, 0, 44);
  glow.addColorStop(0, 'rgba(255, 60, 130, 0)'); glow.addColorStop(0.5, 'rgba(255, 90, 160, 0.55)'); glow.addColorStop(1, 'rgba(255, 60, 130, 0)');
  ctx.fillStyle = glow; ctx.fillRect(68, 24, 118, 20);
  glitter(ctx, s, 68, 24, 118, 20, { n: 150, spread: 0.45 });
  glass(ctx, s, 68, 24, 118, 20);
  ctx.restore();
  poly(ctx, R.channel); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  // the holder: a dark recess with her face in it, an engraving under the clip
  poly(ctx, box(10, 18, 34, 32)); ctx.fillStyle = '#16121e'; ctx.fill();
  ctx.save(); poly(ctx, box(10, 18, 34, 32)); ctx.clip();
  face(ctx, s, 27, 40, 0.3);
  ctx.restore();
  poly(ctx, box(10, 18, 34, 32)); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
  label(ctx, 'PST', 47, 26, 6, '#3b3a4c');
  label(ctx, 'CPRN', 47, 33, 6, '#3b3a4c');
  label(ctx, '02', 47, 40, 6, '#3b3a4c');
  led(ctx, s, 48, 44, 8, 4);
  outline(ctx, shapes);
}

// ---------- 2. Crimson circuit: a red translucent slab with gold traces, gold prongs, and a black
// end cap on the left where only her eyes glow ----------

const C = {
  cap: [[4, 14], [44, 14], [48, 18], [48, 50], [44, 54], [4, 54]],
  slab: [[46, 16], [176, 16], [182, 22], [196, 22], [196, 46], [182, 46], [176, 52], [46, 52]],
};
const TRACES = [
  [[52, 24], [80, 24], [86, 30], [120, 30], [126, 24], [150, 24]], [[52, 44], [70, 44], [76, 38], [110, 38], [116, 44], [168, 44]],
  [[60, 34], [96, 34]], [[132, 34], [176, 34], [182, 28], [194, 28]], [[140, 24], [146, 18]], [[90, 44], [94, 50]], [[156, 40], [190, 40]],
];
function crimson(ctx, s) {
  const shapes = [C.cap, C.slab];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 195, [24, 31, 38], 15, s, { fill: '#e0a83a', lit: '#ffe08a', dark: '#8a5a12' });
  poly(ctx, C.slab);
  const g = ctx.createLinearGradient(0, 16, 0, 52);
  g.addColorStop(0, s.mode === 'alert' && s.blink ? '#ff5a80' : '#ff2152'); g.addColorStop(1, '#8e0c32');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, C.slab); ctx.clip();
  // gold traces, with a pulse of light running along them
  ctx.lineWidth = 1.4;
  TRACES.forEach((t, i) => {
    ctx.beginPath(); t.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = '#ffc847'; ctx.stroke();
    const [x0, y0] = t[0];
    ctx.fillStyle = '#ffc847'; ctx.fillRect(x0 - 1.5, y0 - 1.5, 3, 3);
  });
  const px = 46 + ((s.drift * 2) % 150);
  ctx.fillStyle = 'rgba(255, 244, 200, 0.8)';
  ctx.fillRect(px, 23, 6, 2); ctx.fillRect(px - 30, 43, 6, 2); ctx.fillRect(px - 60, 33, 5, 2);
  glass(ctx, s, 46, 16, 150, 36);
  ctx.restore();
  // the black cap: her eyes, glowing green
  poly(ctx, C.cap); ctx.fillStyle = '#100c16'; ctx.fill();
  ctx.fillStyle = '#2a2236'; ctx.fillRect(6, 15.5, 36, 2);
  eyesOnly(ctx, s, 26, 34, 0.42);
  led(ctx, s, 8, 47, 6, 3);
  label(ctx, 'CPRN', 24, 51, 5, '#6d6480');
  outline(ctx, shapes);
}

// ---------- 3. Teal glitter: the show's cyan-framed shard, pink glitter behind glass, her mask
// floating in the middle of it ----------

const T = {
  body: [[4, 18], [20, 18], [24, 12], [60, 12], [64, 18], [172, 18], [176, 14], [196, 14], [200, 18], [200, 50], [196, 54], [176, 54], [172, 50], [64, 50], [60, 56], [24, 56], [20, 50], [4, 50]],
  glass: [[30, 22], [168, 22], [172, 26], [172, 42], [168, 46], [30, 46], [26, 42], [26, 26]],
};
function teal(ctx, s) {
  const shapes = [T.body];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 199, [20, 28, 36, 44].map((y) => y - 1), 13, s, { fill: '#7fd8d2', lit: '#d8fffb', dark: '#2a7f86' });
  poly(ctx, T.body); ctx.fillStyle = '#3cc5c4'; ctx.fill();
  ctx.save(); poly(ctx, T.body); ctx.clip();
  ctx.fillStyle = '#1f8c95'; ctx.fillRect(0, 42, 224, 20);
  ctx.fillStyle = '#c6fffb'; ctx.fillRect(4, 19.5, 200, 1.4); ctx.fillRect(24, 13.5, 36, 1.4);
  ctx.fillStyle = COLORS.red; ctx.fillRect(176, 47, 20, 3); ctx.fillRect(8, 47, 10, 3);
  ctx.restore();
  poly(ctx, T.glass); ctx.fillStyle = '#3a0f2c'; ctx.fill();
  ctx.save(); poly(ctx, T.glass); ctx.clip();
  const glow = ctx.createRadialGradient(99, 34, 4, 99, 34, 70);
  glow.addColorStop(0, s.mode === 'alert' && s.blink ? 'rgba(255, 40, 90, 0.75)' : 'rgba(255, 70, 150, 0.6)'); glow.addColorStop(1, 'rgba(255, 70, 150, 0.05)');
  ctx.fillStyle = glow; ctx.fillRect(26, 22, 146, 24);
  glitter(ctx, s, 26, 22, 146, 24, { n: 140, spread: 0.8, colors: ['#ff9ac0', '#ff5c9a', '#ffe0ea', '#9fe8ff'] });
  face(ctx, s, 99, 31, 0.3, false);
  glass(ctx, s, 26, 22, 146, 24);
  ctx.restore();
  poly(ctx, T.glass); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  led(ctx, s, 10, 26, 5, 5);
  label(ctx, 'C', 9, 42, 8, '#13484d');
  outline(ctx, shapes);
}

// ---------- 4. Black label: matte black, a red translucent half full of circuitry, and a white
// printed label with her name in big type and her mask as a sticker ----------

const B = {
  body: [[4, 14], [180, 14], [186, 20], [196, 20], [196, 48], [186, 48], [180, 54], [4, 54]],
  red: [[8, 18], [92, 18], [92, 50], [8, 50]],
  sticker: [[98, 18], [176, 18], [176, 50], [98, 50]],
};
function blackLabel(ctx, s) {
  const shapes = [B.body];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 195, [24, 31, 38], 14, s);
  poly(ctx, B.body); ctx.fillStyle = '#16131c'; ctx.fill();
  ctx.fillStyle = '#2b2634'; ctx.fillRect(6, 15.5, 172, 1.6);
  // the red half: translucent, with circuit blocks under it
  poly(ctx, B.red);
  ctx.fillStyle = s.mode === 'alert' && s.blink ? '#ff3a66' : '#e0123f'; ctx.fill();
  ctx.save(); poly(ctx, B.red); ctx.clip();
  ctx.fillStyle = 'rgba(80, 0, 20, 0.45)';
  for (let i = 0; i < 9; i++) ctx.fillRect(12 + (i % 3) * 26, 21 + Math.floor(i / 3) * 10, 18 + hash(i, 4) * 6, 5);
  ctx.strokeStyle = 'rgba(255, 190, 205, 0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(10, 30); ctx.lineTo(40, 30); ctx.lineTo(46, 36); ctx.lineTo(90, 36); ctx.stroke();
  glitter(ctx, s, 8, 18, 84, 32, { n: 40, spread: 0.9, colors: ['#ffb3c4', '#ff6e8e'] });
  glass(ctx, s, 8, 18, 84, 32);
  ctx.restore();
  poly(ctx, B.red); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
  // the white label: her name, a barcode, her mask as a sticker
  poly(ctx, B.sticker); ctx.fillStyle = '#f1eef4'; ctx.fill();
  ctx.fillStyle = '#d8d3e0'; ctx.fillRect(98, 44, 78, 6);
  label(ctx, 'CAPRI', 102, 31, 11, INK);
  label(ctx, 'PROJECT CAPRICORN', 102, 38, 4.5, '#4b4558');
  barcode(ctx, 102, 41, 6, 12, INK);
  ctx.save(); poly(ctx, box(146, 19, 29, 30)); ctx.clip();
  face(ctx, s, 160, 31, 0.3, false);
  ctx.restore();
  poly(ctx, B.sticker); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  led(ctx, s, 182, 30, 4, 8);
  outline(ctx, shapes);
}

// ---------- 5. Industrial: bare white metal with hazard stripes on one end, a red-orange crystal
// grown through the other, her mask stamped where they meet ----------

const I = {
  metal: [[4, 14], [96, 14], [96, 54], [10, 54], [4, 48]],
  crystal: [[94, 16], [178, 16], [184, 22], [196, 22], [196, 46], [184, 46], [178, 52], [94, 52]],
};
function industrial(ctx, s) {
  const shapes = [I.metal, I.crystal];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 195, [25, 32, 39], 13, s, { fill: '#c9cbd8', lit: '#ffffff', dark: '#6e7084' });
  // the crystal: hex cells lighting up and going dark
  poly(ctx, I.crystal);
  const g = ctx.createLinearGradient(94, 0, 196, 0);
  g.addColorStop(0, '#ff3b2f'); g.addColorStop(1, s.mode === 'alert' && s.blink ? '#ff2152' : '#ff7a2a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, I.crystal); ctx.clip();
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 9; col++) {
      const cx = 100 + col * 11 + (row % 2) * 5.5, cy = 20 + row * 9.5;
      const on = hash(col * 7 + row, s.twinkle) > 0.75;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const x = cx + Math.cos(a) * 5, y = cy + Math.sin(a) * 5;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = on ? 'rgba(255, 230, 180, 0.75)' : 'rgba(120, 20, 10, 0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 10, 0, 0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
  glass(ctx, s, 94, 16, 102, 36);
  ctx.restore();
  // the metal: white, its shadow side, hazard stripes, rivets, her mask stamped on
  poly(ctx, I.metal); ctx.fillStyle = '#e8e8f0'; ctx.fill();
  ctx.save(); poly(ctx, I.metal); ctx.clip();
  ctx.fillStyle = '#b9b9c9'; ctx.fillRect(0, 44, 100, 12);
  ctx.fillStyle = INK;
  for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(4 + i * 8, 54); ctx.lineTo(8 + i * 8, 54); ctx.lineTo(16 + i * 8, 44); ctx.lineTo(12 + i * 8, 44); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = '#ffcc33';
  for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 8, 54); ctx.lineTo(12 + i * 8, 54); ctx.lineTo(20 + i * 8, 44); ctx.lineTo(16 + i * 8, 44); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(6, 15.5, 88, 1.4);
  for (const [x, y] of [[9, 19], [89, 19], [89, 40]]) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = '#8c8ca0'; ctx.fill(); }
  ctx.save(); poly(ctx, box(16, 16, 34, 28)); ctx.clip();
  face(ctx, s, 33, 35, 0.27);
  ctx.restore();
  label(ctx, 'CAPRICORN', 54, 25, 6, INK);
  label(ctx, 'UNIT 02', 54, 32, 5, '#5b5b70');
  barcode(ctx, 54, 34, 7, 10, INK);
  led(ctx, s, 84, 34, 5, 5);
  outline(ctx, shapes);
}

// ---------- 6. Black & silver: the Relic's shape and its glitter channel, Crimson circuit's traces
// (in silver, light running along them) and its black cap with only her eyes on it ----------

const SILVER = { lit: '#eceef8', mid: '#a9acc2', dark: '#5e6075' };
const HYBRID_TRACES = [
  [[70, 28], [96, 28], [101, 32], [128, 32], [133, 27], [160, 27]], [[70, 40], [88, 40], [93, 36], [118, 36], [123, 40], [182, 40]],
  [[140, 33], [166, 33], [171, 29], [184, 29]], [[108, 28], [112, 25]],
];
function hybrid(ctx, s) {
  const shapes = [R.holder, R.bar, R.head];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 203, [19, 27, 35, 43], 14, s, { fill: SILVER.mid, lit: SILVER.lit, dark: SILVER.dark });
  // the body: black, its underside blacker; the head at the end in silver
  poly(ctx, R.holder); ctx.fillStyle = '#17141d'; ctx.fill();
  poly(ctx, R.bar); ctx.fillStyle = '#1d1924'; ctx.fill();
  poly(ctx, R.head); ctx.fillStyle = SILVER.mid; ctx.fill();
  ctx.save();
  clipTo(ctx, shapes);
  ctx.fillStyle = '#0c0a10';
  ctx.fillRect(0, 46, 190, 12);
  ctx.fillStyle = SILVER.dark; ctx.fillRect(188, 44, 18, 10);
  // silver trim: the lit top edges, the step plates, a thin red line in the notch (hers)
  ctx.fillStyle = SILVER.lit;
  ctx.fillRect(4, 13.5, 58, 1.6); ctx.fillRect(64, 19.5, 86, 1.4); ctx.fillRect(154, 15.5, 22, 1.4); ctx.fillRect(189, 17.5, 12, 1.4);
  ctx.fillStyle = SILVER.mid;
  ctx.fillRect(152, 15, 26, 7); ctx.fillRect(152, 47, 26, 6);
  ctx.fillStyle = SILVER.lit; ctx.fillRect(152, 15, 26, 1.4);
  ctx.fillStyle = COLORS.red; ctx.fillRect(64, 47.5, 84, 1.2);
  ctx.restore();
  // the channel in a silver bezel: dark red glass, her glitter, silver traces with light running on them
  poly(ctx, box(66, 22, 122, 24)); ctx.fillStyle = SILVER.mid; ctx.fill();
  ctx.fillStyle = SILVER.lit; ctx.fillRect(66, 22, 122, 1.2);
  poly(ctx, R.channel);
  const g = ctx.createLinearGradient(0, 24, 0, 44);
  g.addColorStop(0, '#22060f'); g.addColorStop(0.5, s.mode === 'alert' && s.blink ? '#a3123f' : '#6e0f33'); g.addColorStop(1, '#1a040d');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, R.channel); ctx.clip();
  const glow = ctx.createLinearGradient(0, 24, 0, 44);
  glow.addColorStop(0, 'rgba(255, 40, 100, 0)'); glow.addColorStop(0.5, 'rgba(255, 60, 120, 0.45)'); glow.addColorStop(1, 'rgba(255, 40, 100, 0)');
  ctx.fillStyle = glow; ctx.fillRect(68, 24, 118, 20);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(214, 218, 236, 0.7)';
  for (const t of HYBRID_TRACES) {
    ctx.beginPath(); t.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.fillStyle = SILVER.lit; ctx.fillRect(t[0][0] - 1.3, t[0][1] - 1.3, 2.6, 2.6);
  }
  const px = 68 + ((s.drift * 2) % 118);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(px, 27, 5, 1.6); ctx.fillRect(68 + ((s.drift * 2 + 60) % 118), 39.4, 5, 1.6);
  glitter(ctx, s, 68, 24, 118, 20, { n: 130, spread: 0.45 });
  glass(ctx, s, 68, 24, 118, 20);
  ctx.restore();
  poly(ctx, R.channel); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
  // the cap: a black window with only her eyes in it, silver screws, the engraving, her light
  poly(ctx, box(9, 18, 36, 26)); ctx.fillStyle = '#07060a'; ctx.fill();
  ctx.save(); poly(ctx, box(9, 18, 36, 26)); ctx.clip();
  eyesOnly(ctx, s, 27, 31, 0.45);
  ctx.restore();
  poly(ctx, box(9, 18, 36, 26)); ctx.strokeStyle = SILVER.mid; ctx.lineWidth = 1.4; ctx.stroke();
  for (const [x, y] of [[50, 18], [50, 48], [6, 50]]) {
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fillStyle = SILVER.mid; ctx.fill();
    ctx.fillStyle = SILVER.lit; ctx.fillRect(x - 1.2, y - 0.6, 2.4, 0.9);
  }
  label(ctx, 'CPRN', 10, 52, 6, SILVER.mid);
  label(ctx, '02', 48, 31, 6, SILVER.mid);
  led(ctx, s, 47, 37, 7, 4);
  outline(ctx, shapes);
}

export const DESIGNS = [
  { id: 'hybrid', name: 'Black & silver', draw: hybrid, face: { x: 27, y: 31 } },
  { id: 'relic', name: 'Relic', draw: relic, face: { x: 27, y: 34 } },
  { id: 'crimson', name: 'Crimson circuit', draw: crimson, face: { x: 26, y: 34 } },
  { id: 'teal', name: 'Teal glitter', draw: teal, face: { x: 99, y: 34 } },
  { id: 'label', name: 'Black label', draw: blackLabel, face: { x: 160, y: 34 } },
  { id: 'industrial', name: 'Industrial', draw: industrial, face: { x: 33, y: 30 } },
];

// One drawing of the chip in the look picked (`id`, else the first), bobbing and twitching as told.
export function drawChip(ctx, id, s) {
  const design = DESIGNS.find((d) => d.id === id) || DESIGNS[0];
  ctx.save();
  ctx.translate(s.shake, s.bob);
  ctx.lineJoin = 'miter';
  design.draw(ctx, s);
  ctx.restore();
}
