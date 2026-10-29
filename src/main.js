// Electron main: a frameless transparent island that shows whichever status module
// matters most right now. Two native probes feed it (SMTC for media, Core
// Audio/WinRT for system state); timer, todo and clipboard live here.
import { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard, Notification, Tray, Menu, nativeImage } from 'electron';
import { spawn, exec as execRaw } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveIslandState, trackKey } from './island-state.mjs';
import { DEFAULTS, normalize, isTopAnchored } from './settings.mjs';
import { MODULES, pickActiveModule, batteryAlert } from './modules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'bin');
const MEDIA_PROBE = join(BIN, 'probe.exe');
const SYS_PROBE = join(BIN, 'sysprobe.exe');
const PASTE_PROBE = join(BIN, 'paste.exe');
const DATA_DIR = app.getPath('userData');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const TODO_FILE = join(DATA_DIR, 'todos.json');

// The window is deliberately larger than the glass so the drop shadow is never
// clipped by the window edge (a clipped shadow reads as a hard shell).
const WIN = { w: 480, h: 320, margin: 32 };
// Glass size. These MUST match --island-w/h/w-open/h-open in styles.css: the hover
// poll uses them as the click-through hit rect, and a value smaller than the real
// card puts the bottom of it in the dead zone. hOpen was 218 against a real 246,
// which made the whole footer button row unclickable — only its top 6px was live.
const ISLAND = { w: 238, h: 48, wOpen: 384, hOpen: 246 };

let win = null;
let settingsWin = null;
let settings = normalize(DEFAULTS);
let pollTimers = [];
let hoverPoll = null;
let hidden = false;

// ── module state ─────────────────────────────────────────────────────────
const states = {
    media: deriveIslandState(null),
    volume: { ok: false },
    battery: { ok: false },
    network: { ok: false },
    perf: { ok: false },
    timer: { running: false, endsAt: 0, durationMs: 25 * 60_000, remainingMs: 0, completed: 0 },
    todo: { items: [] },
    clipboard: { items: [] },
    quick: {},
};

const ctx = {
    lastTouched: null,
    lastTouchedAt: 0,
    // What the island is showing right now. Feed it back into the priority engine
    // so the card the user is reading is never swapped out from under them.
    current: null,
    defaultModule: 'volume',
    lowBatteryThreshold: 20,
    enabled: DEFAULTS.modules.enabled,
};

let lastTrackKey = '';
let cachedArt = null;
let artInFlight = false;
let mediaHadTrack = false;
let lastMediaAt = Date.now();
let mediaSeen = false;

// ── settings ─────────────────────────────────────────────────────────────
function loadSettings() {
    try {
        if (existsSync(SETTINGS_FILE)) {
            settings = normalize(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
        }
    } catch {
        settings = normalize(DEFAULTS);
    }
    syncCtx();
    // A probe binary that vanished (antivirus, a half-finished build, a manual
    // rename) used to degrade silently: its module just sat on a stub. Say so once
    // at startup instead.
    for (const [what, exe] of [['media', MEDIA_PROBE], ['system', SYS_PROBE], ['paste', PASTE_PROBE]]) {
        if (!existsSync(exe)) console.error(`${what} probe missing at ${exe} — run npm run build:probe`);
    }
}

function syncCtx() {
    ctx.defaultModule = settings.modules.defaultModule;
    ctx.lowBatteryThreshold = settings.modules.lowBatteryThreshold;
    ctx.enabled = settings.modules.enabled;
    clipboardMax = settings.modules.clipboardMax;
    clipboardPaste = settings.modules.clipboardPaste;
    states.clipboard.items = states.clipboard.items.slice(0, clipboardMax);
}

function saveSettings() {
    try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch { /* read-only disk: keep running with in-memory settings */ }
}

// ── probes ───────────────────────────────────────────────────────────────
// A hung probe.exe must not silently kill its module for the rest of the session.
const PROBE_TIMEOUT_MS = 5000;

function runProbe(exe, args) {
    return new Promise((resolve) => {
        if (!existsSync(exe)) {
            resolve(null);
            return;
        }
        let out = '';
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(killTimer);
            resolve(value);
        };
        // stderr is ignored rather than piped-and-unread: an undrained pipe fills
        // at ~64KB and blocks the child until the timeout kills it.
        const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const killTimer = setTimeout(() => {
            child.kill();
            finish(null);
        }, PROBE_TIMEOUT_MS);
        child.stdout.on('data', (d) => { out += d; });
        child.on('error', () => finish(null));
        child.on('close', () => {
            try {
                const line = out.trim().split('\n').filter(Boolean).pop();
                finish(JSON.parse(line));
            } catch {
                finish(null);
            }
        });
    });
}

