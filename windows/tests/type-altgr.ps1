param(
    [Parameter(Mandatory)][Int64]$WindowHandle,
    [Parameter(Mandatory)][int]$AppProcessId,
    [Parameter(Mandatory)][ValidateSet('00000407','00000415')][string]$Layout
)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'This keyboard layout test requires a disposable GitHub-hosted Windows desktop.' }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class MenuKeyboardFixture {
    [StructLayout(LayoutKind.Sequential)]
    struct Key { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    struct Data { [FieldOffset(0)] public Key key; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)]
    struct Input { public uint type; public Data data; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr LoadKeyboardLayout(string id, uint flags);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);

    static void Activate(IntPtr window, uint thread, IntPtr layout) {
        if (!PostMessage(window, 0x0050, IntPtr.Zero, layout)) throw new Exception("Unable to request the input layout.");
        for (int i = 0; i < 50; i++) {
            if (GetKeyboardLayout(thread) == layout) return;
            Thread.Sleep(40);
        }
        throw new Exception("The test window did not activate the requested layout.");
    }

    static Input Scan(ushort scan, uint flags) {
        return new Input { type = 1, data = new Data { key = new Key { scan = scan, flags = 8 | flags } } };
    }

    public static void Type(IntPtr window, uint process, string id) {
        uint owner;
        uint thread = GetWindowThreadProcessId(window, out owner);
        if (thread == 0 || owner != process || GetForegroundWindow() != window)
            throw new Exception("The isolated test app must own the foreground window.");
        IntPtr original = GetKeyboardLayout(thread);
        IntPtr layout = LoadKeyboardLayout(id, 0);
        if ((layout.ToInt64() & 0xffff) != Convert.ToInt32(id.Substring(4), 16))
            throw new Exception("The hosted desktop did not load keyboard layout " + id);
        try {
            Activate(window, thread, layout);
            if (GetForegroundWindow() != window) throw new Exception("The test app lost focus.");
            ushort letter = id == "00000407" ? (ushort)0x12 : (ushort)0x1f;
            var strokes = new[] { Scan(0x38, 1), Scan(letter, 0), Scan(letter, 2), Scan(0x38, 3) };
            if (SendInput((uint)strokes.Length, strokes, Marshal.SizeOf(typeof(Input))) != strokes.Length)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            Thread.Sleep(200);
        } finally { Activate(window, thread, original); }
    }
}
'@
[MenuKeyboardFixture]::Type([IntPtr]$WindowHandle, $AppProcessId, $Layout)
