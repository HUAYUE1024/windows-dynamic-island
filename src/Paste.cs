// Restores the window that had focus before the island took it, then sends Ctrl+V
// there. Electron has no SendInput/SetForegroundWindow binding, and the island is
// always-on-top so without this the user has to click back into their app by hand.
//
//   paste.exe mark            -> prints {"hwnd":N}
//   paste.exe paste <hwnd>    -> foreground that window, send Ctrl+V, print {"ok":true}
//
// Both modes print one JSON line so the app can reuse its existing probe runner
// instead of carrying a second spawn path; failure prints nothing.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class Paste {
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    // The only way a background process can take the foreground: share the target's
    // input queue. AllowSetForegroundWindow does not help here — it has to be called
    // by the process that already owns the foreground, which is not us.
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

    const byte VK_CONTROL = 0x11;
    const byte VK_V = 0x56;
    const uint KEYEVENTF_KEYUP = 0x02;

    static bool ForceForeground(IntPtr hWnd) {
        uint unused;
        uint targetThread = GetWindowThreadProcessId(hWnd, out unused);
        uint ourThread = GetCurrentThreadId();
        if (targetThread == 0 || targetThread == ourThread) return SetForegroundWindow(hWnd);
        AttachThreadInput(ourThread, targetThread, true);
        bool ok = SetForegroundWindow(hWnd);
        AttachThreadInput(ourThread, targetThread, false);
        return ok;
    }

    static int Main(string[] args) {
        if (args.Length < 1) return 2;

        if (args[0] == "mark") {
            Console.Out.WriteLine("{\"hwnd\":" + GetForegroundWindow().ToInt64().ToString() + "}");
            Console.Out.Flush();
            return 0;
        }

        if (args[0] != "paste" || args.Length < 2) return 2;
        long raw;
        if (!long.TryParse(args[1], out raw)) return 2;
        IntPtr target = new IntPtr(raw);
        if (target == IntPtr.Zero) return 3;

        if (!ForceForeground(target)) return 3;
        // Give the target window a beat to actually take the foreground before the
        // keystroke lands, otherwise Ctrl+V goes to whatever is still on top.
        Thread.Sleep(60);

        keybd_event(VK_CONTROL, 0, 0, IntPtr.Zero);
        keybd_event(VK_V, 0, 0, IntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, IntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, IntPtr.Zero);
        Console.Out.WriteLine("{\"ok\":true}");
        Console.Out.Flush();
        return 0;
    }
}
