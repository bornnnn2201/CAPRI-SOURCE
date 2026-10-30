// Her biochip's looks (chip.js): her shards the way Edgerunners draws them, lying on their side,
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

// Her face from the show, as on her sprite (assets/capri/capri-mask.png, set by app.js once loaded),
// for the chips that show only her eyes, and where things are on it in its pixels: her eyes' middles,
// how big the ring and iris are, and the turn that levels her eyes.
let FACE = null;
export function setChipFace(img) { FACE = img; }
const CHIP_FACE = { eyes: [[75, 116], [202.3, 87.9]], mid: [138.7, 102], ring: 21.5, iris: 14.8, pupil: 5, turn: 0.22, span: 38 };

// One of her eyes on the chip, as on her (sprite.js eye()), in the face's pixels: the show's socket
// and thin ring around it are the picture's own, and inside the ring her big blue iris and white
// pupil are drawn over its, turned `dir`; half shut, squeezed by her lids; shut, as she shuts them in
// the show: her mask's green over the whole socket, a black curved slash across it.
function chipEye(ctx, ex, ey, open, dir) {
  const F = CHIP_FACE;
  if (open < 0.15) {
    ctx.beginPath(); ctx.ellipse(ex, ey, F.ring + 13, F.ring + 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.green; ctx.fill();
    ctx.beginPath(); // the slash: thick in the middle, to a point at each end
    ctx.moveTo(ex - F.ring - 8, ey - 6);
    ctx.quadraticCurveTo(ex, ey + 22, ex + F.ring + 8, ey - 10);
    ctx.quadraticCurveTo(ex, ey + 6, ex - F.ring - 8, ey - 6);
    ctx.fillStyle = COLORS.ink; ctx.fill();
    return;
  }
  const disk = (dx, dy, rx, ry, color) => {
    ctx.beginPath(); ctx.ellipse(ex + dx, ey + dy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  };
  disk(0, 0, F.ring - 0.8, F.ring - 0.8, COLORS.ink); // inside her ring: the picture's own iris gone
  const shift = (F.ring - 1 - F.iris) * 0.9;
  disk(dir.x * shift, dir.y * shift, F.iris, F.iris * open, '#0f5cf5'); // her deep blue (sprite.js)
  disk(dir.x * (shift + 6), dir.y * (shift + 6), F.pupil, F.pupil * open, COLORS.paper);
}

// just her eyes, glowing out of the dark: her face from the show, its eyes level, the window around
// them; her vector mask until the picture's loaded
function eyesOnly(ctx, s, x, y, k) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 34 * k, y - 12 * k, 68 * k, 24 * k);
  ctx.clip();
  if (!FACE) {
    face(ctx, s, x, y, k);
    ctx.restore();
    return;
  }
  const F = CHIP_FACE;
  const f = (F.span * k) / Math.hypot(F.eyes[1][0] - F.eyes[0][0], F.eyes[1][1] - F.eyes[0][1]);
  const ox = x + s.glitch, oy = y + s.breath;
  const draw = () => {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(F.turn);
    ctx.scale(f, f);
    ctx.translate(-F.mid[0], -F.mid[1]);
    ctx.drawImage(FACE, 0, 0);
    F.eyes.forEach(([ex, ey], i) => {
      // where it looks: toward the pointer (s.look, the chip's own units), turned into the face's
      let dir = { x: 0, y: 0 };
      if (s.look) {
        const c = Math.cos(F.turn), sn = Math.sin(F.turn);
        const lx = (ex - F.mid[0]) * f, ly = (ey - F.mid[1]) * f;
        const at = { x: ox + lx * c - ly * sn, y: oy + lx * sn + ly * c };
        const dx = s.look.x - at.x, dy = s.look.y - at.y, d = Math.hypot(dx, dy) || 1;
        dir = { x: (dx / d) * c + (dy / d) * sn, y: -(dx / d) * sn + (dy / d) * c };
      }
      chipEye(ctx, ex, ey, s.eyes?.[i] ?? 1, dir);
    });
    ctx.restore();
  };
  if (s.glitch) { // torn sideways for a drawing: her colours pulled apart
    ctx.globalAlpha = 0.5;
    ctx.save(); ctx.translate(-3, 0); draw(); ctx.restore();
    ctx.save(); ctx.translate(3, 0); draw(); ctx.restore();
    ctx.globalAlpha = 1;
  }
  draw();
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
function hybridIn(ctx, s, P) {
  const shapes = [R.holder, R.bar, R.head];
  if (backing(ctx, shapes, s)) return;
  prongs(ctx, 203, [19, 27, 35, 43], 14, s, { fill: P.mid, lit: P.lit, dark: P.dark });
  // the body: black, its underside blacker; the head at the end in the trim's colour
  poly(ctx, R.holder); ctx.fillStyle = '#17141d'; ctx.fill();
  poly(ctx, R.bar); ctx.fillStyle = '#1d1924'; ctx.fill();
  poly(ctx, R.head); ctx.fillStyle = P.mid; ctx.fill();
  ctx.save();
  clipTo(ctx, shapes);
  ctx.fillStyle = '#0c0a10';
  ctx.fillRect(0, 46, 190, 12);
  ctx.fillStyle = P.dark; ctx.fillRect(188, 44, 18, 10);
  // silver trim: the lit top edges, the step plates, a thin red line in the notch (hers)
  ctx.fillStyle = P.lit;
  ctx.fillRect(4, 13.5, 58, 1.6); ctx.fillRect(64, 19.5, 86, 1.4); ctx.fillRect(154, 15.5, 22, 1.4); ctx.fillRect(189, 17.5, 12, 1.4);
  ctx.fillStyle = P.mid;
  ctx.fillRect(152, 15, 26, 7); ctx.fillRect(152, 47, 26, 6);
  ctx.fillStyle = P.lit; ctx.fillRect(152, 15, 26, 1.4);
  ctx.fillStyle = COLORS.red; ctx.fillRect(64, 47.5, 84, 1.2);
  ctx.restore();
  // the channel in a silver bezel: dark red glass, her glitter, silver traces with light running on them
  poly(ctx, box(66, 22, 122, 24)); ctx.fillStyle = P.mid; ctx.fill();
  ctx.fillStyle = P.lit; ctx.fillRect(66, 22, 122, 1.2);
  poly(ctx, R.channel);
  const g = ctx.createLinearGradient(0, 24, 0, 44);
  g.addColorStop(0, '#22060f'); g.addColorStop(0.5, s.mode === 'alert' && s.blink ? '#a3123f' : '#6e0f33'); g.addColorStop(1, '#1a040d');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, R.channel); ctx.clip();
  const glow = ctx.createLinearGradient(0, 24, 0, 44);
  glow.addColorStop(0, 'rgba(255, 40, 100, 0)'); glow.addColorStop(0.5, 'rgba(255, 60, 120, 0.45)'); glow.addColorStop(1, 'rgba(255, 40, 100, 0)');
  ctx.fillStyle = glow; ctx.fillRect(68, 24, 118, 20);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = P.trace;
  for (const t of HYBRID_TRACES) {
    ctx.beginPath(); t.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.fillStyle = P.lit; ctx.fillRect(t[0][0] - 1.3, t[0][1] - 1.3, 2.6, 2.6);
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
  poly(ctx, box(9, 18, 36, 26)); ctx.strokeStyle = P.mid; ctx.lineWidth = 1.4; ctx.stroke();
  for (const [x, y] of [[50, 18], [50, 48], [6, 50]]) {
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fillStyle = P.mid; ctx.fill();
    ctx.fillStyle = P.lit; ctx.fillRect(x - 1.2, y - 0.6, 2.4, 0.9);
  }
  label(ctx, 'CPRN', 10, 52, 6, P.text || P.mid);
  label(ctx, '02', 48, 31, 6, P.text || P.mid);
  led(ctx, s, 47, 37, 7, 4);
  outline(ctx, shapes);
}
const hybrid = (ctx, s) => hybridIn(ctx, s, { ...SILVER, trace: 'rgba(214, 218, 236, 0.7)' });
// ---------- 7. Blackout: the same shard all in black, no silver: gunmetal edges catching a little light,
// her red running along the traces ----------
const BLACKOUT = { lit: '#5a5368', mid: '#2b2733', dark: '#121016', trace: 'rgba(255, 70, 120, 0.75)', text: '#9b2e52' };
const blackout = (ctx, s) => hybridIn(ctx, s, BLACKOUT);

// ---------- 8. Blackwall circuit: Crimson circuit's shape in darker glass with the Blackwall moving in
// it (dark data falling down its columns, and now and then the wall surging up red through all of
// it), gold traces with solder pads and light running along them, a little chip of hers on the board,
// her glitter, her eyes in the black cap, and for an end a collar and a real edge connector ----------

const W = {
  cap: [[4, 14], [44, 14], [48, 18], [48, 50], [44, 54], [4, 54]],
  slab: [[46, 16], [164, 16], [170, 22], [170, 46], [164, 52], [46, 52]],
  collar: [[168, 19], [181, 19], [181, 49], [168, 49]],
  tongue: [[180, 23], [204, 23], [210, 28], [210, 40], [204, 45], [199, 45], [199, 41], [195, 41], [195, 45], [180, 45]],
};
const WALL_TRACES = [
  [[52, 24], [78, 24], [84, 30], [104, 30], [112, 22], [150, 22]], [[52, 45], [70, 45], [76, 39], [106, 39], [112, 45], [160, 45]],
  [[56, 34], [111, 34]], [[133, 30], [148, 30], [154, 25], [167, 25]], [[133, 36], [167, 36]], [[90, 45], [94, 50]],
  [[124, 39], [124, 48], [140, 48]], [[60, 28], [60, 40]],
];
const GOLD = { lit: '#ffe08a', mid: '#e0a83a', dark: '#8a5a12' };

// a point `d` along a trace (and how far it is in all)
function along(pts, d) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (d === undefined) return total;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (d <= len) return [x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len];
    d -= len;
  }
  return pts[pts.length - 1];
}

