// Her voice out loud and her ears ("Hey Capri"), both worked out on this PC (main/speech.js).
// Her voice is a stock Piper voice, pitched up and run through a chorus of minds with a few glitches
// like a construct coming off a chip: close to her, a copy of nobody.

import { pick } from './util.js';
import { heardAs, isStop } from './hearing.js';

const PITCH = 1.2;          // as in main/speech.js (each voice can have its own: it comes with her line)
const PRE_ROLL_MS = 300;    // kept from before you start talking, so the first word isn't clipped
const START_MS = 60;        // this long above the noise and it's someone talking
const END_MS = 600;         // this long quiet and they're done (short: she answers her name fast)
const VOICED_MS = 128;      // at least this much of it with a voice's pitch in it (voiced), or it's noise:
                            // on your own recordings, noise had 64 ms at most, your shortest word 192
const VOICED_R = 0.6;       // how alike a chunk is to itself one pitch later, to count as voiced
const END_AWAKE_MS = 1400;  // once she's listening to a request: you may stop to think
const MIN_MS = 350;         // shorter: a click, a cough
const MAX_MS = 15000;
const AWAKE_MS = 10000;     // after "Hey Capri" alone, how long she waits for the rest
const FOLLOW_MS = 10000;    // and after each answer of hers: you go on without her name, or it's over

// How broken up her voice is (her menu's Voice > Glitch): the chorus around her, the shimmer, how often
// the signal skips, the deeper voice under hers (`low`) and the bit-crushed copy beside it (`crush`).
// No deeper voice but in 'heavy': under her, it made her sound like a man.
const GLITCH = {
  subtle: { wet: 0.16, ring: 0.02, gap: [3, 6], skip: 0.6, low: 0, crush: 0, bits: 14 },
  anime: { wet: 0.22, ring: 0.04, gap: [2, 4.5], skip: 0.45, low: 0, crush: 0.1, bits: 14 },
  heavy: { wet: 0.34, ring: 0.12, gap: [0.9, 2], skip: 0.25, low: 0.22, crush: 0.35, bits: 8 },
};

// Her name as Whisper writes it down: "Capri", or near it ("Kapri", "Cabri", "Ca pri"), first thing
// said or after a "hey" (findName). Anything a letter off counts; two off, if it sounds like her name.
const GREETINGS = new Set(['hey', 'hi', 'hay', 'hei', 'heya', 'hello', 'okay', 'ok', 'yo', 'a', 'ay', 'oi', 'eh']);

const LINES = {
  en: {
    yes: ['Yeah?', 'I\'m listening.', 'What do you need, choom?', 'Go on.', 'Mm? Talk to me.'],
    loading: (p) => `Pulling my voice off the Net… ${p}%`,
    ready: 'Voice online. Hear me now?',
    failed: (e) => `Couldn't get my voice: ${e}`,
    noMic: 'No microphone for me to hear you with.',
  },
  fr: {
    yes: ['Oui ?', 'Je t\'écoute.', 'Qu\'est-ce qu\'il te faut ?', 'Vas-y.'],
    loading: (p) => `Je récupère ma voix sur le Net… ${p} %`,
    ready: 'Voix en ligne. Tu m\'entends ?',
    failed: (e) => `Pas pu récupérer ma voix : ${e}`,
    noMic: 'Pas de micro pour t\'entendre.',
  },
};

export class Speech {
  constructor({ host, voice, capri, panel }) {
    this.host = host;
    this.voice = voice;
    this.capri = capri;
    this.panel = panel;
    this.lang = 'en';
    this.speakOn = false;
    this.talking = false; // while she speaks, she doesn't listen (she'd hear herself)
    this.ticket = 0;
    this.playing = [];
    this.listening = false;
    this.awakeUntil = 0;
    this.hearing = false;
    this.thinking = false; // working out what you said while she was listening (her tag: GOT IT…)
    this.level = 0;        // how loud the microphone is right now (her tag's bars)
    this.awakeFor = AWAKE_MS;
    this.onEars = null;    // () => void: she's listening for you now (ears.js shows it)
    this.onCommand = null; // (text) => void: what you said to her, after "Hey Capri"
    this.onCalled = null;  // () => Promise: just her name (app.js brings her over to you)
    this.resetEars();
    host.onVoiceProgress((p) => this.progress(p));
  }

