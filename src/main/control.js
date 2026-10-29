'use strict';

// Her hands on your PC (Windows), when you ask: an app's windows (close them all, minimize, maximize,
// bring it up), the window you're in ("close this", "close this tab"), the volume to an exact level,
// the desktop, locking, sleep, the screens off, shutting down (with a minute to take it back),
// Windows' settings pages and tools, how busy the PC is, one app's own volume ("turn Discord down"),
// and "clip that" (the recorder's save shortcut). control.ps1 does the Win32 calls.

const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const WIN = process.platform === 'win32';
// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'control.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function run(...args) {
  return new Promise((resolve) => {
    if (!WIN) return resolve({ error: 'Windows only' });
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args.map(String)],
      { windowsHide: true, timeout: 20000 }, (err, out) => {
        if (err) return resolve({ error: err.message.split('\n')[0] });
        try {
          resolve(JSON.parse(String(out).trim().split('\n').pop()));
        } catch {
          resolve({ error: 'no answer' });
        }
      });
  });
}

// Windows' own pages and tools, by what you'd call them
const SETTINGS = {
  bluetooth: 'ms-settings:bluetooth', wifi: 'ms-settings:network-wifi', network: 'ms-settings:network',
  display: 'ms-settings:display', sound: 'ms-settings:sound', mixer: 'ms-settings:apps-volume',
  apps: 'ms-settings:appsfeatures', update: 'ms-settings:windowsupdate', notifications: 'ms-settings:notifications',
  storage: 'ms-settings:storagesense', mouse: 'ms-settings:mousetouchpad', keyboard: 'ms-settings:keyboard',
  power: 'ms-settings:powersleep', privacy: 'ms-settings:privacy', background: 'ms-settings:personalization-background',
  themes: 'ms-settings:themes', colors: 'ms-settings:colors', nightlight: 'ms-settings:nightlight',
  startup: 'ms-settings:startupapps', gaming: 'ms-settings:gaming-gamebar', captures: 'ms-settings:gaming-gamedvr',
  settings: 'ms-settings:',
};
const TOOLS = {
  taskmgr: ['taskmgr.exe'], control: ['control.exe'], devmgmt: ['mmc.exe', 'devmgmt.msc'], calc: ['calc.exe'],
  notepad: ['notepad.exe'], explorer: ['explorer.exe'], snip: ['explorer.exe', 'ms-screenclip:'], cmd: ['cmd.exe'],
  powershell: ['powershell.exe'], regedit: null, // never: not hers to touch
};

function start(file, args = []) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

// What busy means right now: the processor over a second, the memory, the busiest programs.
async function stats() {
  const tick = () => os.cpus().reduce((a, c) => {
    const t = c.times;
    return { idle: a.idle + t.idle, all: a.all + t.user + t.nice + t.sys + t.idle + t.irq };
  }, { idle: 0, all: 0 });
  const a = tick();
  await new Promise((r) => setTimeout(r, 1000));
  const b = tick();
  const cpu = Math.round(100 * (1 - (b.idle - a.idle) / Math.max(1, b.all - a.all)));
  const total = os.totalmem();
  const used = total - os.freemem();
  return { cpu, ramUsed: +(used / 2 ** 30).toFixed(1), ramTotal: Math.round(total / 2 ** 30), ram: Math.round((100 * used) / total) };
}

// { op, target?, value? } (chat.js reads it off what you said); resolves with what happened.
// `target`: an app's process name, or '#hwnd' for one window ("this": the one you're in).
async function control({ op, target, value } = {}) {
  switch (op) {
    case 'close': {
      if (!target) return { error: 'no target' };
      const res = await run('close', target);
      // a window stayed: it's asking something ("Save changes?", "Leave site?"): what, for her to ask you
      if (res.windows > 0) res.dialog = (await run('dialogs', target)).dialogs?.[0] || null;
      return res;
    }
    case 'press': {
      // your answer to its popup, then what's left: closed, or another question (Save → a file name)
      if (!target || !value?.button) return { error: 'no target' };
      const res = await run('press', target, value.button);
      if (!res.pressed) return res;
      await new Promise((r) => setTimeout(r, 1200));
      const [left, more] = await Promise.all([run('count', target), run('dialogs', target)]);
      return { pressed: true, windows: left.windows ?? 0, dialog: more.dialogs?.[0] || null };
    }
    case 'move': return target ? run('move', target, value?.where || 'other') : { error: 'no target' };
    case 'force': case 'min': case 'max': case 'front': case 'tab':
      return target ? run(op, target) : { error: 'no target' };
    case 'volume': return run('volume', value?.how || 'get', value?.amount ?? 0);
    case 'appVolume':
      return target ? run('appvolume', target, `${value?.how || 'get'}:${value?.amount ?? 0}`) : { error: 'no target' };
    case 'clip': {
      // the last bit of your game, saved: NVIDIA's Instant Replay if its overlay's running (Alt+F10,
      // its default), else Windows' Game Bar when it records in the background (Win+Alt+G)
      const can = await run('capture');
      if (can.nvidia) return { ...(await run('keys', 'alt+f10')), via: 'nvidia' };
      if (can.gamebar) return { ...(await run('keys', 'win+alt+g')), via: 'gamebar' };
      return { ok: false, why: 'off' };
    }
    case 'desktop': case 'undesktop': case 'lock': case 'monitor':
      return run(op);
    case 'sleep':
      // a moment first, so her line shows before the screens go
      setTimeout(() => run('sleep'), 2500);
      return { ok: true };
    case 'shutdown': case 'restart':
      if (!WIN) return { error: 'Windows only' };
      start('shutdown.exe', [op === 'restart' ? '/r' : '/s', '/t', '60', '/c', 'Capri: in a minute. Say "cancel the shutdown" to stop it.']);
      return { ok: true, seconds: 60 };
    case 'cancelShutdown':
      if (!WIN) return { error: 'Windows only' };
      start('shutdown.exe', ['/a']);
      return { ok: true };
    case 'settings': {
      const uri = SETTINGS[target] || SETTINGS.settings;
      start('explorer.exe', [uri]);
      return { ok: true };
    }
    case 'tool': {
      const tool = TOOLS[target];
      if (!tool) return { error: 'not that one' };
      start(tool[0], tool.slice(1));
      return { ok: true };
    }
    case 'stats': return stats();
    default: return { error: 'unknown' };
  }
}

module.exports = { control, SETTINGS, TOOLS };
