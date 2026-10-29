# Makes "Capri" shortcuts (Desktop and Start menu) that start her from this folder, with her icon
# (assets/icons/capri-app.ico), carrying her app ID (capri.desktop, as main.js sets it) so a pinned
# taskbar icon and her windows group together. Right-click the shortcut > Pin to taskbar.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icons\capri-app.ico'
if (-not (Test-Path $electron)) { throw "Electron isn't installed in $root (npm install first)" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CapriShortcut {
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint c);
    int GetAt(uint i, out PROPERTYKEY k);
    int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    int Commit();
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bind, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

  // System.AppUserModel.ID on a shortcut
  public static void SetAppId(string lnk, string id) {
    Guid iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);
    PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PROPVARIANT value = new PROPVARIANT { vt = 31 /* VT_LPWSTR */, p = Marshal.StringToCoTaskMemUni(id) };
    store.SetValue(ref key, ref value);
    store.Commit();
    Marshal.FreeCoTaskMem(value.p);
    Marshal.ReleaseComObject(store);
  }
}
'@

$places = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $places) {
  $lnk = Join-Path $dir 'Capri.lnk'
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $electron
  $s.Arguments = "`"$root`""
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.Description = 'Capri, the Project Capricorn construct, on your desktop'
  $s.Save()
  [CapriShortcut]::SetAppId($lnk, 'capri.desktop')
  "made $lnk"
}
