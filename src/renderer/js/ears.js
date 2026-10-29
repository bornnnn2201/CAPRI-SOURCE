// Her ears, shown: a tag over her head while she's listening for you (after "Hey Capri", her key, or
// a question of hers), so you know when to speak. LISTENING with your voice's level in its bars and
// the time left under it; GO ON… while you talk; GOT IT… while she works out what you said. Gone the
// rest of the time, and nothing runs then (it wakes up only while she listens).

const FPS = 20;
const BARS = 5;
const SHOW_AFTER_MS = 900; // "got it…" stays this long after she understood you

export class Ears {
  constructor({ speech, capri, root = document.body }) {
    this.speech = speech;
    this.capri = capri;
    this.el = document.createElement('div');
    this.el.className = 'ears';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<div class="ears__plate"><span class="ears__dot"></span><span class="ears__label"></span>'
      + `<span class="ears__bars">${'<i></i>'.repeat(BARS)}</span></div><div class="ears__time"><b></b></div>`;
    this.label = this.el.querySelector('.ears__label');
    this.bars = [...this.el.querySelectorAll('.ears__bars i')];
    this.time = this.el.querySelector('.ears__time b');
    root.append(this.el);
    this.timer = null;
    this.state = '';
    this.doneAt = 0;
    speech.onEars = () => this.wake(); // she started listening (or hearing) for you
  }

  wake() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000 / FPS);
  }

  sleep() {
    clearInterval(this.timer);
    this.timer = null;
    this.el.hidden = true;
    this.state = '';
  }

  tick() {
    const s = this.speech;
    const now = performance.now();
    const left = s.awakeUntil - now;
    const state = s.thinking ? 'think'
      : left > 0 && s.seg ? 'talk'
        : left > 0 && !s.talking ? 'listen'
          : now - this.doneAt < SHOW_AFTER_MS ? 'think' : '';
    if (s.thinking) this.doneAt = now;
    if (!state || this.capri.stowed || !s.listening) return this.sleep();
    if (state !== this.state) {
      this.state = state;
      this.el.dataset.state = state;
      this.label.textContent = state === 'listen' ? 'LISTENING' : state === 'talk' ? 'GO ON…' : 'GOT IT…';
      this.el.hidden = false;
    }
    // your voice, in the bars: louder, taller (a little jitter so it looks alive, not a meter)
    const level = Math.min(1, (s.level || 0) * 14);
    this.bars.forEach((bar, i) => {
      const k = state === 'think' ? 0.25 + 0.2 * Math.sin(now / 120 + i) : Math.max(0.12, level * (0.6 + 0.4 * Math.sin(now / 90 + i * 1.7)));
      bar.style.transform = `scaleY(${k.toFixed(2)})`;
    });
    this.time.style.transform = `scaleX(${state === 'think' ? 1 : Math.max(0, Math.min(1, left / (s.awakeFor || 8000))).toFixed(3)})`;
    // by her head, on the screen's side (over it is her chat panel), wherever she is
    const h = this.capri.head();
    const k = this.capri.scale || 1;
    const w = this.el.offsetWidth || 150;
    const side = this.capri.towardCenter();
    const at = side > 0 ? h.x + 70 * k : h.x - 70 * k - w;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, at));
    const y = Math.max(8, Math.min(window.innerHeight - 60, h.y - 20 * k));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
