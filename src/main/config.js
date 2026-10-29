'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'auto',      // 'auto' follows the system language, or 'fr' / 'en'
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  assistant: 'auto', // the coding assistant she watches: 'claude' or 'codex' ('auto': whichever has her hooks)
  linked: false,     // a Claude Code event has reached her at least once
  chatModel: null,   // the model she talks with (null: the provider's first one)
  provider: 'ollama', // who answers her chat: a key of llm.js PROVIDERS
  apiKeys: {},       // { openai: 'sk-...' }, else the provider's env variable
  customUrl: '',     // the 'custom' provider: any OpenAI-compatible base URL (http://host:port/v1)
  claudeCwd: null,   // the folder Claude Code works in (null: your home folder)
  userName: '',      // what she calls you
  persona: '',       // how you want her, in your words (her chat)
  myLines: [],       // lines of yours she says now and then, with hers
  memories: [],      // things you asked her to remember (her chat)
  claudeMode: 'default', // Claude Code's permission mode in her chat: 'default' only reads, 'acceptEdits' edits without asking
  claude: true,      // she watches Claude Code (off: she just keeps you company, no word of it)
  rest: 'corner',    // where she rests when nothing's going on: 'corner', or 'taskbar' (sitting on it)
  motion: 'auto',    // her animations: 'auto' (like Windows' animation effects), 'full' or 'reduced'
  motionAsked: false, // she asked once, Windows' animations being off, whether to move anyway
  render: 'auto',   // how her window is drawn: 'auto', 'gl' (OpenGL) or 'software' (no graphics card), for PCs that show it black
  follow: true,      // with several screens, she follows the pointer to the one you're on
  jealous: true,     // she gets jealous when she sees you on another AI (bond.js)
  reminders: [],     // the reminders she keeps: [{ id, at, text, made }] (reminders.js)
  bond: null,        // how close she is to you: { xp, first, last, days, streak, caps } (bond.js)
  pcReact: true,     // she reacts to your PC: the processor at full tilt, the battery, the network, a USB stick, a game (pc.js)
  watchScreen: false, // she looks at your screen now and then and says something about it (look.js)
  lookAsked: false,  // she told you what looking means (where the picture goes) and you said yes
  speak: false,      // she says her answers out loud (speech.js, on this PC)
  listen: false,     // the microphone stays on for "Hey Capri" (heard on this PC, never sent anywhere)
  ttsVoice: 'kristin', // the Piper voice she speaks with (speech.js VOICES)
  quick: true,       // two brains: with Claude Code as her main one, a quick local one (Ollama) for what's simple
  quickModel: 'huihui_ai/llama3.2-abliterate:3b', // that one: light (2.2 GB), refusals taken out
  callWith: 'name',  // how you call her: 'name' ("Hey Capri", or her key) or 'key' (only Ctrl+Alt+V: Whisper idle till then)
  hearing: 'fast',   // her ears on the processor: 'fast' (~2 s, the quick model) or 'accurate' (~6 s, the bigger one for requests)
  gaming: false,     // gaming mode: she keeps off the screen you're playing on until you call her
  chipStyle: 'wall', // her biochip's look when put away: wall | blackout | hybrid | relic | crimson | teal | label | industrial (chips.js)
  audience: false,   // audience mode: she hears the PC's own sound too (Discord), so your call can call her
  voiceVolume: 1,    // her spoken voice only, 0 to 2 (her other sounds: volume)
  glitch: 'anime',   // how broken up her voice is: 'subtle', 'anime' or 'heavy' (renderer speech.js)
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load(fresh = false) {
  if (cache && !fresh) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, file, DEFAULTS };
