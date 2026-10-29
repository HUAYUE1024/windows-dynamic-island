// SMTC probe: prints one line of JSON describing the media session the user is
// actually listening to, or {"session":null}. Optional arg: a transport command
// (toggle/next/prev) which is executed before reading state back.
//
// Build: npm run build:probe  (csc.exe + Windows.winmd, no SDK/MSBuild needed)
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Media.Control;

static class Probe
{
    // csc here is C# 5: no async entry point, so block on the async body.
    static int Main(string[] rawArgs)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            return Run(rawArgs).GetAwaiter().GetResult();
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.ToString());
            Console.Out.WriteLine("{\"session\":null,\"error\":\"" + Esc(e.Message) + "\"}");
            return 1;
        }
    }

    static async Task<int> Run(string[] rawArgs)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        string mode = rawArgs.Length > 0 ? rawArgs[0] : "get";
        bool includeArt = rawArgs.Contains("-art");

        var mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var sessions = mgr.GetSessions().ToList();

        // The OS "current session" is often an unrelated app (a paused video tab,
        // the shell). Prefer one that is playing; break ties by freshest timeline.
        var playing = sessions.Where(s => s.GetPlaybackInfo().PlaybackStatus ==
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing).ToList();
        var pool = playing.Count > 0 ? playing : sessions;
        var session = pool
            .OrderByDescending(s => s.GetTimelineProperties().LastUpdatedTime.UtcTicks)
            .FirstOrDefault() ?? mgr.GetCurrentSession();

        if (session == null)
        {
            Console.Out.WriteLine("{\"session\":null}");
            return 0;
        }

        bool actionOk = true;
        switch (mode)
        {
            case "toggle": actionOk = await session.TryTogglePlayPauseAsync(); break;
            case "next": actionOk = await session.TrySkipNextAsync(); break;
            case "prev": actionOk = await session.TrySkipPreviousAsync(); break;
            case "seek":
                long seekMs;
                if (rawArgs.Length > 1 && long.TryParse(rawArgs[1], out seekMs) && seekMs >= 0)
                {
                    // WinRT takes 100-ns ticks, not a TimeSpan.
                    actionOk = await session.TryChangePlaybackPositionAsync(TimeSpan.FromMilliseconds(seekMs).Ticks);
                }
                break;
            case "shuffle":
                bool on;
                if (rawArgs.Length > 1 && bool.TryParse(rawArgs[1], out on))
                {
                    actionOk = await session.TryChangeShuffleActiveAsync(on);
                }
                break;
            case "repeat":
                if (rawArgs.Length > 1)
                {
                    Windows.Media.MediaPlaybackAutoRepeatMode rm;
                    if (Enum.TryParse(rawArgs[1], true, out rm))
                    {
                        actionOk = await session.TryChangeAutoRepeatModeAsync(rm);
                    }
                }
                break;
        }

        var props = await session.TryGetMediaPropertiesAsync();
        var time = session.GetTimelineProperties();
        var info = session.GetPlaybackInfo();

        string art = null;
        if (includeArt && props.Thumbnail != null)
        {
            try
            {
                using (var rs = await props.Thumbnail.OpenReadAsync())
                using (var ms = new MemoryStream())
                {
                    await rs.AsStreamForRead().CopyToAsync(ms);
                    var bytes = ms.ToArray();
                    if (bytes.Length > 0)
                    {
                        string mime = bytes.Length > 3 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                            ? "image/png"
                            : "image/jpeg";
                        art = "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
                    }
                }
            }
            catch
            {
                art = null; // artwork is cosmetic; never fail the probe over it
            }
        }

        var c = info.Controls;
        Console.Out.WriteLine("{\"session\":\"ok\"" +
            ",\"source\":\"" + Esc(session.SourceAppUserModelId) + "\"" +            ",\"title\":\"" + Esc(props.Title) + "\"" +
            ",\"artist\":\"" + Esc(props.Artist) + "\"" +
            ",\"album\":\"" + Esc(props.AlbumTitle) + "\"" +
            ",\"status\":\"" + info.PlaybackStatus + "\"" +
            ",\"positionMs\":" + (long)time.Position.TotalMilliseconds +
            ",\"durationMs\":" + (long)time.EndTime.TotalMilliseconds +
            ",\"lastUpdatedUtc\":\"" + time.LastUpdatedTime.UtcDateTime.ToString("o") + "\"" +
            ",\"rate\":" + (info.PlaybackRate ?? 1.0).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) +
            ",\"shuffle\":" + (info.IsShuffleActive ?? false ? "true" : "false") +
            ",\"repeat\":\"" + (info.AutoRepeatMode ?? Windows.Media.MediaPlaybackAutoRepeatMode.None) + "\"" +
            ",\"canToggle\":" + B(c.IsPlayPauseToggleEnabled) +
            ",\"canNext\":" + B(c.IsNextEnabled) +
            ",\"canPrev\":" + B(c.IsPreviousEnabled) +
            ",\"art\":" + (art == null ? "null" : "\"" + art + "\"") +
            ",\"actionOk\":" + B(actionOk) +
            "}");
        return 0;
    }

    static string B(bool? v)
    {
        return v == true ? "true" : "false";
    }

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
