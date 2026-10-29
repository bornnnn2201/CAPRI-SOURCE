// Her Spotify window (her menu's Spotify): the steps to your own Client ID, connecting, disconnecting.

const host = window.host;
const $ = (id) => document.getElementById(id);

function status(text, kind = '') {
  $('status').hidden = !text;
  $('status').textContent = text || '';
  $('status').className = kind;
}

async function refresh() {
  const s = await host.spotifyStatus();
  $('redirect').textContent = s.redirect;
  $('setup').hidden = s.linked;
  $('done').hidden = !s.linked;
}

$('dashboard').addEventListener('click', () => host.spotifyDashboard());
// what you copied (from Spotify's page), straight in: no keyboard shortcut needed
$('paste').addEventListener('click', async () => {
  $('client').value = await host.spotifyPaste();
  $('client').focus();
});
$('copy').addEventListener('click', async () => {
  await host.spotifyCopyRedirect();
  $('copy').textContent = 'Copied';
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
});
$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  status('Waiting for you to press Agree in your browser…');
  const res = await host.spotifyConnect($('client').value);
  $('connect').disabled = false;
  if (res.ok) status('Connected. She can play your Spotify now.', 'ok');
  else status(`Not connected: ${res.error}`, 'bad');
  refresh();
});
$('disconnect').addEventListener('click', async () => {
  await host.spotifyDisconnect();
  status('Disconnected.');
  refresh();
});
refresh();
