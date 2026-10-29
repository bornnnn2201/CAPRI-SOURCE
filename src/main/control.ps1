# Her hands on your PC (control.js): the windows of an app, the volume, locking, sleep.
# Prints one JSON line with what happened.
#
#   powershell -File control.ps1 <op> [arg] [arg2]
#     close|force|min|max|front <process name, or #hwnd for one window>
#     tab #hwnd                     Ctrl+W in that window (its tab)
#     count <name or #hwnd>         how many of its windows are open
#     dialogs <name or #hwnd>       the popups it shows (title, text, buttons)
#     press <name or #hwnd> <button>  that popup button, pressed
#     volume get|set|up|down|mute|unmute [0-100]
#     appvolume <name or #hwnd> <get|set|up|down|mute|unmute>[:0-100]   one app's own volume (the mixer's)
#     move <name or #hwnd> <main|other|second|left|right|1|2|3>   its window onto that monitor
#     keys <alt+f10, win+alt+g...>  a shortcut pressed (her "clip that")
#     capture                       what can save a clip: NVIDIA's Instant Replay, Windows' Game Bar
#     desktop | undesktop | lock | sleep | monitor

param([string]$Op = '', [string]$Arg = '', [string]$Arg2 = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8 # a popup's text, as written

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CapriHands {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool LockWorkStation();
  [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate, bool force, bool noWake);

  const uint WM_CLOSE = 0x10, WM_SYSCOMMAND = 0x112;
  const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;
  const uint KEYUP = 0x2;

  static HashSet<uint> Pids(string name) {
    var set = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName(name)) set.Add((uint)p.Id);
    return set;
  }

  // the app's own windows (what its taskbar button stands for), front to back
  static List<IntPtr> Windows(string target) {
    var list = new List<IntPtr>();
    if (target.StartsWith("#")) {
      var h = new IntPtr(long.Parse(target.Substring(1)));
      if (IsWindow(h)) list.Add(h);
      return list;
    }
    var pids = Pids(target);
    if (pids.Count == 0) return list;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // 4: GW_OWNER
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0 || GetWindowTextLength(h) == 0) return true;
      list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // to the front, even though we aren't the app in front (a tap of Alt lets it through)
  static void Front(IntPtr h) {
    if (IsIconic(h)) ShowWindowAsync(h, 9); // SW_RESTORE
    if (SetForegroundWindow(h) && GetForegroundWindow() == h) return;
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
    SetForegroundWindow(h);
  }

  // closes them all the way their close buttons do; { windows, running }: windows still open, and
  // whether the program still runs without any (in the tray)
  public static string Close(string target) {
    var wins = Windows(target);
    foreach (var h in wins) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    int left = wins.Count;
    for (int i = 0; i < 30 && left > 0; i++) {
      Thread.Sleep(100);
      left = 0;
      foreach (var h in wins) if (IsWindow(h) && IsWindowVisible(h)) left++;
    }
    bool running = !target.StartsWith("#") && Pids(target).Count > 0;
    return "{\"found\":" + wins.Count + ",\"windows\":" + left + ",\"running\":" + (running ? "true" : "false") + "}";
  }

  // ends the program outright (and what it started): unsaved work is lost
  public static string Force(string target) {
    int found = 0;
    foreach (var p in Process.GetProcessesByName(target)) {
      found++;
      try { p.Kill(); } catch {}
    }
    Thread.Sleep(600);
    return "{\"found\":" + found + ",\"windows\":0,\"running\":" + (Pids(target).Count > 0 ? "true" : "false") + "}";
  }

  public static string Show(string target, string how) {
    var wins = Windows(target);
    if (wins.Count == 0) return "{\"found\":0}";
    if (how == "min") foreach (var h in wins) ShowWindowAsync(h, 6); // SW_MINIMIZE, all of them
    else {
      if (how == "max") ShowWindowAsync(wins[0], 3); // SW_MAXIMIZE
      Front(wins[0]);
    }
    return "{\"found\":" + wins.Count + "}";
  }

  public static string Count(string target) { return "{\"windows\":" + Windows(target).Count + "}"; }

  public static string Tab(string target) {
    var wins = Windows(target);
    if (wins.Count == 0) return "{\"found\":0}";
    Front(wins[0]);
    Thread.Sleep(150);
    keybd_event(0x11, 0, 0, UIntPtr.Zero);    // Ctrl
    keybd_event(0x57, 0, 0, UIntPtr.Zero);    // W
    keybd_event(0x57, 0, KEYUP, UIntPtr.Zero);
    keybd_event(0x11, 0, KEYUP, UIntPtr.Zero);
    return "{\"found\":1}";
  }

  public static string Lock() { return "{\"ok\":" + (LockWorkStation() ? "true" : "false") + "}"; }
  public static string Sleep() { return "{\"ok\":" + (SetSuspendState(false, false, false) ? "true" : "false") + "}"; }
  // all screens off until the mouse moves (SC_MONITORPOWER, 2: off)
  public static string Monitor() {
    PostMessage(new IntPtr(0xffff), WM_SYSCOMMAND, new IntPtr(0xF170), new IntPtr(2));
    return "{\"ok\":true}";
  }

  // The speakers' volume (the default output), as Windows' own slider has it.
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint n); int SetMasterVolumeLevel(float db, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx); int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint c, float db, ref Guid ctx); int SetChannelVolumeLevelScalar(uint c, float l, ref Guid ctx);
    int GetChannelVolumeLevel(uint c, out float db); int GetChannelVolumeLevelScalar(uint c, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IntPtr devices); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  static IAudioEndpointVolume Speakers() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev)); // render, multimedia
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
    return (IAudioEndpointVolume)o;
  }

  public static string Volume(string how, int amount) {
    var v = Speakers();
    var ctx = Guid.Empty;
    float level;
    bool muted;
    v.GetMasterVolumeLevelScalar(out level);
    int now = (int)Math.Round(level * 100);
    int want = how == "set" ? amount : how == "up" ? now + amount : how == "down" ? now - amount : now;
    want = Math.Max(0, Math.Min(100, want));
    if (want != now) v.SetMasterVolumeLevelScalar(want / 100f, ref ctx);
    if (how == "mute") v.SetMute(true, ref ctx);
    else if (how == "unmute" || ((how == "set" || how == "up") && want > 0)) v.SetMute(false, ref ctx);
    v.GetMasterVolumeLevelScalar(out level);
    v.GetMute(out muted);
    return "{\"volume\":" + (int)Math.Round(level * 100) + ",\"muted\":" + (muted ? "true" : "false") + "}";
  }

  // An app's window onto another monitor, where it sat on its own (the same spot, the same size as
  // far as it fits; maximized there if it was). `where`: main, other, left, right, or 1, 2, 3 left to
  // right. In real pixels whatever the scaling (a per-monitor DPI-aware call).
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
  delegate bool MonitorProc(IntPtr m, IntPtr dc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc cb, IntPtr data);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);

  public static string Move(string target, string where) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
    var wins = Windows(target);
    if (wins.Count == 0) return "{\"found\":0}";
    var mons = new List<IntPtr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr m, IntPtr dc, ref RECT r, IntPtr d) => { mons.Add(m); return true; }, IntPtr.Zero);
    var info = new List<MONITORINFO>();
    foreach (var m in mons) { var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO)); GetMonitorInfo(m, ref mi); info.Add(mi); }
    if (mons.Count < 2) return "{\"found\":" + wins.Count + ",\"screens\":" + mons.Count + "}";
    // left to right (top to bottom when they're stacked)
    var order = new List<int>();
    for (int i = 0; i < mons.Count; i++) order.Add(i);
    order.Sort((a, b) => info[a].rcMonitor.Left != info[b].rcMonitor.Left ? info[a].rcMonitor.Left.CompareTo(info[b].rcMonitor.Left) : info[a].rcMonitor.Top.CompareTo(info[b].rcMonitor.Top));
    var h = wins[0];
    int from = mons.IndexOf(MonitorFromWindow(h, 2)); // MONITOR_DEFAULTTONEAREST
    int main = -1;
    for (int i = 0; i < mons.Count; i++) if ((info[i].dwFlags & 1) != 0) main = i; // MONITORINFOF_PRIMARY
    int to = -1;
    string w = where.ToLowerInvariant();
    int n;
    if (w == "main" || w == "primary" || w == "first") to = main;
    else if (w == "left") to = order[0];
    else if (w == "right") to = order[order.Count - 1];
    else if (int.TryParse(w, out n) && n >= 1 && n <= order.Count) to = order[n - 1];
    // "second", "other", "next": the one it isn't on (from the main one: the next one along)
    if (to < 0) {
      int at = order.IndexOf(from);
      to = order[(at + 1) % order.Count];
      if (w == "second" && from != main) to = main == order[0] && order.Count > 1 ? order[1] : order[0];
      if (w == "second" && from == main) { foreach (var i in order) if (i != main) { to = i; break; } }
    }
    int index = order.IndexOf(to) + 1;
    if (to == from) return "{\"found\":" + wins.Count + ",\"already\":true,\"monitor\":" + index + ",\"screens\":" + mons.Count + "}";
    bool max = IsZoomed(h);
    if (IsIconic(h) || max) ShowWindow(h, 9); // SW_RESTORE: moved as a normal window, then put back
    RECT wr;
    GetWindowRect(h, out wr);
    RECT src = info[from < 0 ? main : from].rcWork, dst = info[to].rcWork;
    int ww = Math.Min(wr.Right - wr.Left, dst.Right - dst.Left), wh = Math.Min(wr.Bottom - wr.Top, dst.Bottom - dst.Top);
    double fx = (src.Right - src.Left) > 0 ? (wr.Left - src.Left) / (double)(src.Right - src.Left) : 0;
    double fy = (src.Bottom - src.Top) > 0 ? (wr.Top - src.Top) / (double)(src.Bottom - src.Top) : 0;
    int x = Math.Max(dst.Left, Math.Min(dst.Right - ww, dst.Left + (int)(fx * (dst.Right - dst.Left))));
    int y = Math.Max(dst.Top, Math.Min(dst.Bottom - wh, dst.Top + (int)(fy * (dst.Bottom - dst.Top))));
    SetWindowPos(h, IntPtr.Zero, x, y, ww, wh, 0x0004 | 0x0010); // SWP_NOZORDER | SWP_NOACTIVATE
    if (max) ShowWindow(h, 3); // SW_MAXIMIZE, on its new monitor
    Thread.Sleep(150);
    bool there = mons.IndexOf(MonitorFromWindow(h, 2)) == to;
    return "{\"found\":" + wins.Count + ",\"moved\":" + (there ? "true" : "false") + ",\"monitor\":" + index + ",\"main\":" + (to == main ? "true" : "false") + ",\"screens\":" + mons.Count + "}";
  }

  // One app's own volume, as the volume mixer has it: every sound session of its processes (Discord
  // talks through several). An app only has one while it has opened its sound (found: 0 otherwise).
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr a, int b, out IntPtr c); int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int s); int GetDisplayName(out IntPtr n); int SetDisplayName(string n, ref Guid c);
    int GetIconPath(out IntPtr p); int SetIconPath(string p, ref Guid c); int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid g, ref Guid c);
    int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr id); int GetSessionInstanceIdentifier(out IntPtr id); int GetProcessId(out uint pid);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid c); int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid c); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public static string AppVolume(string target, string how, int amount) {
    // the app by its process name, or the one behind a window (#hwnd: the game in front)
    string name = target;
    if (target.StartsWith("#")) {
      uint pid;
      GetWindowThreadProcessId(new IntPtr(long.Parse(target.Substring(1))), out pid);
      try { name = Process.GetProcessById((int)pid).ProcessName; } catch { return "{\"found\":0}"; }
    }
    var pids = Pids(name);
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    var iid = typeof(IAudioSessionManager2).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    IAudioSessionEnumerator list;
    Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out list));
    int count;
    list.GetCount(out count);
    var ctx = Guid.Empty;
    int found = 0, volume = 0;
    bool muted = false;
    for (int i = 0; i < count; i++) {
      IAudioSessionControl2 session;
      if (list.GetSession(i, out session) != 0 || session == null) continue;
      uint pid;
      session.GetProcessId(out pid);
      if (!pids.Contains(pid)) continue;
      var v = (ISimpleAudioVolume)session;
      float level;
      v.GetMasterVolume(out level);
      int now = (int)Math.Round(level * 100);
      int want = Math.Max(0, Math.Min(100, how == "set" ? amount : how == "up" ? now + amount : how == "down" ? now - amount : now));
      if (want != now) v.SetMasterVolume(want / 100f, ref ctx);
      if (how == "mute") v.SetMute(true, ref ctx);
      else if (how == "unmute" || ((how == "set" || how == "up") && want > 0)) v.SetMute(false, ref ctx);
      v.GetMasterVolume(out level);
      v.GetMute(out muted);
      volume = (int)Math.Round(level * 100);
      found++;
    }
    return "{\"found\":" + found + ",\"name\":\"" + name.Replace("\\", "").Replace("\"", "") + "\",\"volume\":" + volume + ",\"muted\":" + (muted ? "true" : "false") + "}";
  }

  // A shortcut, pressed and let go in order ("alt+f10"): what her "clip that" sends to the recorder
  public static string Keys(string combo) {
    var vks = new List<byte>();
    foreach (var k in combo.ToLowerInvariant().Split('+')) {
      byte vk = k == "alt" ? (byte)0x12 : k == "ctrl" ? (byte)0x11 : k == "shift" ? (byte)0x10 : k == "win" ? (byte)0x5B
        : k == "prtsc" ? (byte)0x2C : k.Length > 1 && k[0] == 'f' ? (byte)(0x6F + int.Parse(k.Substring(1))) : k.Length == 1 ? (byte)char.ToUpperInvariant(k[0]) : (byte)0;
      if (vk == 0) return "{\"ok\":false}";
      vks.Add(vk);
    }
    foreach (var vk in vks) keybd_event(vk, 0, 0, UIntPtr.Zero);
    Thread.Sleep(40);
    for (int i = vks.Count - 1; i >= 0; i--) keybd_event(vks[i], 0, KEYUP, UIntPtr.Zero);
    return "{\"ok\":true}";
  }
}
"@