// child_process.exec only attaches an 'error' listener when a callback is given.
// Without one a spawn failure emits an unhandled 'error' event and takes the main
// process down with it.
const exec = (cmd) => execRaw(cmd, () => {});

const probeMedia = (args) => runProbe(MEDIA_PROBE, args);
const probeSys = (args) => runProbe(SYS_PROBE, args);

async function pollMedia() {
    const p = await probeMedia(['get']);
    if (!p) {
        lastTrackKey = '';
        cachedArt = null;
        states.media = deriveIslandState({ probeMissing: !existsSync(MEDIA_PROBE) });
        return;
    }
    if (p.session !== 'ok') {
        lastTrackKey = '';
        cachedArt = null;
        states.media = deriveIslandState(null);
        return;
    }

    lastMediaAt = Date.now();
    mediaSeen = true;
    if (hidden) showIsland();

    // Album art is the only heavy field, so re-read it only when the track changes.
    // The in-flight guard matters: without it, a poll that fires while the art read
    // is still running sees lastTrackKey already set, skips the read, and writes
    // cachedArt — which the previous poll just nulled — so the new track renders
    // with no cover until some later poll happens to re-read it.
    const key = trackKey(p);
    if (key !== lastTrackKey && !artInFlight) {
        lastTrackKey = key;
        cachedArt = null;
        artInFlight = true;
        try {
            const withArt = await probeMedia(['get', '-art']);
            if (withArt && withArt.session === 'ok') cachedArt = withArt.art || null;
        } finally {
            artInFlight = false;
        }
    }
    const st = deriveIslandState(p, { art: cachedArt });
    states.media = st;

    // A session carrying a real track takes the island over when it appears, the
    // way the pill is meant to announce what is playing. This is an edge, not a
    // priority: ranking "paused but has a track" in the engine would outrank the
    // card the user is reading and yank them off it. Without it, a session that
    // starts paused was invisible — the island sat on the volume card and never
    // mentioned the music at all.
    if (st.hasTrack && !mediaHadTrack) {
        ctx.lastTouched = 'media';
        ctx.lastTouchedAt = Date.now();
    }
    mediaHadTrack = st.hasTrack;
}

async function pollSys(name) {
    // A missing binary used to leave the module on its silent {ok:false} stub
    // forever: the card showed a plausible-looking wrong answer with no error
    // anywhere. Mark it so the card can say what is actually wrong.
    if (!existsSync(SYS_PROBE)) {
        states[name] = { ok: false, missing: true };
        return;
    }
    const r = await probeSys([name]);
    if (r && r.ok) states[name] = r;
    else if (!r) states[name] = { ok: false, missing: true };
}

// ── timer ────────────────────────────────────────────────────────────────
let timerTick = null;

function startTimer(durationMs) {
    const d = Number(durationMs) > 0 ? Number(durationMs) : states.timer.durationMs;
    states.timer.durationMs = d;
    states.timer.endsAt = Date.now() + d;
    states.timer.remainingMs = d;
    states.timer.running = true;
    if (!timerTick) {
        timerTick = setInterval(() => {
            if (!states.timer.running) return;
            if (Date.now() >= states.timer.endsAt) {
                states.timer.running = false;
                states.timer.remainingMs = 0;
                states.timer.completed += 1;
                stopTimerTick();
                notify('专注完成', '这一段结束了，休息一下。');
            } else {
                states.timer.remainingMs = states.timer.endsAt - Date.now();
            }
            push();
        }, 250);
    }
}

