'use strict';

// Her Kokoro voice, in a process of its own (forked by speech.js, so a crash in the native engine
// never takes her down): Kokoro-82M through sherpa-onnx, on the processor, kept loaded while she's
// talking and gone after IDLE_MS of quiet, so it holds no memory through your game.
//   in:  { id, text, sid, speed, gb, dir }   out: { id, wav } | { id, error }

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IDLE_MS = 90 * 1000;
// four threads, under everything else: ~0.45 s per second of speech on an i5-9400F (two: 0.7 s), and a
// game in front still gets the processor first. The full-precision model: the int8 one was 2.5x slower.
const THREADS = 4;

let sherpa = null;
let tts = null;
let ttsGb = null;
let idle = null;

function open(dir, gb) {
  if (tts && ttsGb === gb) return tts;
  sherpa ??= require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts({
    model: {
      kokoro: {
        model: path.join(dir, 'model.onnx'),
        voices: path.join(dir, 'voices-capri.bin'),
        tokens: path.join(dir, 'tokens.txt'),
        dataDir: path.join(dir, 'espeak-ng-data'),
        lexicon: path.join(dir, gb ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt'),
        lang: gb ? 'en' : 'en-us',
      },
      numThreads: THREADS,
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  });
  ttsGb = gb;
  return tts;
}

// 16-bit mono WAV, what Piper gives voice.js too
function wav(samples, rate) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return out;
}

// the worker itself, only when forked (speech.js also loads this file, for blend)
if (require.main === module && process.send) {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  process.on('message', (msg) => {
    clearTimeout(idle);
    try {
      if (!msg.text) {
        open(msg.dir, Boolean(msg.gb)); // warm: loaded before her first line
        process.send({ id: msg.id, ok: true });
      } else {
        // copied out of the engine: Electron's Node refuses memory it doesn't own (external buffers)
        const audio = open(msg.dir, Boolean(msg.gb)).generate({ text: msg.text, sid: msg.sid, speed: msg.speed, enableExternalBuffer: false });
        process.send({ id: msg.id, wav: wav(audio.samples, audio.sampleRate) });
      }
    } catch (err) {
      process.send({ id: msg.id, error: String(err?.message || err) });
    }
    idle = setTimeout(() => process.exit(0), IDLE_MS);
  });
  process.on('disconnect', () => process.exit(0));
  idle = setTimeout(() => process.exit(0), IDLE_MS);
}

// the blended voice she talks with by default, made from Kokoro's own table (speech.js, on install),
// plus the Kokoro voices you imported, each in its row: `mine` [{ sid, file }] (myvoices.js)
module.exports = { blend };
function blend(dir, mine = []) {
  const ROW = 510 * 256 * 4; // one voice: 510 styles of 256 floats
  const table = fs.readFileSync(path.join(dir, 'voices.bin'));
  const row = (i) => new Float32Array(table.buffer, table.byteOffset + i * ROW, ROW / 4);
  // the same mix as the other Capri app's "Her own": af_heart 0.45, af_bella 0.35, af_nicole 0.2,
  // in row 53 (em_santa, a Spanish voice she never uses)
  const [heart, bella, nicole] = [row(3), row(2), row(6)];
  const out = Buffer.from(table);
  const mix = new Float32Array(out.buffer, out.byteOffset + 53 * ROW, ROW / 4);
  for (let i = 0; i < mix.length; i++) mix[i] = 0.45 * heart[i] + 0.35 * bella[i] + 0.2 * nicole[i];
  for (const { sid, file } of mine) {
    try {
      const voice = fs.readFileSync(file);
      if (voice.length === ROW && sid > 0 && sid < 53) voice.copy(out, sid * ROW);
    } catch {} // gone: that row keeps Kokoro's own voice
  }
  // written aside first: a half-written table would leave her voiceless
  const to = path.join(dir, 'voices-capri.bin');
  fs.writeFileSync(`${to}.new`, out);
  fs.renameSync(`${to}.new`, to);
}
