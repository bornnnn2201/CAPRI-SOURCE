'use strict';

// Her voice and her ears, both on this PC: Piper speaks her lines (a stock voice, pitched and glitched
// in voice.js, never anyone's cloned voice) and whisper.cpp writes down what you say ("Hey Capri…").
// Nothing here goes online once it's downloaded; the downloads are checked against their SHA-256.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { app } = require('electron');
const myvoices = require('./myvoices');

const HF = 'https://huggingface.co';
const GH = 'https://github.com';

const LIBRITTS = { url: `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx`, sha256: '10bb85e071d616fcf4071f369f1799d0491492ab3c5d552ec19fb548fac13195', size: 78580914 };

// Kokoro-82M v1.0 (Apache 2.0), as sherpa-onnx packs it: a newer, much more natural voice model than
// Piper's, run by kokoro.js. Only what English needs is unpacked from it.
const KOKORO = {
  url: `${GH}/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2`,
  sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4', size: 349886476,
  untar: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-gb-en.txt', 'LICENSE', 'espeak-ng-data'].map((f) => `kokoro-multi-lang-v1_0/${f}`),
  into: 'kokoro', strip: 1,
};

// The voices she can speak with: bright young women, the closest to her without copying anybody.
const VOICES = {
  // Kokoro's: "her own" is the other Capri app's free voice (lachydotmcg/capri-desktop): stock
  // Kokoro voices mixed (af_heart, af_bella, af_nicole: kokoro.js blend), not anyone's cloned voice.
  // Its own pace, unpitched, as that app speaks them.
  kokoro_capri: { label: 'Kokoro: her own (blend)', engine: 'kokoro', sid: 53, speed: 1.1, pitch: 1 },
  kokoro_bella: { label: 'Kokoro: bright (Bella)', engine: 'kokoro', sid: 2, speed: 1.1, pitch: 1 },
  kokoro_nicole: { label: 'Kokoro: sly (Nicole)', engine: 'kokoro', sid: 6, speed: 1.08, pitch: 1 },
  kokoro_emma: { label: 'Kokoro: sharp, British (Emma)', engine: 'kokoro', sid: 21, speed: 1.1, pitch: 1, gb: true },
  kristin: {
    label: 'Kristin (lower)',
    onnx: { url: `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium.onnx`, sha256: '5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4', size: 63531379 },
  },
  hfc_female: {
    label: 'HFC (clear)',
    onnx: { url: `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx`, sha256: '914c473788fc1fa8b63ace1cdcdb44588f4ae523d3ab37df1536616835a140b7', size: 63201294 },
  },
  amy: {
    label: 'Amy (softer)',
    onnx: { url: `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx`, sha256: 'b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18', size: 63201294 },
  },
  // LibriTTS-R's 904 speakers, measured for her: the ones near her pitch (~250 Hz once raised, like
  // her in the show) whose pitch swings the most (the energy). `pitch` takes each one there.
  ...Object.fromEntries([
    [194, 1.193, 'liveliest'], [815, 1.199, 'lively'], [860, 1.271, 'lively, raised more'], [515, 1.166, 'calmer'],
  ].map(([speaker, pitch, note]) => [`libritts_${speaker}`, { label: `Speaker ${speaker} (${note})`, model: 'libritts_r', speaker, pitch, onnx: LIBRITTS }])),
};