function stopTimerTick() {
    if (timerTick) {
        clearInterval(timerTick);
        timerTick = null;
    }
}

function pauseTimer() {
    if (!states.timer.running) return;
    states.timer.remainingMs = Math.max(0, states.timer.endsAt - Date.now());
    states.timer.running = false;
}

function resumeTimer() {
    if (states.timer.running || !states.timer.remainingMs) return;
    states.timer.endsAt = Date.now() + states.timer.remainingMs;
    states.timer.running = true;
}

function resetTimer() {
    states.timer.running = false;
    states.timer.remainingMs = 0;
    states.timer.endsAt = 0;
    stopTimerTick();
}

// ── todo ─────────────────────────────────────────────────────────────────
function loadTodos() {
    try {
        if (existsSync(TODO_FILE)) {
            const raw = JSON.parse(readFileSync(TODO_FILE, 'utf8'));
            if (Array.isArray(raw)) {
                states.todo.items = raw.filter((t) => t && typeof t.text === 'string');
            }
        }
    } catch { /* start empty */ }
}

function saveTodos() {
    try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(TODO_FILE, JSON.stringify(states.todo.items));
    } catch { /* ignore */ }
}

// ── clipboard ────────────────────────────────────────────────────────────
// Electron's clipboard has no change event, so poll it; the read is cheap.
let clipboardMax = 10;

// The island only steals focus when it is clicked, so while the cursor is merely
// over it the foreground window is still the user's app. Remember that HWND so a
// clipboard click can hand focus back and send Ctrl+V there.
let clipboardPaste = true;
let lastForeignHwnd = null;
let lastHwndPollAt = 0;

function startClipboardWatch() {
    let last = '';
    clipboardPoll = setInterval(() => {
        let text = '';
        try {
            text = clipboard.readText();
        } catch { return; }
        if (!text || text === last) return;
        last = text;
        if (states.clipboard.items[0] && states.clipboard.items[0].text === text) return;
        states.clipboard.items = [{ text, at: Date.now() }, ...states.clipboard.items]
            .filter((v, i, a) => a.findIndex((x) => x.text === v.text) === i)
            .slice(0, clipboardMax);
        push();
    }, 600);
}

function watchForeground() {
    if (engaged) return;
    // Rate-limited: a spawn per hover poll would be a process per 50ms. 5s is
    // enough — hover-in captures the HWND fresh, so this sweep only has to cover an
    // alt-tab that happens while the cursor sits still off the island.
    if (Date.now() - lastHwndPollAt < 5000) return;
    lastHwndPollAt = Date.now();
    runProbe(PASTE_PROBE, ['mark']).then((r) => {
        if (r && typeof r.hwnd === 'number' && r.hwnd > 0) lastForeignHwnd = r.hwnd;
    }, () => {});
}

/** Copy the entry, then hand focus back and paste it where the user was typing. */
async function pasteClipboardItem(index) {
    const item = states.clipboard.items[index];
    if (!item) return false;
    try {
        clipboard.writeText(item.text);
    } catch { return false; }
    states.clipboard.items = [item, ...states.clipboard.items.filter((x) => x !== item)];
    if (!clipboardPaste || !lastForeignHwnd) return false;
    const r = await runProbe(PASTE_PROBE, ['paste', String(lastForeignHwnd)]);
    return !!(r && r.ok);
}

// ── push ─────────────────────────────────────────────────────────────────
function buildState() {
    return {
        active: pickActiveModule(states, { ...ctx, nowMs: Date.now() }),
        alert: batteryAlert(states.battery, ctx.lowBatteryThreshold),
        enabled: ctx.enabled,
        modules: states,
    };
}

