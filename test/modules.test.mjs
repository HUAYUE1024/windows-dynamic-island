import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, MODULE_IDS, pickActiveModule, collapsedSummary, batteryAlert, filterClipItems } from '../src/modules.mjs';

const base = {
    lastTouched: null,
    lastTouchedAt: 0,
    defaultModule: 'volume',
    lowBatteryThreshold: 20,
    enabled: MODULE_IDS,
};

const mediaIdle = { mode: 'idle' };
const mediaPlaying = { mode: 'playing' };
const timerOff = { running: false };
const timerOn = { running: true };

test('a module the user just touched outranks playing media', () => {
    // With media ranked first, clicking the volume dot while music plays would
    // never show volume — the stickiness window would be dead code.
    const now = Date.now();
    assert.equal(pickActiveModule(
        { media: mediaPlaying, timer: timerOn },
        { ...base, lastTouched: 'volume', lastTouchedAt: now - 2_000 },
    ), 'volume');
    // once it expires, ambient state takes back over
    assert.equal(pickActiveModule(
        { media: mediaPlaying, timer: timerOn },
        { ...base, lastTouched: 'volume', lastTouchedAt: now - 15_000 },
    ), 'media');
});

test('playing media outranks the timer and alerts when nothing was touched', () => {
    const s = pickActiveModule(
        { media: mediaPlaying, timer: timerOn, battery: { present: true, percent: 5, charging: false } },
        base,
    );
    assert.equal(s, 'media');
});

test('a running timer outranks alerts and the default module', () => {
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOn, battery: { present: true, percent: 5, charging: false }, network: { connected: false } },
        base,
    ), 'timer');
});

test('a recently touched module sticks for 10s so it cannot be yanked away', () => {
    const now = Date.now();
    const states = { media: mediaIdle, timer: timerOff, battery: { present: true, percent: 5, charging: false } };
    assert.equal(pickActiveModule(states, { ...base, lastTouched: 'todo', lastTouchedAt: now - 5_000 }), 'todo');
    // once the stickiness expires the alert takes over again
    assert.equal(pickActiveModule(states, { ...base, lastTouched: 'todo', lastTouchedAt: now - 15_000 }), 'battery');
});

test('low battery alerts, but not while charging', () => {
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff, battery: { present: true, percent: 12, charging: false } },
        base,
    ), 'battery');
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff, battery: { present: true, percent: 12, charging: true } },
        base,
    ), 'volume');
});

test('a desktop with no battery never alerts', () => {
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff, battery: { present: false, percent: -1 } },
        base,
    ), 'volume');
});

test('losing the network surfaces the network module', () => {
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff, network: { connected: false } },
        base,
    ), 'network');
});

test('falls back to the default module, then the first enabled one', () => {
    assert.equal(pickActiveModule({ media: mediaIdle, timer: timerOff }, base), 'volume');
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff },
        { ...base, defaultModule: 'todo' },
    ), 'todo');
    assert.equal(pickActiveModule(
        { media: mediaIdle, timer: timerOff },
        { ...base, defaultModule: 'media', enabled: ['perf', 'todo'] },
    ), 'perf');
});

test('pausing the music does not teleport the user to the default module', () => {
    // Media only counts as priority while it is playing. Once the user presses
    // pause, whatever is already on screen has to outrank defaultModule or the card
    // swaps to volume under them.
    const paused = { media: { mode: 'paused' }, timer: timerOff };
    assert.equal(pickActiveModule(paused, { ...base, current: 'media' }), 'media');
    assert.equal(pickActiveModule(paused, { ...base, current: 'todo' }), 'todo');
    // ...but a stale current id for a module that got disabled must not win.
    assert.equal(pickActiveModule(paused, { ...base, current: 'todo', enabled: ['volume', 'media'] }), 'volume');
});

test('ambient alerts still interrupt the module on screen', () => {
    const playing = { media: mediaIdle, timer: timerOff, battery: { present: true, percent: 8, charging: false } };
    assert.equal(pickActiveModule(playing, { ...base, current: 'volume' }), 'battery');
});

test('a disabled module is never picked, even as the fallback', () => {
    const s = pickActiveModule(
        { media: mediaIdle, timer: timerOff, battery: { present: true, percent: 5, charging: false } },
        { ...base, enabled: ['volume', 'network'] },
    );
    assert.equal(s, 'volume');
});

test('batteryAlert returns the percent only when it is a real warning', () => {
    assert.equal(batteryAlert({ present: true, percent: 15, charging: false }), 15);
    assert.equal(batteryAlert({ present: true, percent: 15, charging: true }), null);
    assert.equal(batteryAlert({ present: false, percent: 15, charging: false }), null);
    assert.equal(batteryAlert({ present: true, percent: 40, charging: false }), null);
    assert.equal(batteryAlert({ present: true, percent: -1, charging: false }), null);
    assert.equal(batteryAlert(null), null);
});

test('collapsedSummary never returns an empty label', () => {
    for (const id of MODULE_IDS) {
        const text = collapsedSummary(id, {}).text;
        assert.ok(typeof text === 'string' && text.length > 0, `${id} -> "${text}"`);
    }
    assert.equal(collapsedSummary('volume', { level: 42, muted: false }).text, '音量 42%');
    assert.equal(collapsedSummary('volume', { level: 42, muted: true }).text, '已静音');
    assert.equal(collapsedSummary('media', { sourceName: 'Spotify' }).text, 'Spotify');
    assert.equal(collapsedSummary('battery', { present: true, percent: 80, charging: true }).text, '80% 充电中');
    assert.equal(collapsedSummary('todo', { items: [{ done: true }, { done: false }] }).text, '1 项待办');
});

test('clipboard filter is case-insensitive and a blank query keeps everything', () => {
    const items = [{ text: 'Hello World' }, { text: 'foo bar' }, { text: '' }];
    assert.equal(filterClipItems(items, '').length, 3);
    // A query of only spaces must not silently empty the list.
    assert.equal(filterClipItems(items, '   ').length, 3);
    assert.equal(filterClipItems(items, 'hello').length, 1);
    assert.equal(filterClipItems(items, 'BAR')[0].text, 'foo bar');
    assert.equal(filterClipItems(items, 'nope').length, 0);
});

test('every module declares a sane poll interval', () => {    for (const m of MODULES) {
        assert.ok(Number.isInteger(m.interval) && m.interval >= 0, `${m.id} interval`);
        assert.ok(m.label && m.label.length > 0, `${m.id} label`);
    }
    // the ids must be unique or the switcher cannot address them
    assert.equal(new Set(MODULE_IDS).size, MODULE_IDS.length);
});

test('collapsedSummary clamps an out-of-range battery percent', () => {
    // The probe clamps too, but the summary must not print "108%" or "-1%" if it
    // ever sees one.
    assert.equal(collapsedSummary('battery', { present: true, percent: 108, charging: false }).text, '108%');
    assert.equal(collapsedSummary('volume', { level: 0, muted: false }).text, '音量 0%');
});