const PIPER = { url: `${GH}/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip`, sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', size: 22477236 };
const WHISPER = { url: `${GH}/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip`, sha256: '00c4304b6be363a224a4b69829df49009f74131df8c3ce6a5878b89a11cd26ef', size: 5410599 };
const EARS = { url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`, sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', size: 147964211 };
// the bigger model, for what you ask her once she's listening: slower, and it gets the words right
const SHARP = { url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`, sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', size: 487614201 };

// Words Whisper should expect. Never "Hey Capri." itself: Whisper takes its prompt as what was just
// said, and then leaves "Hey Capri" out of what it hears.
const VOCABULARY = 'Capri, Claude, Claude Code, Blackwall, Reboot Optics, cyberpsychosis, Sandevistan, overheat, system reset, quickhack, short circuit, gaming mode, Spotify, Discord, YouTube, Roblox, Steam, Chrome.';

// she's pitched up in voice.js (playbackRate, about 3 semitones: young and bright, not a chipmunk);
// Piper speaks slower to make up for it, though not all the way: she talks a little fast, she's lively
const PITCH = 1.2;
const PACE = 0.88;
// Piper's expressiveness: more swing in her intonation (noise) and her rhythm (noise_w) than its
// even narrator defaults (0.667 and 0.8)
const LIVELY = ['--noise_scale', '0.8', '--noise_w', '0.95'];

const dir = () => path.join(app.getPath('userData'), 'voice');
// a voice's model file: its own, or the one it shares with others (LibriTTS-R's speakers: `model`)
const files = (voice) => ({
  piper: path.join(dir(), 'piper', 'piper.exe'),
  onnx: path.join(dir(), `${VOICES[voice]?.model || voice}.onnx`),
  json: path.join(dir(), `${VOICES[voice]?.model || voice}.onnx.json`),
  whisper: path.join(dir(), 'Release', 'whisper-cli.exe'),
  server: path.join(dir(), 'Release', 'whisper-server.exe'),
  serverGpu: path.join(dir(), 'cuda', 'Release', 'whisper-server.exe'),
  ears: path.join(dir(), 'ggml-base.en.bin'),
  sharp: path.join(dir(), 'ggml-small.en.bin'),
  kokoro: path.join(dir(), 'kokoro'),
});
// the voices you imported (myvoices.js), listed with hers: once, then after every import or removal
const mineDir = () => path.join(dir(), 'mine');
let mineRead = false;
function readMine() {
  mineRead = true;
  for (const id of Object.keys(VOICES)) if (id.startsWith('mine_')) delete VOICES[id];
  for (const v of myvoices.list(mineDir())) VOICES[v.id] = { ...v, mine: true };
}
const voiceOf = (cfg) => {
  if (!mineRead) readMine();
  return VOICES[cfg.ttsVoice] ? cfg.ttsVoice : 'kristin';
};
const kokoroOf = (voice) => VOICES[voice].engine === 'kokoro';
const kokoroHere = (f) => ['model.onnx', 'voices.bin', 'voices-capri.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-gb-en.txt']
  .every((n) => fs.existsSync(path.join(f.kokoro, n)));

// { mouth, ears, missingMB }: what's already here for her voice (mouth) and her hearing (ears)
function state(cfg) {
  const voice = voiceOf(cfg);
  const f = files(voice);
  const mouth = kokoroOf(voice) ? kokoroHere(f) : [f.piper, f.onnx, f.json].every((p) => fs.existsSync(p));
  const ears = [f.whisper, f.ears, f.sharp].every((p) => fs.existsSync(p));
  return { mouth, ears, missingMB: Math.round(missing(cfg).reduce((n, d) => n + d.size, 0) / 1e6) };
}

function missing(cfg) {
  const voice = voiceOf(cfg);
  const f = files(voice);
  const v = VOICES[voice];
  const kokoro = kokoroOf(voice);
  return [
    kokoro && !kokoroHere(f) && { ...KOKORO, unzip: true },
    !kokoro && !fs.existsSync(f.piper) && { ...PIPER, unzip: true },
    // (one of yours is already here, or gone: nothing to fetch for it)
    !kokoro && !v.mine && !fs.existsSync(f.onnx) && { ...v.onnx, to: f.onnx },
    // the voice's settings file is tiny and has no checksum of its own: it comes with its model
    !kokoro && !v.mine && !fs.existsSync(f.json) && { url: `${v.onnx.url}.json`, to: f.json, size: 5000 },
    !fs.existsSync(f.whisper) && { ...WHISPER, unzip: true },
    !fs.existsSync(f.ears) && { ...EARS, to: f.ears },
    !fs.existsSync(f.sharp) && { ...SHARP, to: f.sharp },
  ].filter(Boolean);
}

// Fetches what's missing, one file after the other: onProgress({ done, total }) in bytes.
let installing = null;
function install(cfg, onProgress) {
  installing ||= (async () => {
    const todo = missing(cfg);
    const total = todo.reduce((n, d) => n + d.size, 0);
    let done = 0;
    fs.mkdirSync(dir(), { recursive: true });
    for (const item of todo) {
      const tmp = path.join(dir(), `.${path.basename(new URL(item.url).pathname)}.part`);
      await download(item, tmp, (n) => onProgress?.({ done: done + n, total }));
      done += item.size;
      if (item.unzip) {
        // Windows' own tar (bsdtar) opens zips; another tar first on the PATH (Git's) may not
        const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        const into = path.join(dir(), item.into || '');
        fs.mkdirSync(into, { recursive: true });
        const only = item.untar ? [...(item.strip ? ['--strip-components', String(item.strip)] : []), ...item.untar] : [];
        await new Promise((resolve, reject) => execFile(tar, ['-xf', tmp, '-C', into, ...only], { windowsHide: true }, (err) => (err ? reject(err) : resolve())));
        fs.rmSync(tmp, { force: true });
        if (item.url === KOKORO.url) remix(); // her own voice mixed from its table, and yours put in
      } else {
        fs.renameSync(tmp, item.to);
      }
    }
    return state(cfg);
  })().finally(() => { installing = null; });
  return installing;
}

async function download({ url, sha256 }, to, onBytes) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${path.basename(url)}: ${res.status}`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(to);
  let n = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      n += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      onBytes(n);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (sha256 && hash.digest('hex') !== sha256) {
    fs.rmSync(to, { force: true });
    throw new Error(`${path.basename(url)} isn't the file it should be (checksum)`);
  }
}