function push() {
    if (!win || win.isDestroyed()) return;
    const next = buildState();
    // Remember what went on screen so the next pick can keep it there.
    ctx.current = next.active;
    win.webContents.send('state', next);
}

// ── window geometry ──────────────────────────────────────────────────────
function windowBounds() {
    // Follow the display the cursor is on so the island shows up wherever the user
    // is working; the primary display is the fallback before any cursor is known.
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [vert, horiz] = settings.island.position.split('-');
    const edge = 12;
    const x = horiz === 'left' ? workArea.x + edge
        : horiz === 'right' ? workArea.x + workArea.width - WIN.w - edge
            : workArea.x + Math.round((workArea.width - WIN.w) / 2);
    const y = vert === 'top' ? workArea.y + 10
        : workArea.y + workArea.height - WIN.h - 10;
    return { x, y, width: WIN.w, height: WIN.h };
}

/** The glass rectangle in screen coordinates — must match the CSS anchor. */
function islandRect(expanded) {
    const b = win.getBounds();
    const w = expanded ? ISLAND.wOpen : ISLAND.w;
    const h = expanded ? ISLAND.hOpen : ISLAND.h;
    const y = isTopAnchored(settings.island.position)
        ? b.y + WIN.margin
        : b.y + WIN.h - WIN.margin - h;
    const horiz = settings.island.position.split('-')[1];
    const x = horiz === 'left' ? b.x + WIN.margin
        : horiz === 'right' ? b.x + WIN.w - WIN.margin - w
            : b.x + Math.round((WIN.w - w) / 2);
    return { x, y, w, h };
}

function applyWindowSettings() {
    if (win && !win.isDestroyed()) {
        win.setBounds(windowBounds());
        win.setAlwaysOnTop(settings.island.alwaysOnTop, 'screen-saver');
        win.setIgnoreMouseEvents(!engaged && settings.island.clickThrough);
        win.webContents.send('settings', settings);
    }
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings', settings);
}

// ── hover / click-through ────────────────────────────────────────────────
// Driving this from pointer events oscillates: flipping setIgnoreMouseEvents makes
// Windows re-post mouse messages, which flip the state straight back. Polling the
// cursor instead has no feedback loop, so the state changes only when it moves.
const HOVER_MS = 50;
let engaged = false;
// Set while the renderer is dragging a slider or the progress bar. Click-through has
// to stay off for the whole gesture: the cursor poll enables it the instant the
// pointer crosses the island's edge, and after that the OS delivers no mouse message
// to the window at all — pointer capture cannot override it, so the drag dies and
// pointerup never arrives.
let dragging = false;

// The window only moves displays while collapsed and not engaged, otherwise the
// card would slide out from under the user's cursor.
let currentDisplayId = null;

function followCursorDisplay() {
    if (!win || win.isDestroyed() || engaged) return;
    const id = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    if (id === currentDisplayId) return;
    currentDisplayId = id;
    win.setBounds(windowBounds());
}

function startHoverPolling() {
    hoverPoll = setInterval(() => {
        if (!win || win.isDestroyed()) return;
        followCursorDisplay();
        const r = islandRect(engaged);
        const p = screen.getCursorScreenPoint();
        const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
        if (inside === engaged) {
            // Still outside: keep the remembered window fresh for the next paste.
            if (!inside) watchForeground();
            return;
        }
        engaged = inside;
        win.setIgnoreMouseEvents(!inside && !dragging && settings.island.clickThrough);
        win.webContents.send('engage', inside);
        // First moment the island is hovered, snapshot the window the user is in.
        if (inside) watchForeground();
    }, HOVER_MS);
}

// ── auto-hide ────────────────────────────────────────────────────────────
function hideIsland() {
    if (!win || win.isDestroyed() || hidden) return;
    hidden = true;
    win.hide();
}

