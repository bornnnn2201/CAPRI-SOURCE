'use strict';

// Voices you bring her yourself (Voice > Import a voice…), kept in voice/mine with their list
// (mine.json):
//  - a Piper model: its .onnx and the .onnx.json that comes with it (piper-voices on Hugging Face,
//    or one you trained), spoken by piper.exe like her stock ones
//  - a Kokoro voice: a .pt (how Kokoro's own voices come), a .npy, or a .bin holding one raw style
//    table (510 x 256 floats). It goes into a row of her Kokoro table that English never uses
//    (kokoro.js blend), so it loads with the rest and costs nothing more.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROW_BYTES = 510 * 256 * 4;
// rows 28-52 of Kokoro's table: its Spanish, French, Hindi, Italian, Japanese, Portuguese and
// Chinese voices, which her English never uses (53 is her blend)
const FREE_ROWS = Array.from({ length: 25 }, (_, i) => 28 + i);

const listFile = (dir) => path.join(dir, 'mine.json');

function list(dir) {
  try {
    const all = JSON.parse(fs.readFileSync(listFile(dir), 'utf8'));
    return Array.isArray(all) ? all.filter((v) => v && v.id && v.engine) : [];
  } catch {
    return [];
  }
}

const save = (dir, all) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(listFile(dir), JSON.stringify(all, null, 2));
};

// "en_US-my_voice-medium.onnx" -> "my voice"
const nameOf = (file) => path.basename(file).replace(/\.(onnx|pt|npy|bin)$/i, '')
  .replace(/^[a-z]{2}_[A-Z]{2}-/, '').replace(/-(x_low|low|medium|high)$/i, '').replace(/[_-]+/g, ' ').trim() || 'voice';

// The entry she lists it under: { id, label, engine, ... } (speech.js VOICES)
function importFile(dir, file) {
  const ext = path.extname(file).toLowerCase();
  const all = list(dir);
  const name = nameOf(file);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32) || 'voice';
  let id = `mine_${slug}`;
  for (let n = 2; all.some((v) => v.id === id); n++) id = `mine_${slug}_${n}`;
  fs.mkdirSync(dir, { recursive: true });

  let voice;
  if (ext === '.onnx') {
    const json = [`${file}.json`, file.replace(/\.onnx$/i, '.json')].find((p) => fs.existsSync(p));
    if (!json) throw new Error(`${path.basename(file)}.json isn't next to it. A Piper voice comes as two files: put them in the same folder.`);
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(json, 'utf8'));
    } catch {
      throw new Error(`${path.basename(json)} isn't a Piper voice's settings file.`);
    }
    if (!meta.phoneme_id_map || !meta.audio) throw new Error(`${path.basename(json)} isn't a Piper voice's settings file.`);
    fs.copyFileSync(file, path.join(dir, `${id}.onnx`));
    fs.copyFileSync(json, path.join(dir, `${id}.onnx.json`));
    voice = { id, label: `Mine: ${name}`, engine: 'piper', model: `mine/${id}`, pitch: 1, length: 1 };
    if ((meta.num_speakers || 1) > 1) voice.speaker = 0;
  } else if (ext === '.pt' || ext === '.npy' || ext === '.bin') {
    const row = FREE_ROWS.find((r) => !all.some((v) => v.engine === 'kokoro' && v.sid === r));
    if (row === undefined) throw new Error(`She already has ${FREE_ROWS.length} Kokoro voices of yours. Remove one first.`);
    const table = kokoroTable(file, ext);
    fs.writeFileSync(path.join(dir, `${id}.kvoice`), table);
    // a British voice (Kokoro names them bf_/bm_): read with the British dictionary
    const gb = /^b[fm]_/i.test(path.basename(file));
    voice = { id, label: `Mine: ${name} (Kokoro)`, engine: 'kokoro', sid: row, speed: 1, pitch: 1, gb, file: `${id}.kvoice` };
  } else {
    throw new Error('She can take a Piper voice (.onnx with its .onnx.json) or a Kokoro voice (.pt, .npy or .bin).');
  }
  save(dir, [...all, voice]);
  return voice;
}

function remove(dir, id) {
  const all = list(dir);
  const voice = all.find((v) => v.id === id);
  if (!voice) return null;
  for (const f of [`${id}.onnx`, `${id}.onnx.json`, `${id}.kvoice`]) fs.rmSync(path.join(dir, f), { force: true });
  save(dir, all.filter((v) => v.id !== id));
  return voice;
}

// One Kokoro voice's style table, 510 x 256 little-endian floats, out of the file it came in
function kokoroTable(file, ext) {
  const data = fs.readFileSync(file);
  let raw;
  if (ext === '.bin') {
    if (data.length !== ROW_BYTES) throw new Error(`A Kokoro .bin voice is ${ROW_BYTES} bytes (510 x 256 floats); this one is ${data.length}.`);
    raw = data;
  } else if (ext === '.npy') {
    raw = fromNpy(data);
  } else {
    raw = fromPt(data);
  }
  const floats = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + ROW_BYTES));
  for (const f of floats) if (!Number.isFinite(f) || Math.abs(f) > 100) throw new Error("That file's numbers don't look like a Kokoro voice.");
  return Buffer.from(floats.buffer);
}

// NumPy's own file: a short header ({'descr': '<f4', 'shape': (510, 1, 256)}), then the numbers
function fromNpy(data) {
  if (data.toString('latin1', 1, 6) !== 'NUMPY') throw new Error("That .npy file isn't a NumPy array.");
  const major = data[6];
  const len = major >= 2 ? data.readUInt32LE(8) : data.readUInt16LE(8);
  const start = (major >= 2 ? 12 : 10) + len;
  const header = data.toString('latin1', major >= 2 ? 12 : 10, start);
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error('That .npy voice has to be float32 numbers.');
  if (/'fortran_order':\s*True/.test(header)) throw new Error('That .npy voice is stored column-first; save it again with NumPy defaults.');
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number) || [];
  if (shape.reduce((a, b) => a * b, 1) !== 510 * 256) throw new Error(`A Kokoro voice is 510 x 256 numbers; that one is ${shape.join(' x ') || 'empty'}.`);
  return data.subarray(start, start + ROW_BYTES);
}

// PyTorch's .pt is a zip: the tensor's numbers sit in one entry, "<name>/data/0", as they are in memory
function fromPt(data) {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("That .pt file isn't one PyTorch saved (an old-style one? save it again with torch.save).");
  let at = data.readUInt32LE(end + 16);
  const count = data.readUInt16LE(end + 10);
  for (let i = 0; i < count && data.readUInt32LE(at) === 0x02014b50; i++) {
    const method = data.readUInt16LE(at + 10);
    const packed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLen = data.readUInt16LE(at + 28);
    const extraLen = data.readUInt16LE(at + 30);
    const noteLen = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + noteLen;
    if (!/(^|\/)data\/\d+$/.test(name) || size !== ROW_BYTES) continue;
    const begin = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const body = data.subarray(begin, begin + packed);
    return method === 0 ? body : zlib.inflateRawSync(body);
  }
  throw new Error('No Kokoro voice inside that .pt file (510 x 256 numbers).');
}

module.exports = { list, importFile, remove, FREE_ROWS, ROW_BYTES };
