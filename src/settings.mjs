// Settings store: defaults, coercion/clamping, load/save. Pure `normalize` so the
// validation rules are testable without touching the filesystem.

export const DEFAULTS = {
    island: {
        position: 'top-center',      // top-left | top-center | top-right | bottom-left | bottom-center | bottom-right
        autoHide: false,             // hide the island when nothing has played for a while
        autoHideDelaySec: 20,
        alwaysOnTop: true,
        clickThrough: true,
        hoverDelayMs: 140,
        pollMs: 1500,
    },
    glass: {
        blurPx: 26,
        refractScale: 28,
        tint: 0.34,
        opacity: 1,
        specular: true,
    },
    motion: {
        morphMs: 240,
        waveform: true,
    },
    modules: {
        enabled: ['media', 'volume', 'battery', 'network', 'perf', 'quick', 'timer', 'todo', 'clipboard'],
        defaultModule: 'volume',
        lowBatteryThreshold: 20,
        clipboardMax: 10,
        // 'click' = clicking a clipboard row also pastes it back into the window the
        // user came from; 'copy' only puts it on the system clipboard.
        clipboardPaste: true,
    },
    shortcuts: {
        toggle: 'Alt+Shift+Space',
        next: 'Alt+Shift+Right',
        prev: 'Alt+Shift+Left',
        settings: 'Alt+Shift+S',
    },
};

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

const RANGES = {
    'island.autoHideDelaySec': [1, 600],
    'island.hoverDelayMs': [0, 1000],
    'island.pollMs': [250, 10000],
    'glass.blurPx': [0, 60],
    'glass.refractScale': [0, 60],
    'glass.tint': [0, 0.9],
    'glass.opacity': [0.2, 1],
    'motion.morphMs': [80, 900],
    'modules.lowBatteryThreshold': [5, 50],
    'modules.clipboardMax': [3, 30],
};

function num(path, value, fallback) {
    // Number(null) is 0 and Number(true) is 1, both of which would silently become
    // a valid-looking setting, so only real numbers and numeric strings get through.
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const [lo, hi] = RANGES[path];
    return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000));
}

function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function idList(value, fallback) {
    if (!Array.isArray(value)) return [...fallback];
    // Keep only known ids, de-duplicated, so a hand-edited file cannot inject junk.
    const seen = new Set();
    const out = [];
    for (const v of value) {
        if (typeof v === 'string' && fallback.includes(v) && !seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    }
    return out.length > 0 ? out : [...fallback];
}

function str(value, fallback) {
    // Trimmed: a whitespace-only accelerator passes a bare length check and
    // globalShortcut.register then refuses it, silently.
    const v = typeof value === 'string' ? value.trim() : '';
    return v.length > 0 ? v : fallback;
}

/**
 * Merge user-supplied JSON over the defaults, dropping anything malformed.
 * Never throws — a corrupt settings file must not stop the island from booting.
 */
export function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULTS;
    return {
        island: {
            position: POSITIONS.includes(r.island?.position) ? r.island.position : d.island.position,
            autoHide: bool(r.island?.autoHide, d.island.autoHide),
            autoHideDelaySec: num('island.autoHideDelaySec', r.island?.autoHideDelaySec, d.island.autoHideDelaySec),
            alwaysOnTop: bool(r.island?.alwaysOnTop, d.island.alwaysOnTop),
            clickThrough: bool(r.island?.clickThrough, d.island.clickThrough),
            hoverDelayMs: num('island.hoverDelayMs', r.island?.hoverDelayMs, d.island.hoverDelayMs),
            pollMs: num('island.pollMs', r.island?.pollMs, d.island.pollMs),
        },
        glass: {
            blurPx: num('glass.blurPx', r.glass?.blurPx, d.glass.blurPx),
            refractScale: num('glass.refractScale', r.glass?.refractScale, d.glass.refractScale),
            tint: num('glass.tint', r.glass?.tint, d.glass.tint),
            opacity: num('glass.opacity', r.glass?.opacity, d.glass.opacity),
            specular: bool(r.glass?.specular, d.glass.specular),
        },
        motion: {
            morphMs: num('motion.morphMs', r.motion?.morphMs, d.motion.morphMs),
            waveform: bool(r.motion?.waveform, d.motion.waveform),
        },
        modules: {
            enabled: idList(r.modules?.enabled, d.modules.enabled),
            // Validated against the user's own enabled list, not the default one,
            // so disabling a module cannot leave it selected as the default.
            defaultModule: (() => {
                const enabled = idList(r.modules?.enabled, d.modules.enabled);
                return enabled.includes(r.modules?.defaultModule)
                    ? r.modules.defaultModule : d.modules.defaultModule;
            })(),
            lowBatteryThreshold: num('modules.lowBatteryThreshold', r.modules?.lowBatteryThreshold, d.modules.lowBatteryThreshold),
            clipboardMax: num('modules.clipboardMax', r.modules?.clipboardMax, d.modules.clipboardMax),
            clipboardPaste: bool(r.modules?.clipboardPaste, d.modules.clipboardPaste),
        },
        shortcuts: {
            toggle: str(r.shortcuts?.toggle, d.shortcuts.toggle),
            next: str(r.shortcuts?.next, d.shortcuts.next),
            prev: str(r.shortcuts?.prev, d.shortcuts.prev),
            settings: str(r.shortcuts?.settings, d.shortcuts.settings),
        },
    };
}

export function isTopAnchored(position) {
    return String(position).startsWith('top');
}