function showIsland() {
    if (!win || win.isDestroyed() || !hidden) return;
    hidden = false;
    win.show();
}

let autoHidePoll = null;
let clipboardPoll = null;

function startAutoHide() {
    autoHidePoll = setInterval(() => {
        if (!settings.island.autoHide || hidden) return;
        // Only hide once media has actually come and gone. Hiding a fresh boot that
        // never played anything makes the island vanish with no way back but the tray.
        if (!mediaSeen) return;
        if (Date.now() - lastMediaAt > settings.island.autoHideDelaySec * 1000) hideIsland();
    }, 1000);
}

// ── notifications ────────────────────────────────────────────────────────
function notify(title, body) {
    try {
        new Notification({ title, body }).show();
    } catch { /* notifications can be disabled system-wide */ }
}

// ── quick actions ────────────────────────────────────────────────────────
const QUICK_ACTIONS = {
    lock: () => exec('rundll32.exe user32.dll,LockWorkStation'),
    sleep: () => exec('rundll32.exe powrprof.dll,SetSuspendSleep'),
    screenshot: () => exec('explorer.exe ms-screenclip:'),
    taskmgr: () => exec('taskmgr'),
    explorer: () => exec('cmd /c taskkill /f /im explorer.exe && start explorer.exe'),
    settings: () => openSettings(),
};

// ── tray ─────────────────────────────────────────────────────────────────
// The island window is skipTaskbar, so without a tray there is no way to quit
// short of Task Manager. The icon is generated so the repo stays text-only.
let tray = null;

function trayIcon() {
    // 16x16 rounded squircle with a white capsule, drawn as raw RGBA.
    const S = 16;
    const buf = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const i = (y * S + x) * 4;
            const dx = x - 7.5;
            const dy = y - 7.5;
            const r = Math.sqrt(dx * dx + dy * dy);
            if (r > 7.2) continue;                     // outside the squircle
            const inCapsule = Math.abs(dy) <= 2.4 && Math.abs(dx) <= 5.4;
            const a = inCapsule ? 255 : 90;
            buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = a;
        }
    }
    return nativeImage.createFromBuffer(buf, { width: S, height: S });
}

function createTray() {
    tray = new Tray(trayIcon());
    tray.setToolTip('Liquid Island');
    tray.on('click', () => {
        if (!win || win.isDestroyed()) return;
        if (hidden) showIsland();
        else win.show();
        win.focus();
    });
    tray.on('right-click', () => {
        tray.popUpContextMenu(Menu.buildFromTemplate([
            { label: hidden ? '显示' : '隐藏', click: () => (hidden ? showIsland() : hideIsland()) },
            { label: '设置…', click: () => openSettings() },
            { type: 'separator' },
            { label: '退出', click: () => app.quit() },
        ]));
    });
}

// ── windows ──────────────────────────────────────────────────────────────
function startPolling() {
    for (const t of pollTimers) clearInterval(t);
    pollTimers = [];
    for (const mod of MODULES) {
        if (mod.interval <= 0) continue;
        // island.pollMs replaces the media cadence outright. It used to be
        // Math.max(mod.interval, pollMs), so any value under the module's own 1500
        // was silently ignored — while the setting's hint promised "越小越实时" and
        // the validator allowed 250.
        const period = mod.id === 'media' ? settings.island.pollMs : mod.interval;
        pollTimers.push(setInterval(() => {
            // Each module must push its own result. Relying on one module's tick to
            // flush everybody else meant disabling that module froze the whole island.
            if (mod.id === 'media') pollMedia().then(push, push);
            else if (mod.id === 'timer') push();
            else pollSys(mod.id).then(push, push);
        }, period));
    }
}

