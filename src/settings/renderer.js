// Settings window: schema-driven controls, live-applied and debounce-saved.
// The left rail picks a section; the pill above it renders the actual glass settings
// so a change is visible before it is committed.
import { MODULES, MODULE_ICON } from '../modules.mjs';

const api = window.settingsApi;

const MODULE_OPTIONS = MODULES.map((m) => [m.id, m.label]);

const POSITIONS = [
    ['top-left', '左上'], ['top-center', '顶部居中'], ['top-right', '右上'],
    ['bottom-left', '左下'], ['bottom-center', '底部居中'], ['bottom-right', '右下'],
];

// Section glyphs. Same outline weight as the island's module icons so the two
// windows read as one product.
const ICON = {
    glass: '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 3.2c1.4 2.4 2.1 4.6 2.1 6.8s-.7 4.4-2.1 6.8c-1.4-2.4-2.1-4.6-2.1-6.8s.7-4.4 2.1-6.8zM5.2 11h13.6c0 1.5-.3 3-.8 4.2H6c-.5-1.2-.8-2.7-.8-4.2z"/></svg>',
    behaviour: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.4 4c0-.4 0-.8-.1-1.2l2-1.5-2-3.4-2.3 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>',
    modules: '<svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>',
    motion: '<svg viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>',
    keys: '<svg viewBox="0 0 24 24"><path d="M7 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12.7 7.3l9 9-1.4 1.4-9-9 1.4-1.4z"/></svg>',
};

const SCHEMA = [
    {
        id: 'glass', icon: ICON.glass, group: '玻璃外观',
        sub: '五层光学栈：模糊、折射、色调、不透明度、镜面追光。改动会立刻反映在左边的实时预览里。',
        items: [
            { path: 'glass.blurPx', label: '磨砂模糊', type: 'range', min: 0, max: 60, step: 1, unit: 'px', hint: '背景被模糊的程度' },
            { path: 'glass.refractScale', label: '折射畸变', type: 'range', min: 0, max: 60, step: 1, hint: '玻璃背后的内容被弯折的强度，0 就是普通毛玻璃' },
            { path: 'glass.tint', label: '色调深度', type: 'range', min: 0, max: 0.9, step: 0.02, hint: '越深越不透明，折射也越难看清楚' },
            { path: 'glass.opacity', label: '整体不透明度', type: 'range', min: 0.2, max: 1, step: 0.05 },
            { path: 'glass.specular', label: '镜面追光', type: 'switch', hint: '指针掠过时高光跟随' },
        ],
    },
    {
        id: 'behaviour', icon: ICON.behaviour, group: '岛的行为',
        sub: '岛在哪里、什么时候出现、什么时候让开鼠标。',
        items: [
            { path: 'island.position', label: '屏幕位置', type: 'select', options: POSITIONS },
            { path: 'island.hoverDelayMs', label: '悬停展开延迟', type: 'range', min: 0, max: 1000, step: 20, unit: 'ms' },
            { path: 'island.pollMs', label: '状态刷新间隔', type: 'range', min: 250, max: 10000, step: 250, unit: 'ms', hint: '轮询播放器的频率，越小越实时' },
            { path: 'island.alwaysOnTop', label: '总在最前', type: 'switch' },
            { path: 'island.clickThrough', label: '玻璃外点击穿透', type: 'switch', hint: '关掉后整块窗口都会挡住鼠标' },
            { path: 'island.autoHide', label: '无媒体时自动隐藏', type: 'switch' },
            { path: 'island.autoHideDelaySec', label: '自动隐藏延迟', type: 'range', min: 1, max: 600, step: 5, unit: 's' },
        ],
    },
    {
        id: 'modules', icon: ICON.modules, group: '模块',
        sub: '启用的模块会出现在切换轨里，也会被优先级选中。',
        items: [
            { path: 'modules.enabled', label: '启用的模块', type: 'modules', hint: '关掉的模块不会出现在切换点里，也不会被优先级选中' },
            { path: 'modules.defaultModule', label: '默认模块', type: 'select', options: MODULE_OPTIONS, hint: '没有更高优先级事件时显示哪个' },
            { path: 'modules.lowBatteryThreshold', label: '低电量告警阈值', type: 'range', min: 5, max: 50, step: 5, unit: '%' },
            { path: 'modules.clipboardMax', label: '剪贴板保留条数', type: 'range', min: 3, max: 30, step: 1 },
            { path: 'modules.clipboardPaste', label: '点按直接回粘', type: 'switch', hint: '点历史记录就粘进你刚才在用的窗口；关掉则只复制' },
        ],
    },
    {
        id: 'motion', icon: ICON.motion, group: '动效',
        sub: '形变时长与音频波形。按下左边的播放键可以预览。',
        items: [
            { path: 'motion.morphMs', label: '展开时长', type: 'range', min: 80, max: 900, step: 20, unit: 'ms', hint: '太长会显得拖沓' },
            { path: 'motion.waveform', label: '音频波形', type: 'switch' },
        ],
    },
    {
        id: 'keys', icon: ICON.keys, group: '全局快捷键',
        sub: '格式如 Alt+Shift+Space。被别的程序占用的快捷键会标成橙色——注册失败时系统不会有任何提示。',
        items: [
            { path: 'shortcuts.toggle', label: '播放 / 暂停', type: 'text' },
            { path: 'shortcuts.next', label: '下一首', type: 'text' },
            { path: 'shortcuts.prev', label: '上一首', type: 'text' },
            { path: 'shortcuts.settings', label: '打开本窗口', type: 'text' },
        ],
    },
];