// Her line as WAVs (Buffers), from Piper: { main, low }. `low` is the same line said twice as fast,
// which voice.js slows down under her as a deeper second voice: only for the 'heavy' glitch (under
// the others it made her sound like a man). The text goes in on stdin, never on a command line.
// `pitch`: how far voice.js raises this voice (each voice has its own, so they all land near hers).
async function speak(cfg, text) {
  const voice = voiceOf(cfg);
  const f = files(voice);
  const { pitch = PITCH, speaker } = VOICES[voice];
  const line = text.replace(/\s+/g, ' ').trim();
  if (kokoroOf(voice)) {
    const { sid, speed, gb } = VOICES[voice];
    return { main: await kokoroSay({ text: line, sid, speed, gb: Boolean(gb), dir: f.kokoro }), low: null, pitch };
  }
  // yours keep their own pace (`length`); hers are slowed to make up for being pitched up
  const length = VOICES[voice].length ?? pitch * PACE;
  const [main, low] = await Promise.all([
    render(f, line, length, 0.12, speaker),
    cfg.glitch === 'heavy' ? render(f, line, length / 2, 0.06, speaker).catch(() => null) : null,
  ]);
  return { main, low, pitch };
}

// Kokoro in its own process (kokoro.js), started on her first line and gone after a quiet minute and a
// half; Electron's own Node runs it. One line at a time, in order.
let kokoro = null;
let kokoroAsks = 0;
const kokoroWaiting = new Map();
function kokoroSay(msg) {
  if (!kokoro) {
    kokoro = require('node:child_process').fork(path.join(__dirname, 'kokoro.js'), [], {
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const me = kokoro;
    let errors = '';
    me.stderr.on('data', (d) => { errors = (errors + d).slice(-400); });
    me.on('message', (m) => {
      const wait = kokoroWaiting.get(m.id);
      if (!wait) return;
      kokoroWaiting.delete(m.id);
      if (m.error) wait.reject(new Error(m.error));
      else wait.resolve(m.wav ? Buffer.from(m.wav) : null);
    });
    me.on('exit', (code) => {
      if (kokoro === me) kokoro = null;
      for (const [id, wait] of kokoroWaiting) {
        kokoroWaiting.delete(id);
        wait.reject(new Error(errors.trim().split('\n').at(-1) || `her voice stopped (${code})`));
      }
    });
  }
  const id = ++kokoroAsks;
  return new Promise((resolve, reject) => {
    kokoroWaiting.set(id, { resolve, reject });
    kokoro.send({ id, ...msg });
  });
}
app.on('will-quit', () => kokoro?.kill());

// Her Kokoro table made again: her blend, and your Kokoro voices in their rows. The worker goes, so
// her next line loads the new one.
function remix() {
  const f = files('kokoro_capri');
  if (!fs.existsSync(path.join(f.kokoro, 'voices.bin'))) return;
  kokoro?.kill();
  kokoro = null;
  kokoroWarm = null;
  const mine = Object.values(VOICES).filter((v) => v.mine && v.engine === 'kokoro').map((v) => ({ sid: v.sid, file: path.join(mineDir(), v.file) }));
  require('./kokoro').blend(f.kokoro, mine);
}

// A voice file you picked (Voice > Import a voice…): copied in and listed. Throws, in words for you,
// when it isn't one she can use.
function importVoice(file) {
  const voice = myvoices.importFile(mineDir(), file);
  readMine();
  if (voice.engine === 'kokoro') remix();
  return VOICES[voice.id];
}

function removeVoice(id) {
  const voice = myvoices.remove(mineDir(), id);
  readMine();
  if (voice?.engine === 'kokoro') remix();
  return voice;
}

// her voice ready before her next line (Kokoro only: Piper loads per line anyway)
function warmVoice(cfg) {
  const voice = voiceOf(cfg);
  if (!kokoroOf(voice) || (kokoro && kokoroWarm === voice)) return;
  kokoroWarm = voice;
  kokoroSay({ dir: files(voice).kokoro, gb: Boolean(VOICES[voice].gb) }).catch(() => { kokoroWarm = null; });
}
let kokoroWarm = null;

function render(f, text, length, silence, speaker) {
  const out = path.join(os.tmpdir(), `capri-say-${process.pid}-${crypto.randomUUID()}.wav`);
  const who = speaker === undefined ? [] : ['--speaker', String(speaker)];
  return new Promise((resolve, reject) => {
    const child = spawn(f.piper, ['--model', f.onnx, '--output_file', out, '--length_scale', String(length), '--sentence_silence', String(silence), ...who, ...LIVELY], {
      cwd: path.dirname(f.piper), windowsHide: true,
    });
    let errors = '';
    child.stderr.on('data', (d) => { errors += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0) return reject(new Error(errors.trim().split('\n').at(-1) || `piper ${code}`));
        resolve(fs.readFileSync(out));
      } catch (err) {
        reject(err);
      } finally {
        fs.rm(out, { force: true }, () => {});
      }
    });
    child.stdin.end(text + '\n');
  });
}