function createIsland() {
    win = new BrowserWindow({
        ...windowBounds(),
        transparent: true,
        frame: false,
        alwaysOnTop: settings.island.alwaysOnTop,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        roundedCorners: false,
        webPreferences: {
            preload: join(here, 'preload.cjs'),
            contextIsolation: true,
            backgroundThrottling: false,
        },
    });

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(settings.island.clickThrough);
    win.loadFile(join(here, 'renderer', 'index.html'));

    // The glass size is declared twice — once in CSS, once in ISLAND above — and the
    // hover poll uses the JS copy as its click-through hit rect. When they drifted
    // (218 vs 246) the whole footer button row fell into the dead zone and every
    // button in it read as dead. Compare them at load and shout, so it can never
    // silently happen again.
    win.webContents.on('did-finish-load', () => {
        if (win.isDestroyed()) return;
        win.webContents.executeJavaScript(`(() => {
            const cs = getComputedStyle(document.getElementById('island'));
            const px = (n) => parseFloat(cs.getPropertyValue(n));
            return { w: px('--island-w'), h: px('--island-h'), wOpen: px('--island-w-open'), hOpen: px('--island-h-open') };
        })()`).then((css) => {
            for (const k of ['w', 'h', 'wOpen', 'hOpen']) {
                if (Number.isFinite(css[k]) && Math.abs(css[k] - ISLAND[k]) > 0.5) {
                    console.error(`island size drift: ISLAND.${k}=${ISLAND[k]} but CSS says ${css[k]} — the click-through hit rect is wrong`);
                }
            }
        }).catch(() => { /* the page went away before it answered */ });
    });

    startPolling();
    startHoverPolling();
    startAutoHide();
    try {
        startClipboardWatch();
        loadTodos();
    } catch (e) {
        console.error('auxiliary modules failed to start:', e);
    }

    pollMedia();
    for (const id of ['volume', 'battery', 'network', 'perf']) pollSys(id);
    push();
}

function openSettings() {
    if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.show();
        settingsWin.focus();
        return;
    }
    settingsWin = new BrowserWindow({
        // Wide enough for the section rail plus a label/control row without the
        // control column wrapping.
        width: 700,
        height: 760,
        title: '灵动岛设置',
        // Parented so the always-on-top island cannot cover part of it.
        parent: win,
        autoHideMenuBar: true,
        backgroundColor: '#11131c',
        webPreferences: {
            preload: join(here, 'preload-settings.cjs'),
            contextIsolation: true,
        },
    });
    settingsWin.loadFile(join(here, 'settings', 'index.html'));
    settingsWin.on('closed', () => { settingsWin = null; });
    // registerShortcuts() only broadcasts when something changed, so the window needs
    // the current set pushed to it on open or its shortcut fields start out blank.
    settingsWin.webContents.on('did-finish-load', () => {
        if (!settingsWin.isDestroyed()) settingsWin.webContents.send('shortcuts', boundShortcuts);
    });
}

// ── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => settings);

/** Everything that has to re-read `settings` after it changes. */
function applySettings() {
    syncCtx();
    startPolling();
    registerShortcuts();
    applyWindowSettings();
    push();
}

ipcMain.handle('settings:save', (_e, next) => {
    settings = normalize(next);
    saveSettings();
    applySettings();
    return settings;
});
// Fire-and-forget variant used by the settings window's unload flush.
ipcMain.on('settings:save-now', (_e, next) => {
    settings = normalize(next);
    saveSettings();
    applySettings();
});
ipcMain.handle('settings:reset', () => {
    // Reset must go through the same path as a save. Skipping startPolling() and
    // registerShortcuts() left the old cadence and the old accelerators live, so
    // "恢复默认" restored the field text but not the behaviour.
    settings = normalize(DEFAULTS);
    saveSettings();
    applySettings();
    return settings;
});

