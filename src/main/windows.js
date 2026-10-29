'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates. It also says when the window in front is another AI (ChatGPT,
// Gemini…: `ai`, the names it matched), for her jealousy, and never passes on a title; which game
// is in front, if one (`game`, its folder in Steam's library or another launcher's); and the USB
// sticks plugged in (`usb`, drive letters), and the last device plugged in or out (`plug`).

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startWindowWatch({ overlay, onUpdate, onSeat }) {
  if (process.platform !== 'win32') return { stop() {}, refresh() {}, yours: () => null, seat() {} };

  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null; // the helper's last snapshot: it only speaks when something changes
  let yours = null; // the last ordinary window you were in that isn't hers: "close this"
  let seat = 0; // the window she sits on, watched closely by the helper

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  // the snapshot as seen from her window, wherever it is now
  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => toOverlay(w, bounds))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    // the window in front, where it is on the whole desktop (DIP), whichever screen she's on: a game
    // there keeps her off its screen (app.js); `ours`: the one in front is hers (you're typing to her)
    const fgWin = last.wins.find((w) => w.id === last.fg);
    if (fgWin && BigInt(last.fg) !== self) yours = last.fg;
    const fgDip = fgWin && screen.screenToDipRect(null, { x: fgWin.x, y: fgWin.y, width: fgWin.w, height: fgWin.h });
    onUpdate({
      fg: last.fg, taskbar: Boolean(last.taskbar), ai: Array.isArray(last.ai) ? last.ai : [],
      game: last.game || null, usb: Array.isArray(last.usb) ? last.usb : [], plug: last.plug || null, wins,
      front: fgDip ? { x: fgDip.x, y: fgDip.y, w: fgDip.width, h: fgDip.height } : null,
      ours: BigInt(last.fg || 0) === self,
    });
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    if (seat) child.stdin.write(`${seat}\n`);

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      // the window she sits on moved (being dragged): just its edge, straight to her
      if (data.seat !== undefined) {
        const w = last?.wins.find((x) => x.id === data.seat);
        if (!w || overlay.isDestroyed()) return;
        Object.assign(w, { x: data.x, y: data.y, w: data.w, h: data.h });
        onSeat?.(toOverlay(w, overlay.getBounds()));
        return;
      }
      last = data;
      send();
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // her window moved (another screen, the taskbar in it or not): the same windows, from there
    refresh: send,
    // the window you're in (or were, before talking to her), if it's still there: its handle
    yours: () => (last?.wins.some((w) => w.id === yours) ? yours : null),
    // she sat on a window (its handle), or got off (0)
    seat(id) {
      const n = Number(id) || 0;
      if (n === seat) return;
      seat = n;
      if (child?.stdin.writable) child.stdin.write(`${n}\n`);
    },
  };
}

module.exports = { startWindowWatch };