# Popups: what an app asks when it's being closed ("Save changes?", "Leave site?"), read and answered
# through UI Automation, which sees inside most apps (classic dialogs, browsers, Windows' new apps).
if ($Op -eq 'dialogs' -or $Op -eq 'press') {
  Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

public static class CapriPopups {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);

  static readonly HashSet<string> FRAME = new HashSet<string> { "Minimize", "Maximize", "Restore", "Close", "System", "Help" };

  // the windows of the app (its process name, or #hwnd: that window's program): its own, and the
  // small ones it opened over them (classic dialogs are windows of their own, owned by the app's)
  static List<KeyValuePair<IntPtr, bool>> Roots(string target) {
    var pids = new HashSet<uint>();
    if (target.StartsWith("#")) {
      uint pid;
      var h = new IntPtr(long.Parse(target.Substring(1)));
      if (IsWindow(h)) { GetWindowThreadProcessId(h, out pid); pids.Add(pid); }
    } else foreach (var p in Process.GetProcessesByName(target)) pids.Add((uint)p.Id);
    var list = new List<KeyValuePair<IntPtr, bool>>();
    if (pids.Count == 0) return list;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      bool popup = GetWindow(h, 4) != IntPtr.Zero || cls.ToString() == "#32770"; // 4: GW_OWNER
      list.Add(new KeyValuePair<IntPtr, bool>(h, popup));
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // a question with a few buttons to answer it (not the window's own title-bar buttons)
  static List<AutomationElement> Buttons(AutomationElement el) {
    var found = new List<AutomationElement>();
    foreach (AutomationElement b in el.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button))) {
      string name = (b.Current.Name ?? "").Trim();
      if (name == "" || FRAME.Contains(name)) continue;
      var parent = TreeWalker.ControlViewWalker.GetParent(b);
      if (parent != null && parent.Current.ControlType == ControlType.TitleBar) continue;
      found.Add(b);
      if (found.Count > 8) break;
    }
    return found;
  }

  // dialogs inside the app's window (a browser's "Leave site?", Notepad's "Save changes?"): looked for
  // a few levels down, never inside the page itself (a web page's own buttons aren't a question)
  static void Inner(AutomationElement el, int depth, List<AutomationElement> into, ref int budget) {
    if (depth > 7 || budget-- <= 0) return;
    var child = TreeWalker.ControlViewWalker.GetFirstChild(el);
    while (child != null && budget > 0) {
      var type = child.Current.ControlType;
      if (type != ControlType.Document) {
        bool dialog = type == ControlType.Window || child.Current.LocalizedControlType == "dialog";
        if (dialog) into.Add(child);
        else Inner(child, depth + 1, into, ref budget);
      }
      child = TreeWalker.ControlViewWalker.GetNextSibling(child);
    }
  }

  static List<AutomationElement> Find(string target) {
    var found = new List<AutomationElement>();
    foreach (var root in Roots(target)) {
      AutomationElement el;
      try { el = AutomationElement.FromHandle(root.Key); } catch { continue; }
      if (root.Value) { found.Add(el); continue; }
      int budget = 600;
      try { Inner(el, 0, found, ref budget); } catch {}
    }
    return found.FindAll(d => { try { int n = Buttons(d).Count; return n >= 1 && n <= 8; } catch { return false; } });
  }

  static string Json(string s) {
    var sb = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') sb.Append('\\').Append(c);
      else if (c < ' ') sb.Append(' ');
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }

  public static string List(string target) {
    var sb = new StringBuilder("{\"dialogs\":[");
    int n = 0;
    var seen = new HashSet<string>(); // a classic dialog shows up twice: on its own, and under the app's window
    foreach (var d in Find(target)) {
      var text = new StringBuilder();
      foreach (AutomationElement t in d.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text))) {
        string s = (t.Current.Name ?? "").Trim();
        if (s != "" && text.Length < 400) text.Append(text.Length > 0 ? " " : "").Append(s);
      }
      var names = new List<string>();
      foreach (var b in Buttons(d)) names.Add(Json(b.Current.Name.Trim()));
      string one = "{\"title\":" + Json(d.Current.Name) + ",\"text\":" + Json(text.ToString()) + ",\"buttons\":[" + string.Join(",", names) + "]}";
      if (!seen.Add(one)) continue;
      if (n++ > 0) sb.Append(',');
      sb.Append(one);
    }
    return sb.Append("]}").ToString();
  }

  // presses the button by that name in the app's popup, the way a click would
  public static string Press(string target, string button) {
    foreach (var d in Find(target)) {
      foreach (var b in Buttons(d)) {
        if (b.Current.Name.Trim() != button) continue;
        object pattern;
        if (!b.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) return "{\"pressed\":false}";
        ((InvokePattern)pattern).Invoke();
        return "{\"pressed\":true}";
      }
    }
    return "{\"pressed\":false}";
  }
}
"@
}