  get t() {
    return LINES[this.lang] || LINES.en;
  }

  configure(cfg) {
    this.lang = cfg.lang;
    this.callWith = cfg.callWith === 'key' ? 'key' : 'name';
    this.speakOn = Boolean(cfg.speak);
    this.glitch = GLITCH[cfg.glitch] || GLITCH.anime;
    this.loudness = 1.15 * Math.max(0, Math.min(2, cfg.voiceVolume ?? 1)); // her voice volume, 0-200 %
    if (this.out) this.out.gain.value = this.loudness; // dragged while she's talking
    if (!this.speakOn) this.stop();
    this.ears = Boolean(cfg.listen); // her listening switched on in her menu
    // called by her key only: the microphone stays shut until you press it (listenNow)
    this.listen(this.ears && this.callWith !== 'key');
    if (Boolean(cfg.audience) !== Boolean(this.audienceOn)) this.setAudience(Boolean(cfg.audience)); // audience mode
  }

  progress({ percent, done, error }) {
    const t = this.t;
    if (error) return this.panel.say({ kind: 'info', face: 'wide', line: t.failed(error), hold: 9000 });
    if (done) {
      this.panel.say({ kind: 'info', face: 'smug', line: t.ready, hold: 5000 });
      return;
    }
    if (percent % 10 !== 0 || percent === this.lastPercent) return; // every 10 %: enough to see it move
    this.lastPercent = percent;
    this.panel.say({ kind: 'info', face: 'look', line: t.loading(percent), hold: 8000 });
  }

  // --- her voice ------------------------------------------------------------------------------------

  // Her line made ahead (her check-in, said the moment she says hi in her intro): say() then has
  // nothing to wait for
  prepare(text) {
    if (!this.speakOn) return;
    const line = forSpeech(text);
    if (line) this.made = { line, wavs: this.host.voiceSay(line).catch(() => null) };
  }

  // Says it out loud (if that's on). Resolves once she's done talking (and then whatever waits for
  // that runs: followUp's listening)
  async say(text) {
    this.saying = (this.saying || 0) + 1;
    try {
      await this.sayNow(text);
    } finally {
      this.saying -= 1;
      const then = !this.saying && this.afterTalk;
      if (then) {
        this.afterTalk = null;
        setTimeout(then, 350); // once her own echo's gone (talking clears 300 ms after her line)
      }
    }
  }

  async sayNow(text) {
    if (!this.speakOn || this.voice.muted) return;
    const line = forSpeech(text);
    if (!line) return;
    const ticket = ++this.ticket;
    const made = this.made?.line === line ? this.made.wavs : null;
    if (made) this.made = null;
    const wavs = await (made || this.host.voiceSay(line).catch(() => null));
    if (!wavs?.main || ticket !== this.ticket) return;
    const ctx = this.voice.wake(5);
    if (ctx.state === 'suspended') await ctx.resume();
    const decode = (wav) => ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
    let buffer;
    let deep = null;
    try {
      buffer = await decode(wavs.main);
      if (wavs.low) deep = await decode(wavs.low).catch(() => null);
    } catch {
      return;
    }
    if (ticket !== this.ticket) return;
    this.stop();
    this.voice.wake(buffer.duration + 1);
    this.talking = true;
    this.lineNow = line; // what she's saying: her own words in your mic don't count as you cutting in
    this.capri.pulse();
    await new Promise((resolve) => {
      this.endNow = resolve;
      const length = this.play(ctx, buffer, deep, resolve, wavs.pitch || PITCH);
      this.ending = setTimeout(resolve, length * 1000 + 500); // in case onended never comes
    });
    this.endNow = null;
    if (ticket === this.ticket) setTimeout(() => { this.talking = false; }, 300); // the room's echo of her
  }

