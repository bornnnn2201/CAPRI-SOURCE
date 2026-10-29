'use strict';

// Her quick brain as a switchboard: for a message her own command words didn't catch (chat.js), the
// small local model says who takes it: herself (a PC command, rewritten in words chat.js knows), the
// quick brain (chat, a quick question), or Claude Code (work, code, thinking it through). Two short
// JSON answers at temperature 0: who takes it, then (hers only) the commands. Anything else, or no
// answer in time, and Claude takes it.

const ollama = require('./ollama');

const WHO = `You sort messages sent to Capri, a desktop assistant. Reply with JSON only: {"route": "do" | "quick" | "claude"}.
"do": the user clearly asks for something to be done on their PC: open, close, move (to another monitor) or switch apps, games or windows, the volume (all of it or one app's, like Discord or the game), saving a clip of the game, music or Spotify (play, skip, pause, shuffle, repeat), gaming mode, lock, sleep, shut down, Windows settings, a screenshot, a web search, a reminder, or one of her effects (blackwall, sandevistan, overheat, system reset, reboot optics, short circuit, cyberpsychosis).
"quick": chat, feelings, thanks, jokes, flirting, romance, short or half-finished sentences, or a simple fact answered in a sentence or two.
"claude": coding, bugs, scripts, plugins, files or projects, writing something long, planning, research, comparing, explaining in depth, maths, anything with several steps, anything about Claude. If unsure between quick and claude, pick claude.
Examples: "turn it up a little" -> do. "save that, that was sick" -> do (a clip). "discord is too loud" -> do. "my friends are too quiet" -> do (Discord). "skip this and shuffle" -> do. "fire up minecraft" -> do. "there you go" -> quick. "lol you're funny" -> quick. "will you be my girlfriend" -> quick. "who sang thriller" -> quick. "make my plugin save to mysql" -> claude. "help me plan my week" -> claude.`;

const HOW = `Rewrite what the user asks into commands for Capri, a desktop assistant. Reply with JSON only: {"do": [command, ...]}, one command per action, in the order asked, each exactly one of these with <...> filled in from the message:
open <app> | close <app> | force close <app> | minimize <app> | maximize <app> | close this window | close this tab
move <app> to my <main|second|other|left|right> monitor | move this to my <main|second|other> monitor
set volume to <number> | volume up | volume down | mute | unmute
set <app> volume to <number> | turn <app> up | turn <app> down | mute <app> | unmute <app> | clip that
spotify shuffle on | spotify shuffle off | spotify repeat song | spotify repeat off | set spotify volume to <number> | spotify volume up | spotify volume down
play <song or playlist> on spotify | next song | previous song | pause music | resume music
gaming mode on | gaming mode off
use blackwall | use sandevistan | use overheat | use system reset | use reboot optics | use short circuit | use cyberpsychosis
lock my pc | put my pc to sleep | shut down my pc | restart my pc | show desktop | take a screenshot | look at my screen
open <setting> settings | search the web for <text> | remind me in <number> minutes to <text>
If nothing fits, reply {"do": []}.
Examples:
"turn it up a little" -> {"do":["volume up"]}
"turn the music down" -> {"do":["volume down"]}
"get rid of steam" -> {"do":["close steam"]}
"throw discord on my other screen" -> {"do":["move discord to my other monitor"]}
"fire up minecraft" -> {"do":["open minecraft"]}
"put spotify on shuffle and skip this" -> {"do":["spotify shuffle on","next song"]}
"spotify to 30 and my pc to 80" -> {"do":["set spotify volume to 30","set volume to 80"]}
"discord's too loud" -> {"do":["turn discord down"]}
"i can't hear the game" -> {"do":["turn the game up"]}
"my friends are too quiet" -> {"do":["turn discord up"]}
"save that, that was sick" -> {"do":["clip that"]}`;

const WHO_SCHEMA = { type: 'object', properties: { route: { type: 'string', enum: ['do', 'quick', 'claude'] } }, required: ['route'] };
const HOW_SCHEMA = { type: 'object', properties: { do: { type: 'array', maxItems: 4, items: { type: 'string' } } }, required: ['do'] };

async function ask(model, system, schema, text, predict, keepAlive, signal) {
  const res = await fetch(`${ollama.base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: keepAlive,
      format: schema,
      options: { temperature: 0, num_predict: predict },
      messages: [{ role: 'system', content: system }, { role: 'user', content: String(text).slice(0, 600) }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  return JSON.parse((await res.json()).message?.content || '{}');
}

// { route: 'do' | 'quick' | 'claude', do: [command…], ms }; Claude when the model can't say in time.
// A command still holding a <placeholder> is left out (chat.js checks the rest reads as one of hers).
async function route(model, text, { timeoutMs = 10000, keepAlive = '1m' } = {}) {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const { route: who } = await ask(model, WHO, WHO_SCHEMA, text, 12, keepAlive, signal);
    if (who !== 'do') return { route: who === 'quick' ? 'quick' : 'claude', do: [], ms: Date.now() - started };
    const out = await ask(model, HOW, HOW_SCHEMA, text, 80, keepAlive, signal);
    const commands = (Array.isArray(out.do) ? out.do : []).map((c) => String(c).trim()).filter((c) => c && !/[<>]/.test(c)).slice(0, 4);
    return { route: 'do', do: commands, ms: Date.now() - started };
  } catch (err) {
    return { route: 'claude', do: [], ms: Date.now() - started, error: err.message };
  }
}

module.exports = { route };