# Discord's own buttons for your voice (mute, deafen, camera, screen share, leaving the call), found
# through UI Automation like the popups: where each one is on screen (she zaps it) and whether it's
# on, then pressed the way a click would. Chromium only builds what UI Automation sees once something
# asks: the first look can come back empty, so a few looks, a moment apart.
if ($Op -eq 'discord') {
  Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;

public static class CapriDiscord {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  // each button by what Discord calls it (its English labels), on or off
  static readonly Dictionary<string, Regex> NAMES = new Dictionary<string, Regex> {
    { "mute", new Regex(@"^(?:mute|unmute)$", RegexOptions.IgnoreCase) },
    { "deafen", new Regex(@"^(?:deafen|undeafen)$", RegexOptions.IgnoreCase) },
    { "camera", new Regex(@"^(?:turn (?:on|off) camera|camera|(?:start|stop) video|video)$", RegexOptions.IgnoreCase) },
    { "screen", new Regex(@"^(?:share your screen|share screen|screen share|stop streaming|stop sharing|go live)$", RegexOptions.IgnoreCase) },
    { "disconnect", new Regex(@"^(?:disconnect|leave call)$", RegexOptions.IgnoreCase) },
  };
  // what its label says when it's on (when there's no on/off state to read)
  static readonly Regex ON_LABEL = new Regex(@"^(?:unmute|undeafen|turn off camera|stop video|stop streaming|stop sharing)$", RegexOptions.IgnoreCase);

  static List<IntPtr> Windows() {
    var pids = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("Discord")) pids.Add((uint)p.Id);
    var list = new List<IntPtr>();
    if (pids.Count == 0) return list;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pids.Contains(pid) && IsWindowVisible(h)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static AutomationElement Find(string what, out string why) {
    why = Process.GetProcessesByName("Discord").Length == 0 ? "closed" : "hidden";
    Regex re;
    if (!NAMES.TryGetValue(what, out re)) { why = "unknown"; return null; }
    var button = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
    for (int tries = 0; tries < 4; tries++) {
      int seen = 0;
      foreach (var h in Windows()) {
        AutomationElement root;
        try { root = AutomationElement.FromHandle(h); } catch { continue; }
        AutomationElementCollection all;
        try { all = root.FindAll(TreeScope.Descendants, button); } catch { continue; }
        seen += all.Count;
        foreach (AutomationElement b in all) {
          string name = (b.Current.Name ?? "").Trim();
          if (re.IsMatch(name)) return b;
        }
      }
      if (seen > 5) { why = what == "mute" || what == "deafen" ? "hidden" : "nocall"; return null; } // it looked: no such button (not in a call)
      System.Threading.Thread.Sleep(700);
    }
    return null;
  }

  static bool IsOn(AutomationElement b) {
    object pattern;
    if (b.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) return ((TogglePattern)pattern).Current.ToggleState == ToggleState.On;
    return ON_LABEL.IsMatch((b.Current.Name ?? "").Trim());
  }

  static string Json(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

  static string Describe(AutomationElement b) {
    var r = b.Current.BoundingRectangle;
    bool shown = !r.IsEmpty && r.Width > 0 && r.X > -10000;
    return "{\"found\":true,\"name\":" + Json(b.Current.Name) + ",\"on\":" + (IsOn(b) ? "true" : "false")
      + (shown ? ",\"rect\":{\"x\":" + (int)r.X + ",\"y\":" + (int)r.Y + ",\"w\":" + (int)r.Width + ",\"h\":" + (int)r.Height + "}" : "") + "}";
  }

  // where that button is, and whether it's on
  public static string Look(string what) {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // its place in real pixels, like the windows'
    string why;
    var b = Find(what, out why);
    return b == null ? "{\"found\":false,\"why\":" + Json(why) + "}" : Describe(b);
  }

  // pressed, then looked at again: on or off now
  public static string Press(string what) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    string why;
    var b = Find(what, out why);
    if (b == null) return "{\"found\":false,\"why\":" + Json(why) + "}";
    object pattern;
    try {
      if (b.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) ((InvokePattern)pattern).Invoke();
      else if (b.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) ((TogglePattern)pattern).Toggle();
      else return "{\"found\":true,\"pressed\":false}";
    } catch { return "{\"found\":true,\"pressed\":false}"; }
    System.Threading.Thread.Sleep(350);
    var after = Find(what, out why);
    return "{\"pressed\":true,\"after\":" + (after == null ? "null" : Describe(after)) + "}";
  }
}
"@
}

