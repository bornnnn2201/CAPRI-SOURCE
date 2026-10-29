// What you meant, from what Whisper wrote down: its usual mistakes on her commands, said short and on
// their own ("Got rest.", "Drawaway.", "Use red ticks."), put back to the command before chat.js reads
// them. Only for what you said out loud (speech.js), never what you typed. Anything longer, or not
// close enough to one of hers, is left as it was.

// how Whisper writes "deafen", "me", "mic", and "on Discord" after them (kept: $1 / $2 in MISHEARD)
const DEAF = String.raw`(?:deaf(?:en|in|and|ened|on)?|defined|defend|defen|defin|deafin|death in|death and|def in|def and|deaf in|deaf and|bethan|the fan|devon)`;
const ME = String.raw`(?:me|may|mi|mee|mean|myself)`;
const MIC = String.raw`(?:mic|mike|mick|mark|mac|make|meg|nick|microphone|mic phone)`;
const ON_DC = String.raw`((?:\s+(?:on|in|onto)\s+(?:discord|this cord|the cord|discords))?)`;
const ON_DC_REQUIRED = String.raw`(\s+(?:on|in)\s+(?:discord|this cord|the cord|discords))`;

// mistakes Whisper makes again and again (from her heard\ clips): the whole thing, or a part of it
const MISHEARD = [
  [/^(?:got|god|gone|girl|good|go to|go ahead|gonna)\s+rest$|^gore?st$|^a?rr?est$|^go (?:wrist|rust|rest up)$/, 'go rest'],
  [/^(?:draw|grow|gro|goes?)\s*a\s?way$|^drawaway$|^go way$|^goaway$|^go wait$/, 'go away'],
  [/\b(?:red|reed|read|rib|ribbed|reboot|re boot|we boot|rebooted|rebooting)\s+(?:ticks|tics|topics|optic|op ticks|optics|apt ticks)\b/, 'reboot optics'],
  [/\bsand(?:y|ie|a|e|i)?\s*(?:vista|vistan|vistin|vistan|this tan|v stan|bistan|visstan)\b/, 'sandevistan'],
  [/\bblack\s*(?:ball|wool|well|whirl|wol|walls)\b/, 'blackwall'],
  // Discord: "deafen me" heard as "defined me", "deaf in may", "bethan may"; "mic" as "mark", "mike"
  [new RegExp(String.raw`^(?:un|on|and|an)\s*${DEAF}(?:\s+${ME})?${ON_DC}$|^undefined(?:\s+${ME})?${ON_DC}$`), 'undeafen me$1'],
  [new RegExp(String.raw`^${DEAF}\s+${ME}${ON_DC}$|^${DEAF}${ON_DC_REQUIRED}$`), 'deafen me$1'],
  [new RegExp(String.raw`^(?:on|and|an)\s*mute(?:\s+${ME})?${ON_DC}$`), 'unmute me$1'],
  [new RegExp(String.raw`^(un)?(?:mute|mutes|mewt)\s+(?:${ME}|my\s+${MIC})${ON_DC}$`), '$1mute my mic$2'],
  [/^(?:skip|skips|skipped|kip|step|ship)\s+(?:this|the|that)\s*(?:one|song|son|sung|thing|track)?$/, 'skip this song'],
  [/^(?:game|gaming|getting|gamin|gamer)\s*(?:mode|mod|mood|mold)\s*(on|off)$/, 'gaming mode $1'],
  [/^(?:come|calm|comb|com)\s+(?:out|back)$/, 'come out'],
];

// her short commands, for near misses of them (a letter or two off, the spaces anywhere)
const COMMANDS = [
  'go rest', 'go away', 'come out', 'come back', 'wake up', 'skip this song', 'next song', 'pause the music',
  'reboot optics', 'short circuit', 'use blackwall', 'sandevistan', 'overheat', 'system reset',
  'gaming mode on', 'gaming mode off', 'audience mode on', 'audience mode off',
  'mute me', 'unmute me', 'deafen me', 'undeafen me', 'share my screen', 'stop sharing',
  'turn my camera on', 'turn my camera off',
]; // (not "leave the call": a near miss of that is too easily something else, and you'd be out of it)

// You cutting her off, she got it wrong: "no", "stop", "cancel", "wait", "no no no, stop", "never
// mind", "that's wrong", on its own. (Whisper: "Nope.", "No, no, no, no. Cancel.", "Stop it.")
const STOP_WORD = String.raw`(?:no+|nope|nah|stop|stop it|cancel|cancel that|cancel it|wait|hold on|hang on|never ?mind|nevermind|shut up|be quiet|quiet|enough|forget it|abort|not that|that's wrong|that's not it|wrong|no wait|stop stop|capri)`;
const STOP_ASK = new RegExp(String.raw`^(?:${STOP_WORD})(?:\s+(?:${STOP_WORD}|please|that|it|now|capri|you got it wrong|you're wrong|that's not what i said|not that one))*$`);
export function isStop(text) {
  const c = String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:hey|ok(?:ay)?|yo)\s+)?(?:capri|kapri|capree)\s*/, '').replace(OPENERS, '').trim();
  return Boolean(c) && c.split(' ').length <= 9 && c !== 'capri' && STOP_ASK.test(c);
}

// what you call out before the command: "brother, mute my mic", "yo, go rest", "okay so, skip this"
export const OPENERS = /^(?:(?:bro(?:ther)?|bruh|brah|dude|man|mate|homie|choom|yo|okay|ok|alright|right|so|please|pls|can you|could you)\s+)+/;

const letters = (s) => s.replace(/[^a-z]/g, '');

// Levenshtein: how many letters to change, add or take away to get from one to the other
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function heardAs(text) {
  const raw = String(text || '').trim();
  const c = raw.toLowerCase().replace(/[’`]/g, "'").replace(/^(?:(?:hey|ok(?:ay)?|yo)\s+)?(?:capri|kapri|capree)[,.!\s]*/, '')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(OPENERS, '').trim();
  if (!c || c.split(' ').length > 6) return raw;
  for (const [re, meant] of MISHEARD) {
    if (re.test(c)) return c.replace(re, meant);
  }
  // a near miss of one of her commands, when it's that one and no other
  if (c.split(' ').length > 4) return raw;
  const said = letters(c);
  let best = null;
  let second = Infinity;
  for (const cmd of COMMANDS) {
    const d = distance(said, letters(cmd));
    if (!best || d < best.d) {
      second = best ? best.d : Infinity;
      best = { cmd, d };
    } else if (d < second) second = d;
  }
  const room = Math.floor(letters(best.cmd).length / 6);
  return best.d > 0 && best.d <= room && second > best.d ? best.cmd : raw;
}