  // Cut off (you said "stop", app.js): her line stopped mid-word, and the ones on their way dropped.
  cut() {
    this.ticket += 1;
    this.made = null;
    this.afterTalk = null;
    this.barge = null;
    this.stop();
    this.endNow?.();
    this.endNow = null;
  }

  // While she talks she doesn't listen (she'd hear herself), except for you cutting in: a short burst
  // of your voice, clearly louder than the room (her own voice through speakers comes in quieter
  // than you), heard by the quick model, and only "no", "stop", "cancel", "wait"... count, and not
  // when it's a word she's saying herself right then (onInterrupt).
  bargeIn(data, rate, ms) {
    if (!this.onInterrupt || this.callWith === 'key') return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const loud = Math.sqrt(sum / data.length) > Math.max(0.03, this.floor * 6) && voiced(data, rate);
    if (!this.barge && !loud) return;
    const b = this.barge || (this.barge = { chunks: [], ms: 0, voiced: 0, quiet: 0 });
    b.chunks.push(data);
    b.ms += ms;
    if (loud) {
      b.voiced += ms;
      b.quiet = 0;
    } else b.quiet += ms;
    // too long to be "stop" (it's her, or you talking over her about something else), or just a blip
    if (b.voiced > 1800 || b.ms > 2600 || (b.quiet >= 300 && b.voiced < 140)) {
      this.barge = null;
      return;
    }
    if (b.quiet >= 300) {
      this.barge = null;
      this.checkBarge(b.chunks, rate);
    }
  }

