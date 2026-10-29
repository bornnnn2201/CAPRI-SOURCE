// What you meant, from what Whisper wrote down: its usual mistakes on her commands, said short and on
// their own ("Got rest.", "Drawaway.", "Use red ticks."), put back to the command before chat.js reads
// them. Only for what you said out loud (speech.js), never what you typed. Anything longer, or not
// close enough to one of hers, is left as it was.

// mistakes Whisper makes again and again (from her heard\ clips): the whole thing, or a part of it
const MISHEARD = [
  [/^(?:got|god|gone|girl|good|go to|go ahead|gonna)\s+rest$|^gore?st$|^a?rr?est$|^go (?:wrist|rust|rest up)$/, 'go rest'],
  [/^(?:draw|grow|gro|goes?)\s*a\s?way$|^drawaway$|^go way$|^goaway$|^go wait$/, 'go away'],
  [/\b(?:red|reed|read|rib|ribbed|reboot|re boot|we boot|rebooted|rebooting)\s+(?:ticks|tics|topics|optic|op ticks|optics|apt ticks)\b/, 'reboot optics'],
  [/\bsand(?:y|ie|a|e|i)?\s*(?:vista|vistan|vistin|vistan|this tan|v stan|bistan|visstan)\b/, 'sandevistan'],
  [/\bblack\s*(?:ball|wool|well|whirl|wol|walls)\b/, 'blackwall'],
  [/^(?:un|on|and|an)\s*(?:deaf(?:en|in|and|ened)?|defend|defin|the fan)(?:\s+me)?$|^undefined(?:\s+me)?$/, 'undeafen me'],
  [/^(?:deaf(?:en|in|and)|defend|defin|the fan|death in)\s+me$/, 'deafen me'],
  [/^(?:on|and|an)\s*mute(?:\s+me)?$/, 'unmute me'],
  [/^(?:mute|mutes)\s+(?:mi|mean|mee)$/, 'mute me'],
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
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
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
