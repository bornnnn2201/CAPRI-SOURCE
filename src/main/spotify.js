'use strict';

// Your Spotify, played for real (Premium): through Spotify's Web API, signed in once with your own
// app's Client ID (developer.spotify.com, PKCE: no secret), the sign-in kept encrypted with your
// Windows account (setup.js sealKey). What you ask (play(text)) is worked out here: your liked songs,
// one of your playlists or anyone's, an artist, a song by someone, an album.

const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const config = require('./config');
const setup = require('./setup');

const API = 'https://api.spotify.com/v1';
const PORT = 47834;
// Spotify takes a loopback address, never "localhost": this is what goes in your app's Redirect URIs
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read playlist-read-private playlist-read-collaborative user-read-private';

let access = null; // { token, until }

const linked = () => Boolean(config.load().spotify?.refresh && config.load().spotify?.clientId);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Signs in: your browser opens on Spotify's page, it comes back to a little server here with the code.
function connect(clientId) {
  const id = String(clientId || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) return Promise.resolve({ ok: false, error: "that doesn't look like a Client ID (32 letters and digits)" });
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT);
      if (url.pathname !== '/callback') return res.writeHead(404).end();
      const done = (ok, error) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<body style="background:#14101c;color:#e9e4f5;font:16px sans-serif;display:grid;place-items:center;height:90vh"><div>${ok ? 'Capri is connected to your Spotify. You can close this tab.' : `Spotify said no: ${String(error).replace(/[<>&]/g, '')}`}</div></body>`);
        server.close();
        clearTimeout(timer);
        resolve(ok ? { ok: true } : { ok: false, error });
      };
      if (url.searchParams.get('state') !== state) return done(false, 'the sign-in got mixed up, try again');
      if (url.searchParams.get('error')) return done(false, url.searchParams.get('error'));
      try {
        const tok = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT, client_id: id, code_verifier: verifier });
        config.save({ spotify: { clientId: id, refresh: setup.sealKey(tok.refresh_token) } });
        access = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
        done(true);
      } catch (err) {
        done(false, err.message);
      }
    });
    const timer = setTimeout(() => {
      server.close();
      resolve({ ok: false, error: 'no answer from Spotify in 5 minutes' });
    }, 5 * 60 * 1000);
    server.on('error', (err) => resolve({ ok: false, error: err.message }));
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES });
      shell.openExternal(`https://accounts.spotify.com/authorize?${q}`);
    });
  });
}

function disconnect() {
  access = null;
  config.save({ spotify: null });
}

async function tokenRequest(form) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Spotify ${res.status}`);
  return body;
}

async function token() {
  if (access && Date.now() < access.until) return access.token;
  const { clientId, refresh } = config.load().spotify || {};
  if (!clientId || !refresh) throw Object.assign(new Error('Spotify not connected'), { code: 'unlinked' });
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: setup.openKeys({ r: refresh }).r, client_id: clientId });
  // Spotify may hand out a new refresh token (it rotates them with PKCE): keep it
  if (tok.refresh_token) config.save({ spotify: { clientId, refresh: setup.sealKey(tok.refresh_token) } });
  access = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
  return access.token;
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await token()}`, ...(body && { 'content-type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Spotify ${res.status}`), { status: res.status, reason: data?.error?.reason });
  return data;
}

// Where it plays: the device that's on, else your PC's Spotify, opened if it isn't.
async function device() {
  const pick = (list) => list.find((d) => d.is_active) || list.find((d) => d.type === 'Computer') || list[0];
  let { devices = [] } = (await api('GET', '/me/player/devices')) || {};
  if (devices.length) return pick(devices);
  await shell.openExternal('spotify:').catch(() => {});
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 750));
    ({ devices = [] } = (await api('GET', '/me/player/devices').catch(() => null)) || {});
    if (devices.length) return pick(devices);
  }
  return null;
}