  async checkBarge(chunks, rate) {
    if (this.bargeBusy) return;
    this.bargeBusy = true;
    try {
      const text = cleanHeard(await this.host.voiceHear(toWav(chunks, rate), false));
      if (!isStop(text) || !this.talking) return;
      const said = String(this.lineNow || '').toLowerCase();
      const words = text.toLowerCase().match(/[a-z']+/g) || [];
      if (words.every((w) => new RegExp(String.raw`\b${w}\b`).test(said))) return; // her own words, through your speakers
      this.onInterrupt?.(text);
    } finally {
      this.bargeBusy = false;
    }
  }

  stop() {
    clearTimeout(this.ending);
    for (const node of this.playing) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this.playing = [];
    this.talking = false;
  }

  // Her line through her effects: pitched up, a chorus of minds around it, a deeper voice under hers,
  // a metallic shimmer, a bit-crushed copy, and stutters, like the signal skipping (how much of each:
  // GLITCH). Returns how long it lasts (seconds).
  play(ctx, buffer, deep, onEnd, rate = PITCH) {
    const g = this.glitch || GLITCH.anime;
    const now = ctx.currentTime + 0.05;
    const length = buffer.duration / rate;
    const out = ctx.createGain();
    out.gain.value = this.loudness ?? 1.15;
    out.connect(this.voice.master);
    this.out = out;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    // brighter and lighter: less chest (below 200 Hz), more presence (3 kHz) and air (above 5 kHz)
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 200;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3000;
    presence.Q.value = 1;
    presence.gain.value = 3;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5000;
    air.gain.value = 4;
    const gate = ctx.createGain(); // the stutters cut the main voice for a moment
    src.connect(low).connect(presence).connect(air).connect(gate);

    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    gate.connect(dry).connect(out);

    // the deeper voice under hers: Piper's twice-as-fast take, slowed to last exactly as long as hers
    const extra = [];
    if (deep && g.low) {
      const under = ctx.createBufferSource();
      under.buffer = deep;
      under.playbackRate.value = deep.duration / length;
      const lowGain = ctx.createGain();
      lowGain.gain.value = g.low;
      under.connect(lowGain).connect(gate);
      under.start(now + 0.008);
      extra.push(under);
    }

    // a bit-crushed copy beside her, muffled a little so it's grit, not hiss
    if (g.crush) {
      const crushed = ctx.createWaveShaper();
      crushed.curve = steps(g.bits);
      const muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 5200;
      const crushMix = ctx.createGain();
      crushMix.gain.value = g.crush;
      gate.connect(crushed).connect(muffle).connect(crushMix).connect(out);
    }

    // the chorus: two copies a few ms late, wobbling, one on each side
    const lfos = [];
    for (const [delay, wobble, pan] of [[0.011, 0.9, -0.45], [0.017, 1.3, 0.45]]) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = wobble;
      const depth = ctx.createGain();
      depth.gain.value = 0.0022;
      lfo.connect(depth).connect(d.delayTime);
      const wet = ctx.createGain();
      wet.gain.value = g.wet;
      const side = ctx.createStereoPanner();
      side.pan.value = pan;
      gate.connect(d).connect(wet).connect(side).connect(out);
      lfos.push(lfo);
    }

    // a faint ring modulation: the shimmer of a voice that isn't quite a throat
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = 1150;
    carrier.connect(ring.gain);
    const ringMix = ctx.createGain();
    ringMix.gain.value = g.ring;
    gate.connect(ring).connect(ringMix).connect(out);
    lfos.push(carrier);

    // the stutters: a 50-80 ms slice said twice while the voice drops out
    const stutters = [];
    for (let at = 0.6; at < length - 0.5; at += g.gap[0] + Math.random() * (g.gap[1] - g.gap[0])) {
      if (Math.random() < g.skip) continue;
      const slice = 0.05 + Math.random() * 0.03;
      const when = now + at;
      gate.gain.setValueAtTime(1, when - 0.005);
      gate.gain.linearRampToValueAtTime(0, when);
      gate.gain.setValueAtTime(0, when + slice * 2);
      gate.gain.linearRampToValueAtTime(1, when + slice * 2 + 0.01);
      const rep = ctx.createBufferSource();
      rep.buffer = buffer;
      rep.playbackRate.value = rate;
      rep.loop = true;
      rep.loopStart = at * rate;
      rep.loopEnd = (at + slice) * rate;
      const crush = ctx.createWaveShaper(); // a little grit on the repeat
      crush.curve = steps(g.bits);
      rep.connect(crush).connect(out);
      rep.start(when, at * rate);
      rep.stop(when + slice * 2);
      stutters.push(rep);
    }

    src.onended = () => {
      for (const o of lfos) {
        try { o.stop(); } catch { /* done */ }
      }
      out.disconnect();
      if (this.out === out) this.out = null;
      onEnd();
    };
    for (const o of lfos) o.start(now);
    src.start(now);
    this.playing = [src, ...lfos, ...extra, ...stutters];
    return length;
  }

  // --- her ears -------------------------------------------------------------------------------------

  async listen(on) {
    if (on === this.listening) return;
    this.listening = on;
    if (!on) return this.closeMic();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // no noise suppression: it eats consonants, and Whisper copes with noise better by itself
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      this.listening = false;
      console.error('[capri] microphone:', err);
      this.panel.say({ kind: 'info', face: 'aside', line: `${this.t.noMic} (${err?.name || 'Error'}: ${err?.message || err})`, hold: 12000 });
      return;
    }
    if (!this.listening) return this.closeMic(); // switched off while the microphone was opening
    // at 16 kHz the browser resamples the microphone properly, which is what Whisper wants; if it
    // can't, the device's rate, smoothed below 7 kHz so toWav's cheap resampling doesn't smear words
    let ctx;
    let source;
    try {
      ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' });
      source = ctx.createMediaStreamSource(this.stream);
    } catch {
      ctx?.close().catch(() => {});
      ctx = new AudioContext({ latencyHint: 'playback' });
      source = ctx.createMediaStreamSource(this.stream);
    }
    this.mic = ctx;
    const smooth = ctx.createBiquadFilter();
    smooth.type = 'lowpass';
    smooth.frequency.value = Math.min(7000, ctx.sampleRate / 2 - 500);
    const size = ctx.sampleRate <= 16000 ? 1024 : 2048; // ~64 ms or ~43 ms
    // the sound comes in on the audio thread (mic-worklet.js), never the page's
    try {
      await ctx.audioWorklet.addModule('js/mic-worklet.js');
      // two ins: your microphone, and the PC's own sound in audience mode (plugged in by hearPc)
      const ears = new AudioWorkletNode(ctx, 'capri-ears', {
        numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { size },
      });
      ears.port.onmessage = (e) => this.frame(e.data, ctx.sampleRate);
      this.merge = ctx.createChannelMerger(2);
      source.connect(smooth).connect(this.merge, 0, 0);
      this.merge.connect(ears);
      if (this.audienceOn) this.hearPc(true);
    } catch (err) {
      console.warn('[capri] no audio worklet, the old way:', err);
      const proc = ctx.createScriptProcessor(size, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0; // it has to reach the speakers to run, silently
      source.connect(smooth).connect(proc).connect(sink).connect(ctx.destination);
      proc.onaudioprocess = (e) => this.frame(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
    }
  }

  closeMic() {
    this.hearPc(false);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mic?.close().catch(() => {});
    this.mic = null;
    this.merge = null;
    this.resetEars();
  }

  // Audience mode: the PC's own sound in her ears too, mainly Discord, so the people in your call can
  // call her as well (what they may ask of her is up to app.js / chat.js). Windows' loopback, given by
  // main.js for this request; the screen picture that has to come with it is dropped at once.
  async hearPc(on) {
    if (!on) {
      this.pcStream?.getTracks().forEach((track) => track.stop());
      this.pcStream = null;
      this.pcSource?.disconnect();
      this.pcSource = null;
      return true;
    }
    if (this.pcStream || !this.mic || !this.merge) return Boolean(this.pcStream);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((track) => track.stop());
      if (!stream.getAudioTracks().length || !this.audienceOn || !this.mic) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.pcStream = stream;
      const smooth = this.mic.createBiquadFilter();
      smooth.type = 'lowpass';
      smooth.frequency.value = Math.min(7000, this.mic.sampleRate / 2 - 500);
      // down to one channel (game sound is in stereo), then into her ears' second input
      const mono = this.mic.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      this.pcSource = this.mic.createMediaStreamSource(stream);
      this.pcSource.connect(mono).connect(smooth).connect(this.merge, 0, 1);
      return true;
    } catch (err) {
      console.error('[capri] PC sound:', err);
      return false;
    }
  }

  // switched from her menu or by voice: on only while she's listening (it needs her ears)
  async setAudience(on) {
    this.audienceOn = on;
    if (!on) return this.hearPc(false);
    return this.listening ? this.hearPc(true) : false;
  }

  resetEars() {
    this.floor = 0.005; // the room's noise, followed while nobody talks
    this.pre = [];
    this.preMs = 0;
    this.seg = null;
    this.segMs = 0;
    this.loudFor = 0;
    this.quietFor = 0;
  }

  // One chunk of what she hears (~40 ms): is somebody talking, and have they finished? `msg`: the
  // worklet's { buf, e0, e1 } (your mic's energy, the PC's), or just the samples (the old way)
  frame(msg, rate) {
    const data = msg.buf || msg;
    const ms = (data.length / rate) * 1000;
    if (this.talking) {
      this.seg = null;
      this.loudFor = 0;
      this.bargeIn(data, rate, ms);
      return;
    }
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    this.level = this.level * 0.5 + rms * 0.5;
    const loud = rms > Math.max(0.012, this.floor * 3);
    const chunk = data; // a copy of its own already (mic-worklet.js)
    const voice = loud && voiced(data, rate); // a pitch in it: someone talking, not a click or a knock
    if (!this.seg) {
      this.pre.push(chunk);
      this.preMs += ms;
      while (this.preMs > PRE_ROLL_MS && this.pre.length > 1) {
        this.pre.shift();
        this.preMs -= ms;
      }
      if (loud) {
        this.loudFor += ms;
      } else {
        this.loudFor = 0;
        this.floor = this.floor * 0.98 + rms * 0.02;
      }
      if (this.loudFor >= START_MS) {
        this.seg = this.pre;
        this.segMs = this.preMs;
        this.voicedMs = voice ? ms : 0;
        this.segE = [0, 0]; // who's louder in it, you or the PC (someone in your call), summed below
        this.segAt = performance.now(); // when you started: what counts for her listening window
        this.pre = [];
        this.preMs = 0;
        this.quietFor = 0;
      }
      return;
    }
    this.seg.push(chunk);
    this.segMs += ms;
    if (voice) {
      this.voicedMs += ms;
      this.segE[0] += msg.e0 || 0;
      this.segE[1] += msg.e1 || 0;
    }
    this.quietFor = loud ? 0 : this.quietFor + ms;
    const end = performance.now() < this.awakeUntil ? END_AWAKE_MS : END_MS;
    if (this.quietFor >= end || this.segMs >= MAX_MS) {
      const seg = this.seg;
      const spoken = this.segMs - this.quietFor;
      this.seg = null;
      this.loudFor = 0;
      // too little of it voiced: keys, a clap, a door; no need to wake Whisper for that
      // 'pc': clearly louder through the PC than your microphone (it hears your speakers a little too)
      const from = this.pcStream && this.segE[1] > this.segE[0] * 1.5 ? 'pc' : 'you';
      if (spoken >= MIN_MS && this.voicedMs >= VOICED_MS) this.heard(seg, rate, spoken, this.segAt, from);
    }
  }

  // One at a time (it's work for the CPU): what you say meanwhile waits its turn, the latest only,
  // never dropped (it may be her name).
  async heard(seg, rate, spoken, at = performance.now(), from = 'you') {
    // called only by her key: what you say otherwise never reaches Whisper, it costs nothing
    if (this.callWith === 'key' && at >= this.awakeUntil) return;
    if (this.hearing) {
      this.waiting = [seg, rate, spoken, at, from];
      return;
    }
    this.hearing = true;
    try {
      await this.hear(seg, rate, at, from);
    } finally {
      this.hearing = false;
      const next = this.waiting;
      this.waiting = null;
      if (next) this.heard(...next);
    }
  }

  // Her key (Ctrl+Alt+V, main.js): she listens to what you say next, no name needed.
  async listenNow() {
    if (!this.ears) return;
    if (!this.listening) await this.listen(true); // key only: the microphone opened for this
    this.host.voiceWarm?.(); // her voice loaded while she listens and thinks
    await this.onCalled?.();
    this.capri.wake();
    this.capri.perform('hop');
    await this.ack();
    this.setAwake(AWAKE_MS);
    this.shutLater();
  }

  // She listens for you for `ms`, no name needed (and shows it: ears.js). Nothing said by then (nor
  // being said, heard or answered), the conversation's over: onConversationEnd, and it's her name again.
  setAwake(ms) {
    this.awakeUntil = performance.now() + ms;
    this.awakeFor = ms;
    this.onEars?.();
    clearTimeout(this.endTimer);
    const over = () => {
      if (performance.now() < this.awakeUntil || this.seg || this.hearing || this.thinking || this.talking || this.saying) {
        this.endTimer = setTimeout(over, 400);
        return;
      }
      this.onConversationEnd?.();
    };
    this.endTimer = setTimeout(over, ms + 50);
  }

  // She answered what you asked out loud: a conversation, so she keeps listening, FOLLOW_MS from when
  // she's done talking. Ask again without her name; say nothing and it's over.
  followUp() {
    if (!this.ears) return;
    const open = () => this.expectReply(FOLLOW_MS);
    if (this.saying || this.talking) this.afterTalk = open;
    else open();
  }

  // The conversation's over now (sent to her chip): "Hey Capri" again for the next thing
  hush() {
    this.afterTalk = null;
    this.awakeUntil = 0;
    clearTimeout(this.endTimer);
    this.onEars?.();
  }

  // She asked you something (chat.js): she listens for your answer, as after "Hey Capri".
  async expectReply(ms = AWAKE_MS) {
    if (!this.ears) return;
    if (!this.listening) await this.listen(true); // key only: the microphone opened for this
    this.setAwake(ms);
    if (this.callWith === 'key') this.shutLater();
  }

  // Key only: the microphone shut again once she's done listening (and hearing) to you.
  shutLater() {
    clearTimeout(this.shutTimer);
    this.shutTimer = setTimeout(() => {
      if (this.callWith !== 'key') return;
      if (performance.now() < this.awakeUntil || this.hearing || this.seg) return this.shutLater();
      this.listen(false);
    }, Math.max(0, this.awakeUntil - performance.now()) + 2000);
  }

  // working out what you said to her: her tag says so (GOT IT…)
  think(on) {
    this.thinking = on;
    if (on) this.onEars?.();
  }

  // Her short "I heard you" (one of your 'heard' sounds, else a blip). She doesn't listen through it,
  // or she'd hear herself.
  ack() {
    const line = this.voice.play('heard');
    if (!line) {
      this.voice.play('blip');
      return Promise.resolve();
    }
    this.talking = true;
    return new Promise((r) => setTimeout(r, line * 1000 + 150)).then(() => { this.talking = false; });
  }

  // `from`: 'you' (your microphone) or 'pc' (someone in your call, audience mode)
  async hear(seg, rate, at = performance.now(), from = 'you') {
    const awake = at < this.awakeUntil; // you started while she was listening (it may have run out since)
    const wav = toWav(seg, rate);
    let request = '';
    if (awake) this.think(true);
    // called: straight to the careful decoding; not called: the quick one, only for her name
    const text = cleanHeard(await this.host.voiceHear(wav, awake).finally(() => this.think(false)));
    if (!text) return;
    if (awake) {
      request = text;
    } else {
      const rest = afterName(text);
      if (rest === null) return;
      if (words(rest) >= 2) {
        // her name and a request in one breath: she heard you, then hears it again properly
        this.capri.pulse();
        this.ack();
        this.think(true);
        const sharp = cleanHeard(await this.host.voiceHear(wav, true).finally(() => this.think(false)));
        const better = afterName(sharp) ?? sharp;
        request = words(better) >= 2 ? better : rest;
      }
    }
    if (request) {
      request = heardAs(request); // "Got rest." was "go rest", "Use red ticks." "Reboot Optics"
      this.awakeUntil = 0;
      clearTimeout(this.endTimer); // the conversation goes on: after her answer she listens again
      // whoever said the request: what they may ask is theirs (app.js); her answer done, followUp
      Promise.resolve(this.onCommand?.(request, { from })).catch(() => {}).then(() => this.followUp());
      return;
    }
    // just her name: she comes over (off another screen, app.js), answers and waits for the rest
    await this.onCalled?.(from);
    this.capri.wake();
    this.capri.perform('hop');
    // short, so you can go on right away
    if (this.speakOn && !this.voice.custom.get('heard')?.length) await this.say(pick(this.t.yes));
    else await this.ack();
    this.setAwake(AWAKE_MS);
  }
}

// What comes after her name ("Hey Capri, open Spotify" -> "open Spotify"), or null without her name.
function afterName(text) {
  const end = findName(text);
  return end < 0 ? null : text.slice(end).replace(/^[\s,.!?-]+/, '').trim();
}

// Where her name ends in what Whisper heard, or -1: "Capri" or a near miss, said first or after a
// greeting (two pieces joined too: "Ca pri"), or run into the greeting in one word ("Hackapri").
export function findName(text) {
  const tokens = [...String(text || '').matchAll(/[a-z']+/gi)].map((m) => ({ w: m[0].toLowerCase().replace(/'s$/, ''), end: m.index + m[0].length }));
  // "Hike prey", "Like pray": the "Ca" swallowed by a quick "hey", the rest heard as a word of its own
  if (tokens[1] && /^(?:hike|hyke|like|hey|hay|hi|hike's|a)$/.test(tokens[0].w) && /^[ck]?a?pr(?:i|ee|ey|ay|ie|y|e)$/.test(tokens[1].w)) return tokens[1].end;
  for (let i = 0; i < tokens.length; i++) {
    if (i === 0 && greetedName(tokens[i].w)) return tokens[i].end;
    if (i > 0 && !GREETINGS.has(tokens[i - 1].w)) continue;
    if (likeName(tokens[i].w)) return tokens[i].end;
    if (tokens[i + 1] && likeName(tokens[i].w + tokens[i + 1].w)) return tokens[i + 1].end;
    // after a greeting, run into the next word: "a capriuse blackwall" (the rest is lost, the name isn't)
    if (i > 0 && tokens[i].w.length > 6 && (likeName(tokens[i].w.slice(0, 5)) || likeName(tokens[i].w.slice(0, 6)))) return tokens[i].end;
  }
  return -1;
}

// how far a word is from her name, as Whisper writes it either way ("capri", "capree")
const fromName = (w) => Math.min(distance(w, 'capri'), distance(w, 'capree'));

// "Hey Capri" said fast, written as one word: "hackapri", "haykapri", "heycapri", "hackpre", and
// "acapree" (Whisper's "a" for a quick "hey")
function greetedName(w) {
  if (w.length < 6 || w.length > 10 || !/^[ha]/.test(w)) return false;
  for (let n = 4; n <= 6; n++) {
    const tail = w.slice(-n);
    const d = fromName(tail);
    if (d <= 1 || (d === 2 && /[ck][a-z]?pr/.test(tail))) return true;
  }
  return false;
}

function likeName(w) {
  if (w.length < 4 || w.length > 8) return false;
  const d = fromName(w);
  return d <= 1 || (d === 2 && /^[ck]a?[pb]/.test(w) && /[pb]r/.test(w)); // "capree", not "carrie" or "cap it"
}

// Whether a chunk of the microphone has a voice in it: a pitch between 70 and 400 Hz (normalised
// autocorrelation), which keys, claps, knocks and doors don't have.
export function voiced(x, rate) {
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.ceil(rate / 70);
  const n = Math.min(x.length - maxLag, Math.round(rate * 0.04));
  if (n < minLag * 4) return false;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[i] * x[i];
  if (e0 < 1e-7) return false;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      const b = x[i + lag];
      c += x[i] * b;
      e1 += b * b;
    }
    if (c / Math.sqrt(e0 * e1 + 1e-12) > VOICED_R) return true;
  }
  return false;
}