// Whisper kept running with its model loaded (whisper-server, on 127.0.0.1 only): no loading the
// model again for every clip. On the processor, the quick model for her name and your requests alike
// (the bigger one took 5-7 s there, with a game and Discord on); a CUDA build in voice\cuda, with all
// of NVIDIA's libraries in it (cublas), would run the bigger one on the card. Started with her ears
// (warm), stopped with her.
const servers = new Map(); // model file -> { url, ready: Promise<boolean>, child, gpu }
let gpuFailed = false;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(model, gpu) {
  const f = files('kristin');
  const entry = { url: '', child: null, gpu, log: '' };
  entry.ready = (async () => {
    const port = await freePort();
    entry.url = `http://127.0.0.1:${port}`;
    const cores = os.cpus().length;
    const threads = String(gpu ? 2 : Math.max(2, Math.min(4, cores - 1)));
    entry.child = spawn(gpu ? f.serverGpu : f.server, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-t', threads, '-l', 'en', ...(gpu ? [] : ['-ng'])], {
      cwd: path.dirname(gpu ? f.serverGpu : f.server), windowsHide: true,
    });
    // below normal, like the rest of her: a game first (on the card it hardly uses the processor anyway)
    try { os.setPriority(entry.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not yet */ }
    entry.child.stderr.on('data', (d) => { if (entry.log.length < 20000) entry.log += d; });
    entry.child.on('exit', () => { if (servers.get(model) === entry) servers.delete(model); });
    entry.child.on('error', () => {});
    for (let i = 0; i < 120; i++) { // up to a minute: loading a model onto a card the first time is slow
      if (entry.child.exitCode !== null) return false;
      if (await fetch(entry.url, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false)) {
        // the CUDA build falls back to the processor by itself when it can't use the card: then it's no use
        if (gpu && !/CUDA/i.test(entry.log)) return false;
        // the card's first clip takes ~17 s (its code compiled for it): that one's a second of silence,
        // now, not your first "Hey Capri"
        if (gpu) await warmUp(entry.url);
        return true;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })().catch(() => false);
  return entry;
}

// A second of silence through a server (16 kHz mono WAV), to get its first, slow clip out of the way.
async function warmUp(url) {
  const n = 16000;
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n * 2, 40);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'silence.wav');
  form.append('response_format', 'text');
  await fetch(`${url}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(90000) }).catch(() => {});
}

// The server for a model, started if it isn't: the card's if it can, else the processor's.
async function serverFor(model) {
  const f = files('kristin');
  const known = servers.get(model);
  if (known) return (await known.ready) ? known : null;
  const tryGpu = !gpuFailed && gpuComplete() && model === f.sharp;
  let entry = startServer(model, tryGpu);
  servers.set(model, entry);
  if (!(await entry.ready) && tryGpu) {
    gpuFailed = true;
    keepNote('gpu.log', `${new Date().toISOString()} the card's Whisper didn't start (exit ${entry.child?.exitCode}):\n${entry.log.slice(-3000)}\n`);
    entry.child?.kill();
    entry = startServer(model, false);
    servers.set(model, entry);
  }
  if (await entry.ready) return entry;
  entry.child?.kill();
  servers.delete(model);
  return null;
}

// A CUDA build is only any use with NVIDIA's maths libraries beside it (the 11.8 build hasn't them).
function gpuComplete() {
  const f = files('kristin');
  if (!fs.existsSync(f.serverGpu)) return false;
  return fs.readdirSync(path.dirname(f.serverGpu)).some((n) => /^cublas64_\d+\.dll$/i.test(n));
}

// Her ears ready before you call her (her listening switched on): the model loaded in advance.
function warm() {
  const f = files('kristin');
  if (!fs.existsSync(f.server)) return;
  serverFor(gpuComplete() && !gpuFailed ? f.sharp : f.ears);
}

const gpuOn = () => [...servers.values()].some((e) => e.gpu);

function stopEars() {
  for (const e of servers.values()) e.child?.kill();
  servers.clear();
}

// What you said, from a 16 kHz mono WAV (a Buffer). `sharp`: what you ask her (beam search: the words
// right), else is it her name (greedy: fast).
// One at a time: through a server if one's up, else Whisper started just for this clip.
// `accurate` (her menu's Voice > Hearing): your requests through the bigger model on the processor too,
// ~6 s instead of ~2; its server is started then and stopped after ACCURATE_IDLE_MS without one.
const ACCURATE_IDLE_MS = 2 * 60 * 1000;
let accurateTimer = 0;
let hearing = Promise.resolve();
function hear(wav, sharp = false, accurate = false) {
  const f = files('kristin');
  const run = async () => {
    const seconds = Math.max(0, (wav.length - 44) / 32000);
    const file = path.join(os.tmpdir(), `capri-heard-${process.pid}-${Date.now()}.wav`);
    fs.writeFileSync(file, wav);
    const t0 = Date.now();
    const big = gpuOn() || (sharp && accurate);
    const model = big ? f.sharp : f.ears;
    if (big && !gpuOn()) {
      clearTimeout(accurateTimer);
      accurateTimer = setTimeout(() => {
        servers.get(f.sharp)?.child?.kill();
        servers.delete(f.sharp);
      }, ACCURATE_IDLE_MS);
    }
    let text = null;
    let how = 'cli';
    const srv = fs.existsSync(f.server) ? await serverFor(model) : null;
    if (srv) {
      try {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'heard.wav');
        form.append('response_format', 'text');
        form.append('temperature', '0');
        form.append('prompt', VOCABULARY);
        if (sharp) form.append('beam_size', '5');
        // is it her name: Whisper's window cut to ~3x the clip (at least ~10 s) instead of its 30 s,
        // no retries. A third of the work, the same words (tested on her heard\ clips); requests keep it all
        else {
          form.append('audio_ctx', String(Math.min(1500, Math.max(512, Math.ceil(((seconds * 3) + 1) * 50 / 64) * 64))));
          form.append('temperature_inc', '0');
        }
        const res = await fetch(`${srv.url}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
        if (res.ok) {
          text = (await res.text()).replace(/\s+/g, ' ').trim();
          how = srv.gpu ? 'gpu' : 'server';
        }
      } catch {
        // the server's gone: Whisper just for this clip, below; a new server next time
        srv.child?.kill();
      }
    }
    if (text === null) text = await hearOnce(f, file, model, sharp);
    keepHeard(file, { at: new Date().toISOString(), model: path.basename(model), how, seconds: +seconds.toFixed(2), ms: Date.now() - t0, text });
    return text;
  };
  const turn = hearing.then(run);
  hearing = turn.catch(() => {});
  return turn;
}

