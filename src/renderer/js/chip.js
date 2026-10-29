// Her two small forms, each on its own little canvas, drawn on twos and only while on screen.
//
// Mask: asleep a while, her mane and her body come apart and what's left is what she is at
// heart in the show, her green mask with its eyes, floating where she was, eyes shut. Now and
// then she cracks one open (her wink). A pointer coming over it stirs her (app.js wakes her).
//
// Chip: put away (Ctrl+Alt+C), she folds herself into her biochip (the one she's stored on in
// the show) and all that shows of her is her mask in the bottom-left corner, eyes shut. They
// open, blinking, while Claude is waiting on you. Click it and she comes back out (app.js).

import { COLORS, drawMask } from './fx.js';
import { CHIP_SIZE, DESIGNS, drawChip } from './chips.js';
import { rand, reducedMotion } from './util.js';

const STEP = 1000 / 12;

// A small canvas of its own, w x h css px, placed by its top-left corner.
class Small {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.visible = false;
    this.pointer = null; // set while the pointer is over it
    this.shownAt = 0;
    this.last = 0;
    this.x = 0;
    this.y = 0;
    this.loop = this.loop.bind(this);
  }

  moveTo(x, y) {
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(this.w * dpr)) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
    }
    this.x = x;
    this.y = y;
    this.canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  contains(x, y, pad = 8) {
    return x >= this.x - pad && x <= this.x + this.w + pad && y >= this.y - pad && y <= this.y + this.h + pad;
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.canvas.hidden = false;
    this.shownAt = performance.now();
    requestAnimationFrame(this.loop);
  }

  hide() {
    this.visible = false;
    this.canvas.hidden = true;
    this.pointer = null;
  }

  loop(now) {
    if (!this.visible) return;
    requestAnimationFrame(this.loop);
    if (now - this.last < STEP - 1) return;
    this.last = now;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.draw(now, Math.floor(now / STEP));
  }

  // it lands as a white silhouette, one drawing, like her impact frames
  get landing() {
    return performance.now() - this.shownAt < STEP * 1.5 && !reducedMotion.matches;
  }
}

// ---------- her mask, asleep ----------

export class Mask extends Small {
  constructor(canvas) {
    super(canvas, 140, 170);
    this.k = 0.66;
    this.wokeAt = 0;
    this.nextPeek = 0;
    this.peek = null; // { eye, until }
  }

  // Floating with the middle of her face at (x, y), k = how big (her size on screen).
  place(x, y, k) {
    this.k = k;
    this.cx = 70;
    this.cy = 110;
    this.moveTo(x - this.cx, y - this.cy);
  }

  show() {
    this.wokeAt = 0;
    this.nextPeek = performance.now() + rand(5000, 9000);
    super.show();
  }

  // eyes snap open: she's coming back
  wake() {
    this.wokeAt = performance.now();
  }

  draw(now, frame) {
    const { ctx } = this;
    const calm = reducedMotion.matches;
    const bob = calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4]; // a slow float, on twos
    if (this.landing) {
      drawMask(ctx, this.cx, this.cy, this.k, { flat: COLORS.paper });
      return;
    }
    let eyes = [0, 0], look = null;
    if (now > this.nextPeek && !this.peek) {
      this.peek = { eye: Math.random() < 0.5 ? 0 : 1, until: now + rand(700, 1100) };
      this.nextPeek = now + rand(7000, 14000);
    }
    if (this.peek) {
      if (now > this.peek.until) this.peek = null;
      else eyes[this.peek.eye] = 0.45; // one eye cracked open, the wink
    }
    if (this.pointer) {
      eyes = [0.35, 0.35]; // stirring
      look = { x: this.pointer.x - this.x, y: this.pointer.y - this.y };
    }
    if (this.wokeAt) {
      eyes = [1, 1];
      look = null;
    }
    const shake = this.wokeAt && !calm ? rand(-2, 2) : 0;
    drawMask(ctx, this.cx + shake, this.cy + bob, this.k, { eyes, look });
  }
}

// ---------- put away ----------

// bottom-left: the bottom-right corner is where the clock and the tray are, the pointer goes there all the time
const MARGIN = { left: 22, bottom: 14 };
const K = 1.25; // how big it shows, of its design size (chips.js CHIP_SIZE): 280 x 85 px

// Put away (Ctrl+Alt+C): her shard in the bottom-left corner, on its side, her face on it (the look
// her menu's config picks: chips.js). Eyes shut,
// asleep on it; one cracks open now and then; the pointer over it half-opens them, following it;
// open and blinking while Claude is waiting on you. Drawn only when something on it changes: still,
// it costs nothing.
export class Chip extends Small {
  constructor(canvas) {
    super(canvas, Math.round(CHIP_SIZE.w * K), Math.round(CHIP_SIZE.h * K));
    this.style = DESIGNS[0].id;
    this.mode = 'idle'; // hers: idle | work | alert | sleep
    this.drawn = '';
    this.timer = 0;
    this.nextPeek = 0;
    this.peek = null;
  }

