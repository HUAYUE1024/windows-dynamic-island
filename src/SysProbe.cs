// System probe: volume, battery, network and machine vitals.
// Compiled by scripts/build-probe.mjs alongside Probe.cs.
//
//   sysprobe.exe volume | battery | network | perf
//   sysprobe.exe setvol <0-100> | mute <true|false> | bright <0-100>
//
// One JSON line on stdout, {"ok":false,"error":"..."} on failure.
using System;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Windows.Devices.Power;
using Windows.Networking.Connectivity;
using Windows.System.Power;

static class SysProbe
{
    // csc here is C# 5: no async entry point, so block on the async body.
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            return Run(args);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.ToString());
            Console.Out.WriteLine("{\"ok\":false,\"error\":\"" + Esc(e.Message) + "\"}");
            return 1;
        }
    }

    static int Run(string[] args)
    {
        string mode = args.Length > 0 ? args[0] : "perf";
        switch (mode)
        {
            case "volume": Console.Out.WriteLine(Volume()); return 0;
            case "setvol":
                double v;
                if (args.Length > 1 && double.TryParse(args[1], NumberStyles.Float, CultureInfo.InvariantCulture, out v))
                {
                    SetVolume((float)(Math.Max(0, Math.Min(100, v)) / 100.0));
                    Console.Out.WriteLine(Volume());
                    return 0;
                }
                break;
            case "mute":
                bool m;
                if (args.Length > 1 && bool.TryParse(args[1], out m))
                {
                    SetMute(m);
                    Console.Out.WriteLine(Volume());
                    return 0;
                }
                break;
            case "bright":
                int b;
                if (args.Length > 1 && int.TryParse(args[1], out b))
                {
                    SetBrightness(Math.Max(0, Math.Min(100, b)));
                    Console.Out.WriteLine("{\"ok\":true,\"brightness\":" + Math.Max(0, Math.Min(100, b)) + "}");
                    return 0;
                }
                break;
            case "battery": Console.Out.WriteLine(Battery()); return 0;
            case "network": Console.Out.WriteLine(Network()); return 0;
            case "perf": Console.Out.WriteLine(Perf()); return 0;
        }
        Console.Out.WriteLine("{\"ok\":false,\"error\":\"unknown mode\"}");
        return 1;
    }

    // ── volume via Core Audio (IAudioEndpointVolume) ──────────────────────
    // RCWs are not IDisposable, so there is no using here.
    static string Volume()
    {
        float level;
        bool muted;
        IAudioEndpointVolume vol = Audio.DefaultEndpointVolume();
        vol.GetMasterVolumeLevelScalar(out level);
        vol.GetMute(out muted);
        string device = FriendlyDeviceName();
        // One decimal, not an integer: the endpoint is continuous, and rounding here
        // erased the fractional value the renderer just set, snapping the knob back
        // to a whole percent and making the slider feel steppy.
        return "{\"ok\":true,\"level\":" + (Math.Round(level * 1000) / 10.0).ToString(CultureInfo.InvariantCulture) +
               ",\"muted\":" + (muted ? "true" : "false") +
               ",\"device\":\"" + Esc(device) + "\"}";
    }

    static void SetVolume(float scalar)
    {
        Audio.DefaultEndpointVolume().SetMasterVolumeLevelScalar(scalar, Guid.Empty);
    }

    static void SetMute(bool mute)
    {
        Audio.DefaultEndpointVolume().SetMute(mute, Guid.Empty);
    }

    static string FriendlyDeviceName()
    {
        // IMMDevice.GetId() returns an opaque endpoint id; the display name lives in
        // the MMDevices registry key, which is readable without elevation.
        try
        {
            string id = Audio.DefaultEndpointId();
            int cut = id.LastIndexOf('.');
            if (cut < 0 || cut + 1 >= id.Length) return "默认设备";
            string guid = id.Substring(cut + 1).Trim('{', '}');
            using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{" + guid + @"}\Properties"))
            {
                if (key == null) return "默认设备";
                object name = key.GetValue("{a45c254e-df1c-4efd-8020-67d146a850e0},2");
                if (name == null) return "默认设备";
                return name.ToString();
            }
        }
        catch
        {
            return "默认设备";
        }
    }

    // ── battery ───────────────────────────────────────────────────────────
    static string Battery()
    {
        var report = Windows.Devices.Power.Battery.AggregateBattery.GetReport();
        // A desktop with no battery reports NotPresent; showing 100% there is a lie.
        bool present = report.Status != Windows.System.Power.BatteryStatus.NotPresent;
        double? remaining = report.RemainingCapacityInMilliwattHours;
        double? full = report.FullChargeCapacityInMilliwattHours;
        int pct = -1;
        if (present && remaining.HasValue && full.HasValue && full.Value > 0)
        {
            // Clamp: a panel that reports more remaining than full (firmware drift on
            // some docks) produced 108% on the card and on the pill.
            double raw = remaining.Value / full.Value * 100;
            pct = (int)Math.Round(Math.Max(0, Math.Min(100, raw)));
        }

        string status = PowerManager.BatteryStatus.ToString();
        bool charging = PowerManager.BatteryStatus == Windows.System.Power.BatteryStatus.Charging;
        int? remainingMinutes = null;
        if (!charging)
        {
            var t = PowerManager.RemainingDischargeTime;
            double minutes = t.TotalMinutes;
            // Windows returns int.MinValue when nothing is discharging.
            if (minutes > 0 && minutes < 100000) remainingMinutes = (int)Math.Round(minutes);
        }

        return "{\"ok\":true,\"present\":" + (present ? "true" : "false") +
               ",\"percent\":" + pct +
               ",\"charging\":" + (charging ? "true" : "false") +
               ",\"status\":\"" + Esc(status) + "\"" +
               ",\"remainingMinutes\":" + (remainingMinutes.HasValue ? remainingMinutes.Value.ToString() : "null") +
               ",\"powerSaver\":" + (PowerManager.EnergySaverStatus == EnergySaverStatus.On ? "true" : "false") + "}";
    }

    // ── network ───────────────────────────────────────────────────────────
    static string Network()
    {
        var profile = NetworkInformation.GetInternetConnectionProfile();
        if (profile == null)
        {
            return "{\"ok\":true,\"connected\":false}";
        }
        string name = profile.ProfileName ?? "";
        uint type = profile.NetworkAdapter != null ? profile.NetworkAdapter.IanaInterfaceType : 0;
        // 6 = Ethernet, 71 = IEEE 802.11 (WiFi), 243/244 = WWAN
        string kind = type == 71 ? "wifi" : type == 6 ? "ethernet" : type == 243 || type == 244 ? "wwan" : "other";
        int? signal = null;
        try
        {
            byte? bars = profile.GetSignalBars();
            if (bars.HasValue && bars.Value > 0) signal = (int)bars.Value;
        }
        catch { /* not every adapter reports signal */ }

        return "{\"ok\":true,\"connected\":true" +
               ",\"name\":\"" + Esc(name) + "\"" +
               ",\"kind\":\"" + kind + "\"" +
               ",\"signal\":" + (signal.HasValue ? signal.Value.ToString() : "null") + "}";
    }

    // ── performance ───────────────────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential)]
    struct FILETIME { public uint dwLowDateTime; public uint dwHighDateTime; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

    static ulong Ft(FILETIME f) { return ((ulong)f.dwHighDateTime << 32) | f.dwLowDateTime; }

    static bool cpuSampled = false;
    static ulong cpuLastIdle, cpuLastKernel, cpuLastUser;

    static double CpuPercent()
    {
        FILETIME idleFt, kernelFt, userFt;
        if (!GetSystemTimes(out idleFt, out kernelFt, out userFt)) return 0;
        ulong idle = Ft(idleFt), kernel = Ft(kernelFt), user = Ft(userFt);
        if (!cpuSampled)
        {
            cpuSampled = true;
            cpuLastIdle = idle; cpuLastKernel = kernel; cpuLastUser = user;
            System.Threading.Thread.Sleep(110);
            if (!GetSystemTimes(out idleFt, out kernelFt, out userFt)) return 0;
            idle = Ft(idleFt); kernel = Ft(kernelFt); user = Ft(userFt);
        }
        ulong dIdle = idle - cpuLastIdle;
        ulong dKernel = kernel - cpuLastKernel;
        ulong dUser = user - cpuLastUser;
        cpuLastIdle = idle; cpuLastKernel = kernel; cpuLastUser = user;
        cpuSampled = true;
        ulong total = dKernel + dUser;
        if (total == 0) return 0;
        // Kernel time already includes idle, so busy is everything that is not idle.
        double busy = (double)total - (double)dIdle;
        if (busy < 0) busy = 0;
        return Math.Round(Math.Min(100, busy * 100.0 / (double)total), 1);
    }

    static string Perf()
    {
        var st = new MEMORYSTATUSEX();
        st.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        double totalGb = 0;
        double usedGb = 0;
        if (GlobalMemoryStatusEx(ref st))
        {
            totalGb = st.ullTotalPhys / 1073741824.0;
            usedGb = (st.ullTotalPhys - st.ullAvailPhys) / 1073741824.0;
        }

        // GetSystemTimes, not PerformanceCounter: constructing
        // `new PerformanceCounter("Processor", "% Processor Time", "_Total")` costs
        // ~670ms the first time in a process (it walks the PDH counter registry),
        // and this is a one-shot binary polled every 2s — that was 44% of the wall
        // clock spent building an object. GetSystemTimes is a single kernel call.
        //
        // The counters are cumulative since boot, so a one-shot process still needs
        // two samples; the 110ms gap is the only wait left.
        double cpu = CpuPercent();

        return "{\"ok\":true,\"cpu\":" + Math.Round(cpu, 1).ToString(CultureInfo.InvariantCulture) +
               ",\"ramUsedGb\":" + Math.Round(usedGb, 2).ToString(CultureInfo.InvariantCulture) +
               ",\"ramTotalGb\":" + Math.Round(totalGb, 2).ToString(CultureInfo.InvariantCulture) +
               ",\"processes\":" + Process.GetProcesses().Length + "}";
    }

    // ── brightness via WMI (needs DDC/CI support on the panel) ────────────
    static void SetBrightness(int percent)
    {
        try
        {
            var scope = new System.Management.ManagementScope(@"\\.\root\WMI");
            scope.Connect();
            using (var cls = new System.Management.ManagementClass(scope, new System.Management.ManagementPath("WmiMonitorBrightnessMethods"), null))
            {
                foreach (System.Management.ManagementObject mo in cls.GetInstances())
                {
                    using (mo)
                    {
                        object[] args = { 1, (byte)percent };
                        mo.InvokeMethod("WmiSetBrightness", args);
                        return;
                    }
                }
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("brightness failed: " + e.Message);
        }
    }

    // ── Core Audio interop ────────────────────────────────────────────────
    static class Audio
    {
        static IMMDeviceEnumerator enumerator;
        static IMMDevice cached;

        static IMMDeviceEnumerator Enumerator()
        {
            if (enumerator == null) enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorObject();
            return enumerator;
        }

        static IMMDevice DefaultEndpoint()
        {
            if (cached == null)
            {
                IMMDevice device;
                Enumerator().GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
                cached = device;
            }
            return cached;
        }

        public static IAudioEndpointVolume DefaultEndpointVolume()
        {
            IMMDevice device = DefaultEndpoint();
            object vol;
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out vol);
            return (IAudioEndpointVolume)vol;
        }

        public static string DefaultEndpointId()
        {
            return DefaultEndpoint().GetId();
        }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorObject { }

    enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
    enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        void EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection devices);
        void GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        void GetDevice(string id, out IMMDevice device);
        void RegisterEndpointNotificationCallback(IntPtr client);
        void UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        int GetCount(out uint cDevices);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        // Vtable order must match mmdeviceapi.h exactly or the offsets are wrong.
        void Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
                      [MarshalAs(UnmanagedType.Interface)] out object ppInterface);
        void OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
        [return: MarshalAs(UnmanagedType.LPWStr)] string GetId();
        int GetState(out int state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore { }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        // Order matters: these are the real vtable slots.
        void RegisterControlChangeNotify(IntPtr pNotify);
        void UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint channelCount);
        void SetMasterVolumeLevel(float level, ref Guid eventContext);
        void SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        void GetMasterVolumeLevel(out float level);
        void GetMasterVolumeLevelScalar(out float level);
        void SetChannelVolumeLevel(uint channel, float level, ref Guid eventContext);
        void SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        void GetChannelVolumeLevel(uint channel, out float level);
        void GetChannelVolumeLevelScalar(uint channel, out float level);
        void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        // Same attribute as SetMute: C# bool marshals as a 2-byte VARIANT_BOOL while
        // the callee writes a 4-byte BOOL. It happened to read correctly on x64
        // little-endian, but it is a 2-byte overrun.
        void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        void GetVolumeStepInfo(out uint step, out uint stepCount);
        void VolumeStepUp(ref Guid eventContext);
        void VolumeStepDown(ref Guid eventContext);
        int QueryHardwareSupport(out uint hardwareSupportMask);
        void GetVolumeRange(out float minLevelDb, out float maxLevelDb, out float incrementDb);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    static string Esc(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length + 16);
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