let model = null;
const inputs = new Map(); // path -> control element
let section = SCHEMA[0].id;

// Which accelerators actually took. The main process reports this because
// globalShortcut.register() failing is silent by nature.
let bound = {};

function get(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), model);
}

function set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let o = model;
    for (const k of keys) o = o[k];
    o[last] = value;
}

function fmt(path, value) {
    const item = SCHEMA.flatMap((g) => g.items).find((i) => i.path === path);
    if (item.type === 'select') {
        const found = (item.options || []).find(([v]) => v === value);
        return found ? found[1] : value;
    }
    if (item.type === 'switch') return value ? '开' : '关';
    return item.unit ? `${value}${item.unit}` : String(value);
}

// ── rail ─────────────────────────────────────────────────────────────────
function renderRail() {
    const rail = document.getElementById('rail');
    rail.textContent = '';
    for (const sec of SCHEMA) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rail-item';
        b.dataset.id = sec.id;
        b.innerHTML = sec.icon;
        b.append(document.createTextNode(sec.group));
        b.setAttribute('aria-current', sec.id === section ? 'true' : 'false');
        b.addEventListener('click', () => selectSection(sec.id));
        rail.append(b);
    }
}

function selectSection(id) {
    if (!SCHEMA.some((s) => s.id === id)) return;
    section = id;
    for (const b of document.querySelectorAll('.rail-item')) {
        b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false');
    }
    renderGroups();
}

// Arrow keys walk the rail the way a tab strip should.
document.getElementById('rail').addEventListener('keydown', (e) => {
    const ids = SCHEMA.map((s) => s.id);
    const i = ids.indexOf(section);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else return;
    e.preventDefault();
    selectSection(next);
    document.querySelector(`.rail-item[data-id="${next}"]`).focus();
});