async function start(what, { shuffle = false, fromTop = false } = {}) {
  const d = await device();
  if (!d) throw Object.assign(new Error("Spotify isn't open on any device"), { code: 'nodevice' });
  const q = `?device_id=${encodeURIComponent(d.id)}`;
  await api('PUT', `/me/player/shuffle?state=${shuffle}&device_id=${encodeURIComponent(d.id)}`).catch(() => {});
  const body = what.uris ? { uris: what.uris } : { context_uri: what.context, ...(fromTop && !/:artist:/.test(what.context) && { offset: { position: 0 } }) };
  await api('PUT', `/me/player/play${q}`, body);
  return d;
}

const first = async (q, type) => (await api('GET', `/search?type=${type}&limit=5&q=${encodeURIComponent(q)}`))?.[`${type}s`]?.items?.filter(Boolean) || [];
// the same name, near enough: "juice world" is Juice WRLD (Whisper writes what it hears)
const near = (a, b) => {
  const x = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return distance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 5));
};

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// What you asked for, worked out from how you said it. Resolves { ok, line } (line: what she says)
// or { ok: false, code } ('unlinked': not connected; 'notfound'; 'nodevice'; 'premium').
async function play(text) {
  let t = String(text || '').trim().replace(/[.!?]+$/, '')
    .replace(/^(?:hey\s+)?capri,?\s*/i, '').replace(/^(?:can you|could you|would you|please|pls)\s+/i, '').replace(/\s+(?:please|pls|for me)$/i, '')
    .replace(/\s+on\s+spotify$/i, '');
  const fromTop = /\b(?:from the (?:top|start|beginning)|in order|from song one|from the first (?:one|song))\b/i.test(t);
  const shuffled = /\bshuffle/i.test(t);
  t = t.replace(/\b(?:from the (?:top|start|beginning)|in order|from song one|from the first (?:one|song)|on shuffle|shuffled?)\b/gi, '').replace(/\s+/g, ' ').trim();
  const verb = /^(?:play|put on|start|shuffle|listen to|queue up|throw on|blast)\s+(?:me\s+|us\s+)?/i;
  const ask = t.replace(verb, '').trim();
  if (!linked()) return { ok: false, code: 'unlinked' };
  try {
    // your liked songs
    if (/\b(?:my\s+)?(?:liked|saved|favou?rite|loved)\s+(?:songs|tracks|music)\b|\bmy likes\b/i.test(ask)) {
      const me = await api('GET', '/me');
      await start({ context: `spotify:user:${me.id}:collection` }, { shuffle: !fromTop || shuffled, fromTop });
      return { ok: true, line: fromTop ? 'Your liked songs, from the top.' : 'Your liked songs, shuffled.' };
    }
    // a playlist: yours first ("my gym playlist"), else anyone's
    const pl = /^(?:(?:a|an|some|the|my)\s+)?(.+?)\s+playlist$|^(?:my\s+)?playlist\s+(.+)$/i.exec(ask);
    if (pl) {
      const name = (pl[1] || pl[2]).replace(/^my\s+/i, '');
      const mine = (await api('GET', '/me/playlists?limit=50'))?.items?.filter(Boolean) || [];
      const own = mine.find((p) => near(p.name, name));
      const found = own || (await first(`${name}`, 'playlist'))[0];
      if (!found) return { ok: false, code: 'notfound', line: `No playlist like "${name}".` };
      await start({ context: found.uri }, { shuffle: shuffled, fromTop: fromTop || !shuffled });
      return { ok: true, line: `Playing ${found.name}.` };
    }
    // an album
    const al = /^(?:the\s+)?(?:album\s+(.+)|(.+?)\s+album)$/i.exec(ask);
    if (al) {
      const found = (await first(al[1] || al[2], 'album'))[0];
      if (!found) return { ok: false, code: 'notfound' };
      await start({ context: found.uri }, { shuffle: shuffled, fromTop: true });
      return { ok: true, line: `Playing ${found.name} by ${found.artists?.[0]?.name}.` };
    }
    // an artist: "a juice wrld song", "some juice wrld", "something by juice wrld", "juice wrld's music"
    const ar = /^(?:a|an|some|any)\s+(.+?)(?:\s+(?:song|songs|track|tracks|music|tunes))?$|^something\s+(?:by|from)\s+(.+)$|^(.+?)(?:'s)?\s+(?:songs|music|tracks)$/i.exec(ask);
    const artistName = ar && (ar[1] || ar[2] || ar[3]);
    if (artistName) {
      const found = (await first(artistName, 'artist'))[0];
      if (!found) return { ok: false, code: 'notfound' };
      await start({ context: found.uri }, { shuffle: true });
      return { ok: true, line: `Some ${found.name}, shuffled.` };
    }
    // a song by someone
    const by = /^(?:the\s+song\s+)?(.+?)\s+by\s+(.+)$/i.exec(ask);
    if (by) {
      const found = (await first(`track:${by[1]} artist:${by[2]}`, 'track'))[0] || (await first(`${by[1]} ${by[2]}`, 'track'))[0];
      if (!found) return { ok: false, code: 'notfound' };
      await start({ uris: [found.uri] });
      return { ok: true, line: `${found.name} by ${found.artists?.[0]?.name}.` };
    }
    // anything else: an artist if that's what it is, else the song it is
    const [artist] = await first(ask, 'artist');
    if (artist && near(artist.name, ask)) {
      await start({ context: artist.uri }, { shuffle: true });
      return { ok: true, line: `Some ${artist.name}, shuffled.` };
    }
    const [track] = await first(ask, 'track');
    if (!track) return { ok: false, code: 'notfound' };
    await start({ uris: [track.uri] });
    return { ok: true, line: `${track.name} by ${track.artists?.[0]?.name}.` };
  } catch (err) {
    if (err.code) return { ok: false, code: err.code, error: err.message };
    if (err.reason === 'PREMIUM_REQUIRED') return { ok: false, code: 'premium', error: err.message };
    return { ok: false, code: 'error', error: err.message };
  }
}

// What's playing, changed: { op: 'shuffle', on } | { op: 'repeat', mode: 'track'|'context'|'off' } |
// { op: 'volume', how: 'set'|'up'|'down', amount }. On the device playing now (else Spotify says so).
async function control({ op, on, mode, how, amount } = {}) {
  if (!linked()) return { ok: false, code: 'unlinked' };
  try {
    const now = await api('GET', '/me/player');
    if (!now?.device) return { ok: false, code: 'nothing' };
    const q = `device_id=${encodeURIComponent(now.device.id)}`;
    if (op === 'shuffle') {
      await api('PUT', `/me/player/shuffle?state=${Boolean(on)}&${q}`);
      return { ok: true, op, on: Boolean(on) };
    }
    if (op === 'repeat') {
      const state = ['track', 'context', 'off'].includes(mode) ? mode : 'track';
      await api('PUT', `/me/player/repeat?state=${state}&${q}`);
      return { ok: true, op, mode: state };
    }
    if (op === 'volume') {
      if (now.device.supports_volume === false) return { ok: false, code: 'novolume', device: now.device.name };
      const at = now.device.volume_percent ?? 50;
      const step = Number.isFinite(amount) ? amount : 15;
      const volume = Math.max(0, Math.min(100, Math.round(how === 'set' ? amount : how === 'up' ? at + step : at - step)));
      await api('PUT', `/me/player/volume?volume_percent=${volume}&${q}`);
      return { ok: true, op, volume };
    }
    return { ok: false, code: 'error', error: `no such thing: ${op}` };
  } catch (err) {
    if (err.reason === 'PREMIUM_REQUIRED') return { ok: false, code: 'premium', error: err.message };
    return { ok: false, code: 'error', error: err.message };
  }
}

module.exports = { REDIRECT, linked, connect, disconnect, play, control };