// Levenshtein: how many letters to change, add or take away to get from one word to the other
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const words = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

// What she reads out: no code, no links, no markdown, no emoji, and not a whole essay.
export function forSpeech(text) {
  let s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 600) {
    const cut = s.slice(0, 600);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > 200 ? cut.slice(0, end + 1) : `${cut}…`;
  }
  return s;
}

// Whisper's notes about the sound ("[BLANK_AUDIO]", "(music)", "*laughs*") aren't words, nor are a
// clip's worth of quote marks. It also writes one voice as two now and then ("- Who are you? - Who
// are you?"): said once.
export function cleanHeard(text) {
  let t = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const same = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const turns = t.split(/(?:^|\s)-\s+/).map((s) => s.trim()).filter(Boolean);
  if (turns.length > 1 && turns.every((s) => same(s) === same(turns[0]))) t = turns[0];
  else t = t.replace(/^-\s+/, '');
  return /[a-z0-9]/i.test(t) ? t : '';
}

// The chunks, joined, brought down to 16 kHz mono (what Whisper wants) and wrapped as a WAV.
function toWav(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  const ratio = rate / 16000;
  const n = Math.floor(total / ratio);
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // the average of what falls in this sample: a cheap low-pass on the way down
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += all[j];
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

// a staircase for the WaveShaper: the repeat comes out a little bit-crushed
function steps(levels) {
  const curve = new Float32Array(512);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}