// Whisper started for one clip (no server): the old way, a model load each time.
function hearOnce(f, file, model, sharp) {
  return new Promise((resolve) => {
    const cores = os.cpus().length;
    const threads = String(sharp ? Math.max(2, Math.min(8, cores)) : Math.max(2, Math.min(4, cores - 1)));
    const search = sharp ? ['-bs', '5', '-bo', '5'] : ['-bs', '1', '-bo', '1'];
    execFile(f.whisper, ['-m', model, '-f', file, '-l', 'en', '-nt', '-np', '-t', threads, ...search, '--prompt', VOCABULARY], {
      windowsHide: true, timeout: 30000, maxBuffer: 1 << 20,
    }, (err, stdout) => resolve(err ? '' : String(stdout).replace(/\s+/g, ' ').trim()));
  });
}

// The last HEARD_KEEP things she heard, kept in her folder's heard\ (the sound, and what Whisper wrote
// in heard.jsonl): if she gets you wrong, there's what she got. On this PC only, like the rest.
const HEARD_KEEP = 30;
function keepNote(name, text) {
  try {
    const keep = path.join(app.getPath('userData'), 'heard');
    fs.mkdirSync(keep, { recursive: true });
    fs.appendFileSync(path.join(keep, name), text);
  } catch {
    // only a note
  }
}
function keepHeard(file, entry) {
  try {
    const keep = path.join(app.getPath('userData'), 'heard');
    fs.mkdirSync(keep, { recursive: true });
    const name = `${entry.at.replace(/[:.]/g, '-')}-${entry.how}.wav`;
    fs.renameSync(file, path.join(keep, name));
    fs.appendFileSync(path.join(keep, 'heard.jsonl'), JSON.stringify({ ...entry, file: name }) + '\n');
    const sounds = fs.readdirSync(keep).filter((n) => n.endsWith('.wav')).sort();
    for (const old of sounds.slice(0, -HEARD_KEEP)) fs.rmSync(path.join(keep, old), { force: true });
    const log = fs.readFileSync(path.join(keep, 'heard.jsonl'), 'utf8').trim().split('\n');
    if (log.length > HEARD_KEEP * 4) fs.writeFileSync(path.join(keep, 'heard.jsonl'), log.slice(-HEARD_KEEP * 2).join('\n') + '\n');
  } catch {
    fs.rm(file, { force: true }, () => {});
  }
}

module.exports = { VOICES, PITCH, state, install, speak, warmVoice, importVoice, removeVoice, hear, warm, stopEars };