// ── controls ─────────────────────────────────────────────────────────────
function buildControl(item, value) {
    const wrap = document.createElement('div');
    wrap.className = 'control';

    if (item.type === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(item.min);
        input.max = String(item.max);
        input.step = String(item.step);
        input.value = String(value);
        const out = document.createElement('span');
        out.className = 'value';
        out.textContent = fmt(item.path, value);
        const paintFill = (v) => {
            const span = Number(item.max) - Number(item.min);
            const pct = span > 0 ? ((Number(v) - Number(item.min)) / span) * 100 : 0;
            input.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
        };
        paintFill(value);
        input.addEventListener('input', () => {
            set(item.path, Number(input.value));
            out.textContent = fmt(item.path, Number(input.value));
            paintFill(input.value);
            scheduleSave();
        });
        wrap.append(input, out);
        inputs.set(item.path, input);
        return wrap;
    }

    if (item.type === 'modules') {
        const wrapEl = document.createElement('div');
        wrapEl.className = 'chips';
        for (const mod of MODULES) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.dataset.id = mod.id;
            const on = value.includes(mod.id);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
            chip.innerHTML = MODULE_ICON[mod.id] || '';
            chip.append(document.createTextNode(mod.label));
            chip.addEventListener('click', () => {
                const list = new Set(get(item.path));
                if (list.has(mod.id)) {
                    // Refuse to switch off the last one. normalize() substitutes the
                    // whole default set for an empty list, so the chips flashed off
                    // and then all nine snapped back on.
                    if (list.size === 1) return;
                    list.delete(mod.id);
                } else {
                    list.add(mod.id);
                }
                // Order follows MODULES so the switcher stays predictable.
                const next = MODULES.map((m) => m.id).filter((id) => list.has(id));
                set(item.path, next);
                syncChips();
                scheduleSave();
            });
            wrapEl.append(chip);
        }
        inputs.set(item.path, wrapEl);
        return wrapEl;
    }

    if (item.type === 'switch') {
        const btn = document.createElement('button');
        btn.className = 'switch';
        btn.type = 'button';
        btn.setAttribute('role', 'switch');
        btn.setAttribute('aria-checked', value ? 'true' : 'false');
        btn.setAttribute('aria-label', item.label);
        const out = document.createElement('span');
        out.className = 'value';
        out.textContent = value ? '开' : '关';
        btn.addEventListener('click', () => {
            const next = btn.getAttribute('aria-checked') !== 'true';
            btn.setAttribute('aria-checked', next ? 'true' : 'false');
            out.textContent = next ? '开' : '关';
            set(item.path, next);
            scheduleSave();
        });
        wrap.append(btn, out);
        inputs.set(item.path, btn);
        return wrap;
    }

    if (item.type === 'select') {
        const sel = document.createElement('select');
        for (const [v, label] of item.options) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = label;
            if (v === value) opt.selected = true;
            sel.append(opt);
        }
        sel.addEventListener('change', () => {
            set(item.path, sel.value);
            scheduleSave();
        });
        wrap.append(sel);
        inputs.set(item.path, sel);
        return wrap;
    }

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'kbd';
    text.value = String(value);
    text.spellcheck = false;
    text.setAttribute('aria-label', item.label);
    text.dataset.bound = Object.prototype.hasOwnProperty.call(bound, item.path)
        && bound[item.path] === text.value ? '1' : '0';
    text.addEventListener('change', () => {
        // Fall back to the model's current value, not the one captured when this
        // control was built: after an external change, clearing the field snapped
        // back to the stale original.
        set(item.path, text.value.trim() || get(item.path));
        scheduleSave();
    });
    wrap.append(text);
    inputs.set(item.path, text);
    return wrap;
}

function renderGroups() {
    const sec = SCHEMA.find((s) => s.id === section);
    document.getElementById('sec-title').textContent = sec.group;
    document.getElementById('sec-sub').textContent = sec.sub || '';

    const host = document.getElementById('groups');
    host.textContent = '';
    const rows = document.createElement('div');
    rows.className = 'rows';
    for (const item of sec.items) {
        const row = document.createElement('div');
        row.className = 'row';
        const left = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.label;
        left.append(label);
        if (item.hint) {
            const hint = document.createElement('div');
            hint.className = 'hint';
            hint.textContent = item.hint;
            left.append(hint);
        }
        row.append(left, buildControl(item, get(item.path)));
        rows.append(row);
    }
    host.append(rows);
}

function syncControls() {
    for (const [path, el] of inputs) {
        const value = get(path);
        if (el.type === 'range') {
            el.value = String(value);
            // Both the range and the switch readouts are `.value` siblings written
            // only by the control's own handler, so an externally-pushed change
            // moved the control and left the number/label stale.
            const out = el.parentElement.querySelector('.value');
            if (out) out.textContent = fmt(path, value);
            const item = SCHEMA.flatMap((g) => g.items).find((i) => i.path === path);
            const span = Number(item.max) - Number(item.min);
            if (span > 0) {
                el.style.setProperty('--fill', `${Math.max(0, Math.min(100, ((Number(value) - Number(item.min)) / span) * 100))}%`);
            }
        } else if (el.className === 'switch') {
            el.setAttribute('aria-checked', value ? 'true' : 'false');
            const out = el.parentElement.querySelector('.value');
            if (out) out.textContent = value ? '开' : '关';
        } else if (el.className === 'chips') syncChips();
        else if (el.tagName === 'SELECT') el.value = String(value);
        else {
            el.value = String(value);
            if (el.classList.contains('kbd')) {
                el.dataset.bound = bound[path] === value ? '1' : '0';
            }
        }
    }
}

