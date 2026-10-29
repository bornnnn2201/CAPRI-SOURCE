// She lives in your PC, so she feels it: the processor maxed out, the charger, the battery, the
// network, things you plug in (a USB stick, a phone, a controller...) and the games you play.
// Her menu › React to my PC turns it off.

import { pick, fmt, today } from './util.js';

const HOT = 85; // % of the processor, for HOT_FOR
// short on room (checkRoom)
const ROOM_LINES = {
  ram: ['Your RAM\'s nearly gone, choom. {gb} GB left. Close something before your game starts stuttering.', 'Memory\'s at {pct}% free. Something\'s hogging it. Want me to close a few apps?'],
  disk: ['Your C drive is down to {gb} GB. Updates and saves are going to start failing. Clear some space, yeah?', 'Only {gb} GB left on C. Even I need room to breathe in here.'],
};
const HOT_FOR = 15000;
const HOT_EVERY = 30 * 60 * 1000;
const CHARGER_EVERY = 60 * 1000;
const PLUG_EVERY = 15 * 1000;
const GAME_AFTER = 6000;  // a game in front this long: you're playing
const GAME_OVER = 8000;   // and gone this long: you're done
// How long you played, once you're really done (not just out of it for a bit): said this long after,
// for a session this long at least. Back in the same game before then, it's the same session.
const REPORT_AFTER = 90 * 1000;
const REPORT_FROM = 15 * 60 * 1000;
const PLAYED_KEY = 'capri.played'; // today's time per game: { date, ms: { game: ms } }
const PLAYED = {
  short: ['{time} of {game}. Quick one, choom.', '{time} of {game}. Warming up, or giving up?'],
  mid: ['{time} of {game}. Not bad, edgerunner.', '{time} of {game}. Win anything, or just vibes?'],
  long: ['{time} of {game}. Your eyes still work? Blink for me.', '{time} straight of {game}. Drink some water, you\'re running hot.'],
  marathon: ['{time} of {game}. Even we take breaks, and we\'re dozens of minds.', '{time} of {game}. Night City would call that a lifestyle.'],
  today: ' That\'s {total} of it today.',
};
// "an hour and 20 minutes", the way she'd say it
function spoken(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = h === 0 ? '' : h === 1 ? 'an hour' : `${h} hours`;
  const mins = m === 0 ? '' : `${m} minute${m === 1 ? '' : 's'}`;
  return [hours, mins].filter(Boolean).join(' and ') || 'a minute';
}

const PHONE = /phone|iphone|apple|galaxy|samsung|pixel|xiaomi|redmi|poco|oneplus|huawei|honor|motorola|oppo|vivo|realme|nokia|xperia|android|mobile|t[ée]l[ée]phone|celular|телефон/i;
const PAD = /controller|gamepad|manette|mando|controle|xbox|dualsense|dualshock|joy-?con|геймпад/i;

// what was plugged in, from the name and the class Windows gives it
function kindOf({ name = '', class: cls = '' }) {
  if (PAD.test(name)) return 'controller';
  if (cls === 'DiskDrive' || cls === 'Volume') return 'drive'; // USB sticks: by their drive letter
  if (cls === 'WPD' || PHONE.test(name)) return 'phone';
  if (cls === 'AudioEndpoint' || cls === 'MEDIA') return 'audio';
  if (cls === 'Camera' || cls === 'Image') return 'camera';
  if (['Keyboard', 'Mouse', 'HIDClass'].includes(cls)) return 'input';
  return 'device';
}

export class Pc {
  constructor({ capri, panel, brain, host, voice, chat, guide }) {
    Object.assign(this, { capri, panel, brain, host, voice, chat, guide });
    this.enabled = true;
    this.wantsOut = () => true; // not put away in her settings
    this.hotSince = 0;
    this.hot = false;
    this.hotAt = -Infinity;
    this.charging = null;
    this.chargerAt = -Infinity;
    this.warned = 1; // lowest battery level she warned about (1: none yet)
    this.cutOff = false;
    this.drives = null;
    this.plugs = null; // count of plug events seen (windows.ps1)
    this.plugAt = -Infinity;
    this.game = null;
    this.gameAway = false; // she's already off on another screen than your game's (app.js): no need to put her away
    this.keepAway = () => true; // () => gaming mode's on (app.js): only then does a game put her away
    setInterval(() => this.checkCpu(), 3000);
    setInterval(() => this.checkGame(), 1000);
    setInterval(() => this.checkRoom(), 60 * 1000);
    this.roomAt = { ram: -Infinity, disk: -Infinity };
    this.watchBattery();
    window.addEventListener('offline', () => this.offline());
    window.addEventListener('online', () => this.online());
  }

  get t() {
    return this.brain.t.pc;
  }