  // Bottom-left corner of a w x h screen.
  place(w, h) {
    this.moveTo(MARGIN.left, h - MARGIN.bottom - this.h);
    this.drawn = ''; // drawn again where it is now
  }

  // the middle of its screen, on screen: where she folds into it
  center() {
    const { face } = DESIGNS.find((d) => d.id === this.style) || DESIGNS[0];
    return { x: this.x + face.x * K, y: this.y + face.y * K };
  }

  contains(x, y, pad = 8) {
    return x >= this.x - pad && x <= this.x + 214 * K + pad && y >= this.y + 10 * K - pad && y <= this.y + 58 * K + pad;
  }

  setMode(mode) {
    this.mode = mode;
  }

  // one of chips.js's looks, by its id (config.chipStyle)
  setStyle(id) {
    if (!DESIGNS.some((d) => d.id === id) || id === this.style) return;
    this.style = id;
    this.drawn = '';
  }

  show() {
    this.nextPeek = performance.now() + rand(4000, 8000);
    this.drawn = '';
    super.show();
  }

  hide() {
    cancelAnimationFrame(this.timer);
    super.hide();
  }

  // What this drawing shows, smooth with the clock (drawn at the screen's rate, 60 fps): the float,
  // the glitter's drift, the light across the glass. Blinks, peeks and glitches stay snappy.
  state(now) {
    const calm = reducedMotion.matches;
    const t = now / 1000;
    const frame = Math.floor(now / STEP); // twelfths of a second, for what's on/off (blinks, the LED)
    let eyes = [0, 0];
    let look = null;
    if (now > this.nextPeek && !this.peek && !calm) {
      this.peek = { eye: Math.random() < 0.5 ? 0 : 1, until: now + rand(700, 1100) };
      this.nextPeek = now + rand(6000, 13000);
    }
    if (this.peek && now > this.peek.until) this.peek = null;
    if (this.peek) eyes[this.peek.eye] = 0.5;
    if (this.pointer) {
      eyes = [0.5, 0.5]; // stirring, watching your pointer
      look = { x: (this.pointer.x - this.x) / K, y: (this.pointer.y - this.y) / K };
    }
    const blink = frame % 8 < 6;
    if (this.mode === 'alert') eyes = calm || blink ? [1, 1] : [0, 0];
    const bob = calm ? 0 : Math.sin(t * Math.PI) * 1.2 - 1.2; // a slow float, one up and down every 2 s
    const shake = this.pointer && !calm && frame % 2 ? (frame % 4 < 2 ? -1 : 1) : 0;
    const cycle = t % 5; // a glint across the prongs every five seconds
    const glint = !calm && cycle < 0.8 ? Math.floor(cycle * 5) : -9;
    // her glitter drifting along the glass (12 units a second), twinkling
    const drift = calm ? 0 : t * 12;
    const twinkle = calm ? 0 : Math.floor(t * 6);
    const ledOn = this.mode === 'alert' || this.mode === 'work' ? blink : this.mode !== 'sleep';
    // the light sweeping across the glass every four seconds, her face breathing, and a glitch now
    // and then, more of them while Claude's at work
    const roll = t % 4;
    const scan = !calm && roll < 1.5 ? roll / 1.5 : -1;
    const breath = calm ? 0 : Math.sin(t * 1.4) * 0.6;
    if (!calm && now > (this.nextGlitch || 0)) {
      this.glitchUntil = now + STEP * 2;
      this.nextGlitch = now + rand(5000, 11000) / (this.mode === 'work' ? 2 : 1);
    }
    const glitch = now < (this.glitchUntil || 0) ? (Math.floor(now / 40) % 2 ? 3 : -3) : 0;
    return { eyes, look, bob, shake, glint, blink, ledOn, scan, breath, glitch, drift, twinkle, mode: this.mode, flat: this.landing ? COLORS.paper : null };
  }

  // 60 fps while it's out (it moves smoothly: no drawing is the same twice), no more on a faster screen
  loop(now) {
    if (!this.visible) return;
    const step = 1000 / 60;
    if (now - this.last < step - 1) {
      this.timer = requestAnimationFrame(this.loop);
      return;
    }
    // kept in step, 60 a second on average; after a pause (hidden, a slow frame), from now
    this.last = now - this.last > step * 2 ? now : this.last + step;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr * K, 0, 0, dpr * K, 0, 0);
    this.ctx.clearRect(-4, -4, CHIP_SIZE.w + 8, CHIP_SIZE.h + 8);
    drawChip(this.ctx, this.style, this.state(now));
    this.timer = requestAnimationFrame(this.loop);
  }
}
