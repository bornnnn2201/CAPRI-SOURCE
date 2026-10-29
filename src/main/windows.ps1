# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds. No contents, and no titles:
# the title of the window in front is only checked against a short list of AI names (ChatGPT,
# Gemini...) for her jealousy, and all that goes out is which of them matched ("ai").
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid>

param([long]$Self = 0, [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Management -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  // Other AIs: a key, what gives them away in the title of the window in front, and the name of
  // their own app's program, if they have one.
  static readonly string[][] AIS = {
    new[] { "chatgpt", @"\bChatGPT\b", "chatgpt" },
    new[] { "claude", @"\bClaude\b", "claude" },
    new[] { "codex", @"\bCodex\b", "codex" },
    new[] { "gemini", @"\bGemini\b", "" },
    new[] { "copilot", @"\bCopilot\b", "copilot" },
    new[] { "perplexity", @"\bPerplexity\b", "perplexity" },
    new[] { "deepseek", @"\bDeepSeek\b", "" },
    new[] { "grok", @"\bGrok\b", "" },
    new[] { "lechat", @"\bLe Chat\b|\bMistral AI\b", "" },
    new[] { "characterai", @"character\.ai", "" },
    new[] { "metaai", @"\bMeta AI\b", "" },
  };
  static IntPtr procOf = IntPtr.Zero;
  static string proc = "";
  static string game = "";

  // A game: its program sits in a launcher's library (Steam, Epic, Riot, Xbox, GOG). The game is the
  // name of its folder there (the launchers themselves aren't games).
  static readonly Regex GAME = new Regex(@"\\(?:steamapps\\common|Epic Games|Riot Games|XboxGames|GOG Galaxy\\Games)\\([^\\]+)\\", RegexOptions.IgnoreCase);
  static readonly Regex NOT_GAME = new Regex(@"launcher|client|redistributable|steamworks", RegexOptions.IgnoreCase);

  // The program behind the window in front, when it changes: its name, and the game it is, if one.
  static void Program(IntPtr fg) {
    if (fg == procOf) return;
    procOf = fg;
    proc = "";
    game = "";
    uint pid;
    GetWindowThreadProcessId(fg, out pid);
    try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch {}
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return;
    var path = new StringBuilder(1024);
    int size = path.Capacity;
    if (QueryFullProcessImageName(h, 0, path, ref size)) {
      var m = GAME.Match(path.ToString());
      if (m.Success && !NOT_GAME.IsMatch(m.Groups[1].Value)) game = m.Groups[1].Value;
    }
    CloseHandle(h);
  }

  static string Json(string s) {
    return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }

  // USB sticks (and SD cards) plugged in, by drive letter, looked at every couple of seconds.
  static string usb = "[]";
  static DateTime usbAt = DateTime.MinValue;
  static string Usb() {
    if ((DateTime.Now - usbAt).TotalMilliseconds < 2000) return usb;
    usbAt = DateTime.Now;
    var letters = new StringBuilder();
    try {
      foreach (var d in System.IO.DriveInfo.GetDrives()) {
        if (d.DriveType != System.IO.DriveType.Removable || !d.IsReady) continue;
        if (letters.Length > 0) letters.Append(',');
        letters.Append(Json(d.Name.Substring(0, 1)));
      }
    } catch {}
    usb = "[" + letters.ToString() + "]";
    return usb;
  }

  // Which of them the window in front is, as a JSON list of keys.
  static string Ai(IntPtr fg) {
    var title = new StringBuilder(512);
    GetWindowText(fg, title, 512);
    Program(fg);
    string t = title.ToString();
    var keys = new StringBuilder();
    foreach (var ai in AIS) {
      if (!Regex.IsMatch(t, ai[1], RegexOptions.IgnoreCase) && (ai[2] == "" || proc != ai[2])) continue;
      if (keys.Length > 0) keys.Append(',');
      keys.Append('"').Append(ai[0]).Append('"');
    }
    return "[" + keys.ToString() + "]";
  }

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
    try { WatchDevices(); } catch {}
  }

  // Devices plugged in or out (a phone, a controller, a headset...). Windows says something
  // changed; we list the devices again and see what's new or gone.
  static Dictionary<string, string[]> devices;
  static int plugs = 0;
  static string plug = "null";
  static readonly object gate = new object();

  static Dictionary<string, string[]> Devices() {
    var all = new Dictionary<string, string[]>();
    using (var q = new ManagementObjectSearcher("SELECT DeviceID, Name, PNPClass FROM Win32_PnPEntity")) {
      foreach (ManagementBaseObject d in q.Get()) {
        var id = d["DeviceID"] as string;
        if (id != null) all[id] = new[] { (d["Name"] as string) ?? "", (d["PNPClass"] as string) ?? "" };
      }
    }
    return all;
  }

  static void WatchDevices() {
    devices = Devices();
    var watcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_DeviceChangeEvent WHERE EventType = 2 OR EventType = 3"));
    watcher.EventArrived += (s, e) => {
      try { Changed(); } catch {} // never take the whole helper down over a device
    };
    watcher.Start();
  }

  static void Changed() {
    System.Threading.Thread.Sleep(1200); // a phone shows up as several devices, one after the other
    lock (gate) {
      var now = Devices();
      var added = new List<string[]>();
      var removed = new List<string[]>();
      foreach (var d in now) if (!devices.ContainsKey(d.Key)) added.Add(d.Value);
      foreach (var d in devices) if (!now.ContainsKey(d.Key)) removed.Add(d.Value);
      devices = now;
      bool plugged = added.Count > 0;
      var best = Best(plugged ? added : removed);
      if (best == null) return;
      plugs++;
      plug = "{\"n\":" + plugs + ",\"in\":" + (plugged ? "true" : "false") + ",\"name\":" + Json(best[0]) + ",\"class\":" + Json(best[1]) + "}";
    }
  }

  // The device that says the most about what was plugged: "Galaxy S21" rather than "USB Composite Device".
  static readonly Regex VAGUE = new Regex(@"composite|hub|concentrateur|input device|hid|mass storage|stockage|g.n.ri|virtu|num.rat|interface|host|h.te|bus|port|endpoint|service|profil|protocol|p.riph.rique|dispositivo", RegexOptions.IgnoreCase); // ASCII only: PowerShell reads this file as ANSI
  public static string[] Best(List<string[]> list) {
    string[] best = null;
    int top = int.MinValue;
    foreach (var d in list) {
      if (d[0] == "") continue;
      int score = d[1] == "WPD" ? 6 : d[1] == "AudioEndpoint" ? 5 : d[1] == "Camera" || d[1] == "Image" ? 4 : d[1] == "HIDClass" || d[1] == "Keyboard" || d[1] == "Mouse" ? 3 : d[1] == "Bluetooth" ? 2 : 1;
      if (VAGUE.IsMatch(d[0])) score -= 4;
      if (score > top) { top = score; best = d; }
    }
    return best;
  }

  // The watch itself, all in here (a PowerShell loop costs more than the looking does): a snapshot
  // every 150 ms while things change, every 300 ms once nothing has for a few seconds. Stops with
  // Capri, even if she crashed without telling us.
  // The window she sits on (Capri says which on stdin, 0 = none): its edge is read once per
  // screen refresh while it moves (Ride), so she rides a window you drag instead of hopping after it.
  static long seat = 0;
  static void Listen() {
    var t = new System.Threading.Thread(() => {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          long id;
          if (long.TryParse(line.Trim(), out id)) System.Threading.Interlocked.Exchange(ref seat, id);
        }
      } catch {}
    });
    t.IsBackground = true;
    t.Start();
  }

  public static void Run(long self, int parent) {
    Listen();
    string last = "";
    int still = 0, tick = 0;
    var output = Console.Out;
    Ride(output);
    var clock = System.Diagnostics.Stopwatch.StartNew();
    long next = 0;
    while (true) {
      long now = clock.ElapsedMilliseconds;
      if (now >= next) {
        string snap = Snapshot(self);
        if (snap != last) {
          lock (output) { output.WriteLine(snap); output.Flush(); }
          last = snap;
          still = 0;
        } else if (still < 1000) {
          still++;
        }
        if (parent != 0 && ++tick % 20 == 0) {
          try { System.Diagnostics.Process.GetProcessById(parent).Dispose(); } catch (ArgumentException) { return; }
        }
        next = now + (still > 20 ? 300 : 150);
      }
      if (System.Threading.Interlocked.Exchange(ref seatMoved, 0) != 0) still = 0;
      System.Threading.Thread.Sleep((int)Math.Max(1, next - clock.ElapsedMilliseconds));
    }
  }

  // The window she sits on, on its own thread so a snapshot never holds it up. While it's being
  // dragged it's read once per screen refresh, right after Windows draws the screen (in step with
  // it: on a timer of its own, some refreshes got no news and she stuttered), and she's put where
  // it will be by the time her own drawing reaches the screen, ~2 refreshes later, from how fast
  // it's going: on the window, not trailing it.
  static int seatMoved = 0;
  static void Ride(System.IO.TextWriter output) {
    var t = new System.Threading.Thread(() => {
      var clock = System.Diagnostics.Stopwatch.StartNew();
      string last = "";
      long lastId = 0;
      double px = 0, py = 0, pt = 0, vx = 0, vy = 0, frame = 1000.0 / 60, lastMove = -10000;
      int idle = 0;
      while (true) {
        long id = System.Threading.Interlocked.Read(ref seat);
        if (id == 0) { lastId = 0; Wait(50); continue; }
        var h = new IntPtr(id);
        bool fast = clock.Elapsed.TotalMilliseconds - lastMove < 400 || Dragged(h);
        if (fast) {
          double before = clock.Elapsed.TotalMilliseconds;
          if (!Refresh()) Wait(4);
          double gap = clock.Elapsed.TotalMilliseconds - before;
          if (gap > 2 && gap < 40) frame = frame * 0.9 + gap * 0.1; // how long a refresh is on this screen
        } else {
          Wait(30); // sitting still: just to notice it start
        }
        RECT r;
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) continue;
        double now = clock.Elapsed.TotalMilliseconds;
        if (id != lastId) { lastId = id; last = ""; px = r.Left; py = r.Top; pt = now; vx = vy = 0; idle = 2; }
        double dt = Math.Max(1, now - pt);
        if (r.Left != px || r.Top != py) {
          vx = vx * 0.4 + (r.Left - px) / dt * 0.6; // px per ms
          vy = vy * 0.4 + (r.Top - py) / dt * 0.6;
          idle = 0;
          lastMove = now;
        } else if (++idle >= 2) {
          vx = vy = 0; // stopped: back onto where it really is
        } else {
          vx *= 0.5; vy *= 0.5; // a refresh the window missed, or it's stopping
        }
        px = r.Left; py = r.Top; pt = now;
        double lead = Math.Min(40, frame * 2.2);
        int lx = (int)Math.Round(Math.Max(-160, Math.Min(160, vx * lead)));
        int ly = (int)Math.Round(Math.Max(-160, Math.Min(160, vy * lead)));
        string s = "{\"seat\":" + id + ",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + ",\"lx\":" + lx + ",\"ly\":" + ly + "}";
        if (s == last) continue;
        bool first = last == "";
        last = s;
        if (first) continue; // the first look is the snapshot's
        lock (output) { output.WriteLine(s); output.Flush(); }
        System.Threading.Interlocked.Exchange(ref seatMoved, 1);
      }
    });
    t.IsBackground = true;
    t.Priority = System.Threading.ThreadPriority.AboveNormal;
    t.Start();
  }

  // Waits for the screen's next refresh (Windows 11's compositor clock). False where there's none.
  [DllImport("dcomp.dll")] static extern uint DCompositionWaitForCompositorClock(uint count, IntPtr handles, uint timeoutMs);
  static bool noClock = false;
  static bool Refresh() {
    if (noClock) return false;
    try { DCompositionWaitForCompositorClock(0, IntPtr.Zero, 50); return true; }
    catch (EntryPointNotFoundException) { noClock = true; } catch (DllNotFoundException) { noClock = true; }
    return false;
  }

  // Is the window being dragged (or resized) right now? Its thread is in Windows' move loop: she
  // starts riding on its first step, not after it.
  [StructLayout(LayoutKind.Sequential)]
  struct GUITHREADINFO { public int cbSize, flags; public IntPtr active, focus, capture, menuOwner, moveSize, caret; public RECT caretRect; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  static bool Dragged(IntPtr h) {
    uint pid;
    uint tid = GetWindowThreadProcessId(h, out pid);
    if (tid == 0) return false;
    var info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    return GetGUIThreadInfo(tid, ref info) && (info.flags & 2) != 0; // GUI_INMOVESIZE
  }

  // A precise wait without raising Windows' timer for everyone (Sleep only wakes every 15.6 ms here).
  [DllImport("kernel32.dll")] static extern IntPtr CreateWaitableTimerExW(IntPtr attrs, IntPtr name, uint flags, uint access);
  [DllImport("kernel32.dll")] static extern bool SetWaitableTimer(IntPtr timer, ref long due, int period, IntPtr fn, IntPtr arg, bool resume);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  static IntPtr timer = IntPtr.Zero;
  static bool timerTried = false;
  static void Wait(int ms) {
    if (!timerTried) { timerTried = true; timer = CreateWaitableTimerExW(IntPtr.Zero, IntPtr.Zero, 2, 0x1F0003); } // HIGH_RESOLUTION, all access
    long due = -10000L * ms;
    if (timer != IntPtr.Zero && SetWaitableTimer(timer, ref due, 0, IntPtr.Zero, IntPtr.Zero, false)) WaitForSingleObject(timer, 1000);
    else System.Threading.Thread.Sleep(ms);
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr fg = GetForegroundWindow();
    var fgClass = new StringBuilder(64);
    GetClassName(fg, fgClass, 64);
    // the taskbar clicked: it comes up over her (Windows has no levels among windows on top)
    bool taskbar = fgClass.ToString() == "Shell_TrayWnd" || fgClass.ToString() == "Shell_SecondaryTrayWnd";
    sb.Append("{\"fg\":").Append(fg.ToInt64()).Append(",\"taskbar\":").Append(taskbar ? "true" : "false")
      .Append(",\"ai\":").Append(Ai(fg))
      .Append(",\"game\":").Append(game == "" ? "null" : Json(game))
      .Append(",\"usb\":").Append(Usb());
    lock (gate) sb.Append(",\"plug\":").Append(plug);
    sb.Append(",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
[CapriWindows]::Run($Self, $ParentPid)
