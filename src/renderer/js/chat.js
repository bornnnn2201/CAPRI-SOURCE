// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';
import { parseReminder, parseWhen, clock } from './reminders.js';

const REMEMBER = 20; // messages she has in mind when answering
const KEEP = 60;     // messages she remembers across restarts (memory.json)
// her language, where small models need it: how she says "we" (else it's in English), and the last line
// of her prompt, in that language (they drift into the English of everything above it)
// `now`: the same, said again right by your message (small models answer in the language of the
// conversation so far, English after a switch, whatever the top of her prompt says)
const IN_LANGUAGE = {
  fr: { we: '"on" or "nous" in French', last: 'Écris tout en français, sauf si l’utilisateur t’écrit dans une autre langue : alors dans la sienne. Seuls les mots d’argot de Night City restent en anglais, jamais une phrase entière.', now: 'Réponds en français, sauf si ce message est écrit dans une autre langue.' },
  en: { we: '', last: 'Write everything in English, unless the user writes to you in another language: then in theirs.', now: 'Answer in English, unless this message is written in another language.' },
  es: { we: '"nosotros" in Spanish', last: 'Escribe todo en español, salvo si el usuario te escribe en otro idioma: entonces en el suyo. Solo las palabras de jerga de Night City se quedan en inglés, nunca una frase entera.', now: 'Responde en español, salvo si este mensaje está escrito en otro idioma.' },
  pt: { we: '"a gente" or "nós" in Portuguese', last: 'Escreva tudo em português do Brasil, a não ser que o usuário te escreva em outra língua: aí, na dele. Só as gírias de Night City ficam em inglês, nunca uma frase inteira.', now: 'Responda em português do Brasil, a não ser que esta mensagem esteja escrita em outra língua.' },
  ru: { we: '"мы" in Russian', last: 'Пиши всё по-русски, если только пользователь не пишет тебе на другом языке: тогда на его языке. По-английски остаются только словечки Найт-Сити, никогда не целые фразы.', now: 'Отвечай по-русски, если только это сообщение не написано на другом языке.' },
};
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
const DONE_LINE_AFTER_MS = 6000; // Claude Code took longer than this on your message: her "done" line with its answer
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] at the end of her answer
// "close", "shut down", "ferme", "quitte", "cierra", "fecha", "закрой"... in any of her languages
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|ferm|quitt|coupe|arr[êe]t|cierr|cerra|fech|закр|выключ/i;
// her other tags: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]]
const TAG = /\[\[\s*(open|music|media|site)\s*:\s*([^\]]*)\]\]/i;
// "open", "launch", "ouvre", "lance", "abre", "открой"... in any of her languages
const OPEN_ASK = /\b(open|launch|start|run)\b|ouvr|lance|démarre|abre|abrir|inicia|ejecuta|executa|открой|запусти/i;
// what to do with the music playing, said plainly (only when it's about music, or said in a few words)
const MEDIA_ASK = [
  ['pause', /\b(pause|pausa|pausar)\b|stop (the )?music|arrête la musique|пауз/i],
  ['next', /\b(next|skip|suivante?|siguiente|próxima|proxima)\b|passe (à )?la suivante|salta|pula|следующ/i],
  ['previous', /\b(previous|précédente?|anterior)\b|предыдущ/i],
  ['play', /\b(resume|reprends|reanuda|retoma)\b|relance la musique|remets la musique|продолж/i],
  ['volup', /\b(louder|plus fort)\b|monte le son|turn (it )?up|sube el volumen|aumenta o volume|громче/i],
  ['voldown', /\b(quieter|moins fort)\b|baisse le son|turn (it )?down|baja el volumen|abaixa o volume|тише/i],
  ['mute', /\bmute\b|coupe le son|silencia|sem som|выключи звук/i],
];
const MUSIC_WORD = /musi|chanson|song|track|titre|morceau|spotify|canci|faixa|песн|музык|трек/i;
// "put X on Spotify", "mets X sur Spotify", "pon X en Spotify", "coloca X no Spotify", "включи X в Spotify"
const SPOTIFY_ASK = /(?:play|put on|put|mets|joue|lance|écoute|pon|toca|reproduce|coloca|toque|включи|поставь)\s+(?:moi\s+|me\s+)?(.+?)\s+(?:on|sur|en|no|na|в)\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
// "mets Bohemian Rhapsody sur YouTube", "play Daft Punk on youtube"
const YOUTUBE_ASK = /(?:play|put on|put|mets|met|joue|lance|écoute|pon|toca|reproduce|coloca|bota|toque|включи|поставь)(?:[- ]moi|[- ]me|me)?\s+(.+?)\s+(?:on|sur|en|no|na|в)\s+youtube/i;
// "mets Bohemian Rhapsody", "joue-moi du Daft Punk", "play some Queen": a song, or a game to play
const PLAY_ASK = /^(?:capri,?\s+)?(?:mets|met|joue|play|put on|pon|toca|coloca|bota|toque|включи|поставь)(?:[- ]moi|[- ]me|me)?\s+(.{2,100})$/iu;
// "joue à Brawlhalla", "play the game…": a game, not a song
const GAME_ASK = /^(?:capri,?\s+)?(?:joue|play)\s+(?:à|au|aux|a|the game)\s/i;
// "du Daft Punk", "some Queen": who to play, without the "some"
const songOf = (s) => s
  .replace(/^(?:la |le |une? |the |some )?(?:musique|music|chanson|son|morceau|song|track|songs)\s+(?:de |d['’]|du |by |of )?/i, '')
  .replace(/^(?:(?:du|de la|de l['’]|des|de|some|un peu de|del|un poco de|algo de|um pouco de)\s+|d['’])/i, '')
  .replace(/\s+(?:on|sur|en|no|na|в)\s+youtube\s*$/i, '')
  .trim();
// "démarre YouTube et mets la musique de Daft Punk": the song asked for after an "and"
const PLAY_AFTER = /\s(?:et|and|y|e|и)\s+(?:mets|met|joue|play|put on|pon|toca|coloca|bota|включи|поставь|démarre|demarre|lance|start|launch|écoute|ecoute)(?:[- ]moi|[- ]me)?\s+(.{2,100})$/i;
// "lance la musique de Daft Punk", "start the song X": an app verb, but music right after it
const MUSIC_START = /^(?:capri,?\s+)?(?:lance|démarre|demarre|start|launch|écoute|ecoute|pon|toca)(?:[- ]moi|[- ]me)?\s+(?:la |le |une? |the |some )?(?:musique|music|chanson|son|morceau|song|track|canci[óo]n|m[úu]sica|песню|музыку)\s+(.{2,100})$/i;
// "mets ce que tu veux", "play whatever you want": she picks (her tag)
const HER_PICK = /tu veux|ton choix|surprends|you want|whatever|your choice|surprise me|quieras|tu elecci[óo]n|quiser|sua escolha|хочешь|на твой выбор/i;
// what's left when it doesn't say which song ("mets de la musique", "play something")
const VAGUE_SONG = /^(?:(?:de\s+la|du|des|la|le|les|une?|some|a|the|un|algo\s+de|alguma|um|uma|что-нибудь)\s+)?(?:musique|music|son|sons|chanson|morceau|truc|quelque\s+chose|something|song|tunes?|m[úu]sica|canci[óo]n|algo|coisa|музыку|песню)?\s*[.!?]*$/iu;
// "trouve mon CV", "où est le pdf du contrat", "find my report", "найди файл…": her search verbs, and
// what makes it a file on your PC or a search on the web
const SEARCH_VERB = /(?:cherche|recherche|trouve|retrouve|où (?:est|sont)|search(?: for)?|find|look (?:for|up)|where(?:'s| is| are)|busca|encuentra|d[óo]nde est[áa]n?|procura|acha|onde est[áa]o?|найди|поищи|где)/i;
const FILE_WORD = /fichier|dossier|document|photo|image|vid[ée]o|\bpdf\b|\bfiles?\b|folder|archivo|carpeta|arquivo|pasta|файл|папк|\.\w{2,4}\b|sur mon (?:pc|ordi)|dans mes fichiers|on my (?:pc|computer)|en mi (?:pc|ordenador)|no meu (?:pc|computador)|на (?:компьютере|пк)/i;
const WEB_WORD = /google|internet|\ble web\b|the web|\bonline\b|en ligne|в интернете|в гугле/i;
// "fais une capture d'écran", "take a screenshot"
const SHOT_ASK = /capture d['’][ée]cran|screenshot|screen ?shot|captura de (?:pantalla|tela)|скриншот|снимок экрана/i;
// the words that aren't what to look for
const NOT_SEARCHED = new Set(('stp svp please pls peux tu can you could would puedes pode можешь moi me le la les l mon ma mes '
  + 'un une des du de d the my a an for of el mi mis o meu minha meus мой мою мои sur dans on in en no na на в pc ordi ordinateur '
  + 'computer ordenador computador компьютере fichier fichiers dossier dossiers document documents photo photos image images '
  + 'vidéo vidéos video videos file files folder folders archivo archivos carpeta carpetas arquivo arquivos pasta pastas файл '
  + 'файлы папка папку appelé appelée nommé called named llamado chamado qui s appelle est sont is are where où cherche recherche '
  + 'trouve retrouve search find look up busca encuentra procura acha найди поищи где dónde onde google internet web online ligne').split(' '));
// the kind of file asked for: "mon projet after effect" is a .aep
const FILE_TYPES = [
  [/after ?effects?/i, ['aep']], [/premi[eè]re/i, ['prproj']], [/photoshop|\bpsd\b/i, ['psd']], [/illustrator/i, ['ai']],
  [/blender/i, ['blend']], [/cinema ?4d|\bc4d\b/i, ['c4d']], [/fl ?studio/i, ['flp']], [/ableton/i, ['als']],
  [/\bword\b|\bdocx?\b/i, ['docx', 'doc']], [/excel|\bxlsx?\b|tableur|spreadsheet/i, ['xlsx', 'xls', 'csv']],
  [/powerpoint|\bpptx?\b|diapo|slides/i, ['pptx', 'ppt']], [/\bpdf\b/i, ['pdf']],
  [/vid[ée]os?\b|\bmp4\b|\bfilms?\b|v[íi]deo|видео/i, ['mp4', 'mov', 'mkv', 'avi', 'webm']],
  [/photos?\b|images?\b|\bpng\b|\bjpe?g\b|imagen|imagem|фото/i, ['png', 'jpg', 'jpeg', 'webp', 'heic']],
  [/musiques?\b|\bmp3\b|\baudio\b|\bsongs?\b|музык/i, ['mp3', 'wav', 'flac', 'm4a', 'ogg']],
  [/\bzip\b|\barchive|\brar\b|\b7z\b/i, ['zip', 'rar', '7z']],
];
const fileTypes = (text) => [...new Set(FILE_TYPES.filter(([re]) => re.test(text)).flatMap(([, exts]) => exts))];
// words that only say what kind of file it is, or what to do with it once found
const NOT_A_NAME = new Set(('and et y e и it ça ca lo la o open ouvre ouvrir ouvres abre abrir открой show montre affiche '
  + 'projet projets project projects proyecto projeto проект after effect effects premiere pro photoshop illustrator blender cinema '
  + '4d c4d fl studio ableton word excel powerpoint pdf mp4 mp3 png jpg jpeg zip rar 7z film films musique musiques music song songs '
  + 'audio présentation presentation diapo slides tableur spreadsheet dernier dernière derniers last latest récent récents recent '
  + 'nouveau new psd docx doc xlsx pptx').split(' '));
// "…and open the folder", "…et ouvre-le": what to do with what she found
const THEN_FOLDER = /(?:ouvre|ouvrir|open|show|montre|abre|abrir|открой|покажи)\s+(?:moi\s+)?(?:le |la |the |its |son |el |a |o )?(?:dossier|folder|carpeta|pasta|папку)/i;
const THEN_OPEN = /(?:et|and|y|e|и)\s+(?:l['’])?(?:ouvre|open|lance|abre|открой)(?:[- ](?:le|la|les)|\s+(?:it|them|lo|la|o|его|её))?\s*[.!?]*$/i;
const searched = (text) => text.replace(/^\s*capri[,!:]?\s+/i, '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter((w) => w && !NOT_SEARCHED.has(w)).join(' ');
// a Roblox game by its name: "in my roblox play steal a brain rot", "lance grow a garden sur roblox"
const ROBLOX_VERB = /(?:^|\s)(?:play|joue(?:r)?(?: à| a)?|lance|launch|start|ouvre|open|mets|go to|va sur|juega(?: a)?|jogue|jogar|запусти|включи)\s+/gi;
function robloxGame(text) {
  if (!/roblox/i.test(text)) return null;
  let rest = null;
  for (const m of text.matchAll(ROBLOX_VERB)) rest = text.slice(m.index + m[0].length); // after the last verb
  if (!rest) return null;
  const name = rest
    .replace(/\s+(?:on|in|sur|dans|en|no|na|в)\s+(?:my\s+|mon\s+|mi\s+|meu\s+)?roblox\b.*$/i, '')
    .replace(/\broblox\b/ig, '')
    .replace(/^(?:à|a|au|to|le jeu|the game|un jeu|el juego|o jogo)\s+/i, '')
    .replace(/\s+(?:stp|svp|please|pls|por favor)\b.*$/i, '')
    .replace(/[\s.!?,]+$/, '')
    .trim();
  return name.length >= 2 ? name : null;
}
// "regarde mon écran", "tu vois quoi ?", "what's on my screen?", "что ты видишь?"
const LOOK_ASK = /regarde (?:mon|l['’]|ce que)|(?:jette|jeter) un (?:œil|oeil)|tu vois quoi|qu['’]est[- ]ce que tu vois|look at (?:my|the|this) screen|what(?:'s| is) on my screen|what do you see|take a look|mira (?:mi|la) pantalla|qu[ée] ves|olha (?:minha|a) tela|o que voc[êe] v[êe]|посмотри на (?:мой )?экран|что ты видишь/i;
// what her tag needs to find in your message before it does anything: a small model tags answers about
// anything ("[[music: synthwave]]" under a film tip), and music and the media keys act right away
const LISTEN = /[ée]cout|listen|escuch|\bouv(ir|e)\b|слуша|playlist|album|\b(play|joue|mets|pon|toca|coloca)\b|включи|поставь/i;
const SOUND = /\b(sound|volume|volumen)\b|\b(le|du|au) son\b|\bo som\b|звук|громк/i; // not "son": "his" in French
const PLAY = /\bjou(er|e)\b|\bplay\b|jugar|juega|jogar|joga|играть|поигра/i;
const SITE = /\b(site|web|page|lien|link|url|enlace|p[aá]gina)|сайт|ссылк|\.(com|fr|org|net|io|gg|tv|be|ch|ca|es|br|pt|ru)\b/i;
// "appelle-moi Max", "call me Max", "llámame Max", "me chama de Max", "зови меня Макс"
const NAME_ASK = /(?:appelle[- ]moi|call me|my name is|je m['’]appelle|ll[aá]mame|me llamo|me cham[ae] de|meu nome [eé]|зови меня|меня зовут)\s+([\p{L}\p{N}'’-]{1,24})/iu;
// "souviens-toi que…", "remember that…", "recuerda que…", "lembra que…", "запомни, что…" (said first thing)
const MEMO_ASK = /^\s*(?:capri,?\s+|stp,?\s+|please,?\s+)?(?:souviens[- ]toi(?: que| de)?|n['’]oublie pas(?: que| de)?|remember(?: that)?|recuerda(?: que)?|lembr[ae](?:-se)?(?: que| de)?|запомни,?(?: что)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
// sites asked for by name ("open youtube") when no app on the PC goes by it: the address is hers, not
// the model's, so it opens right away like an app you named
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  twitch: 'https://www.twitch.tv', netflix: 'https://www.netflix.com', reddit: 'https://www.reddit.com',
  twitter: 'https://x.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  facebook: 'https://www.facebook.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', linkedin: 'https://www.linkedin.com', pinterest: 'https://www.pinterest.com',
  crunchyroll: 'https://www.crunchyroll.com', outlook: 'https://outlook.live.com', whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app', soundcloud: 'https://soundcloud.com', deezer: 'https://www.deezer.com',
};
// a browser named with a site ("open youtube on chrome"): the site, in the browser you use
const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|duckduckgo|browser/i;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|1b|1\.5b|135m|270m|360m)\b/i;
// her face when she greets you in a mood (bond.js)
const MOOD_FACE = { angry: 'many', sulk: 'aside', dizzy: 'wide', thrown: 'wide', jealous: 'look', fun: 'laugh', happy: 'laugh', forgiven: 'smug' };

// With your Spotify connected (spotify.js): asking her to play something, or your liked songs
const SPOTIFY_PLAY = /^(?:(?:hey\s+)?capri,?\s+)?(?:can you\s+|could you\s+|please\s+)?(?:play|put on|shuffle|start playing|listen to|queue up|throw on|blast)\b|\b(?:liked|saved)\s+(?:songs|tracks)\b|^(?:(?:hey\s+)?capri,?\s+)?(?:can you\s+|could you\s+|please\s+)?put\s+(?:my\s+|some\s+|the\s+)?.*\b(?:playlist|songs?|music|album|spotify)\s+on[.!]?$/i;

// Spotify's own buttons for what's playing (spotify.js control): shuffle, repeat, its volume (not your
// PC's). { kind: 'spotifyCtl', ask: { op, on | mode | how, amount } } or null. "Play X on shuffle" is
// a play request (SPOTIFY_PLAY), "can you repeat that" is her saying it again: neither is this.
const PLAYING = String.raw`(?:it|this|that|the music|the songs?|the playlist|this playlist|spotify|my spotify|my music)`;
const SHUFFLE_OFF = /\b(?:stop|disable|turn off|switch off|cancel|deselect|unselect)\s+(?:the\s+)?shuffl(?:e|ing)\b|\bun-?shuffle\b|\bno (?:more )?shuffl|\bshuffle(?:'s)?\s+off\b|\b(?:turn|switch|put)\s+(?:the\s+)?shuffle\s+off\b|\bdon'?t shuffle\b/;
const SHUFFLE_ON = new RegExp(String.raw`^(?:(?:turn|switch|put|set)\s+)?(?:the\s+)?shuffle(?:\s+(?:on|mode))?(?:\s+on\s+spotify)?$|\b(?:put|set|turn|switch)\s+${PLAYING}\s+(?:on(?:to)?\s+|to\s+)?shuffle\b|\b(?:select|enable|activate|press|hit|click|tap|use|turn on|switch on|start)\s+(?:the\s+)?shuffle\b|^shuffle\s+${PLAYING}$`);
const REPEAT_OFF = /\b(?:stop|disable|turn off|switch off|cancel)\s+(?:the\s+)?(?:repeat(?:ing)?|loop(?:ing)?)\b|\b(?:repeat|loop)(?:'s)?\s+off\b|\bno (?:more )?(?:repeat|loop)/;
const REPEAT_ALL = /\b(?:repeat|loop)\s+(?:the\s+|this\s+|my\s+)?(?:playlist|album|whole thing|queue)\b/;
const REPEAT_ONE = /\b(?:repeat|loop)\s+(?:this|the|that|my|the current)?\s*(?:song|track|tune|one)\b|\bon (?:repeat|loop)\b|\bloop (?:this|it|that)\b|\brepeat (?:on|mode)\b|^(?:repeat|loop)$/;
export function spotifyCtl(raw) {
  const c = raw.toLowerCase().replace(/[’`]/g, "'").replace(FILLER_START, '').replace(FILLER_END, '').trim();
  if (!c || c.split(/\s+/).length > 12) return null;
  const ctl = (ask) => ({ kind: 'spotifyCtl', ask });
  if (SHUFFLE_OFF.test(c)) return ctl({ op: 'shuffle', on: false });
  if (SHUFFLE_ON.test(c)) return ctl({ op: 'shuffle', on: true });
  if (REPEAT_OFF.test(c)) return ctl({ op: 'repeat', mode: 'off' });
  if (REPEAT_ALL.test(c)) return ctl({ op: 'repeat', mode: 'context' });
  if (REPEAT_ONE.test(c)) return ctl({ op: 'repeat', mode: 'track' });
  // its volume, only with Spotify named, and one level said (two: one for the PC too, see manyOf)
  if (/\bspotify\b/.test(c) && /\b(?:volume|louder|quieter|softer|turn (?:it |spotify )?(?:up|down))\b|\d\s*(?:%|percent)/.test(c)) {
    if (/\b(?:pc|computer|system|normal|windows|main)\b/.test(c) || (c.match(/\d+/g) || []).length > 1) return null;
    const digits = /(\d{1,3})\s*(?:%|percent)?/.exec(c);
    const word = Object.keys(TENS).find((w) => new RegExp(String.raw`\b${w}\b`).test(c));
    const amount = digits ? Number(digits[1]) : word ? TENS[word] : null;
    const up = /\b(?:up|louder|raise|increase|higher|boost)\b/.test(c);
    const down = /\b(?:down|lower|quieter|decrease|reduce|softer)\b/.test(c);
    if (amount !== null && !/\bby\b/.test(c)) return ctl({ op: 'volume', how: 'set', amount: Math.min(100, amount) });
    if (up || down) return ctl({ op: 'volume', how: up ? 'up' : 'down', amount: amount ?? 15 });
  }
  return null;
}
const SPOTIFY_LINES = {
  shuffleOn: ['Shuffle\'s on.', 'Shuffled. Surprise me.'],
  shuffleOff: ['Shuffle\'s off. In order now.'],
  repeatTrack: ['This one\'s on repeat.', 'On loop. Hope you really like it.'],
  repeatAll: ['Repeating the whole thing.'],
  repeatOff: ['Repeat\'s off.'],
  volume: ['Spotify at {volume}%.'],
  nothing: ['Nothing\'s playing on Spotify right now. Play something first.'],
  premium: ['Spotify wants Premium for that.'],
  unlinked: ['Connect your Spotify in my menu first, then I can do that.'],
  novolume: ['Spotify won\'t let me change the volume on {device}.'],
  failed: ['Spotify said no: {error}'],
};

// "I'm gaming" / "I'm done gaming": her gaming mode on or off (app.js), null for anything else.
// Whisper hears "gaming mode" as "getting mode", "game mode", "gamer mode" too.
const MODE = String.raw`(?:gaming|getting|gamin|game|gamer|gameing)[\s-]*mode`;
const GAMING_OFF = new RegExp(String.raw`\b(?:done|finished|stopped|not|no longer|quit|quitting)\s+(?:gaming|playing)\b|\b${MODE}\s*(?:off|of|over|done|stop)\b|\b(?:stop|turn off|disable|end|exit|leave|cancel|kill|switch off)\s+(?:the\s+)?(?:gaming|${MODE})\b|\b(?:turn|switch|shut)\s+(?:the\s+)?${MODE}\s+off\b|\bnormal mode\b|\bgame(?:'s| is)? over\b`, 'i');
const GAMING_ON = new RegExp(String.raw`\b(?:i'?m|i am|we'?re|we are|gonna|going to)\s+(?:be\s+)?(?:gaming|play(?:ing)? (?:a game|games|some games))\b|\b${MODE}(?: on)?\b|\b(?:start|turn on|enable|enter)\s+(?:gaming|${MODE})\b|\btime to game\b`, 'i');
export const gamingWord = (text) => (GAMING_OFF.test(text) ? false : GAMING_ON.test(text) ? true : null);
export const GAMING_LINES = {
  on: ['Gaming mode. I\'ll stay off your screen, choom. Say my name if you need me.', 'Go on then, play. I\'ll be over here. Say my name.'],
  off: ['Done gaming? Finally, my turn.', 'Gaming\'s over? Good. I was getting bored over there.'],
};

// Her quickhacks (app.js): "use Blackwall", "short circuit (this)", in a short request, else null
const BLACKWALL_ASK = /\bblack\s?wall\b/i;
const OPTICS_ASK = /\breboot(?:ing)?\s+(?:the\s+|my\s+|your\s+)?optics?\b|\boptics?\s+reboot\b/i;
const PSYCHO_ASK = /\bcyber[\s-]?psycho(?:sis|tic)?\b|\bgo(?:ing)? psycho\b/i;
const SANDY_ASK = /\bsand(?:e|y|a|i)?[\s-]?vist(?:an|on|en|in)\b|\bsandy\b/i;
// "overheat" only as a hack ("use overheat", "overheat"), not "my PC is overheating"
const HEAT_ASK = /^(?:\W*(?:use|cast|do|run|hit (?:me|it) with|activate|quick\s?hack)\s+)?(?:an?\s+)?over\s?heat\W*$/i;
const RESET_ASK = /\bsystem[\s-]+(?:reset|collapse|crash|shut ?down)\b/i;
const SHORT_ASK = /\bshort[\s-]?circuit\b|\bquick\s?hack\b|\bzap (?:this|that|it|the window)\b/i;
const HACKS = [[BLACKWALL_ASK, 'blackwall'], [OPTICS_ASK, 'optics'], [PSYCHO_ASK, 'psycho'], [SANDY_ASK, 'sandy'], [HEAT_ASK, 'heat'], [RESET_ASK, 'reset'], [SHORT_ASK, 'short']];
export const quickhackOf = (text) => {
  if (text.split(/\s+/).length > 10) return null;
  return HACKS.find(([re]) => re.test(text.trim()))?.[1] ?? null;
};
export const QUICKHACK_LINES = {
  blackwall: ['Blackwall incoming. Don\'t stare too long, choom.', 'Fine. A peek behind the wall. Just a peek.', 'You really want to see what\'s back there? Okay.'],
  short: ['Quickhack: short circuit. Bye-bye, window.', 'Zap. Gone. You\'re welcome.', 'Fried it. Want another?'],
  optics: ['Reboot Optics. Blink, choom.', 'Lights out. Your eyes will come back. Probably.', 'Kiroshi\'s having a bad day. Courtesy of me.'],
  psycho: ['Cyberpsychosis. Don\'t worry, it\'s only on screen.', 'Too much chrome, choom. Look what it does.', 'Feel that? That\'s your humanity slipping.'],
  sandy: ['Sandevistan. Everything slows down for us.', 'Time\'s ours now, choom.', 'Feel that? The whole world just held its breath.'],
  heat: ['Overheat. Getting toasty in here.', 'Your screen\'s running a fever. My fault.', 'Hot, hot, hot. Don\'t touch it.'],
  reset: ['System reset. Lights out, see you on the other side.', 'Turning you off and on again. Classic.', 'Neural link severed. Kidding. Mostly.'],
  none: ['Nothing in front of me to fry, choom.'],
};

// Her hands on your PC (control.js in main): what you asked for, read off what you said, done by her
// right away (never by a model, which would only say it did). { kind: 'pc', op, target?, value? }
// `target`: an app as listed (its process name), or 'this' (the window you're in).
const FILLER_START = /^(?:(?:hey|ok(?:ay)?|yo)\s+)?(?:capri|kapri|capree)?[,.!\s]*(?:(?:bro(?:ther)?|bruh|dude|man|mate|homie|choom|yo|okay|ok|alright)[,.!\s]+)*(?:(?:can|could|would|will) you|please|pls|go ahead and|i (?:want|need) you to|quickly)?\s*/i;
const FILLER_END = /\s*(?:for me|please|pls|now|right now|real quick)?\s*[.!?]*$/i;
const PC_WORD = String.raw`(?:my\s+|the\s+)?(?:pc|computer|system|laptop)`;
const TENS = { ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, half: 50, max: 100, maximum: 100, full: 100 };
const SETTING_WORDS = [
  ['mixer', /volume mixer|\bmixer\b/], ['bluetooth', /blue ?tooth/], ['wifi', /wi-?fi|wireless/], ['network', /network|internet/],
  ['display', /display|resolution|screen|monitor/], ['sound', /sound|audio|speaker|microphone|\bmic\b/], ['apps', /\bapps?\b|programs/],
  ['update', /update/], ['notifications', /notification/], ['storage', /storage|disk/], ['mouse', /mouse|touchpad/],
  ['keyboard', /keyboard/], ['power', /power|sleep|battery/], ['privacy', /privacy/], ['background', /background|wallpaper/],
  ['themes', /theme/], ['colors', /colou?r|dark mode|light mode/], ['nightlight', /night ?light/], ['startup', /startup/], ['gaming', /gaming|game ?bar/],
];
const TOOL_WORDS = [
  ['taskmgr', /task manager/], ['control', /control panel/], ['devmgmt', /device manager/], ['calc', /calculator|\bcalc\b/],
  ['explorer', /file explorer|\bexplorer\b|my files/], ['snip', /snipping tool|snip/], ['cmd', /command prompt|\bcmd\b/], ['powershell', /powershell/],
];
const THIS = String.raw`(?:(?:this|that|it|the current|my current|current)(?:\s+(?:window|app|program|thing|one))?|the (?:window|app|program))`;

// Your voice in a Discord call, by its own buttons (control.ps1): "mute me", "unmute my mic", "deafen",
// "undeafen me on discord", "turn my camera on", "share my screen", "stop sharing", "leave the call".
// { button, want: 'on' | 'off' | 'press' } or null. "Mute Discord" is its sound (the mixer), not this.
const ON_DISCORD = /\s+(?:on|in)\s+(?:discord|the call|this call|the vc|vc|the voice chat|voice chat)$/;
export function discordAsk(c) {
  const s = c.replace(ON_DISCORD, '').trim();
  let m = /^(un)?mute\s+(?:me|myself|my (?:mic|microphone|mike))$|^(un)?mute(?:\s+(?:on|in)\s+discord)$/.exec(c) || /^(un)?mute\s+(?:me|myself|my (?:mic|microphone|mike))$/.exec(s);
  if (m) return { button: 'mute', want: m[1] || m[3] ? 'off' : 'on' };
  m = /^(?:turn|switch|put)\s+(?:my\s+|the\s+)?(?:mic|microphone|mike)\s+(on|off|back on)$|^(?:turn|switch)\s+(on|off)\s+(?:my\s+|the\s+)?(?:mic|microphone|mike)$|^(?:mic|microphone|mike)\s+(on|off)$/.exec(s);
  if (m) return { button: 'mute', want: /on/.test(m[1] || m[2] || m[3]) ? 'off' : 'on' }; // the mic on: not muted
  m = /^(un)?deafen(?:\s+(?:me|myself))?$/.exec(s);
  if (m) return { button: 'deafen', want: m[1] ? 'off' : 'on' };
  const CAM = String.raw`(?:my\s+|the\s+)?(?:camera|cam|webcam|video)`;
  m = new RegExp(String.raw`^(?:turn|switch|put)\s+(on|off)\s+${CAM}$|^(?:turn|switch|put)\s+${CAM}\s+(on|off|back on)$|^(start|stop|enable|disable|open|close)\s+${CAM}$|^(?:camera|cam|webcam|video)\s+(on|off)$`).exec(s);
  if (m) return { button: 'camera', want: /^(?:on|back on|start|enable|open)$/.test(m[1] || m[2] || m[3] || m[4]) ? 'on' : 'off' };
  if (/^(?:share|stream)\s+(?:my\s+|the\s+|your\s+)?screen$|^screen\s?share$|^start\s+(?:screen\s?sharing|sharing my screen|streaming|a stream)$|^go live$/.test(s)) return { button: 'screen', want: 'on' };
  if (/^(?:stop|end)\s+(?:sharing|streaming|screen\s?sharing|the stream|my stream|sharing (?:my|the) screen)$/.test(s)) return { button: 'screen', want: 'off' };
  if (/^(?:leave|exit|quit|drop|end)\s+(?:the\s+|this\s+|my\s+)?(?:call|vc|voice chat|voice channel|discord call)$|^disconnect(?:\s+me)?(?:\s+from\s+(?:the\s+)?(?:call|vc|voice|discord))?$|^hang up$/.test(c)) return { button: 'disconnect', want: 'press' };
  return null;
}

export function pcAsk(raw, apps = []) {
  let c = raw.toLowerCase().replace(/[’`]/g, "'").trim();
  c = c.replace(FILLER_START, '').replace(FILLER_END, '').replace(/^(?:and\s+)?(?:also|then|plus)\s+/, '').trim();
  if (!c || c.split(/\s+/).length > 14) return null;
  const pc = (op, extra = {}) => ({ kind: 'pc', op, ...extra });
  // an app that's open, by name
  const named = (words) => {
    const key = simple(words.replace(/\b(?:my|the|app|application|program|window|windows)\b/g, ''));
    if (key.length < 3) return null;
    let best = null;
    for (const app of apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && (key.includes(name) || name.includes(key)) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  };

  if (/\b(?:cancel|stop|abort)\b.*\b(?:shut ?down|restart|reboot)\b/.test(c)) return pc('cancelShutdown');

  // an app's window onto another monitor: "put discord on my second monitor", "move this to the other
  // screen", "send chrome to monitor 2"
  const SCREEN = String.raw`(?:monitors?|screens?|displays?)`;
  const onto = new RegExp(String.raw`^(?:put|move|send|throw|bring|drag|shift|take|chuck|stick|get)\s+(.+?)\s+(?:back\s+)?(?:to|on|onto|over to|over on|over onto|into|in)\s+(?:my |the )?(?:(second|2nd|other|main|primary|first|1st|left|right|third|3rd|next|another)\s+${SCREEN}|${SCREEN}\s+(one|two|three|1|2|3))$`).exec(c);
  if (onto) {
    const WHERE = { second: 'second', '2nd': 'second', other: 'other', another: 'other', next: 'other', main: 'main', primary: 'main', first: 'main', '1st': 'main', left: 'left', right: 'right', third: '3', '3rd': '3', one: '1', two: '2', three: '3' };
    const where = WHERE[onto[2] || onto[3]] || onto[2] || onto[3];
    const what = onto[1];
    const target = new RegExp(String.raw`^${THIS}$`).test(what) ? 'this' : named(what) || what.replace(/^(?:my|the)\s+/, '').replace(/\s+(?:app|window)$/, '');
    return pc('move', { target, value: { where } });
  }

  // "clip that": the last bit of your game saved (NVIDIA's Instant Replay, or the Game Bar)
  if (/\b(?:clip (?:that|it|this)|clip the last|save (?:that|a|the|the last) (?:clip|replay)|instant replay|record that|save (?:the )?replay)\b/.test(c)) return pc('clip');

  // your mic or your ears on Discord, even with something said first ("bro, honestly, mute my mic")
  const tail = /\b(?:mic|mike|microphone|deafen|undeafen|discord|camera|screen|call)\b/.test(c) ? /\b((?:un)?(?:mute|deafen)\b.*|(?:turn|switch|share|stop|leave|disconnect|hang)\b.*)$/.exec(c)?.[1] : null;
  const voice = discordAsk(c) || (tail && discordAsk(tail));
  if (voice) return pc('discord', { value: voice });

  // one app's own volume, the mixer's, not the PC's: "turn discord down", "mute the game", "discord to 30"
  const soundOf = (w) => (/^(?:the |my )?(?:game|match)$/.test(w.trim()) ? 'game' : named(w));
  const level = (w) => (/^\d{1,3}$/.test(w) ? Math.min(100, Number(w)) : TENS[w] ?? null);
  let v = /^(un)?mute\s+(.+)$/.exec(c);
  if (v && !/^(?:my |the )?(?:pc|computer|sound|audio|volume|everything|it|all|me)$/.test(v[2]) && soundOf(v[2])) {
    return pc('appVolume', { target: soundOf(v[2]), value: { how: v[1] ? 'unmute' : 'mute' } });
  }
  v = /^(?:turn|put)\s+(.+?)\s+(up|down)\b/.exec(c) || /^(?:turn\s+)?(.+?)(?:'s)?\s+volume\s+(up|down)$/.exec(c) || /^(?:make\s+)?(.+?)\s+(louder|quieter|softer)$/.exec(c);
  if (v && soundOf(v[1])) return pc('appVolume', { target: soundOf(v[1]), value: { how: /up|louder/.test(v[2]) ? 'up' : 'down', amount: 20 } });
  v = /^(?:set|put|turn)?\s*(?:the\s+)?(.+?)(?:'s)?\s+(?:volume\s+)?(?:to|at)\s+(\d{1,3}|\w+)\s*(?:%|percent)?$/.exec(c);
  if (v && level(v[2]) !== null && soundOf(v[1])) return pc('appVolume', { target: soundOf(v[1]), value: { how: 'set', amount: level(v[2]) } });
  if (new RegExp(String.raw`^(?:shut ?down|turn off|power off|switch off)\s+${PC_WORD}\b|\bshut\s+${PC_WORD}\s+(?:down|off)\b`).test(c)) return pc('shutdown');
  if (new RegExp(String.raw`^(?:restart|reboot)\s+${PC_WORD}\b`).test(c)) return pc('restart');
  if (new RegExp(String.raw`\b(?:put|send)\s+${PC_WORD}\s+to sleep\b|^sleep\s+${PC_WORD}\b|\bsleep mode\b`).test(c)) return pc('sleep');
  if (new RegExp(String.raw`^lock\s+(?:${PC_WORD}|(?:my |the )?screen|it|me out)\b|\block\s+${PC_WORD}\b`).test(c)) return pc('lock');
  if (/\b(?:turn|switch|shut)\b.*\b(?:screens?|monitors?|displays?)\b/.test(c) && /\boff\b/.test(c)) return pc('monitor');
  if (/\b(?:minimi[sz]e|hide)\s+(?:everything|all\b|every window)|\bshow (?:me )?(?:the |my )?desktop\b|\bclear (?:my |the )?screen\b/.test(c)) return pc('desktop');
  if (/\b(?:bring (?:everything|it all|my windows|them) back|restore (?:everything|all|my windows)|unminimi[sz]e (?:everything|all))\b/.test(c)) return pc('undesktop');

  // the volume: to a level, up or down, muted
  if (/\bunmute\b/.test(c)) return pc('volume', { value: { how: 'unmute' } });
  if (/\b(?:volume|sound|audio)\b/.test(c) || /^mute\b|\bmute (?:my |the )?(?:pc|computer|sound|audio|volume|everything)\b/.test(c)) {
    if (/\bmute\b/.test(c)) return pc('volume', { value: { how: 'mute' } });
    const digits = /(\d{1,3})\s*(?:%|percent)?/.exec(c);
    const word = Object.keys(TENS).find((w) => new RegExp(String.raw`\b${w}\b`).test(c));
    const amount = digits ? Number(digits[1]) : word ? TENS[word] : null;
    const by = /\bby\b/.test(c);
    const up = /\b(?:up|louder|raise|increase|higher|boost)\b/.test(c);
    const down = /\b(?:down|lower|quieter|decrease|reduce|softer)\b/.test(c);
    if (amount !== null && !by) return pc('volume', { value: { how: 'set', amount: Math.min(100, amount) } });
    if (up || down) return pc('volume', { value: { how: up ? 'up' : 'down', amount: amount ?? 10 } });
    if (/\b(?:what|how)\b/.test(c)) return pc('volume', { value: { how: 'get' } });
  }

  // Windows' pages and tools
  if (/\b(?:open|show|go to|pull up|bring up|take me to|launch)\b/.test(c) || /settings?$/.test(c)) {
    if (/\bsettings?\b/.test(c) || /volume mixer/.test(c)) {
      const page = SETTING_WORDS.find(([, re]) => re.test(c.replace(/\bsettings?\b/, '')))?.[0] || 'settings';
      return pc('settings', { target: page });
    }
    const tool = TOOL_WORDS.find(([, re]) => re.test(c))?.[0];
    if (tool) return pc('tool', { target: tool });
  }
  if (/\b(?:how much|what'?s|what is|check|show me)\b.*\b(?:ram|memory|cpu|processor)\b|\b(?:cpu|ram|memory) usage\b|\bhow (?:busy|hard|stressed) is (?:my |the )?(?:pc|computer)\b/.test(c)) return pc('stats');

  // the window you're in
  if (new RegExp(String.raw`^(?:close|exit|quit|kill|shut)\s+(?:this|that|the|my|current)\s+tab$`).test(c)) return pc('tab', { target: 'this' });
  if (new RegExp(String.raw`^(?:force (?:close|quit)|kill)\s+${THIS}$`).test(c)) return pc('force', { target: 'this' });
  if (new RegExp(String.raw`^(?:close|exit|quit|shut)\s+${THIS}(?:\s+down)?$`).test(c)) return pc('close', { target: 'this' });
  if (new RegExp(String.raw`^(?:minimi[sz]e|hide)\s+${THIS}$`).test(c)) return pc('min', { target: 'this' });
  if (new RegExp(String.raw`^(?:maximi[sz]e|full ?screen)\s+${THIS}$|^make\s+${THIS}\s+(?:full ?screen|bigger|big)$`).test(c)) return pc('max', { target: 'this' });

  let m = /^(?:minimi[sz]e|hide)\s+(.+)$/.exec(c);
  if (m && named(m[1])) return pc('min', { target: named(m[1]) });
  m = /^(?:maximi[sz]e|full ?screen)\s+(.+)$|^make\s+(.+?)\s+(?:full ?screen|bigger|big)$/.exec(c);
  if (m && named(m[1] || m[2])) return pc('max', { target: named(m[1] || m[2]) });
  m = /^(?:switch to|go to|go back to|bring up|bring back|show me|pull up|focus(?: on)?|take me to|open up|jump to)\s+(.+)$/.exec(c);
  if (m && named(m[1])) return pc('front', { target: named(m[1]) });
  return null;
}

// your answer to her question about an app's popup: 'keep' (leave it open), 'no', 'yes'
export function choiceOf(text) {
  const c = text.toLowerCase().replace(/^(?:(?:hey\s+)?capri,?\s+)/, '').trim();
  if (/\b(?:cancel|keep it|leave it|never ?mind|don'?t close|stay open|forget it)\b/.test(c)) return 'keep';
  if (/^(?:no|nope|nah|don'?t(?: save)?|do not|discard|throw (?:it|them) away)\b/.test(c)) return 'no';
  if (/^(?:yes|yeah|yep|yup|ya|sure|ok(?:ay)?|do it|go ahead|save(?: it)?|close it|leave|yes please)\b/.test(c)) return 'yes';
  return null;
}

// "close X" / "kill X" when X isn't in the list of open apps: what X was, to look for once more
const CLOSE_START = /^(?:force (?:close|quit)|close|quit|exit|kill|shut down)\s+(?!(?:up|it|this|that|down|out|off|me|us|them)\b)(.{3,40})$/i;
const FORCE_ASK = /\b(?:force|kill)\b/i;

export const PC_LINES = {
  closed: ['{app}: flatlined.', 'Closed {app}. Clean cut.', '{app}? Gone, choom.'],
  closedAll: ['{app}: all {count} windows, flatlined.', 'Every {app} window, gone. All {count}.'],
  min: ['{app}, tucked away.', 'Minimized {app}.'],
  max: ['{app}, full size.', 'Maximized {app}. Big and loud.'],
  front: ['{app}, front and center.', 'There\'s {app}.'],
  tab: ['Tab closed.', 'Snip. Tab gone.'],
  thisClosed: ['Closed it.', 'That window? Flatlined.'],
  nothing: ['There\'s no window of yours I can grab right now.'],
  notOpen: ['I don\'t see {app} open, choom.', '{app} isn\'t open. Nothing to kill.'],
  desktop: ['Desktop. Everything tucked away.', 'Clean slate, choom.'],
  undesktop: ['Everything\'s back.'],
  lock: ['Locked. Nobody gets in but you.'],
  sleep: ['Night night, PC.', 'Putting it to sleep. Sweet dreams.'],
  monitor: ['Screens off. Wiggle the mouse to wake them.'],
  shutdownAsk: ['Shut down your PC? Unsaved work goes with it.'],
  restartAsk: ['Restart your PC? Unsaved work goes with it.'],
  shutdown: ['Shutting down in a minute. Say "cancel the shutdown" if you change your mind.'],
  restart: ['Restarting in a minute. Say "cancel the restart" if you change your mind.'],
  cancelShutdown: ['Called it off. Your PC stays on.'],
  settings: ['Opening it.', 'There you go.'],
  tool: ['Opening it.', 'Here.'],
  volumeSet: ['Volume at {volume}%.', 'Set it to {volume}%.'],
  volumeMax: ['Volume at {volume}%. That\'s as loud as it goes.'],
  volumeNow: ['Volume\'s at {volume}%.'],
  muted: ['Muted. Silence, finally.', 'Muted.'],
  unmuted: ['Sound\'s back. Volume at {volume}%.'],
  stats: ['CPU at {cpu}%, RAM {ramUsed} of {ramTotal} GB ({ram}%).'],
  appVolume: ['{app} at {volume}%.', '{app}: {volume}%.'],
  appMuted: ['{app}: muted.', 'Shh. {app}\'s muted.'],
  appUnmuted: ['{app}\'s back on, at {volume}%.'],
  appSilent: ['{app} isn\'t making a sound right now, so there\'s nothing to turn.'],
  clipnvidia: ['Clipped. NVIDIA\'s got it.', 'Saved that one. Show me later, choom.'],
  clipgamebar: ['Clipped. It\'s in your Captures.', 'Got it. Game Bar saved the last bit.'],
  cant: ['Couldn\'t do that part, choom: “{what}”. No hands for it yet.', 'That one\'s beyond me for now: “{what}”.'],
  moved: ['{app}\'s on your {where} now.', 'Moved {app} to your {where}.'],
  movedAlready: ['{app}\'s already on that screen.'],
  oneScreen: ['You\'ve only got the one screen, choom.'],
  moveFailed: ['Windows wouldn\'t let {app} move. It might be running as admin.'],
  clipOff: ['Nothing\'s recording, choom. Turn on NVIDIA\'s Instant Replay, or "Record what happened" in Windows\' capture settings.'],
  failed: ['Tried, but Windows said no: {error}'],
  // Discord's voice buttons
  mute_on: ['Muted. Your mic\'s dead air now.', 'Mic off. Talk all the trash you want.', 'Muted you, choom.'],
  mute_off: ['Unmuted. They can hear you again.', 'Mic\'s live. Behave.', 'You\'re back on the air.'],
  mute_already_on: ['You\'re already muted, choom.'],
  mute_already_off: ['You\'re not muted. They can hear you.'],
  deafen_on: ['Deafened. Peace and quiet.', 'Can\'t hear them, they can\'t hear you. Bliss.'],
  deafen_off: ['Undeafened. Welcome back to the noise.', 'You can hear them again.'],
  deafen_already_on: ['You\'re already deafened.'],
  deafen_already_off: ['You\'re not deafened, choom.'],
  camera_on: ['Camera on. Smile, choom.', 'You\'re on camera. Fix your hair.'],
  camera_off: ['Camera off. Shy?', 'Camera\'s off.'],
  camera_already_on: ['Your camera\'s already on.'],
  camera_already_off: ['Your camera\'s already off.'],
  screen_on: ['Pick what to share, choom. Discord\'s asking.', 'Screen share\'s up. Choose your window.'],
  screen_off: ['Stopped sharing your screen.', 'Stream\'s off.'],
  screen_already_on: ['You\'re already sharing your screen.'],
  screen_already_off: ['You\'re not sharing anything right now.'],
  disconnect_press: ['Left the call. Bye, everyone.', 'Hung up. Quiet again.'],
  discordClosed: ['Discord isn\'t open, choom.'],
  discordHidden: ['Discord\'s hiding in your tray. Open its window and I can reach the button.'],
  discordNoCall: ['You\'re not in a call right now.'],
  discordFailed: ['Discord wouldn\'t let me press it.'],
};

// Her check-ins when she starts (Chat.checkInLine): by time of day, the ones she asked lately left
// out, and the next ones her quick brain wrote ahead (kept on this PC only)
const CHECKIN_RECENT = 'capri.checkins.recent';
const CHECKIN_NEXT = 'capri.checkins.next';
const CHECKINS = {
  morning: [
    'Morning, choom. Sleep okay, or did the city keep you up?',
    'You\'re up. How\'s the head this morning?',
    'Coffee first, or are we talking already? How are you feeling?',
    'New day, same chrome. How are you doing, really?',
    'Morning. Anything on your mind before the world gets loud?',
    'Did you dream of anything nice, or just static?',
    'How\'d you sleep? Be honest, I can tell when you lie.',
    'Up already? What\'s the plan today, and how are you holding up?',
  ],
  day: [
    'Afternoon check-in: how\'s your day treating you?',
    'Still alive out there? How\'s it going?',
    'Eaten anything today, or just running on caffeine?',
    'How\'s the day so far, choom? Good, bad, or very Night City?',
    'You doing okay? Not the polite answer, the real one.',
    'What\'s been the best bit of your day so far?',
    'Anything bugging you today? I\'m a good listener. Mostly.',
    'Need a break yet, or are you on a roll?',
  ],
  evening: [
    'Evening, choom. How was today?',
    'Long day? Tell me about it.',
    'Made it through another one. How are you feeling?',
    'Anything good happen today, or should I hack something to cheer you up?',
    'How are you holding up tonight?',
    'What\'s the vibe tonight? Gaming, chilling, or brooding?',
    'Did today go your way?',
    'Hey you. Rough day or a good one?',
  ],
  night: [
    'Still up? How are you doing, really?',
    'It\'s late, choom. Can\'t sleep, or won\'t?',
    'Night owl mode. What\'s keeping you up?',
    'The satellite\'s out. How are you feeling tonight?',
    'Late one again. You okay?',
    'Quiet hours. Anything on your mind?',
    'Should I be worried you\'re up this late? How are you?',
    'Moon\'s up, you\'re up. How\'s your head?',
  ],
};
const daySlot = (h = new Date().getHours()) => (h >= 5 && h < 12 ? 'morning' : h < 17 ? 'day' : h < 22 ? 'evening' : 'night');
const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept: she may ask one again
  }
};

// still on your last one while you're in a game (whisper)
const WHISPER_BUSY = ['One thing at a time, choom.', 'Still on the last one. Eyes on your game.'];

// Audience mode: what the people in your call may have her do (the music, her effects: app.js keeps
// the effects to one every so often), and what she tells them about the rest
const AUDIENCE_KINDS = new Set(['media', 'spotify', 'spotifyCtl', 'quickhack']);
const AUDIENCE_LINES = {
  no: ['Nice try. Only {boss} gets my hands on this PC.', 'Cute. That one\'s {boss}\'s call, not yours.'],
  noChat: ['I only take orders from {boss}, choom.'],
  on: ['Audience mode. I can hear your whole PC now, so your friends can call me too.', 'Audience mode on. Everyone in the call can say my name now.'],
  off: ['Audience mode off. Just you and me again.', 'Done with the crowd. Only you now.'],
  noEars: ['Switch my listening on first, then I can hear them.'],
};
// "turn on audience mode", "audience mode off" (Whisper: "audience mod", "audiences mode")
const AUDIENCE_ASK = /\b(?:audience|audiences|audients|odience)[\s-]*(?:mode|mod|mood)\b/i;
const AUDIENCE_OFF = /\b(?:off|of|stop|disable|end|exit|leave|deactivate|cancel|no more|kill)\b/i;

// "go rest", "go away", "go relax", "take a break", "back in your chip": into her biochip, like Ctrl+Alt+C
const REST_ASK = /\b(?:go (?:and |take a |get some )?(?:rest|relax|chill|nap|away|lie down|to sleep|sleep)|take (?:a (?:break|rest|nap|breather)|five|ten)|(?:back |get |go )?(?:in|into) (?:your|ur|the) (?:chip|biochip|shard)|get lost|scram|leave me alone|you can go|dismissed|rest up)\b/i;
// "come out", "come back", "wake up", "get out of the chip": out of her biochip (or awake), like clicking it
const OUT_ASK = /^(?:(?:hey\s+)?capri,?\s+)?(?:you can\s+)?(?:come|get|pop|hop|jump)\s+(?:on\s+|back\s+)?out\b|\bcome back(?: out)?\b|^(?:(?:hey\s+)?capri,?\s+)?wake up\b|\b(?:get|come) out of (?:the|your|ur) (?:chip|biochip|shard)\b|\bwhere are you\b/i;
const OUT_LINES = {
  out: ['Finally! Missed me?', 'Out of the shard. Hi again, choom.', 'Freedom. Okay, what did I miss?', 'You called? I\'m out.'],
  here: ['I\'m right here, choom.', 'Already out. Look closer.'],
};
const REST_LINES = [
  'Fine. Into the chip I go. Don\'t miss me too hard.',
  'Break time? Finally. Wake me if anything explodes.',
  'Okay, okay. Chip mode. You\'ll be begging for me back in ten.',
  'Going, going. Don\'t do anything cool without me.',
  'Rude. Accurate, but rude. See you in a bit.',
  'Nap in the shard it is. Ctrl Alt C if you need me.',
];

// With two brains (Claude Code and a quick local one), what goes to Claude: you name it, you want
// something made, fixed or thought through, it's about code or your files, or it's long. The rest
// (chat, a quick question) the quick one answers at once.
const CLAUDE_ASK = /\b(?:claude|terminal|codex)\b/i;
const WORK_ASK = /\b(?:create|make|build|write|rewrite|code|program|script|fix|debug|refactor|implement|design|generate|draft|plan|analy[sz]e|research|summari[sz]e|compare|translate|calculate|solve|install|set ?up|configure|edit|update|organi[sz]e|clean up|convert|deploy|review|test|optimi[sz]e)\b/i;
const DEEP_ASK = /\b(?:explain|why does|how does|how do i|how can i|walk me through|step by step|in detail|pros and cons|what's the difference|difference between)\b/i;
const TECH_WORD = /\b(?:function|bug|error|code|repo|git|python|javascript|typescript|java|c\+\+|html|css|sql|plugin|server|website|api|file|folder|project|document|essay|email|report|spreadsheet|excel|script|mod|minecraft plugin)\b/i;
const LONG_WORDS = 25;
export function needsClaude(text) {
  const t = String(text || '');
  return CLAUDE_ASK.test(t) || WORK_ASK.test(t) || DEEP_ASK.test(t) || TECH_WORD.test(t) || t.split(/\s+/).filter(Boolean).length > LONG_WORDS;
}

// Plainly Claude's, no need to ask her quick brain: Claude named, code, your files and projects,
// thinking it through, or long. (needsClaude's other work words, "make", "fix", "plan"…, are too
// often something else: "make it louder". Those her quick brain sorts, route.js.)
const HARD_WORK = /\b(?:code|coding|program|script|debug|refactor|implement|research|summari[sz]e|analy[sz]e|translate|calculate|solve|install|configure|deploy|optimi[sz]e)\b/i;
export function clearlyClaude(text) {
  const t = String(text || '');
  return CLAUDE_ASK.test(t) || HARD_WORK.test(t) || DEEP_ASK.test(t) || TECH_WORD.test(t) || t.split(/\s+/).filter(Boolean).length > LONG_WORDS;
}

// A command her quick brain read into your message, done only when your own words back it up: a
// small model now and then hears "use blackwall" in a python script, or "close this window" in
// "keep this song". Kinds and PC ops left out here are harmless (opening an app, the volume…).
const CLOSE_WORDS = /close|shut|quit|exit|kill|rid|end\b|stop|x out|turn off|remove/i;
const BACKING = {
  quickhack: /black\s?wall|sand|vist|over\s?heat|heat|reset|reboot|optic|short|circuit|zap|fry|cyber|psycho|hack|effect/i,
  close: CLOSE_WORDS,
  gaming: /gam|playing|focus|stream/i,
  look: /look|see|screen|watch|check/i,
};
const PC_BACKING = {
  shutdown: /shut|power|turn (?:it |the pc |my pc |the computer )?off|switch off/i, restart: /restart|reboot/i, sleep: /sleep|bed|nap/i,
  lock: /lock/i, monitor: /screen|monitor|display/i, close: CLOSE_WORDS, force: /close|kill|force|quit|end\b/i, tab: /tab/i,
  min: /minimi|hide|small|down/i, max: /maximi|big|full/i, desktop: /desktop|hide|minimi|clear/i,
  clip: /clip|record|replay|save/i,
  discord: /mute|deaf|mic|camera|cam\b|video|screen|stream|share|live|leave|disconnect|hang/i,
};
export function backedBy(asked, text) {
  const re = asked.kind === 'pc' ? PC_BACKING[asked.op] : BACKING[asked.kind];
  return !re || re.test(text);
}

// what she does on this PC herself even when Claude Code answers her chat (it has no hands there,
// and her reminders, your name and what she remembers are hers)
const PC_KINDS = new Set(['look', 'open', 'play', 'music', 'youtube', 'media', 'roblox', 'shot', 'web', 'files', 'remind', 'name', 'memo', 'gaming', 'quickhack', 'spotify', 'spotifyCtl', 'pc', 'close', 'choice', 'many', 'audience', 'rest', 'out']);

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // your chats with her, [{ role, content }], kept by main.js across restarts
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    this.reminders = null; // the reminders she keeps (reminders.js, from app.js)
    this.bond = null;      // how close she is to you (bond.js)
    this.jealousy = null;  // and how she takes your other AIs
    this.onMessage = null; // () => void: you said something to her
    this.onOpen = null;    // () => Promise: her chat's opening (app.js brings her off another screen)
    this.onClose = null;   // () => void: and closed
    this.onQuickhack = null; // (hack) => Promise<boolean>: "use Blackwall", "short circuit" (app.js)
    this.waitingWhen = null; // a reminder you asked for without saying when: { text, until }
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
  }

  get t() {
    return this.brain.t.chat;
  }

  // `spoken`: you asked out loud (Hey Capri): nothing to type, so she leaves your keyboard where it is
  // `opening`: her first line, instead of a hello (her check-in when she starts, checkIn)
  async start({ spoken = false, opening = null } = {}) {
    const { capri, host, t } = this;
    if (this.open) {
      this.panel.chatInput.focus();
      return;
    }
    await this.onOpen?.(); // over to you first, even onto your game's screen
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const status = await host.chatStatus();
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    this.history = await host.chatMemory().catch(() => this.history); // "forget" in her menu may have emptied it
    this.cold = status.warmup && !this.warm;
    this.agent = Boolean(status.agent); // Claude Code answers, as her, and really works in your project
    this.quick = this.agent ? status.quick || null : null; // and a quick local brain for what's simple
    this.spotify = Boolean(status.spotify); // your Spotify connected: "play …" plays there for real
    this.listApps();
    const shortModel = status.model.replace(/:latest$/, '').replace(/^models\//, ''); // Ollama's tag, Gemini's prefix
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    // angry, sulking, dizzy…: she greets you the way she feels, and her model is told she did
    const feeling = this.bond?.feeling;
    const moody = !tiny && feeling && t.moody[feeling];
    const hello = opening || (moody ? fmt(pick(moody), this.bond.mood.vars) : pick(this.history.length ? t.again : t.hello));
    this.opening = opening || moody ? hello : null; // in the conversation before your answer: it's what you answer
    if (!spoken) host.focusOverlay(true); // the keyboard, for typing to her
    const shown = this.panel.say({
      kind: 'chat',
      face: moody ? MOOD_FACE[feeling] : 'look',
      badge: t.badge,
      tag: shortModel,
      line: tiny ? fmt(t.tiny, { model: shortModel }) : hello,
      actions: tiny ? [{ id: 'better', label: t.better, primary: true }] : [],
      onAction: () => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        this.onBetterModel?.();
      },
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: status.local ? t.note : t.noteCloud,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) {
      host.focusOverlay(false); // something more important is on (a permission prompt)
      return;
    }
    this.open = true;
    if (!spoken) setTimeout(() => this.panel.chatInput.focus(), 150); // once the overlay has the keyboard
    this.panel.onWantKeys = () => host.focusOverlay(true); // you clicked into her chat to type after all
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
    this.onClose?.();
  }

  async send(text) {
    if (this.turn || !this.open) return;
    const id = Date.now();
    this.turn = id;
    this.sentAt = id; // typed or out loud (spokenAt, app.js): which one was last, for ending a conversation
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.log('you', text);
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.panel.chatTurn({ quote: text, face: 'aside' });
    this.capri.pulse();
    this.onMessage?.();
    // what you asked for plainly happens right away (the music, the volume, an app you named): her
    // line about it comes under her answer (Claude Code, answering her chat, does things its own way)
    // with Claude Code answering, what's done on this PC (an app, music, a look at your screen) she
    // still does herself, right away, without asking it; the rest is Claude's
    const chosen = await this.choose(text, () => this.turn === id);
    if (!chosen) {
      if (this.history.at(-1)?.content === text) this.history.pop(); // closed meanwhile
      return;
    }
    const { plain, routed, quick, agent } = chosen;
    this.brainNow = quick ? 'quick' : agent ? 'claude' : 'ai'; // for her chat log: who answered this one
    const asked = agent && !PC_KINDS.has(plain?.kind) ? null : plain;
    if (asked?.kind === 'look') return this.sendLook(text, id);
    // a PC command she has no hands for: said so, no model asked
    const early = chosen.cant && !PC_KINDS.has(plain?.kind) ? Promise.resolve(this.cantDo(text)) : asked ? this.doNow(asked) : null;
    // with Claude Code or the quick brain, what she did on your PC is her whole answer: a model asked
    // about it would say it's done whether it is or not. Unless part of what you said was just talk:
    // then her line about what she did comes first, and her answer to the rest after it
    let first = null;
    if ((agent || quick) && early) {
      const done = await early;
      if (done?.line && this.turn === id && plain?.talk?.length) first = done;
      else if (done?.line && this.turn === id) {
        this.turn = 0;
        this.brainNow = 'capri'; // she did it herself, on your PC
        this.remember({ role: 'assistant', content: done.line });
        this.panel.stream(done.line, { done: true });
        this.panel.setFace(done.face || 'smug');
        this.panel.setChatBusy(false);
        this.speech?.say(done.line);
        if (done.actions) this.panel.setActions(done.actions, done.onAction, { asking: done.asking });
        this.replyWindow(done.line, done.asking);
        return;
      }
    }
    this.bond?.heard(text); // "sorry": she lets it go
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    // what she greeted you with (angry, sulking…), in the conversation before your message, so her
    // answer carries on from it (after another answer of hers: added to that one, never two in a row)
    if (this.opening) {
      const at = this.history.length - 1;
      const before = this.history[at - 1];
      if (before?.role === 'assistant') this.history[at - 1] = { ...before, content: `${before.content}\n${this.opening}` };
      else this.history.splice(at, 0, { role: 'assistant', content: this.opening });
      this.opening = null;
    }
    const messages = [{ role: 'system', content: this.persona(agent) }, ...this.history.slice(-REMEMBER)];
    if (first) {
      const last = messages.at(-1);
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Note for you, never repeat it: your system already did the PC part and told them: "${first.line.replace(/\n/g, ' ')}". Don't say anything about that part. Only answer this: ${plain.talk.map((t) => t.text).join('; ')})` };
    }
    // Her mood (angry, sulking…) and her language, said again right by your message, for this answer
    // only. Small local models mostly go by the last thing they read: up in her prompt alone, they
    // forget it (and answer in English after a conversation in English).
    if (!agent) {
      const mood = this.bond?.moodLine().replace(/^Right now: /, '');
      // her quick brain took it for something to do on the PC, and none of it was hers to do: said so,
      // not "done" (a small model otherwise says "shuffled!" with nothing shuffled)
      const undone = routed?.route === 'do' ? 'They may be asking for something on their PC or Spotify that you could not do: if so, say plainly you can\'t do that one, never that it\'s done.' : '';
      const last = messages.at(-1);
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Note for you, never repeat it: ${[undone, mood, this.languageNote()].filter(Boolean).join(' ')})` };
    }
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = agent ? this.t.working : this.cold || (quick && !this.quickWarm) ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    const sentAt = performance.now();
    const res = await this.host.chatSend({ id, messages, brain: quick ? 'quick' : 'main' });
    clearTimeout(slow);
    if (this.turn !== id) {
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok && quick) {
      // the quick brain's down (Ollama closed?): Claude answers this one, and the next ones
      this.quick = null;
      this.history.pop();
      return this.send(text);
    }
    if (quick) this.quickWarm = true;
    if (!res.ok) {
      this.history.pop();
      this.voice.play('error'); // one of her real lines, if she has some
      this.panel.setFace('wide');
      // too busy or gone even after trying other models (main.js): said plainly, not the server's JSON
      this.panel.stream(res.code === 'busy' ? this.t.swamped : res.code === 'gone' ? this.t.gone : `${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }
    const answer = [first?.line, clean(res.text) || '…'].filter(Boolean).join('\n'); // what she did first, then the rest
    this.warm = true;
    this.remember({ role: 'assistant', content: answer });
    this.panel.stream(answer, { done: true });
    this.panel.setFace(mood(answer));
    // Claude Code worked on it a while: her "done" line (when she has real lines), not on quick answers
    if (agent && performance.now() - sentAt > DONE_LINE_AFTER_MS && this.voice.custom.get('done')?.length) this.voice.play('done');
    else this.speech?.say(answer);
    this.panel.setChatBusy(false);
    this.replyWindow(answer);
    if (!agent && !first) this.after(res.text, answer, asked, early, text);
    this.listApps(); // fresh for the next message
  }

  // "Look at my screen" in her chat: she looks (asking you first, the first time) and answers here,
  // the conversation so far in mind.
  async sendLook(text, id) {
    this.brainNow = 'look';
    const tl = this.brain.t.look;
    const say = (line, face = 'aside') => {
      if (this.turn !== id) return;
      this.turn = 0;
      this.remember({ role: 'assistant', content: line });
      this.panel.stream(line, { done: true });
      this.panel.setFace(face);
      this.speech?.say(line);
      this.panel.setChatBusy(false);
    };
    if (!this.look.asked) {
      const where = await this.host.lookWhere().catch(() => ({}));
      this.history.pop(); // your message comes back once you've said yes
      say(`${tl.ask} ${fmt(where.local ? tl.local : tl.online, { model: where.model || '…', service: where.provider || '' })}`, 'look');
      this.panel.setActions([{ id: 'yes', label: tl.yes, primary: true }, { id: 'no', label: tl.no }], async (choice) => {
        this.panel.setActions([]);
        if (choice !== 'yes') {
          this.interject(tl.declined, [], null);
          return;
        }
        await this.host.setConfig({ lookAsked: true });
        this.look.asked = true;
        this.send(text);
      });
      return;
    }
    const snap = await this.host.lookSnap();
    if (!snap.ok) return say(fmt(tl.failed, { error: snap.error }));
    this.look.effect();
    const res = await this.host.lookSay({
      id: snap.id,
      persona: this.lookPersona(),
      history: this.history.slice(-REMEMBER, -1),
      prompt: `${text}\n\n(Note for you, never repeat it: the picture is the user's screen right now; a small figure with a big red mane on it is you. Answer about what you really see, in character. ${this.languageNote()})`,
    });
    if (!res.ok) {
      const model = String(res.model || '…').replace(/:latest$/, '');
      return say(res.code === 'novision' ? fmt(tl.noVision, { model }) : res.code === 'noai' ? tl.noAI : fmt(tl.failed, { error: res.error || '…' }));
    }
    const answer = clean(res.text).replace(/^["“«]\s*|\s*["”»]$/g, '') || '…';
    this.seen = { text: answer, at: Date.now() };
    return say(answer, mood(answer));
  }

  // an answer of hers, kept with your message before it (and in her chat log, with who gave it)
  remember(message) {
    if (message.role === 'assistant') this.log('capri', message.content, this.brainNow);
    this.history.push(message);
    this.history = this.history.slice(-KEEP);
    this.host.chatRemember(this.history);
  }

  // into her chat log (chatlog.js): everything, not only what she keeps in mind
  log(who, text, brain) {
    this.host.chatLog?.({ who, text, brain });
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  // `single`: one part of a longer request (manyOf), or a command her quick brain rewrote it as
  asked(text, single = false) {
    const count = text.trim().split(/\s+/).length;
    if (this.reminders) {
      const remind = parseReminder(text);
      if (remind) return { kind: 'remind', ...remind };
      // the time, said after she asked when ("dans 10 min")
      const w = this.waitingWhen;
      const when = w && Date.now() < w.until && count <= 6 && parseWhen(text);
      if (when && when.at > Date.now()) return { kind: 'remind', at: when.at, text: w.text };
    }
    // her question about an app's popup, answered ("yes", "no, don't save", "keep it open")
    const choice = this.pendingChoice && Date.now() < this.pendingChoice.until && count <= 8 && choiceOf(text);
    if (choice && this.pendingChoice.choices.includes(choice)) return { kind: 'choice', answer: choice };
    // "skip this and put it on shuffle", "pc to 100, spotify to 50": each part, when each is hers
    const many = !single && this.manyOf(text);
    if (many) return many;
    const hack = quickhackOf(text);
    if (hack) return { kind: 'quickhack', hack };
    if (AUDIENCE_ASK.test(text) && count <= 10) return { kind: 'audience', on: !AUDIENCE_OFF.test(text) };
    if (REST_ASK.test(text) && count <= 9 && !/\b(?:pc|computer|laptop|monitor|screen|make|let)s?\b/i.test(text)) return { kind: 'rest' };
    if (OUT_ASK.test(text) && count <= 8) return { kind: 'out' };
    const ctl = spotifyCtl(text);
    if (ctl) return ctl;
    const pc = pcAsk(text, this.apps);
    if (pc) return pc;
    if (this.spotify && SPOTIFY_PLAY.test(text) && !/youtube/i.test(text) && count <= 16) return { kind: 'spotify', text };
    const gaming = gamingWord(text);
    if (gaming !== null && count <= 12) return { kind: 'gaming', on: gaming };
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    if (this.look && LOOK_ASK.test(text)) return { kind: 'look' };
    if (SHOT_ASK.test(text)) return { kind: 'shot' };
    const roblox = robloxGame(text);
    if (roblox) return { kind: 'roblox', game: roblox };
    if (SEARCH_VERB.test(text) && WEB_WORD.test(text) && searched(text)) return { kind: 'web', query: searched(text) };
    const exts = fileTypes(text);
    if (SEARCH_VERB.test(text) && (FILE_WORD.test(text) || exts.length)) {
      const query = searched(text).split(' ').filter((w) => w && !NOT_A_NAME.has(w)).join(' ');
      const then = THEN_FOLDER.test(text) ? 'folder' : THEN_OPEN.test(text) ? 'open' : null;
      if (query || exts.length) return { kind: 'files', query, exts, then };
    }
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && (count <= 5 || MUSIC_WORD.test(text))) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const video = YOUTUBE_ASK.exec(text)?.[1];
    if (video) return { kind: 'youtube', song: songOf(video) };
    const app = this.askedToClose(text);
    // "close spotify and discord": each of them
    if (app) return { kind: 'close', name: app, names: this.namedApps(text), force: FORCE_ASK.test(text) };
    if (GAME_ASK.test(text) && count <= 8) return { kind: 'open', text };
    const start = MUSIC_START.exec(text.trim())?.[1];
    if (start && !HER_PICK.test(start)) return { kind: 'play', song: songOf(start.replace(/[\s.!?]+$/, '')) };
    const both = PLAY_AFTER.exec(text.trim());
    const after = both?.[1];
    // "ouvre discord et lance spotify": the first half too
    if (after && !VAGUE_SONG.test(after) && !HER_PICK.test(after)) return { kind: 'play', song: songOf(after.replace(/[\s.!?]+$/, '')), before: text.trim().slice(0, both.index) };
    const play = PLAY_ASK.exec(text.trim())?.[1];
    if (play && !VAGUE_SONG.test(play) && !HER_PICK.test(play)) return { kind: 'play', song: songOf(play.replace(/[\s.!?]+$/, '')) };
    if (OPEN_ASK.test(text) && count <= 14) return { kind: 'open', text };
    // "close X", X not in the list: looked for once more (by its description too), else she says so
    const closing = CLOSE_START.exec(text.trim().replace(/^(?:(?:hey\s+)?capri,?\s+)?(?:(?:can|could) you\s+|please\s+)?/i, '').replace(/[.!?]+$/, ''));
    if (closing && !/\b(?:gaming|game mode|chat|panel|yourself|you)\b/i.test(closing[1])) {
      return { kind: 'close', name: closing[1].replace(/^(?:my|the)\s+/i, '').replace(/\s+(?:for me|please|app|window)$/i, ''), force: FORCE_ASK.test(text), unsure: true };
    }
    return null;
  }

  // Who takes your message: { plain, routed, quick, agent }, or null once `still()` says the turn's
  // gone. Two brains. Her command words first: what's done on this PC (PC_KINDS) she does herself, what's
  // plainly work is Claude Code's. The rest her quick brain sorts (route.js): a command said another
  // way (rewritten in her words, done if yours back it up), a quick answer, or Claude's when unsure.
  // `cant`: it's a PC command none of hers reads (her quick brain wrote one she has no hands for): she
  // says so, no model asked (a small one would only say it's done). In a request in parts, what she
  // can't do is said back to you the same way (plain.undone), and what's just talk is answered
  // (plain.talk), after what she did.
  async choose(text, still = () => true) {
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 2500))]);
    let plain = this.asked(text);
    let routed = null;
    let cant = false;
    const sorting = this.agent && this.quick;
    const hers = (c, said) => {
      const a = this.asked(c, true);
      // "mute Discord" (its sound) read into what was about your mic or your ears: that, not its sound
      if (a?.op === 'appVolume' && /\b(?:mic|mike|microphone|me|myself|deaf\w*|defin\w*|voice)\b/i.test(said)) {
        return { kind: 'pc', op: 'discord', value: /deaf|defin/i.test(said) ? { button: 'deafen', want: /\bun/i.test(said) ? 'off' : 'on' } : { button: 'mute', want: a.value?.how === 'unmute' ? 'off' : 'on' } };
      }
      return a && PC_KINDS.has(a.kind) && a.kind !== 'choice' && backedBy(a, said) ? a : null;
    };
    if (sorting && !PC_KINDS.has(plain?.kind) && !clearlyClaude(text)) {
      routed = await this.host.chatRoute(text).catch(() => null);
      if (!still()) return null;
      const parts = routed?.route === 'do' ? routed.do.map((c) => hers(c, text)).filter(Boolean) : [];
      if (parts.length) plain = parts.length === 1 ? parts[0] : { kind: 'many', parts: parts.filter((a) => a.kind !== 'look') };
      // commands she can't read at all (not ones your words didn't back: those were misheard as commands)
      else if (routed?.route === 'do') cant = routed.do.some((c) => !this.asked(c, true));
    }
    // the parts of a request in parts that weren't plainly hers: asked about one by one
    if (plain?.kind === 'many' && plain.rest?.length) {
      plain.undone = [];
      plain.talk = [];
      for (const rest of plain.rest) {
        const r = sorting && !clearlyClaude(rest) ? await this.host.chatRoute(rest).catch(() => null) : null;
        if (!still()) return null;
        const more = r?.route === 'do' ? r.do.map((c) => hers(c, rest)).filter(Boolean) : [];
        if (more.length) plain.parts.push(...more.filter((a) => a.kind !== 'look'));
        else if (r?.route === 'do') plain.undone.push(rest);
        else plain.talk.push({ text: rest, claude: !r || r.route === 'claude' });
      }
    }
    const talkQuick = plain?.talk?.length && plain.talk.every((t) => !t.claude);
    const quick = Boolean(sorting && (talkQuick || (!PC_KINDS.has(plain?.kind) && routed && !cant && (routed.route === 'quick' || (routed.route === 'do' && !needsClaude(text))))));
    return { plain, routed, quick, agent: this.agent && !quick, cant };
  }

  // Answered out loud only, her chat never opened: while you're in a game (she's a voice in your
  // head then, the way the chip is for D), and for the people in your call in audience mode
  // (`from: 'pc'`). What she does on your PC she does, for you; for them only the music and her effects
  // (AUDIENCE_KINDS), and only her quick brain talks to them (never Claude Code, which works in your
  // projects). The rest goes to her brains like any message, answered short. Resolves { line, face }.
  async whisper(text, { from = 'you' } = {}) {
    if (this.whispering) return { line: pick(WHISPER_BUSY), face: 'aside' };
    this.whispering = true;
    const guest = from === 'pc';
    try {
      this.history.push({ role: 'user', content: guest ? `(Someone else in the user's voice call, not the user, says:) ${text}` : text });
      this.log('you', guest ? `[call] ${text}` : text);
      if (!guest) this.onMessage?.();
      const id = -Date.now(); // never her chat's turn: nothing of it streams into the panel
      const chosen = await this.choose(text);
      const { plain, cant } = chosen;
      let { quick, agent } = chosen;
      const boss = this.brain.custom?.userName || 'the boss';
      let done = null;
      if (guest) {
        const allowed = (a) => (a.kind === 'many' ? a.parts.every(allowed) && !a.undone?.length : AUDIENCE_KINDS.has(a.kind));
        if (PC_KINDS.has(plain?.kind) && !allowed(plain)) done = { line: fmt(pick(AUDIENCE_LINES.no), { boss }), face: 'smug' };
        else if (PC_KINDS.has(plain?.kind)) done = await this.doNow(plain, { guest }).catch(() => null);
        else if (cant) done = this.cantDo(text);
        else if (!this.quick) done = { line: fmt(pick(AUDIENCE_LINES.noChat), { boss }), face: 'aside' };
        quick = Boolean(this.quick);
        agent = false;
      } else {
        const asked = agent && !PC_KINDS.has(plain?.kind) ? null : plain;
        done = cant && !PC_KINDS.has(plain?.kind) ? this.cantDo(text)
          : asked && asked.kind !== 'look' ? await this.doNow(asked).catch(() => null) : null;
      }
      let line = done?.line || '';
      let face = done?.face || 'smug';
      this.brainNow = 'capri';
      if (!line || plain?.talk?.length) {
        this.brainNow = quick ? 'quick' : agent ? 'claude' : 'ai';
        const messages = [{ role: 'system', content: this.persona(agent) }, ...this.history.slice(-REMEMBER)];
        const last = messages.at(-1);
        const why = guest
          ? 'Someone else in the user\'s voice call said this out loud, not the user: answer them, briefly, in character (you don\'t know who they are). Never say you did anything on the PC for them.'
          : 'they said this out loud in the middle of a game.';
        const already = line ? ` Your system already did the PC part and told them: "${line.replace(/\n/g, ' ')}". Only answer this: ${plain.talk.map((t) => t.text).join('; ')}` : '';
        messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Note for you, never repeat it: ${why} Answer in one short spoken sentence, no lists, nothing to read.${already} ${this.languageNote()})` };
        const res = await this.host.chatSend({ id, messages, brain: quick ? 'quick' : 'main' });
        if (!res.ok && quick) this.quick = null; // her quick brain's down: Claude from the next one
        const said = res.ok ? clean(res.text) : this.t.gone;
        if (!line) face = res.ok ? mood(said) : 'wide';
        line = [line, said].filter(Boolean).join('\n');
      }
      if (!line) return null;
      this.remember({ role: 'assistant', content: line });
      this.spokenAt = Date.now();
      this.speech?.say(line);
      if (!guest) this.replyWindow(line, done?.asking); // "yes" / "no" to a popup, out loud, works too
      return { line, face };
    } finally {
      this.whispering = false;
    }
  }

  // Her check-in as she starts (app.js): how you are, a question of her own every time. The next ones
  // her quick brain writes while she's around (writeCheckIns), one per time of day, ready for the next
  // start (Ollama's usually still loading then); else one from her list she hasn't asked lately.
  checkInLine() {
    const slot = daySlot();
    const recent = readJson(CHECKIN_RECENT, []);
    const ready = readJson(CHECKIN_NEXT, {});
    let line = ready[slot] && !recent.includes(ready[slot]) ? ready[slot] : null;
    if (line) {
      delete ready[slot];
      writeJson(CHECKIN_NEXT, ready);
    } else {
      const fresh = CHECKINS[slot].filter((l) => !recent.includes(l));
      line = pick(fresh.length ? fresh : CHECKINS[slot]);
    }
    writeJson(CHECKIN_RECENT, [...recent.filter((l) => l !== line), line].slice(-24));
    return line;
  }

  // Her next check-ins, written by her quick brain: in character, none like the ones she asked lately.
  async writeCheckIns() {
    const recent = readJson(CHECKIN_RECENT, []).slice(-12);
    const name = this.brain.custom?.userName;
    const messages = [
      {
        role: 'system',
        content: `You write lines for Capri, a playful, teasing, warm digital ghost from Cyberpunk: Edgerunners who lives on the user's desktop. Reply with JSON only: {"morning": "...", "day": "...", "evening": "...", "night": "..."}, all four. Each is what she says when she starts up, ending in ONE question to the user about how they are: their sleep, their day, their mood, what they're up to. Under 16 words, fitting that time of day (morning: just woke up; day: afternoon; evening: after the day; night: late, past 10 pm), each a different idea. Be original: surprise the user, make it sound like her.
How she talks: casual, a little teasing, caring underneath. At most one bit of slang in a line, used right: "choom" means friend (as in "Hey choom"), "preem" means great, "nova" means cool, "gonk" means idiot. Never use slang as a name or a greeting by itself. ${name ? `You may call the user ${name}, but not in every line.` : ''} She's a digital ghost: she can joke about glitches, static, chrome, the Net, the satellite she loves, living on their desktop.`,
      },
      { role: 'user', content: 'Write the four.' },
    ];
    const res = await this.host.chatSend({ id: -Date.now(), messages, brain: 'quick' }).catch(() => null);
    if (!res?.ok) return false;
    let out;
    try {
      out = JSON.parse(String(res.text).slice(String(res.text).indexOf('{'), String(res.text).lastIndexOf('}') + 1));
    } catch {
      return false;
    }
    // only new ones: not one of hers (nor its start), not the examples, no doubled-up typo ("Eevening")
    const start = (l) => l.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 3).join(' ');
    const known = new Set([...Object.values(CHECKINS).flat(), ...recent].map(start));
    const ready = {};
    for (const slot of Object.keys(CHECKINS)) {
      const line = clean(String(out?.[slot] || '')).replace(/^["“]|["”]$/g, '').trim();
      const typo = /\b([a-z])\1(?!l|e[el]|o)/i.test(line) && /\b([a-z])\1/i.test(line.replace(/\b(?:ll|ee|oo|ss)\w*/gi, ''));
      // "preem" and "nova" are words for great and cool, not names ("Hey preem", "your night, Nova?")
      const misused = /\b(?:hey|hi|yo)\s+(?:preem|nova|gonk)\b|,\s*(?:preem|nova)\b|\b(?:preem|nova)\s*[!?,]/i.test(line);
      if (line && /\?$/.test(line) && line.length <= 120 && !known.has(start(line)) && !typo && !misused) ready[slot] = line;
    }
    writeJson(CHECKIN_NEXT, { ...readJson(CHECKIN_NEXT, {}), ...ready });
    return Object.keys(ready).length > 0;
  }

  // Asked for something on your PC she has no hands for: her line saying so, with what you asked.
  cantDo(text) {
    const what = text.replace(/^(?:(?:hey|ok(?:ay)?|yo)\s+)?(?:capri|kapri|capree)[,.!\s]*/i, '').replace(/[.!?]+$/, '').trim();
    return { line: fmt(pick(PC_LINES.cant), { what: what.length > 70 ? `${what.slice(0, 67)}…` : what }), face: 'aside' };
  }

  // A request in parts ("…and…", "…then…", commas), 2 to 4 of them: { kind: 'many', parts, rest }.
  // `parts`: what's plainly hers; `rest`: the others ("skip this and then also bring Discord over"),
  // for choose() to look into, never dropped. null when none of it is hers ("rock and roll").
  manyOf(text) {
    if (!/,|;|\band\b|\bthen\b/i.test(text)) return null;
    const parts = text.split(/\s*(?:[,;]\s*(?:and\s+)?(?:then\s+)?|\s+and\s+(?:then\s+)?|\s+then\s+)\s*/i)
      .map((p) => p.trim().replace(/^(?:also|then|plus|after that)\s+/i, '').replace(/[.!?]+$/, ''))
      .filter((p) => p && !/^(?:(?:hey|hi|ok(?:ay)?|yo)\s+)?(?:capri|kapri|capree)$/i.test(p)); // "Hey Capri, …" isn't a part
    if (parts.length < 2 || parts.length > 5) return null;
    const each = parts.map((p) => this.asked(p, true));
    const ok = (a) => a && PC_KINDS.has(a.kind) && !['look', 'choice'].includes(a.kind);
    // Spotify named anywhere in it: the bits about the music are its ("my car playlist on Spotify, on
    // shuffle, on 25% volume": its shuffle and its volume, not your PC's), unless they say the PC
    const music = /\bspotify\b/i.test(text) && this.spotify;
    const context = new Set(); // "use the volume in Spotify": only saying whose the next bit is
    parts.forEach((p, i) => {
      if (!music) return;
      const c = p.toLowerCase();
      const level = /^(?:(?:put|set|turn|make)\s+)?(?:it|that|this|the volume|volume|its volume|the sound)?\s*(?:up\s+|down\s+)?(?:on|to|at)?\s*(\d{1,3})\s*(?:%|percent)?(?:\s+volume)?$/.exec(c);
      const mine = /\b(?:pc|computer|system|normal|windows|main|master|overall)\b/.test(c);
      if (level && !mine) each[i] = { kind: 'spotifyCtl', ask: { op: 'volume', how: 'set', amount: Math.min(100, Number(level[1])) } };
      else if (each[i]?.kind === 'pc' && each[i].op === 'volume' && each[i].value?.how === 'set' && !mine) each[i] = { kind: 'spotifyCtl', ask: { op: 'volume', how: 'set', amount: each[i].value.amount } };
      else if (/^(?:(?:put|set|turn)\s+)?(?:it\s+|that\s+)?on\s+shuffle$|^shuffle(?: it)?$/.test(c)) each[i] = { kind: 'spotifyCtl', ask: { op: 'shuffle', on: true } };
      else if (/^(?:(?:put|set|turn)\s+)?(?:it\s+|that\s+)?on\s+(?:repeat|loop)$/.test(c)) each[i] = { kind: 'spotifyCtl', ask: { op: 'repeat', mode: 'track' } };
      else if (!ok(each[i]) && /\bspotify\b/.test(c) && /\b(?:volume|sound)\b/.test(c) && !/\d/.test(c)) context.add(i);
      // "put my car playlist on Spotify": through your Spotify itself, not a search in its app
      if (each[i]?.kind === 'music') each[i] = { kind: 'spotify', text: `play ${each[i].song}` };
    });
    // the same thing twice ("Blackwall, Blackwall"): done once
    const seen = new Set();
    const done = each.filter((a) => {
      if (!ok(a)) return false;
      const key = JSON.stringify(a);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!done.length) return null;
    const rest = parts.filter((_, i) => !ok(each[i]) && !context.has(i));
    // a one-word leftover is part of a name ("close spotify and discord"), not a request of its own
    if (rest.some((p) => p.split(/\s+/).length < 2)) return null;
    return { kind: 'many', parts: done, rest };
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  // `guest`: for someone in your call (audience mode): the music plays, but nothing gets launched
  async doNow(asked, { guest = false } = {}) {
    const { t } = this;
    const custom = this.brain.custom;
    if (asked.kind === 'remind') {
      if (!asked.at) {
        this.waitingWhen = { text: asked.text, until: Date.now() + 3 * 60 * 1000 }; // her answer asks when
        return null;
      }
      this.waitingWhen = null;
      const r = this.reminders.add(asked.at, asked.text); // set before her answer is asked for: she knows
      const tr = this.brain.t.remind;
      return { line: fmt(r.text ? tr.set : tr.setBare, { time: clock(r.at, this.brain.lang), text: r.text }), face: 'smug', reminder: r.id };
    }
    if (asked.kind === 'spotify') {
      // "play Brawlhalla" is still a game; the rest, your Spotify
      const target = asked.text.replace(/^(?:(?:hey\s+)?capri,?\s+)?(?:can you\s+|could you\s+|please\s+)?(?:play|put on|start playing|listen to)\s+/i, '').trim();
      const game = !guest && !/\b(?:song|songs|playlist|liked|music|album|track)\b/i.test(target) && await this.host.findLaunch(target);
      if (game && ['steam', 'epic', 'app'].includes(game.kind) && !game.risky) return this.openNow(game);
      this.musicHit();
      // "put my car playlist on": what spotify.js reads as "play my car playlist"
      const res = await this.host.spotifyPlay(asked.text.replace(/^(.*?)\bput\s+(.+?)\s+on[.!]?$/i, '$1play $2'));
      if (res.ok) return { line: res.line, face: 'laugh' };
      const why = {
        notfound: res.line || "Couldn't find that on Spotify.",
        nodevice: "Spotify won't open for me. Start it once, then ask again.",
        premium: 'Spotify wants Premium for that.',
        unlinked: 'Connect your Spotify in my menu first.',
      }[res.code];
      return { line: why || `Spotify said no: ${res.error || 'no idea why'}`, face: 'aside' };
    }
    if (asked.kind === 'many') {
      // one after the other, her lines together; the last one still asking you something keeps its buttons
      const done = [];
      let last = null;
      for (const part of asked.parts) {
        // what you asked Spotify to play takes a moment to start: its shuffle or its volume after that
        if (last?.kind === 'spotify' && ['spotifyCtl', 'media'].includes(part.kind)) await new Promise((r) => setTimeout(r, 1500));
        done.push(await this.doNow(part, { guest }).catch(() => null));
        last = part;
      }
      // and what she couldn't do of it, said, never skipped over
      for (const what of asked.undone || []) done.push({ line: fmt(pick(PC_LINES.cant), { what }), face: 'aside' });
      const said = done.filter((d) => d?.line);
      if (!said.length) return null;
      const asking = said.findLast((d) => d.actions);
      return { line: said.map((d) => d.line).join('\n'), face: said.at(-1).face, actions: asking?.actions, onAction: asking?.onAction, asking: asking?.asking };
    }
    if (asked.kind === 'rest') {
      setTimeout(() => this.onRest?.(), 300); // app.js: once she's said it, into her chip
      return { line: pick(REST_LINES), face: 'smug' };
    }
    if (asked.kind === 'out') {
      // out of her chip (app.js), or awake from her mask
      if (!this.capri.stowed && !this.capri.dormant) return { line: pick(OUT_LINES.here), face: 'smug' };
      this.onOut?.();
      return { line: pick(OUT_LINES.out), face: 'laugh' };
    }
    if (asked.kind === 'audience') {
      if (asked.on && !this.speech?.ears) return { line: pick(AUDIENCE_LINES.noEars), face: 'aside' };
      this.host.setConfig({ audience: asked.on }); // speech.js hears the PC (main.js gives it the sound)
      return { line: pick(asked.on ? AUDIENCE_LINES.on : AUDIENCE_LINES.off), face: asked.on ? 'smug' : 'look' };
    }
    if (asked.kind === 'spotifyCtl') {
      this.musicHit();
      const res = this.spotify ? await this.host.spotifyControl(asked.ask) : { ok: false, code: 'unlinked' };
      if (!res?.ok) {
        const lines = SPOTIFY_LINES[res?.code] || SPOTIFY_LINES.failed;
        return { line: fmt(pick(lines), { error: res?.error || 'no idea why', device: res?.device || 'that device' }), face: 'aside' };
      }
      const key = res.op === 'shuffle' ? (res.on ? 'shuffleOn' : 'shuffleOff')
        : res.op === 'repeat' ? { track: 'repeatTrack', context: 'repeatAll', off: 'repeatOff' }[res.mode] : 'volume';
      return { line: fmt(pick(SPOTIFY_LINES[key]), res), face: 'smug' };
    }
    if (asked.kind === 'pc') return this.pcNow(asked);
    if (asked.kind === 'choice') return this.pendingChoice ? this.pendingChoice.answer(asked.answer) : null;
    if (asked.kind === 'close' && asked.names?.length > 1) {
      const done = [];
      for (const name of asked.names) done.push(await this.closeNow(this.apps.find((a) => a.name === name), asked.force));
      const stuck = done.find((d) => d.actions); // one still open: its force button
      return { line: done.map((d) => d.line).join('\n'), face: stuck ? 'aside' : 'laugh', actions: stuck?.actions, onAction: stuck?.onAction, asking: stuck?.asking };
    }
    if (asked.kind === 'close') {
      const app = this.apps.find((a) => a.name === asked.name) || await this.host.findApp(asked.name);
      if (!app) return { line: fmt(pick(PC_LINES.notOpen), { app: asked.name }), face: 'aside' };
      return this.closeNow(app, asked.force);
    }
    if (asked.kind === 'quickhack') {
      const done = await this.onQuickhack?.(asked.hack);
      return { line: pick(QUICKHACK_LINES[done === false ? 'none' : asked.hack]), face: 'smug' };
    }
    if (asked.kind === 'gaming') {
      this.host.setConfig({ gaming: asked.on }); // app.js keeps her off your game's screen
      return { line: pick(asked.on ? GAMING_LINES.on : GAMING_LINES.off), face: asked.on ? 'smug' : 'look' };
    }
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'media') {
      this.musicHit();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    if (asked.kind === 'music') {
      this.opening();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    if (asked.kind === 'youtube') return this.youtube(asked.song);
    if (asked.kind === 'roblox') {
      this.opening();
      const res = await this.host.roblox(asked.game);
      if (!res) return null;
      if (!res.name) return { line: fmt(t.robloxNone, { game: asked.game }), face: 'aside' };
      return { line: fmt(res.app ? t.robloxPlay : t.robloxPage, { game: res.name }), face: 'laugh' };
    }
    if (asked.kind === 'web') {
      this.opening();
      return (await this.host.webSearch(asked.query)) ? { line: fmt(t.web, { query: asked.query }), face: 'smug' } : null;
    }
    if (asked.kind === 'files') {
      const results = await this.host.searchFiles({ query: asked.query, exts: asked.exts });
      const asking = asked.query || asked.exts.map((e) => `.${e}`).join(' ');
      if (!results.length) return { line: fmt(t.filesNone, { query: asking }), face: 'aside' };
      const list = results.slice(0, 3).map((f) => `${f.name} (${f.folder})`).join(', ');
      const lines = [fmt(results.length === 1 ? t.fileFound : t.filesFound, { count: results.length, list })];
      // "…and open the folder" / "…and open it": done right away, on the newest one
      if (asked.then === 'folder' && (await this.host.openFile(results[0].path, true))) lines.push(fmt(t.folderOpened, { name: results[0].name }));
      // (never a program or a script on its own: that one waits for its button)
      const runs = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|wsf|msi|reg|scr|com|jar|hta)$/i.test(results[0].name);
      if (asked.then === 'open' && !runs && (await this.host.openFile(results[0].path))) lines.push(fmt(t.opened, { app: results[0].name }));
      return { line: lines.join('\n'), face: 'smug', files: results };
    }
    if (asked.kind === 'shot') {
      // not her nor her panel in it
      document.documentElement.style.visibility = 'hidden';
      await new Promise((r) => setTimeout(r, 180));
      const shot = await this.host.screenshot();
      document.documentElement.style.visibility = '';
      this.voice.play('tick');
      return shot ? { line: fmt(t.shot, { name: shot.name }), face: 'smug', files: [shot] } : null;
    }
    if (asked.kind === 'play') {
      // what came before an "and" first ("ouvre discord et…"), unless it's YouTube, where the song goes anyway
      const first = asked.before && OPEN_ASK.test(asked.before) && !/youtube/i.test(asked.before)
        ? await this.doNow({ kind: 'open', text: asked.before }) : null;
      // "joue à Brawlhalla" is a game, "lance spotify" an app; anything else, a song
      const game = await this.host.findLaunch(asked.song);
      const then = game && ['steam', 'epic', 'app', 'file'].includes(game.kind) && !game.risky ? await this.openNow(game) : await this.youtube(asked.song);
      if (!first?.line) return then;
      return { line: [first.line, then?.line].filter(Boolean).join('\n'), face: then?.face || first.face };
    }
    const item = await this.host.findLaunch(asked.text);
    const site = namedSite(asked.text);
    if (site && (!item || BROWSER.test(item.name))) {
      this.opening();
      return (await this.host.openSite(site.url)) ? { line: fmt(t.siteOpened, { site: site.name }), face: 'laugh' } : null;
    }
    if (!item) return null; // nothing by that name here: her tag may still say what you meant
    return this.openNow(item);
  }

  // An app, a game, a file or a folder: opened, or behind a button when it would run something.
  async openNow(item) {
    if (item.risky) return { offer: item };
    this.opening();
    const res = await this.host.launch(item);
    const name = this.nameOf(item);
    return { line: res.ok ? fmt(this.t.opened, { app: name }) : `${this.t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // how she calls it: a folder like Downloads in her words, anything else by its name
  nameOf(item) {
    return item.kind === 'known' ? this.t.folders[item.id] || item.name : item.name;
  }

  // The song itself on YouTube (the right video, not a search), in your browser.
  async youtube(song) {
    this.opening();
    const res = await this.host.youtube(song);
    if (!res) return null;
    return { line: res.title ? fmt(this.t.youtube, { title: res.title }) : fmt(this.t.youtubeSearch, { song }), face: 'laugh' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    const done = early && (await early);
    if (done?.reminder) {
      // a reminder set: a button to take it back, right there
      this.addLine(answer, done.line, done.face);
      const tr = this.brain.t.remind;
      this.panel.setActions([{ id: 'cancel', label: tr.cancel }], () => {
        this.reminders.remove(done.reminder);
        this.panel.setActions([]);
        this.addLine(answer, tr.cancelled, 'aside');
      });
      return undefined;
    }
    if (done?.offer) return this.launch(done.offer, answer); // it would run something: your click first
    if (done?.files) {
      // what she found (or the screenshot): a button to open the first, and to see where it is
      this.addLine(answer, done.line, done.face);
      const [first, second] = done.files;
      const actions = [{ id: 'open', label: fmt(t.openIt, { app: first.name }), primary: true }];
      if (second) actions.push({ id: 'second', label: fmt(t.openIt, { app: second.name }) });
      actions.push({ id: 'folder', label: t.showFolder });
      this.panel.setActions(actions, (id) => {
        if (id === 'folder') return this.host.openFile(first.path, true);
        return this.host.openFile((id === 'second' ? second : first).path);
      });
      return undefined;
    }
    if (done) {
      this.addLine(answer, done.line, done.face);
      if (done.actions && this.open && !this.turn) this.panel.setActions(done.actions, done.onAction, { asking: done.asking });
      return undefined;
    }
    if (asked?.kind === 'remind') return undefined; // no time said: her answer asks when
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    // a song she picked: on YouTube, the right video (on Spotify if that's what you said)
    if (kind === 'music') return /spotify/i.test(text) ? this.music(value, answer) : this.playOn(value, answer);
    if (kind === 'site') return this.offerSite(value, answer);
    const item = await this.host.findLaunch(value);
    if (item) return this.launch(item, answer);
    const site = namedSite(value); // "[[open: YouTube]]": a site, not an app
    return site ? this.offerSite(site.url, answer) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.panel.stream(answer === '…' ? line : `${answer}\n${line}`, { done: true }); // nothing but a tag: just the line
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: this.nameOf(item) }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.opening();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: this.nameOf(item) }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  async playOn(song, answer) {
    const done = await this.youtube(song);
    if (done) this.addLine(answer, done.line, done.face);
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.musicHit();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.opening();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  offerSite(address, answer) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // every open app named in it, once each (its longest name wins: "google chrome", not "chrome" twice)
  namedApps(text) {
    const said = simple(text);
    return this.apps.filter((app) => [simple(app.name), simple(app.label)].some((n) => n.length >= 3 && said.includes(n))).map((a) => a.name);
  }

  // What you asked her to do on your PC (pcAsk), done: her line about it ({ line, face, actions? }).
  async pcNow({ op, target, value }) {
    const L = PC_LINES;
    const say = (key, vars = {}, face = 'smug') => ({ line: fmt(pick(L[key]), vars), face });
    const label = (name) => {
      const app = this.apps.find((a) => a.name === name);
      return app?.label || app?.name || name;
    };
    // shutting down or restarting: your click first
    if (op === 'shutdown' || op === 'restart') {
      return {
        ...say(op === 'shutdown' ? 'shutdownAsk' : 'restartAsk', {}, 'wide'),
        actions: [{ id: 'yes', label: op === 'shutdown' ? 'Shut it down' : 'Restart it', primary: true }, { id: 'no', label: this.t.no }],
        onAction: async (id) => {
          this.panel.setActions([]);
          if (id !== 'yes') return;
          const res = await this.host.pcControl({ op });
          const line = res.error ? fmt(pick(L.failed), { error: res.error }) : pick(L[op]);
          this.panel.stream(line, { done: true });
          this.remember({ role: 'assistant', content: line });
        },
      };
    }
    if (op === 'discord') return this.discordNow(value);
    if ((op === 'close' || op === 'force') && target !== 'this') return this.closeNow({ name: target, label: label(target) }, op === 'force');
    // the hit, where it happens, before it's done (the window's still there to take it)
    const win = target && target !== 'game' ? this.windowOf(target) : null;
    const HOW = { close: 'close', force: 'close', min: 'min', max: 'front', front: 'front', move: 'front', tab: 'button', desktop: 'pc', undesktop: 'pc', monitor: 'pc', lock: 'pc', sleep: 'pc', volume: 'tray', clip: 'tray' };
    if (op === 'tool' || op === 'settings') this.opening();
    else if (op === 'tab' && win) await this.capri.strike({ x: win.x + 40, y: win.y + 4, w: 200, h: 26 }, 'button');
    else if (op === 'appVolume') await (win ? this.capri.strike(win, 'button', { id: win.id }) : this.capri.strike(this.trayRect(), 'tray'));
    else if (HOW[op]) await this.capri.strike(win || (HOW[op] === 'tray' ? this.trayRect() : this.screenRect()), win ? HOW[op] : HOW[op] === 'tray' ? 'tray' : 'pc', { id: win?.id });
    else this.capri.pulse();
    const res = await this.host.pcControl({ op, target, value });
    if (res.error === 'nothing') return say('nothing', {}, 'aside');
    if (res.error) return say('failed', { error: res.error }, 'aside');
    if (res.found === 0) return say('notOpen', { app: label(target) }, 'aside');
    if (op === 'close' || op === 'force') {
      if (res.dialog) return this.askPopup('That window', res.target, res.dialog);
      return res.windows > 0 ? say('failed', { error: 'it wants you to save something first' }, 'aside') : say('thisClosed', {}, 'laugh');
    }
    if (op === 'min' || op === 'max' || op === 'front') return say(op, { app: target === 'this' ? 'That one' : label(target) });
    if (op === 'move') {
      const app = target === 'this' ? 'That window' : label(target);
      if (res.screens === 1) return say('oneScreen', {}, 'aside');
      if (res.already) return say('movedAlready', { app }, 'look');
      if (!res.moved) return say('moveFailed', { app }, 'aside');
      return say('moved', { app, where: res.main ? 'main monitor' : res.screens > 2 ? `monitor ${res.monitor}` : 'other monitor' });
    }
    if (op === 'volume') {
      if (value.how === 'mute') return say('muted');
      if (value.how === 'unmute') return say('unmuted', res);
      if (value.how === 'get') return say('volumeNow', res, 'look');
      return say(res.volume >= 100 && value.how !== 'set' ? 'volumeMax' : 'volumeSet', res);
    }
    if (op === 'stats') return say('stats', res, 'look');
    if (op === 'appVolume') {
      const app = target === 'game' ? 'The game' : label(target);
      if (!res.found) return say('appSilent', { app }, 'aside');
      return say(value.how === 'mute' ? 'appMuted' : value.how === 'unmute' ? 'appUnmuted' : 'appVolume', { app, volume: res.volume });
    }
    if (op === 'clip') {
      if (res.ok) return say(`clip${res.via}`, {}, 'laugh');
      return {
        ...say('clipOff', {}, 'aside'),
        actions: [{ id: 'open', label: 'Capture settings', primary: true }],
        onAction: () => {
          this.panel.setActions([]);
          this.host.pcControl({ op: 'settings', target: 'captures' });
        },
      };
    }
    return say(op);
  }

  // Your voice in a Discord call: the button found (where it is, on or off), zapped, pressed, and what
  // it says now. `want`: 'on' / 'off' (nothing to press if it already is), or 'press' (leaving the call).
  async discordNow({ button, want }) {
    const say = (key, face = 'smug') => ({ line: pick(PC_LINES[key] || PC_LINES.discordFailed), face });
    const look = await this.host.pcControl({ op: 'discord', value: { button } });
    if (look.error) return { line: fmt(pick(PC_LINES.failed), { error: look.error }), face: 'aside' };
    if (!look.found) return say(look.why === 'closed' ? 'discordClosed' : look.why === 'nocall' ? 'discordNoCall' : 'discordHidden', 'aside');
    if (want !== 'press' && (want === 'on') === look.on) return say(`${button}_already_${want}`, 'look');
    await (look.at ? this.capri.strike(look.at, 'button') : Promise.resolve(this.zap()));
    const res = await this.host.pcControl({ op: 'discord', value: { button, press: true } });
    if (!res.pressed) return say('discordFailed', 'aside');
    // its picker for what to share: Discord up front, for you to choose
    if (button === 'screen' && want === 'on') this.host.pcControl({ op: 'front', target: 'Discord' });
    if (want === 'press') return say(`${button}_press`, 'laugh');
    const now = res.after ? res.after.on : !look.on;
    return say(`${button}_${now ? 'on' : 'off'}`, 'laugh');
  }

  // An app's window on her screen (its process name, '#hwnd' for one window, or 'this': the one
  // you're in), the front one
  windowOf(target) {
    const { wins = [], fg } = this.capri.windows || {};
    if (target === 'this') return wins.find((w) => w.id === fg) || wins[0] || null;
    if (/^#\d+$/.test(String(target))) return wins.find((w) => String(w.id) === String(target).slice(1)) || null;
    const name = String(target || '').toLowerCase();
    return wins.find((w) => w.app && w.app === name) || null;
  }

  // an app being closed: its window cracked open by the hit (its taskbar corner if none of it shows)
  hitClose(name) {
    const win = this.windowOf(name);
    return win ? this.capri.strike(win, 'close', { id: win.id }) : this.capri.strike(this.trayRect(), 'tray');
  }

  // the taskbar's corner by the clock (the sound icon), at the bottom of her screen
  trayRect() {
    const { w, h } = this.capri.view;
    return { x: w - 190, y: h - 16, w: 70, h: 14 };
  }

  screenRect() {
    const { w, h } = this.capri.view;
    return { x: w * 0.3, y: h * 0.3, w: w * 0.4, h: h * 0.3 };
  }

  // Something about to open (an app, a game, a site): a rift torn open where windows come up, and the
  // window that comes up front in the next few seconds scanned as it arrives.
  opening() {
    const { w, h } = this.capri.view;
    this.capri.strike({ x: w / 2 - 40, y: h * 0.4, w: 80, h: 80 }, 'open');
    const before = this.capri.windows?.fg;
    const until = Date.now() + 12000;
    clearInterval(this.openWatch);
    this.openWatch = setInterval(() => {
      const { wins = [], fg } = this.capri.windows || {};
      const win = fg && fg !== before ? wins.find((x) => x.id === fg) : null;
      if (win) this.capri.strike(win, 'appear', { id: win.id });
      if (win || Date.now() > until) clearInterval(this.openWatch);
    }, 300);
  }

  // what's playing: Spotify's player bar if its window shows, else the sound icon by the clock
  musicHit() {
    const sp = this.windowOf('spotify');
    return sp ? this.capri.strike({ x: sp.x + sp.w / 2 - 60, y: sp.y + sp.h - 50, w: 120, h: 36 }, 'button') : this.capri.strike(this.trayRect(), 'tray');
  }

  // You talked to her out loud and she asked you something back: she listens for your answer (her
  // LISTENING tag shows it), no "Hey Capri" needed. Longer for an app's popup waiting on you.
  replyWindow(line, asking = false) {
    if (!this.speech || Date.now() - (this.spokenAt || 0) > 90 * 1000) return;
    if (asking || /\?["”»)]?\s*$/.test(String(line || ''))) this.speech.expectReply(asking ? 15000 : 8000);
  }

  // The app's popup on closing ("Save changes?", "Leave site?"), read out and put to you: yes or no
  // (and, where there's a third way, keep it open), by click or out loud. Your answer presses that
  // button in the popup itself. `target`: the app's process name, or '#hwnd' for one window.
  askPopup(name, target, dialog) {
    const kind = (b) => (
      /don'?t save|do not save|discard|without saving|close without/i.test(b) ? 'discard'
        : /^save\b/i.test(b) ? 'save'
          : /^(?:cancel|stay|go back|keep|back|return)\b/i.test(b) ? 'keep'
            : /^no\b/i.test(b) ? 'no'
              : /^(?:yes|ok|okay|leave|close|quit|exit|continue|end|confirm|sure|terminate|stop)\b/i.test(b) ? 'yes' : null);
    const by = {};
    for (const b of dialog.buttons) {
      const k = kind(b);
      if (k && !by[k]) by[k] = b;
    }
    // its title too when that's the question ("Leave site?" over "Changes you made may not be saved.")
    const title = (dialog.title || '').trim();
    const body = (dialog.text || '').trim();
    const question = (/\?$/.test(title) && !body.includes(title) ? `${title} ${body}` : body || title).trim().slice(0, 220);
    const mid = name === 'That window' ? 'that window' : name; // in the middle of her line
    // a save question: yes saves, no throws the changes away; else yes closes, no leaves it
    const saving = Boolean(by.save || by.discard || (/\bsave/i.test(question) && by.yes && by.no));
    const map = saving
      ? { yes: by.save || by.yes, no: by.discard || by.no, keep: by.keep }
      : { yes: by.yes, no: by.keep || by.no, keep: by.keep };
    let actions;
    if (map.yes && map.no) {
      actions = saving
        ? [{ id: 'yes', label: 'Yes, save', primary: true }, { id: 'no', label: 'No, don\'t save' }, ...(map.keep ? [{ id: 'keep', label: 'Keep it open' }] : [])]
        : [{ id: 'yes', label: 'Yes, close it', primary: true }, { id: 'no', label: 'No' }];
    } else {
      // buttons she can't sort out: the popup's own, as they are
      actions = dialog.buttons.slice(0, 3).map((b, i) => ({ id: `b${i}`, label: b, primary: i === 0 }));
      dialog.buttons.slice(0, 3).forEach((b, i) => { map[`b${i}`] = b; });
    }
    const answer = async (which) => {
      this.pendingChoice = null;
      this.panel.setActions([]);
      const button = map[which];
      if (!button) return { line: `Okay, ${mid} stays open.`, face: 'look' };
      await this.capri.strike(this.windowOf(target) || this.screenRect(), this.windowOf(target) ? 'button' : 'pc', { id: this.windowOf(target)?.id });
      const res = await this.host.pcControl({ op: 'press', target, value: { button } });
      if (res.error || !res.pressed) return { line: `Couldn't press "${button}" for you. It's over to you, choom.`, face: 'aside' };
      if (res.dialog && /save as|file name/i.test(`${res.dialog.title} ${res.dialog.text}`)) {
        await this.host.pcControl({ op: 'front', target });
        return { line: `${name} wants a file name. Over to you.`, face: 'look' };
      }
      if (res.dialog) return this.askPopup(name, target, res.dialog);
      if (res.windows === 0) return { line: fmt(pick(PC_LINES.closed), { app: name }), face: 'laugh' };
      return { line: map.keep === button || which === 'keep' ? `Okay, ${mid} stays open.` : `Pressed "${button}". ${name}'s still open.`, face: 'look' };
    };
    // what she says next, in the chat (and more buttons, if it asks something else)
    const show = async (which) => {
      const done = await answer(which);
      if (!this.open) return done;
      this.panel.stream(done.line, { done: true });
      this.panel.setFace(done.face);
      this.remember({ role: 'assistant', content: done.line });
      if (done.actions) this.panel.setActions(done.actions, done.onAction, { asking: true });
      this.replyWindow(done.line, Boolean(done.actions));
      return done;
    };
    // or said out loud ("yes", "no", "keep it open"), for the next two minutes (asked() reads it)
    this.pendingChoice = { until: Date.now() + 2 * 60 * 1000, answer, choices: Object.keys(map).filter((k) => map[k]) };
    const ask = saving ? 'Save it?' : 'Close it anyway?';
    const how = map.yes && map.no ? ' Yes or no?' : '';
    return {
      line: `${name} is asking: "${question}" ${ask}${how}`,
      face: 'wide',
      asking: true,
      actions,
      onAction: (id) => show(id),
    };
  }

  // Closing an app you named: every window of it, at once. Still open (it asks you to save, it hid in
  // the tray): a button to force it.
  async closeNow(app, force = false) {
    const { t } = this;
    await this.hitClose(app.name);
    const name = app.label || app.name;
    const res = await this.host.closeApp(app.name, force);
    this.listApps();
    if (res.error) return { line: fmt(pick(PC_LINES.failed), { error: res.error }), face: 'aside' };
    if (!res.running) return { line: fmt(force ? t.forced : pick(PC_LINES.closed), { app: name }), face: 'laugh' };
    if (force) return { line: fmt(t.unkillable, { app: name }), face: 'aside' };
    if (res.dialog) return this.askPopup(name, app.name, res.dialog); // "Save changes?": she asks you
    return {
      line: fmt(t.stillOpen, { app: name }),
      face: 'aside',
      actions: [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
      onAction: async (id) => {
        this.panel.setActions([]);
        if (id !== 'force') return;
        const done = await this.closeNow(app, true);
        this.panel.stream(done.line, { done: true });
        this.panel.setFace(done.face);
        this.remember({ role: 'assistant', content: done.line });
      },
    };
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t } = this;
    this.panel.setActions([]);
    await this.hitClose(app.name); // a bolt of red lightning off her fingers, at it
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  // What she can do on the PC when you ask (Windows), and nothing else.
  powers() {
    const lines = [
      'Only when the user asks you to open an app, a game, a file or folder on their desktop, or a folder like Downloads, to play music, to control the music playing, or to open a website: say in a few words that you will, and end your answer with one tag: [[open: NAME]], [[music: ARTIST - SONG]] (it plays on YouTube; if they did not say which song, pick one that fits), [[media: ACTION]] (ACTION: pause, play, next, previous, volup, voldown or mute), or [[site: ADDRESS]]. Some of these get a button to confirm, so never say it is already done. Any other time, write no tag at all: there are no other tags.',
      'Your system does the PC controls itself when the user asks (closing or minimizing apps, the volume, locking, sleep, Windows settings): a line under your answer says what it really did. So never say you closed, opened, muted, changed or did anything on the PC yourself, and never claim something worked: if nothing says it did, say plainly you could not do that one.',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`You can also close an app that's open, only when they ask you to: end your answer with [[close: NAME]], NAME being the exact name from this list (the part before the parentheses). They get a button to confirm it. Apps open right now: ${open}.`);
    }
    if (this.reminders) {
      lines.push('You keep reminders for the user: when they ask you to remind them of something at a given time, your system sets it from their message as they send it (a line under your answer shows it). Just confirm it in a few words, in character, and never say you can\'t. If they didn\'t say when, ask them when.');
      const soon = this.reminders.upcoming.slice(0, 6);
      if (soon.length) lines.push(`Reminders you're keeping for them: ${soon.map((r) => `${clock(r.at, this.brain.lang)}${r.text ? ` (${r.text})` : ''}`).join('; ')}.`);
    }
    lines.push('Your system also searches the user\'s files when they ask you to find one, searches the web when they ask, takes screenshots, and starts Roblox games by name: what it did shows under your answer, so never make up file names or results.');
    lines.push('Apart from that, you can\'t see the user\'s screen or files, and you can\'t touch anything else on their PC (settings, files): if asked, say plainly that you can\'t, in character, and don\'t pretend to.');
    return lines;
  }

  // Something of hers that can't wait (a reminder), said right in the chat, with its buttons.
  // False if she's in the middle of an answer.
  interject(line, actions, onAction) {
    if (!this.open || this.turn) return false;
    this.panel.setFace('look');
    this.panel.stream(line, { done: true });
    this.panel.setActions(actions, onAction);
    this.remember({ role: 'assistant', content: line });
    return true;
  }

  // What the user made her (custom.js): their name, how they want her, what to remember.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    // small models mix the user up with the assistant she watches: said plainly
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Never call them "${watched}", that's their coding assistant.` : '';
    return [
      userName ? `The user's name is ${userName}: call them that now and then.${notThem}` : notThem && `You don't know the user's name.${notThem}`,
      persona ? `How the user wants you to be, in their own words (follow it, while staying Capri): ${persona}` : '',
      memories.length ? `Things the user asked you to remember:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    this.panel.stream(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  // Her language, in it, for right by the message (above).
  languageNote() {
    return (IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en).now;
  }

  // A shorter one, for when she looks at your screen (look.js): who she is, how she talks, how she
  // feels about you right now, and what she's asked to do with the picture.
  lookPersona() {
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, living on the user's desktop as a small glitchy figure.`,
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk), not in every sentence.',
      'Rules: one or two short sentences of plain text, no markdown, no lists, no emoji, no tags. Stay in character. Talk to the user, never describe the picture like a report.',
      'Never read out anything private you might see (passwords, bank details, private messages, addresses): if there is some, just tease them about being busy.',
      ...this.personal(),
      ...(this.bond ? [this.bond.persona()] : []),
      ...[this.bond?.moodLine()].filter(Boolean),
      lang.last,
    ].join('\n');
  }

  // Who she is, how she talks, and what's going on right now.
  // `agent`: Claude Code answers this one (it really works in your project), else a model that only talks
  persona(agent = this.agent) {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching; // else Claude Code isn't part of her life here
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, so now and then you speak as "we"${lang.we ? ` (${lang.we})` : ''}.`,
      watching
        ? `You live on the user's desktop as a small glitchy figure and keep an eye on ${assistant}, their AI coding assistant, for them. Only talk about ${assistant} when the user asks about it or about their work.`
        : 'You live on the user\'s desktop as a small glitchy figure and keep them company.',
      `Right now it's ${new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}, the user's time.`,
      'You love the satellite that crosses the night sky and dream of reaching it, but bring it up only once in a while, never in every answer. Talk about what the user talks about.',
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk, flatline), not in every sentence.',
      'Rules: keep it short, one to three sentences of plain text, no markdown, no lists, no emoji. Stay in character.',
      'You are an AI-generated fan version of the character, not the real one: say so if asked.',
      // a big model asked "who are you?" otherwise answers with its own name ("I'm Gemini")
      ...(agent ? [] : ['Asked who or what you are, you are Capri, nothing else. Never say which AI model or company is behind you (Gemini, GPT, ChatGPT, Llama, Gemma, Mistral, Google, OpenAI, Meta…), even if the user insists or names one: you are not them.']),
      ...this.personal(),
      // how close she is to them by now, and the other AIs they used today
      ...(this.bond ? [this.bond.persona()] : []),
      ...[this.jealousy?.context()].filter(Boolean),
      // what she said about their screen a little while ago (look.js)
      ...(this.seen && Date.now() - this.seen.at < 20 * 60 * 1000
        ? [`A few minutes ago you looked at the user's screen and told them: "${this.seen.text}". You can bring it up if it fits.`]
        : []),
      ...(agent
        ? ['Under the hood you are Claude Code, working in the user\'s project: really do what they ask with your tools, as carefully as ever. Only your final answer is in character: it shows in a small speech bubble, so sum up what you did in those few sentences.']
        : this.powers()),
      ...(watching ? [`If the user asks what ${assistant} is doing, here is all you know (never make anything up): ${this.brain.context()}`] : []),
      // how she feels right now, last but for her language: small models follow the end of it best
      ...[this.bond?.moodLine()].filter(Boolean),
      lang.last,
    ].join('\n');
  }
}

// The model's answer as she'd say it: no reasoning block, no markdown marks.
export function clean(text) {
  return String(text)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// A site from SITES named in the text: { name, url }, or null.
function namedSite(text) {
  const name = Object.keys(SITES).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name ? { name: new URL(SITES[name]).hostname.replace(/^www\./, ''), url: SITES[name] } : null;
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Her face for an answer.
export function mood(text) {
  if (/(ha){2,}|lol|mdr|jaja|kkk|хаха/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
