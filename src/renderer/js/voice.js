// Capri's sounds, synthesized with Web Audio so nothing has to ship with the repo.
// Any file dropped in the custom sounds folder (tray > Son) named after a cue
// (teleport-out.mp3, done.wav, alert.ogg...) replaces the synth for that cue. Several for one cue
// (done-1.wav, done-2.wav...): one of them each time.

import { rand, pick } from './util.js';

// a minor-pentatonic set for the talking blips; three detuned voices = a chorus of minds
const BLIP_NOTES = [62, 65, 67, 69, 72, 74, 77, 79];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const CUES = ['teleport-out', 'teleport-in', 'done', 'alert', 'error', 'hello', 'blip', 'tick', 'star', 'land', 'rise', 'bolt', 'charge', 'possess', 'throw', 'crash', 'remind', 'jealous', 'look', 'bye', 'heard', 'blackwall', 'quickhack', 'optics', 'psycho', 'sandy', 'heat', 'reset'];
// look: before she looks at your screen; bye: put away into her biochip; heard: she heard her name
// (keep those short: she doesn't listen while one plays). Only sounds of yours play for those three:
// she has no synth for them.
const IDLE_MS = 10000; // no sound this long: her audio sleeps, no stream of silence for Windows to mix

export class Voice {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.7;
    this.custom = new Map(); // cue -> [AudioBuffer]
    this.lineVolume = 1; // your sounds (her real lines, say): her voice volume, not the main one
    this.lastBlip = 0;
    this.busyUntil = 0;  // a sound of hers is playing until then (performance.now())
    this.sleepTimer = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // soft clip so stacked cues never get harsh
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    this.master.connect(shaper).connect(ctx.destination);
    this.noise = this.makeNoise();
    this.nap();
    return ctx;
  }

  // A sound's coming, about `seconds` long: her audio up if it slept, and asleep again IDLE_MS after.
  wake(seconds = 3) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this.busyUntil = Math.max(this.busyUntil, performance.now() + seconds * 1000);
    this.nap();
    return ctx;
  }

  nap() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => {
      if (this.ctx?.state === 'running' && performance.now() >= this.busyUntil) this.ctx.suspend().catch(() => {});
    }, Math.max(0, this.busyUntil - performance.now()) + IDLE_MS);
  }

  configure({ muted, volume, voiceVolume }) {
    if (typeof muted === 'boolean') this.muted = muted;
    if (typeof voiceVolume === 'number') this.lineVolume = Math.max(0, Math.min(2, voiceVolume));
    if (typeof volume === 'number') {
      this.volume = volume;
      if (this.master) this.master.gain.value = volume;
    }
  }

  async loadCustom(list) {
    const ctx = this.ensure();
    this.custom.clear();
    for (const { name, url } of list) {
      const cue = CUES.includes(name) ? name : name.replace(/[-_ ]?\(?\d+\)?$/, ''); // done-2, done (2)
      if (!CUES.includes(cue)) continue;
      try {
        const data = await (await fetch(url)).arrayBuffer();
        const buffer = await ctx.decodeAudioData(data);
        this.custom.set(cue, [...(this.custom.get(cue) || []), buffer]);
      } catch (err) {
        console.warn('[capri] could not load sound', name, err);
      }
    }
  }

  // Plays a cue. Returns how long a sound of yours lasts (seconds), 0 for her own synth.
  play(cue, opts = {}) {
    if (this.muted) return 0;
    const custom = this.custom.get(cue);
    const ctx = this.wake(custom?.length ? 0 : 3);
    if (custom?.length) {
      const src = ctx.createBufferSource();
      src.buffer = pick(custom);
      this.wake(src.buffer.duration);
      const level = ctx.createGain();
      level.gain.value = this.lineVolume;
      src.connect(level).connect(this.master);
      src.start();
      return src.buffer.duration;
    }
    const fn = {
      'teleport-out': () => this.zap(false),
      'teleport-in': () => this.zap(true),
      done: () => this.done(),
      alert: () => this.alert(),
      error: () => this.error(),
      hello: () => this.hello(),
      blip: () => this.blip(opts.mood),
      tick: () => this.tick(),
      star: () => this.star(),
      land: () => this.land(),
      rise: () => this.rise(),
      bolt: () => this.bolt(opts.soft),
      charge: () => this.charge(),
      possess: () => this.possess(),
      throw: () => this.whoosh(opts.power ?? 0.6),
      crash: () => this.crash(opts.power ?? 0.6),
      remind: () => this.remind(),
      jealous: () => this.hiss(),
      blackwall: () => this.blackwall(),
      quickhack: () => this.quickhack(),
      optics: () => this.optics(),
      psycho: () => this.psycho(),
      sandy: () => this.sandy(),
      heat: () => this.heat(),
      reset: () => this.reset(),
    }[cue];
    fn?.();
    return 0;
  }

  makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  osc(type, freq, t, dur, peak, dest = this.master) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noiseBurst(t, dur, peak, from, to, q = 2) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, rand(0, 0.5));
    src.stop(t + dur + 0.05);
  }

  // teleport: saw sweep + filtered noise, upward when leaving, downward when landing
  zap(arriving) {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', arriving ? 1600 : 180, t, 0.22, 0.12);
    o.frequency.exponentialRampToValueAtTime(arriving ? 140 : 2400, t + 0.2);
    this.noiseBurst(t, 0.2, 0.22, arriving ? 6000 : 400, arriving ? 500 : 7000, 3);
    // bit-crushy stutter
    for (let i = 0; i < 4; i++) this.osc('square', rand(800, 3200), t + 0.02 + i * 0.035, 0.02, 0.05);
    if (arriving) this.osc('triangle', 70, t + 0.16, 0.18, 0.3);
  }

  blip(mood = 'talk') {
    const now = performance.now();
    if (now - this.lastBlip < 45) return;
    this.lastBlip = now;
    const t = this.ctx.currentTime;
    const base = pick(BLIP_NOTES) + (mood === 'alert' ? 5 : mood === 'error' ? -7 : 0);
    const f = midi(base);
    this.osc('square', f, t, 0.035, 0.035);
    this.osc('triangle', f * 1.498, t + 0.004, 0.03, 0.025); // a fifth up
    this.osc('square', f * 0.501, t + 0.008, 0.03, 0.018);   // an octave down, slightly off
  }

  tick() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.03, 0.06, 3000, 9000, 8);
  }

  // red lightning: a buzz under a crackle of tiny bursts (soft: the small hacking sparks)
  bolt(soft = false) {
    const t = this.ctx.currentTime;
    const k = soft ? 0.35 : 1;
    const o = this.osc('sawtooth', 62, t, 0.3 * k + 0.05, 0.08 * k);
    o.frequency.setValueAtTime(58, t + 0.05);
    for (let i = 0; i < (soft ? 3 : 8); i++) {
      this.noiseBurst(t + i * rand(0.02, 0.045), 0.025, 0.14 * k, rand(2500, 6000), rand(4000, 9000), 6);
    }
  }

  // charging up before the red light goes up: a buzz swelling and climbing, crackling more and more
  charge() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
    for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.08 + i * 0.09, 0.02, 0.04 + i * 0.016, 3000, 7000, 6);
  }

  // the window she took over laughs with all her voices: three falling chirps, each a detuned
  // chord, over a hiss
  possess() {
    const t = this.ctx.currentTime;
    [79, 76, 72].forEach((n, i) => {
      const at = t + i * 0.11;
      this.osc('square', midi(n), at, 0.07, 0.05);
      this.osc('square', midi(n) * 1.012, at + 0.004, 0.06, 0.035);
      this.osc('triangle', midi(n - 12), at + 0.008, 0.07, 0.04);
    });
    this.noiseBurst(t, 0.3, 0.05, 1200, 5000, 3);
  }

  // the launch into the victory pose: a quick upward whoosh
  rise() {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', 160, t, 0.2, 0.07);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
    this.noiseBurst(t, 0.18, 0.12, 500, 6000, 2);
  }

  // thrown: air rushing past, a falling saw under it, harder the faster she goes
  whoosh(power) {
    const t = this.ctx.currentTime;
    const k = 0.4 + power * 0.6;
    this.noiseBurst(t, 0.28, 0.16 * k, 300, 3200 + power * 3000, 1.4);
    const o = this.osc('sawtooth', 420 + power * 300, t, 0.22, 0.05 * k);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
    for (let i = 0; i < 3; i++) this.osc('square', rand(1500, 3800), t + 0.03 + i * 0.03, 0.015, 0.03 * k);
  }

  // slamming into something: a heavy thump, glass crunching, her signal glitching out for a moment
  crash(power) {
    const t = this.ctx.currentTime;
    const k = 0.35 + power * 0.65;
    const o = this.osc('triangle', 130, t, 0.22, 0.34 * k);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    this.noiseBurst(t, 0.12, 0.22 * k, 2400, 300, 1.2);
    if (power > 0.25) {
      for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.02 + i * rand(0.012, 0.03), 0.02, 0.12 * k, rand(5000, 9000), rand(6000, 10000), 9);
    }
    for (let i = 0; i < 4; i++) this.osc('square', rand(700, 2600), t + 0.05 + i * 0.028, 0.018, 0.04 * k);
  }

  // the Blackwall coming down: a sub drone sinking under static, the wall's hum, and at the end a
  // scream of data as it shears apart (fx.js blackwall, 7 s)
  blackwall() {
    const t = this.ctx.currentTime;
    const drone = this.osc('sawtooth', 58, t, 6.6, 0.1);
    drone.frequency.exponentialRampToValueAtTime(30, t + 6.4);
    this.osc('square', 87.5, t + 0.04, 6.2, 0.028);
    this.osc('sine', 29, t, 6.8, 0.16);
    for (let i = 0; i < 16; i++) this.noiseBurst(t + rand(0, 6), rand(0.04, 0.22), rand(0.04, 0.12), rand(300, 3000), rand(2000, 9000), rand(1, 6));
    const scream = this.osc('sawtooth', 220, t + 6, 0.8, 0.06);
    scream.frequency.exponentialRampToValueAtTime(2600, t + 6.7);
    this.noiseBurst(t + 6.1, 0.5, 0.2, 5000, 200, 1.5);
    this.wake(8);
  }

  // Reboot Optics (hacks.js, 5.6 s): a crack, power whining down into static, the reboot's beeps,
  // and the optics spinning back up
  optics() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.12, 0.25, 7000, 1500, 1.2);
    const down = this.osc('sawtooth', 1400, t + 0.05, 1.5, 0.05);
    down.frequency.exponentialRampToValueAtTime(60, t + 1.5);
    for (let i = 0; i < 10; i++) this.noiseBurst(t + 0.3 + i * 0.14, 0.14, 0.05 + i * 0.008, rand(2000, 6000), rand(2000, 6000), 0.8);
    [0, 1, 2, 3].forEach((i) => this.osc('square', 880 + i * 220, t + 2 + i * 0.4, 0.06, 0.04));
    const up = this.osc('triangle', 120, t + 3.6, 1.2, 0.06);
    up.frequency.exponentialRampToValueAtTime(1800, t + 4.7);
    this.wake(6);
  }

  // Cyberpsychosis (hacks.js, 7.5 s): a heartbeat speeding up, a distorted drone rising under it, and
  // the scream it ends in
  psycho() {
    const t = this.ctx.currentTime;
    for (let at = 0, gap = 0.9; at < 7.2; at += gap, gap = Math.max(0.33, gap * 0.86)) {
      const thump = this.osc('sine', 62, t + at, 0.16, 0.32);
      thump.frequency.exponentialRampToValueAtTime(38, t + at + 0.15);
      this.osc('sine', 54, t + at + 0.18, 0.12, 0.2);
    }
    const drone = this.osc('sawtooth', 70, t, 7, 0.05);
    drone.frequency.exponentialRampToValueAtTime(190, t + 6.8);
    this.osc('square', 105, t + 2, 5, 0.025);
    const scream = this.osc('sawtooth', 300, t + 6.6, 0.8, 0.07);
    scream.frequency.exponentialRampToValueAtTime(1500, t + 7.3);
    this.noiseBurst(t + 6.6, 0.9, 0.22, 1800, 6000, 0.9);
    this.wake(8);
  }

  // Sandevistan (hacks.js, 8 s): a deep boom as time drops, a slow heartbeat, a shimmer hanging in
  // the air, a whoosh at each of her dashes (app.js: 0.9 s, then every 1.1 s), and the snap back at 7.3 s
  sandy() {
    const t = this.ctx.currentTime;
    const boom = this.osc('sine', 120, t, 1.4, 0.3);
    boom.frequency.exponentialRampToValueAtTime(28, t + 1.3);
    this.noiseBurst(t, 0.6, 0.18, 4000, 300, 1);
    for (let at = 0.9; at < 7; at += 1.5) {
      this.osc('sine', 48, t + at, 0.25, 0.22);
      this.osc('sine', 44, t + at + 0.3, 0.2, 0.15);
    }
    [76, 83, 88].forEach((n, i) => this.osc('triangle', midi(n), t + 0.5 + i * 0.05, 6.6, 0.012));
    for (let at = 0.9; at < 5.5; at += 1.1) this.noiseBurst(t + at, 0.22, 0.07, 900, 5000, 1.4);
    const snap = this.osc('sawtooth', 60, t + 7.2, 0.4, 0.08);
    snap.frequency.exponentialRampToValueAtTime(900, t + 7.55);
    this.noiseBurst(t + 7.3, 0.3, 0.2, 800, 7000, 1.2);
    this.wake(9);
  }

  // Overheat (hacks.js, 8 s): a roar of fire rising, crackling, an alarm as it passes the red line,
  // the burn-out into white at the end
  heat() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 32; i++) this.noiseBurst(t + i * 0.22, 0.35, 0.05 + i * 0.004, rand(300, 900), rand(1500, 4000), 0.7);
    for (let i = 0; i < 40; i++) this.noiseBurst(t + rand(0.3, 7.2), 0.02, rand(0.05, 0.14), rand(3000, 8000), rand(3000, 8000), 6);
    for (let i = 0; i < 8; i++) this.osc('square', i % 2 ? 660 : 880, t + 3.6 + i * 0.35, 0.16, 0.035);
    this.noiseBurst(t + 7.1, 0.7, 0.25, 6000, 400, 1);
    this.wake(9);
  }

  // System Reset (hacks.js, 7.4 s): the upload chirping in, a glitch as it breaches, the CRT whining
  // down and the thunk of it off, the boot beeps on black, and the whine of it coming back on
  reset() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this.osc('square', 1800 + i * 160, t + i * 0.22, 0.04, 0.02);
    this.noiseBurst(t + 1.6, 0.5, 0.2, 2000, 8000, 1.2);
    const down = this.osc('sine', 15000, t + 3.1, 1.0, 0.02);
    down.frequency.exponentialRampToValueAtTime(400, t + 4);
    this.osc('triangle', 70, t + 4, 0.25, 0.3);
    this.noiseBurst(t + 4, 0.15, 0.2, 300, 120, 1.5);
    [0, 1, 2].forEach((i) => this.osc('square', 1200, t + 4.6 + i * 0.45, 0.05, 0.03));
    const up = this.osc('sine', 300, t + 6.1, 1.2, 0.02);
    up.frequency.exponentialRampToValueAtTime(15000, t + 7.2);
    this.osc('triangle', 90, t + 6.1, 0.2, 0.25);
    this.wake(9);
  }

  // a quickhack going in: a rising charge, then the crack of the short circuit
  quickhack() {
    const t = this.ctx.currentTime;
    const charge = this.osc('sawtooth', 180, t, 0.32, 0.05);
    charge.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
    this.noiseBurst(t + 0.3, 0.16, 0.24, 6000, 900, 1.4);
    for (let i = 0; i < 5; i++) this.osc('square', rand(900, 3200), t + 0.32 + i * 0.03, 0.02, 0.05);
  }

  // a reminder: three bright notes going up, softer than an alert, with a shimmer
  remind() {
    const t = this.ctx.currentTime;
    [76, 81, 88].forEach((n, i) => {
      this.osc('triangle', midi(n), t + i * 0.12, 0.35, 0.08);
      this.osc('sine', midi(n + 12), t + i * 0.12 + 0.01, 0.25, 0.025);
    });
    this.noiseBurst(t + 0.3, 0.4, 0.02, 8000, 12000, 6);
  }

  // jealous: a hiss over a low growl that wobbles, like a cat about to swipe
  hiss() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(3500, t);
    bp.frequency.linearRampToValueAtTime(6500, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, rand(0, 0.5));
    src.stop(t + 0.5);
    const growl = this.osc('sawtooth', 72, t, 0.4, 0.07);
    for (let i = 1; i <= 8; i++) growl.frequency.setValueAtTime(i % 2 ? 64 : 80, t + i * 0.045);
  }

  // touching down: a soft digital thump
  land() {
    const t = this.ctx.currentTime;
    const o = this.osc('triangle', 150, t, 0.14, 0.22);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    this.noiseBurst(t, 0.06, 0.08, 1800, 400, 1.5);
  }

  // the satellite: two soft, high pings and a shimmer
  star() {
    const t = this.ctx.currentTime;
    this.osc('sine', midi(93), t, 0.9, 0.05);
    this.osc('sine', midi(100), t + 0.14, 1.2, 0.035);
    this.noiseBurst(t + 0.05, 0.6, 0.015, 9000, 12000, 6);
  }

  hello() {
    const t = this.ctx.currentTime;
    [69, 76, 81].forEach((n, i) => this.osc('square', midi(n), t + i * 0.06, 0.07, 0.06));
    this.noiseBurst(t + 0.18, 0.08, 0.06, 2000, 8000, 5);
  }

  // bright arpeggio and a glitchy tail
  done() {
    const t = this.ctx.currentTime;
    [64, 68, 71, 75, 76].forEach((n, i) => {
      this.osc('triangle', midi(n + 12), t + i * 0.07, 0.28, 0.09);
      this.osc('square', midi(n), t + i * 0.07, 0.12, 0.035);
    });
    for (let i = 0; i < 7; i++) this.osc('square', rand(1200, 4200), t + 0.4 + i * 0.03, 0.018, 0.035);
  }

  alert() {
    const t = this.ctx.currentTime;
    for (let r = 0; r < 2; r++) {
      this.osc('square', 988, t + r * 0.28, 0.09, 0.07);
      this.osc('square', 740, t + r * 0.28 + 0.11, 0.11, 0.07);
    }
  }

  error() {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', 110, t, 0.32, 0.14);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    this.noiseBurst(t, 0.25, 0.15, 900, 200, 1.2);
    for (let i = 0; i < 5; i++) this.noiseBurst(t + 0.05 + i * 0.05, 0.02, 0.12, 4000, 4000, 10);
  }
}
