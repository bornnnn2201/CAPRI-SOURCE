'use strict';

// Everything said between you and her, kept for her chat log window (chatlog.html): what you said,
// what she answered and which brain did (the quick local one, Claude Code, or herself for things she
// does on your PC), with the time. One JSON line each in chatlog.jsonl in her folder, on this PC only.
// It never feeds her chats (memory.json does that, the last ones only): it's yours to read back.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_BYTES = 8 * 1024 * 1024; // past this, the oldest half goes
const file = () => path.join(app.getPath('userData'), 'chatlog.jsonl');

// { who: 'you' | 'capri', text, brain? }
function add(entry) {
  const text = String(entry?.text || '').trim();
  if (!text || !['you', 'capri'].includes(entry.who)) return;
  const line = { at: new Date().toISOString(), who: entry.who, text: text.slice(0, 20000) };
  if (entry.brain) line.brain = String(entry.brain).slice(0, 20);
  try {
    fs.appendFileSync(file(), JSON.stringify(line) + '\n');
    if (fs.statSync(file()).size > MAX_BYTES) {
      const lines = fs.readFileSync(file(), 'utf8').trim().split('\n');
      fs.writeFileSync(file(), lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
    }
  } catch (err) {
    console.error('[capri] chat log:', err.message);
  }
}

// The last `limit` of them, oldest first.
function list(limit = 5000) {
  try {
    return fs.readFileSync(file(), 'utf8').trim().split('\n').slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function clear() {
  try {
    fs.rmSync(file(), { force: true });
  } catch {
    // nothing to clear
  }
}

module.exports = { add, list, clear };
