// Module registry and the priority engine that decides which module the island shows.
// Pure functions only — no Electron, no DOM — so the priority rules are testable.

export const MODULES = [
    { id: 'media', label: '音乐', interval: 1500 },
    { id: 'volume', label: '音量', interval: 2000 },
    { id: 'battery', label: '电池', interval: 10000 },
    { id: 'network', label: '网络', interval: 10000 },
    { id: 'perf', label: '性能', interval: 2000 },
    { id: 'quick', label: '快捷', interval: 0 },
    { id: 'timer', label: '专注', interval: 1000 },
    { id: 'todo', label: '待办', interval: 0 },
    { id: 'clipboard', label: '剪贴板', interval: 0 },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

/** One glyph per module, shared by the island and the settings window. */
export const MODULE_ICON = {
    media: '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M4 9v6h3.6L13 20V4L7.6 9H4zm11.5-.6a5 5 0 0 1 0 7.2l1.3 1.3a7 7 0 0 0 0-9.8l-1.3 1.3z"/></svg>',
    battery: '<svg viewBox="0 0 24 24"><path d="M9 2h6v2h2v18H7V4h2V2zm0 6v12h6V8H9z"/></svg>',
    network: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-3 17.5v-2.1A7 7 0 1 1 12 5v8.6l4-4L17.4 8 12 13.4V3z"/></svg>',
    perf: '<svg viewBox="0 0 24 24"><path d="M4 18h3v-5H4v5zm6.5 0h3V6h-3v12zM17 18h3v-8h-3v8z"/></svg>',
    quick: '<svg viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>',
    timer: '<svg viewBox="0 0 24 24"><path d="M12 2a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 9.4l3.5 2.1-.9 1.5L11 12.2V6h2v5.4zM10 0h4v2h-4z"/></svg>',
    todo: '<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.4 5.2l1.4 1.4 3.2-3.2 1.4 1.4-4.6 4.6-2.8-2.8 1.4-1.4zM14 10h5v2h-5v-2zm0 4.5h5v2h-5v-2z"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><path d="M9 2h6l1 2h4v18H4V4h4l1-2zm-1 7h8v2H8V9zm0 4h8v2H8v-2z"/></svg>',
};


export const STICKY_MS = 10_000;

/**
 * Which module gets the island right now.
 *
 * A module the user just touched wins over everything: with media playing ranked
 * first, clicking the volume dot while music plays would never show volume at all,
 * which makes the 10s stickiness window useless. After it expires, ambient state
 * (media, timer, alerts) takes back over.
 *
 * Whatever is already on screen outranks the default module. Without that, media
 * only counted while it was *playing*, so pausing the track let the engine fall
 * through to defaultModule and teleported the user to the volume card — every
 * single time they pressed pause.
 */
export function pickActiveModule(states, ctx) {
    const now = ctx.nowMs ?? Date.now();
    const enabled = (id) => (ctx.enabled || MODULE_IDS).includes(id);

    if (ctx.lastTouched && enabled(ctx.lastTouched) && now - (ctx.lastTouchedAt ?? 0) < STICKY_MS) {
        return ctx.lastTouched;
    }
    if (states.media && states.media.mode === 'playing' && enabled('media')) return 'media';
    if (states.timer && states.timer.running && enabled('timer')) return 'timer';

    const battery = states.battery;
    if (battery && battery.present && !battery.charging &&
        typeof battery.percent === 'number' && battery.percent >= 0 &&
        battery.percent <= (ctx.lowBatteryThreshold ?? 20) && enabled('battery')) {
        return 'battery';
    }

    if (states.network && states.network.connected === false && enabled('network')) return 'network';

    if (ctx.current && enabled(ctx.current)) return ctx.current;

    if (ctx.defaultModule && enabled(ctx.defaultModule)) return ctx.defaultModule;

    const first = MODULE_IDS.find(enabled);
    return first || 'media';
}

/** One-line summary for the collapsed pill. */
export function collapsedSummary(id, state) {
    // Before a module's first poll its state is a stub; showing "undefined%" or
    // "NaN%" for two seconds reads as broken, so fall back to a neutral label.
    const stub = !state || state.ok === false;
    switch (id) {
        case 'media':
            return { text: state?.sourceName || '等待播放', art: !!state?.art };
        case 'volume':
            return stub
                ? { text: '音量', art: false }
                : { text: state.muted ? '已静音' : `音量 ${Math.round(state.level)}%`, art: false };
        case 'battery':
            return stub || !state.present
                ? { text: stub ? '电池' : '无电池', art: false }
                : { text: `${state.percent}%${state.charging ? ' 充电中' : ''}`, art: false };
        case 'network':
            return stub
                ? { text: '网络', art: false }
                : { text: state.connected ? (state.name || '已连接') : '网络已断开', art: false };
        case 'perf':
            return stub
                ? { text: '性能', art: false }
                : { text: `CPU ${Math.round(state.cpu)}%`, art: false };
        case 'timer':
            return { text: state.running ? '专注中' : '专注', art: false };
        case 'todo': {
            const left = (state.items || []).filter((t) => !t.done).length;
            return { text: left ? `${left} 项待办` : '待办已清空', art: false };
        }
        case 'clipboard':
            return { text: `${(state.items || []).length} 条记录`, art: false };
        case 'quick':
            return { text: '快捷操作', art: false };
        default:
            return { text: '', art: false };
    }
}

/** Battery percentage for the low-battery alert, or null when not applicable. */
export function batteryAlert(state, threshold = 20) {
    if (!state || !state.present || state.charging) return null;
    if (typeof state.percent !== 'number' || state.percent < 0) return null;
    return state.percent <= threshold ? state.percent : null;
}

/**
 * Clipboard history filter: case-insensitive substring over the entry text.
 * An all-whitespace query must keep every entry — trimming it away is what makes
 * " " not silently empty the list.
 */
export function filterClipItems(items, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) => String(t.text ?? '').toLowerCase().includes(q));
}