function syncChips() {
    const chips = inputs.get('modules.enabled');
    if (!chips) return;
    const list = new Set(get('modules.enabled'));
    for (const chip of chips.querySelectorAll('.chip')) {
        chip.setAttribute('aria-pressed', list.has(chip.dataset.id) ? 'true' : 'false');
    }
    // The default-module select must not offer something that is switched off.
    const sel = inputs.get('modules.defaultModule');
    if (sel && sel.tagName === 'SELECT') {
        const current = get('modules.defaultModule');
        sel.textContent = '';
        for (const mod of MODULES) {
            if (!list.has(mod.id)) continue;
            const opt = document.createElement('option');
            opt.value = mod.id;
            opt.textContent = mod.label;
            if (mod.id === current) opt.selected = true;
            sel.append(opt);
        }
        if (current && !list.has(current)) {
            const first = MODULES.find((m) => list.has(m.id));
            if (first) set('modules.defaultModule', first.id);
        }
    }
}

// ── live glass preview ───────────────────────────────────────────────────
const pvIsland = document.getElementById('pv-island');
const pvRefractMap = document.getElementById('pv-refract-map');

function paintPreview() {
    const g = model.glass;
    pvIsland.style.setProperty('--pv-blur', `${g.blurPx}px`);
    pvIsland.style.setProperty('--pv-tint', String(g.tint));
    pvIsland.style.setProperty('--pv-opacity', String(g.opacity));
    pvIsland.style.setProperty('--pv-specular', g.specular ? '1' : '0');
    pvIsland.style.setProperty('--pv-morph', `${model.motion.morphMs}ms`);
    // scale is an SVG attribute, not a CSS property, so it cannot ride in on a var.
    if (pvRefractMap) pvRefractMap.setAttribute('scale', String(g.refractScale));
}

document.getElementById('pv-play').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const open = pvIsland.dataset.open !== '1';
    pvIsland.dataset.open = open ? '1' : '0';
    btn.dataset.open = open ? '1' : '0';
    btn.setAttribute('aria-label', open ? '预览收起动画' : '预览展开动画');
});

// ── save / reset ─────────────────────────────────────────────────────────
let saveTimer = null;
const status = document.getElementById('status');

function say(text, state) {
    status.textContent = text;
    status.dataset.state = state || '';
}

async function commit() {
    clearTimeout(saveTimer);
    saveTimer = null;
    model = await api.save(model);
    say('已保存', 'saved');
    setTimeout(() => { if (status.dataset.state === 'saved') say(''); }, 1200);
}

function scheduleSave() {
    say('保存中…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 220);
    paintPreview();
}

// Flush on the way out: the debounce is 220ms, and closing the window inside it
// dropped the change entirely — the island kept the old value while the UI had
// already shown the new one.
window.addEventListener('beforeunload', () => {
    if (saveTimer) api.saveNow(model);
});

// Reset touches thirty-odd values at once with no undo, so it takes two clicks.
const resetBtn = document.getElementById('reset');
let resetTimer = null;
resetBtn.addEventListener('click', async () => {
    if (resetBtn.dataset.armed !== '1') {
        resetBtn.dataset.armed = '1';
        resetBtn.dataset.label = resetBtn.textContent.trim();
        resetBtn.textContent = '再点一次确认';
        resetTimer = setTimeout(() => {
            delete resetBtn.dataset.armed;
            resetBtn.textContent = resetBtn.dataset.label;
        }, 3000);
        return;
    }
    clearTimeout(resetTimer);
    delete resetBtn.dataset.armed;
    resetBtn.textContent = resetBtn.dataset.label;
    model = await api.reset();
    paintPreview();
    syncControls();
    say('已恢复默认', 'saved');
    setTimeout(() => { if (status.dataset.state === 'saved') say(''); }, 1400);
});

api.onChange((s) => {
    model = s;
    paintPreview();
    syncControls();
});

// The main process reports which accelerators actually took; register() failing is
// otherwise completely silent.
api.onShortcuts((b) => {
    bound = b || {};
    syncControls();
});

model = await api.get();
renderRail();
renderGroups();
paintPreview();
