// Her chat log window (her menu's Chat log): everything you said to her and she answered, newest at
// the bottom, by day, searchable, which brain answered on each of hers. Kept fresh while it's open.

const host = window.host;
const log = document.getElementById('log');
const search = document.getElementById('search');
const count = document.getElementById('count');
const BRAINS = { claude: 'Claude', quick: 'Quick brain', capri: 'Done by her', look: 'Screen look', ai: 'AI' };

let entries = [];
let shown = '';

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// the text, with what you searched for marked (safely: built from text nodes, never HTML)
function marked(text, q) {
  const span = document.createElement('span');
  span.className = 'text';
  if (!q) {
    span.textContent = text;
    return span;
  }
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
    span.append(text.slice(at, i));
    const m = document.createElement('mark');
    m.textContent = text.slice(i, i + q.length);
    span.append(m);
    at = i + q.length;
  }
  span.append(text.slice(at));
  return span;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const list = q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries;
  const key = `${q}|${entries.length}`;
  if (key === shown) return;
  shown = key;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren();
  count.textContent = q ? `${list.length} of ${entries.length}` : `${entries.length} messages`;
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = q ? 'Nothing matches that.' : 'Nothing yet. Talk to her and it all lands here.';
    log.append(empty);
    return;
  }
  let lastDay = '';
  for (const e of list) {
    const d = day(e.at);
    if (d !== lastDay) {
      const h = document.createElement('div');
      h.className = 'day';
      h.textContent = d;
      log.append(h);
      lastDay = d;
    }
    const row = document.createElement('div');
    row.className = `msg ${e.who}`;
    const t = document.createElement('div');
    t.className = 'time';
    t.textContent = time(e.at);
    const body = document.createElement('div');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = e.who === 'you' ? 'You' : 'Capri';
    body.append(who);
    if (e.brain) {
      const b = document.createElement('span');
      b.className = `brain ${e.brain}`;
      b.textContent = BRAINS[e.brain] || e.brain;
      body.append(b);
    }
    body.append(document.createElement('br'), marked(e.text, q));
    row.append(t, body);
    log.append(row);
  }
  if (atBottom || !q) log.scrollTop = log.scrollHeight;
}

async function refresh() {
  entries = await host.chatLogGet().catch(() => entries);
  render();
}

search.addEventListener('input', render);
document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Delete the whole chat log? Her own memory of your chats stays.')) return;
  await host.chatLogClear();
  refresh();
});
refresh();
setInterval(() => document.visibilityState === 'visible' && refresh(), 2000);