  // not in the middle of something that matters more
  get quiet() {
    return this.enabled && this.capri.mode !== 'alert' && !this.chat.open && !this.guide.running;
  }

  say(line, face = 'smug', hold = 4500) {
    if (this.quiet) this.panel.say({ kind: 'info', face, line, hold });
  }

  // waits a few seconds for her to be free to move, if she's busy
  async whenFree(ms = 6000) {
    for (let waited = 0; !this.capri.free && waited < ms; waited += 250) await new Promise((r) => setTimeout(r, 250));
    return this.capri.free;
  }

  async checkCpu() {
    if (!this.enabled) return;
    const cpu = await this.host.cpu().catch(() => null);
    if (cpu == null) return;
    const now = Date.now();
    if (cpu < HOT) {
      this.hotSince = 0;
      if (this.hot && cpu < 55) {
        this.hot = false;
        if (!this.panel.visible) this.say(pick(this.t.cool), 'calm', 3000);
      }
      return;
    }
    this.hotSince ||= now;
    if (this.hot || now - this.hotSince < HOT_FOR || now - this.hotAt < HOT_EVERY || !this.quiet) return;
    this.hot = true;
    this.hotAt = now;
    this.capri.wake();
    this.say(fmt(pick(this.t.hot), { cpu }), 'wide', 5000);
    this.voice.play('charge');
    if (await this.whenFree()) this.capri.perform('overheat');
  }

  // Short on memory (under 8 % free: games stutter) or on space on the system drive (under 5 GB:
  // updates and saves fail): she says so in plain words, memory at most every 30 min, the drive
  // once a day. In a game she only says it out loud (whisper), off your screen.
  async checkRoom() {
    if (!this.enabled) return;
    const room = await this.host.room?.().catch(() => null);
    if (!room) return;
    const now = Date.now();
    let line = null;
    if (room.ram < 8 && now - this.roomAt.ram > 30 * 60 * 1000) {
      this.roomAt.ram = now;
      line = fmt(pick(ROOM_LINES.ram), { gb: room.ramGb.toFixed(1), pct: room.ram });
    } else if (room.diskGb != null && room.diskGb < 5 && now - this.roomAt.disk > 24 * 3600 * 1000) {
      this.roomAt.disk = now;
      line = fmt(pick(ROOM_LINES.disk), { gb: room.diskGb.toFixed(1) });
    }
    if (!line) return;
    if (!this.game) this.say(line, 'wide', 7000);
    this.chat?.speech?.say(line); // in a game: only out loud, nothing over it
  }

  async watchBattery() {
    const battery = await navigator.getBattery?.().catch(() => null);
    if (!battery) return;
    const changed = () => this.battery(battery);
    battery.addEventListener('levelchange', changed);
    battery.addEventListener('chargingchange', changed);
    this.charging = battery.charging; // as it is when she starts: nothing to say
  }

  async battery({ level, charging }) {
    if (!this.enabled) return;
    const now = Date.now();
    if (charging !== this.charging) {
      this.charging = charging;
      if (now - this.chargerAt > CHARGER_EVERY) {
        this.chargerAt = now;
        if (charging) {
          this.warned = 1;
          this.say(pick(this.t.charging), 'laugh', 3500);
          this.capri.recharge();
        } else {
          this.say(pick(this.t.unplugged), 'aside', 3500);
        }
      }
    }
    if (charging) return;
    const at = level <= 0.05 ? 0.05 : level <= 0.15 ? 0.15 : 1;
    if (at >= this.warned) return;
    this.warned = at;
    this.capri.wake();
    this.say(fmt(pick(at === 0.05 ? this.t.critical : this.t.low), { level: Math.round(level * 100) }), 'aside', 6000);
    if (await this.whenFree()) this.capri.drain();
  }

  offline() {
    clearTimeout(this.offlineTimer);
    // a blip isn't worth it
    this.offlineTimer = setTimeout(() => {
      if (navigator.onLine || !this.enabled) return;
      this.cutOff = true;
      this.voice.play('error');
      this.say(pick(this.t.offline), 'wide', 5000);
      this.capri.hurt();
    }, 4000);
  }

  online() {
    clearTimeout(this.offlineTimer);
    if (!this.cutOff) return;
    this.cutOff = false;
    this.voice.play('hello');
    this.say(pick(this.t.online), 'laugh', 3500);
    if (this.capri.free) this.capri.perform('hop');
  }