ipcMain.on('command', (_e, name, arg) => {
    switch (name) {
        // media
        case 'toggle': probeMedia(['toggle']); break;
        case 'next': probeMedia(['next']); break;
        case 'prev': probeMedia(['prev']); break;
        case 'seek': {
            const ms = Number(arg);
            if (Number.isFinite(ms) && ms >= 0) probeMedia(['seek', String(Math.round(ms))]);
            break;
        }
        case 'shuffle': probeMedia(['shuffle', arg === true ? 'true' : 'false']); break;
        case 'repeat': probeMedia(['repeat', String(arg)]); break;
        // volume / brightness
        case 'setvol': {
            const v = Number(arg);
            if (Number.isFinite(v)) probeSys(['setvol', String(Math.max(0, Math.min(100, v)))]);
            break;
        }
        case 'mute': probeSys(['mute', arg === true ? 'true' : 'false']); break;
        case 'bright': {
            const b = Number(arg);
            if (Number.isFinite(b)) probeSys(['bright', String(Math.max(0, Math.min(100, b)))]);
            break;
        }
        // module navigation
        case 'select-module':
            ctx.lastTouched = String(arg);
            ctx.lastTouchedAt = Date.now();
            push();
            break;
        case 'drag':
            dragging = !!arg;
            // Re-apply on release: the poll may have been skipped while suppressed.
            win.setIgnoreMouseEvents(!engaged && !dragging && settings.island.clickThrough);
            break;
        case 'touch':
            // Any interaction inside the island counts as using the module on screen,
            // not just clicking a rail dot. Without this, pausing the music let the
            // priority engine fall through to the default module on the next poll.
            if (ctx.current) {
                ctx.lastTouched = ctx.current;
                ctx.lastTouchedAt = Date.now();
            }
            break;
        case 'notify': {
            const t = arg && typeof arg === 'object' ? arg : {};
            notify(String(t.title || '灵动岛'), String(t.body || ''));
            break;
        }
        // timer
        case 'timer-start': startTimer(arg); push(); break;
        case 'timer-pause': pauseTimer(); push(); break;
        case 'timer-resume': resumeTimer(); push(); break;
        case 'timer-reset': resetTimer(); push(); break;
        case 'timer-duration': {
            const d = Number(arg);
            if (Number.isFinite(d) && d > 0) {
                states.timer.durationMs = d;
                // Keep endsAt in step, or a running countdown keeps its old finish
                // time and the label disagrees with when it actually fires.
                if (states.timer.running) states.timer.endsAt = Date.now() + d;
                else states.timer.remainingMs = 0;
            }
            push();
            break;
        }
        // todo
        case 'todo-add': {
            const text = String(arg || '').trim();
            if (text) {
                // Date.now() alone collides when two items land in the same millisecond.
                states.todo.items.push({
                    id: `${Date.now()}-${states.todo.items.length}-${Math.random().toString(36).slice(2, 7)}`,
                    text,
                    done: false,
                });
            }
            saveTodos();
            push();
            break;
        }
        case 'todo-edit': {
            // The renderer joins id and text with \u0000 because item text may
            // contain spaces; splitting on a space would silently drop the edit.
            const parts = String(arg || '').split('\u0000');
            const id = parts[0];
            const text = parts.slice(1).join('\u0000');
            const item = states.todo.items.find((t) => String(t.id) === String(id));
            const clean = (text || '').trim();
            if (!item) break;
            if (clean) item.text = clean;
            else states.todo.items = states.todo.items.filter((t) => t !== item);
            saveTodos();
            push();
            break;
        }
        case 'todo-toggle': {
            const item = states.todo.items.find((t) => String(t.id) === String(arg));
            if (item) item.done = !item.done;
            saveTodos();
            push();
            break;
        }
        case 'todo-remove': {
            states.todo.items = states.todo.items.filter((t) => String(t.id) !== String(arg));
            saveTodos();
            push();
            break;
        }
        case 'todo-clear-done': {
            states.todo.items = states.todo.items.filter((t) => !t.done);
            saveTodos();
            push();
            break;
        }
        // clipboard
        case 'clip-pick': {
            // arg is "<index>" for copy-only, "<index>:paste" to hand focus back
            // and send Ctrl+V into the window the user came from.
            const raw = String(arg);
            const paste = raw.endsWith(':paste');
            const item = states.clipboard.items[Number(paste ? raw.slice(0, -6) : raw)];
            if (item) {
                clipboard.writeText(item.text);
                // Re-pin the picked entry so it reads as "the current one".
                states.clipboard.items = [item, ...states.clipboard.items.filter((x) => x !== item)];
                push();
                if (paste) {
                    pasteClipboardItem(states.clipboard.items.indexOf(item))
                        .then((ok) => {
                            if (win.isDestroyed()) return;
                            win.webContents.send('paste-result', { ok });
                            if (ok) win.webContents.send('collapse');
                        }, () => {});
                }
            }
            break;
        }
        case 'clip-clear': states.clipboard.items = []; push(); break;
        // quick actions
        case 'quick': {
            // hasOwnProperty so 'toString'/'constructor' cannot be reached through
            // the prototype chain at an IPC boundary.
            const key = String(arg);
            const fn = Object.prototype.hasOwnProperty.call(QUICK_ACTIONS, key) ? QUICK_ACTIONS[key] : null;
            if (fn) fn();
            break;
        }
        case 'open-settings': openSettings(); break;
        default: break;
    }
});