function trace(ctx, t, dx = 0) {
  ctx.beginPath(); t.forEach(([x, y], j) => (j ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y))); ctx.stroke();
}

function blackwallCircuit(ctx, s) {
  const shapes = [W.cap, W.slab, W.collar, W.tongue];
  if (backing(ctx, shapes, s)) return;
  const t = s.drift / 12; // seconds (0, still, with reduced motion)
  const asleep = s.mode === 'sleep';
  const alert = s.mode === 'alert' && s.blink;
  // the wall surging up through the board every nine seconds (always, alerted), for most of a second
  const ph = t % 9;
  const surge = alert ? 1 : !t || asleep ? 0 : ph < 0.15 ? ph / 0.15 : ph < 0.9 ? 1 - (ph - 0.15) / 0.75 : 0;

  // the slab: dark crimson glass, lit from inside
  poly(ctx, W.slab);
  const g = ctx.createLinearGradient(0, 16, 0, 52);
  g.addColorStop(0, alert ? '#ff3d6e' : '#c8153f'); g.addColorStop(0.55, '#7a0a28'); g.addColorStop(1, '#3a0414');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); poly(ctx, W.slab); ctx.clip();
  const glow = ctx.createLinearGradient(0, 16, 0, 52);
  glow.addColorStop(0, 'rgba(255, 60, 110, 0)'); glow.addColorStop(0.45, `rgba(255, 70, 120, ${asleep ? 0.12 : 0.32})`); glow.addColorStop(1, 'rgba(255, 60, 110, 0)');
  ctx.fillStyle = glow; ctx.fillRect(46, 16, 126, 36);
  // the Blackwall in it: dark data falling down its columns, a red head on some of them
  for (let c = 0; c < 21; c++) {
    const x = 48 + c * 6;
    const speed = 8 + hash(c, 7) * 22;
    for (let k = 0; k < 3; k++) {
      const y = 12 + ((t * speed + hash(c, k + 1) * 60 + k * 15) % 46);
      const h = 3 + hash(c, k + 4) * 6;
      ctx.fillStyle = `rgba(10, 0, 6, ${0.46 + 0.3 * surge})`;
      ctx.fillRect(x, y, 4, h);
      if (k === 0 && hash(c, Math.floor(t * 3)) > 0.78) {
        ctx.fillStyle = `rgba(255, 50, 100, ${asleep ? 0.2 : 0.55})`;
        ctx.fillRect(x, y + h, 4, 1.6);
      }
    }
  }
  // her glitter, drifting through it
  glitter(ctx, s, 48, 18, 120, 32, { n: asleep ? 40 : 90, spread: 0.6 });
  // a little chip of hers on the board: black, gold legs, its own light
  ctx.fillStyle = '#0e0a12'; ctx.fillRect(112, 27, 20, 14);
  ctx.fillStyle = GOLD.mid;
  for (let i = 0; i < 4; i++) { ctx.fillRect(114 + i * 5, 25, 2, 2); ctx.fillRect(114 + i * 5, 41, 2, 2); }
  ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(112, 27, 20, 14);
  ctx.fillStyle = '#2a2236'; ctx.fillRect(113, 28, 18, 1.2);
  ctx.fillStyle = Math.floor(t * 2) % 2 && !asleep ? COLORS.red : '#4a1a2a'; ctx.fillRect(127, 37, 2.5, 2);
  label(ctx, 'BW', 115, 37, 5, '#6d6480');
  // gold traces: solder pads at their ends, a via here and there, offset in red and cyan when she glitches
  ctx.lineWidth = 1.4;
  if (s.glitch) {
    ctx.strokeStyle = 'rgba(255, 60, 110, 0.6)'; WALL_TRACES.forEach((tr) => trace(ctx, tr, s.glitch));
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.5)'; WALL_TRACES.forEach((tr) => trace(ctx, tr, -s.glitch));
  }
  ctx.strokeStyle = GOLD.mid;
  WALL_TRACES.forEach((tr) => trace(ctx, tr));
  ctx.strokeStyle = 'rgba(255, 224, 138, 0.55)'; ctx.lineWidth = 0.6;
  WALL_TRACES.forEach((tr) => trace(ctx, tr.map(([x, y]) => [x, y - 0.6])));
  for (const tr of WALL_TRACES) {
    for (const [x, y] of [tr[0], tr[tr.length - 1]]) {
      ctx.beginPath(); ctx.arc(x, y, 1.9, 0, Math.PI * 2); ctx.fillStyle = GOLD.mid; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI * 2); ctx.fillStyle = '#3a0414'; ctx.fill();
    }
  }
  // light running along them, a short trail behind each spark (faster and violet while she works)
  if (t && !asleep) {
    const fast = s.mode === 'work' ? 2.2 : 1;
    WALL_TRACES.forEach((tr, i) => {
      const len = along(tr);
      const d = ((t * 38 * fast + i * 31) % (len + 50)) - 20;
      for (let k = 0; k < 4; k++) {
        const dd = d - k * 3;
        if (dd < 0 || dd > len) continue;
        const [x, y] = along(tr, dd);
        ctx.fillStyle = k ? `rgba(255, 236, 180, ${0.55 - k * 0.13})` : s.mode === 'work' ? '#c9a8ff' : '#fff6d8';
        ctx.fillRect(x - 1.3, y - 1.3, k ? 2 : 2.8, k ? 2 : 2.8);
      }
    });
  }
  // the surge: the board gone dark, the wall's red cracks through it, flickering
  if (surge > 0) {
    ctx.fillStyle = `rgba(6, 0, 3, ${0.55 * surge})`; ctx.fillRect(46, 16, 126, 36);
    ctx.strokeStyle = `rgba(255, 40, 90, ${surge})`; ctx.lineWidth = 1.2;
    const seed = Math.floor(t * 14);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      let y = 20 + hash(seed, k) * 28;
      ctx.moveTo(46, y);
      for (let x = 52; x <= 172; x += 8) {
        y = Math.max(18, Math.min(50, y + (hash(seed + x, k) - 0.5) * 12));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 90, 140, ${0.5 * surge})`;
    for (let k = 0; k < 10; k++) ctx.fillRect(48 + hash(seed, k + 9) * 118, 18 + hash(seed, k + 19) * 30, 3, 1.4);
  }
  glass(ctx, s, 46, 16, 126, 36);
  ctx.restore();

  // the end: a black collar with a slit of her red light, then the edge connector, gold fingers on it
  poly(ctx, W.collar); ctx.fillStyle = '#141018'; ctx.fill();
  ctx.fillStyle = '#2e2838'; ctx.fillRect(168, 19.5, 13, 1.4);
  ctx.fillStyle = '#08060a'; ctx.fillRect(168, 45, 13, 4);
  const pulse = asleep ? 0.25 : 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2)) + surge * 0.4;
  ctx.fillStyle = `rgba(255, 33, 82, ${Math.min(1, pulse)})`; ctx.fillRect(173.5, 23, 2.4, 22);
  ctx.fillStyle = `rgba(255, 200, 215, ${Math.min(0.8, pulse * 0.6)})`; ctx.fillRect(174.2, 23, 1, 22);
  poly(ctx, W.tongue); ctx.fillStyle = '#1c0c14'; ctx.fill();
  ctx.save(); poly(ctx, W.tongue); ctx.clip();
  ctx.fillStyle = '#2c1420'; ctx.fillRect(180, 23, 32, 2);
  for (let i = 0; i < 6; i++) {
    const x = 183 + i * 4.2;
    if (x + 2.6 > 195 && x < 199) continue; // the key notch
    ctx.fillStyle = s.glint === i % 5 ? COLORS.paper : GOLD.mid; ctx.fillRect(x, 25.5, 2.6, 15);
    ctx.fillStyle = GOLD.lit; ctx.fillRect(x, 25.5, 2.6, 1.4);
    ctx.fillStyle = GOLD.dark; ctx.fillRect(x, 39, 2.6, 1.5);
  }
  ctx.restore();

  // the black cap: her eyes glowing out of it, gold screws, her name
  poly(ctx, W.cap); ctx.fillStyle = '#0f0b14'; ctx.fill();
  ctx.fillStyle = '#2a2236'; ctx.fillRect(6, 15.5, 36, 1.8);
  poly(ctx, box(9, 19, 34, 24)); ctx.fillStyle = '#060408'; ctx.fill();
  ctx.save(); poly(ctx, box(9, 19, 34, 24)); ctx.clip();
  eyesOnly(ctx, s, 26, 31, 0.42);
  ctx.restore();
  poly(ctx, box(9, 19, 34, 24)); ctx.strokeStyle = surge > 0.3 ? COLORS.red : '#3a2c46'; ctx.lineWidth = 1.2; ctx.stroke();
  for (const [x, y] of [[7, 17], [41, 51]]) {
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fillStyle = GOLD.mid; ctx.fill();
    ctx.fillStyle = GOLD.lit; ctx.fillRect(x - 1, y - 0.6, 2, 0.8);
  }
  led(ctx, s, 9, 46, 6, 3);
  label(ctx, 'CPRN', 18, 50.5, 5, GOLD.dark);
  outline(ctx, shapes);
}

export const DESIGNS = [
  { id: 'wall', name: 'Blackwall circuit', draw: blackwallCircuit, face: { x: 26, y: 31 } },
  { id: 'blackout', name: 'Blackout', draw: blackout, face: { x: 27, y: 31 } },
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