  // what windows.ps1 sees: USB sticks by letter, devices plugged in or out, the game in front
  onWindows({ usb = [], plug = null, game = null }) {
    if (!this.enabled) {
      this.drives = usb;
      this.plugs = plug?.n ?? 0;
      return;
    }
    if (this.drives) {
      const added = usb.find((d) => !this.drives.includes(d));
      const removed = this.drives.find((d) => !usb.includes(d));
      if (added) this.stick(added);
      else if (removed) this.say(pick(this.t.usbOut), 'smug', 3500);
    }
    this.drives = usb;

    if (this.plugs !== null && plug && plug.n !== this.plugs) this.device(plug);
    this.plugs = plug?.n ?? 0;

    const g = this.game;
    if (game) {
      if (g?.name === game) g.gone = 0;
      else {
        // back in the game you just left: the same session goes on (and it's been said hello to)
        const back = this.ended?.name === game ? this.ended : null;
        this.ended = null;
        this.game = { name: game, since: back?.since ?? Date.now(), gone: 0, said: Boolean(back), put: false };
      }
    } else if (g && !g.gone) {
      g.gone = Date.now();
    }
  }

  // a USB stick: she dives into it to have a look
  async stick(drive) {
    this.capri.wake();
    this.say(fmt(pick(this.t.usb), { drive }), 'look', 2500);
    if (!this.quiet || !(await this.whenFree())) return;
    const { w, h } = this.capri.view;
    if (await this.capri.visit({ x: w - 140, y: h - 6 })) this.say(pick(this.t.usbBack), 'smug', 4500);
  }

  // anything else plugged in or out: a phone, a controller, a headset...
  device(plug) {
    const kind = kindOf(plug);
    if (kind === 'drive' || Date.now() - this.plugAt < PLUG_EVERY) return;
    this.plugAt = Date.now();
    const lines = plug.in ? this.t.plugIn : this.t.plugOut;
    this.capri.wake();
    // plugged in: a jolt of lightning down to where it came in (by the clock), before she talks
    if (plug.in && this.capri.free) {
      const { w, h } = this.capri.view;
      this.capri.zap(w - 140, h - 10);
    }
    this.say(fmt(pick(lines[kind] || lines.device), { name: plug.name }), plug.in ? 'look' : 'aside', 4000);
  }

  checkGame() {
    const now = Date.now();
    if (this.ended && !this.game && now - this.ended.end >= REPORT_AFTER) {
      const done = this.ended;
      this.ended = null;
      this.played(done);
    }
    const g = this.game;
    if (!g || !this.enabled) return;
    // you're playing: a word about it, then she gets out of the way (she's always on top)
    if (!g.said && !g.gone && now - g.since >= GAME_AFTER) {
      g.said = true;
      if (this.capri.stowed || this.capri.mode === 'alert') return;
      this.capri.wake();
      this.say(fmt(pick(this.t.game), { game: g.name }), 'smug', 3000);
      setTimeout(() => {
        if (this.game !== g || g.gone || this.capri.stowed || this.capri.mode === 'alert' || this.gameAway || !this.keepAway()) return;
        g.put = true;
        this.capri.stow();
      }, 2600);
    }
    // done playing: she comes back, if she's the one who left
    if (g.gone && now - g.gone >= GAME_OVER) {
      this.game = null;
      this.ended = { name: g.name, since: g.since, end: g.gone }; // how long, said once you're really done
      if (g.put && this.capri.stowed && this.wantsOut()) {
        this.capri.unstow().then(() => this.say(pick(this.t.gameBack), 'look', 5000));
      }
    }
  }

  // You're done playing: how long it was, out loud too, teasing you more the longer it went. Today's
  // time in that game is kept on this PC only (localStorage), for "that's 5 hours of it today".
  played({ name, since, end }) {
    const ms = end - since;
    let total = ms;
    try {
      const day = today();
      const kept = JSON.parse(localStorage.getItem(PLAYED_KEY) || 'null');
      const tally = kept?.date === day ? kept : { date: day, ms: {} };
      total = (tally.ms[name] || 0) + ms;
      tally.ms[name] = total;
      localStorage.setItem(PLAYED_KEY, JSON.stringify(tally));
    } catch {
      // nothing kept: today's total is just this one
    }
    if (ms < REPORT_FROM || !this.quiet || this.capri.stowed) return;
    const lines = ms < 45 * 60000 ? PLAYED.short : ms < 2 * 3600000 ? PLAYED.mid : ms < 4 * 3600000 ? PLAYED.long : PLAYED.marathon;
    let line = fmt(pick(lines), { time: spoken(ms), game: name });
    line = line[0].toUpperCase() + line.slice(1);
    if (total - ms >= REPORT_FROM) line += fmt(PLAYED.today, { total: spoken(total) });
    this.capri.wake();
    this.capri.perform(ms >= 2 * 3600000 ? 'yawn' : 'curious', this.capri.towardCenter());
    this.say(line, ms >= 2 * 3600000 ? 'aside' : 'smug', 6000);
    this.chat?.speech?.say(line);
  }
}