// ── global shortcuts ─────────────────────────────────────────────────────
// Tracks the accelerators that actually took, so the settings window can show the
// truth instead of claiming a binding that silently failed.
let boundShortcuts = {};

function registerShortcuts() {
    globalShortcut.unregisterAll();
    boundShortcuts = {};
    const bind = (key, accel, fn) => {
        if (!accel) return;
        // register() returns false for a valid accelerator that another app already
        // owns, and only throws for a malformed one — checking the return value is
        // the only way to catch the common failure.
        try {
            if (globalShortcut.register(accel, fn)) boundShortcuts[key] = accel;
            else console.warn(`shortcut ${accel} is already taken by another app`);
        } catch {
            console.warn(`shortcut ${accel} is not a valid accelerator`);
        }
    };
    // Keyed by settings path: the settings window looks these up by path, and keying
    // them by short name left every shortcut field reading as unbound.
    bind('shortcuts.toggle', settings.shortcuts.toggle, () => probeMedia(['toggle']));
    bind('shortcuts.next', settings.shortcuts.next, () => probeMedia(['next']));
    bind('shortcuts.prev', settings.shortcuts.prev, () => probeMedia(['prev']));
    bind('shortcuts.settings', settings.shortcuts.settings, () => openSettings());
    if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send('shortcuts', boundShortcuts);
    }
}

// Single instance. Without this lock, launching twice stacks two always-on-top
// islands and two tray icons, and both fight over the same userData cache.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win && !win.isDestroyed()) {
            if (hidden) showIsland();
            win.show();
            win.focus();
        }
    });

    // Each step is isolated on purpose. Run in sequence with no guard, a throw in
    // createTray() silently skipped registerShortcuts(), and a throw in
    // createIsland() left no tray at all — with skipTaskbar and a no-op
    // window-all-closed, Task Manager was then the only way out.
    app.whenReady().then(() => {
        loadSettings();
        for (const [name, step] of [
            ['island', createIsland],
            ['tray', createTray],
            ['shortcuts', registerShortcuts],
        ]) {
            try {
                step();
            } catch (e) {
                console.error(`startup step ${name} failed:`, e);
            }
        }
    }).catch((e) => console.error('startup failed:', e));
}

// With skipTaskbar there is no window to close, so never quit just because the
// island window goes away — the tray is the way out.
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
    for (const t of pollTimers) clearInterval(t);
    if (hoverPoll) clearInterval(hoverPoll);
    if (timerTick) clearInterval(timerTick);
    if (autoHidePoll) clearInterval(autoHidePoll);
    if (clipboardPoll) clearInterval(clipboardPoll);
    if (tray) tray.destroy();
    globalShortcut.unregisterAll();
});