$out = switch ($Op) {
  'discord' { if ($Arg2 -eq 'press') { [CapriDiscord]::Press($Arg) } else { [CapriDiscord]::Look($Arg) } }
  'dialogs' { [CapriPopups]::List($Arg) }
  'press' { [CapriPopups]::Press($Arg, $Arg2) }
  'close' { [CapriHands]::Close($Arg) }
  'force' { [CapriHands]::Force($Arg) }
  'min' { [CapriHands]::Show($Arg, 'min') }
  'max' { [CapriHands]::Show($Arg, 'max') }
  'front' { [CapriHands]::Show($Arg, 'front') }
  'tab' { [CapriHands]::Tab($Arg) }
  'count' { [CapriHands]::Count($Arg) }
  'volume' { [CapriHands]::Volume($Arg, [int]("0$Arg2")) }
  'appvolume' { $how, $n = "${Arg2}:".Split(':'); [CapriHands]::AppVolume($Arg, $how, [int]("0$n")) }
  'keys' { [CapriHands]::Keys($Arg) }
  'move' { [CapriHands]::Move($Arg, $Arg2) }
  'capture' {
    # NVIDIA's overlay helper running: its Instant Replay saves on Alt+F10. Windows' Game Bar: only
    # with its captures and "record what happened" switched on.
    $dvr = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -ErrorAction SilentlyContinue
    $nvidia = [bool](Get-Process nvsphelper64, 'NVIDIA Share' -ErrorAction SilentlyContinue)
    $gamebar = $dvr.AppCaptureEnabled -eq 1 -and $dvr.HistoricalCaptureEnabled -eq 1
    '{"nvidia":' + "$nvidia".ToLower() + ',"gamebar":' + "$gamebar".ToLower() + '}'
  }
  'desktop' { (New-Object -ComObject Shell.Application).MinimizeAll(); '{"ok":true}' }
  'undesktop' { (New-Object -ComObject Shell.Application).UndoMinimizeALL(); '{"ok":true}' }
  'lock' { [CapriHands]::Lock() }
  'sleep' { [CapriHands]::Sleep() }
  'monitor' { [CapriHands]::Monitor() }
  default { '{"error":"unknown"}' }
}
[Console]::Out.WriteLine($out)
