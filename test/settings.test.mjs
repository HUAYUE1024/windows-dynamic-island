import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, isTopAnchored } from '../src/settings.mjs';

test('normalize returns defaults for junk input', () => {
    for (const junk of [null, undefined, 42, 'x', [], { island: 5 }, { glass: null }]) {
        assert.deepEqual(normalize(junk), DEFAULTS, `failed for ${JSON.stringify(junk)}`);
    }
});

test('normalize keeps valid overrides', () => {
    const s = normalize({
        island: { position: 'bottom-right', pollMs: 900, autoHide: false },
        glass: { blurPx: 12, tint: 0.1, refractScale: 40, specular: false },
        motion: { morphMs: 200, waveform: false },
        shortcuts: { toggle: 'Ctrl+Alt+P' },
    });
    assert.equal(s.island.position, 'bottom-right');
    assert.equal(s.island.pollMs, 900);
    assert.equal(s.island.autoHide, false);
    assert.equal(s.glass.blurPx, 12);
    assert.equal(s.glass.tint, 0.1);
    assert.equal(s.glass.refractScale, 40);
    assert.equal(s.glass.specular, false);
    assert.equal(s.motion.morphMs, 200);
    assert.equal(s.motion.waveform, false);
    assert.equal(s.shortcuts.toggle, 'Ctrl+Alt+P');
    // untouched keys keep their defaults
    assert.equal(s.island.hoverDelayMs, DEFAULTS.island.hoverDelayMs);
    assert.equal(s.shortcuts.next, DEFAULTS.shortcuts.next);
});

test('numbers are clamped to their range', () => {
    const s = normalize({
        island: { pollMs: 1, hoverDelayMs: 99999 },
        glass: { blurPx: -5, tint: 5, opacity: 0.01, refractScale: 999 },
        motion: { morphMs: 10 },
    });
    assert.equal(s.island.pollMs, 250);
    assert.equal(s.island.hoverDelayMs, 1000);
    assert.equal(s.glass.blurPx, 0);
    assert.equal(s.glass.tint, 0.9);
    assert.equal(s.glass.opacity, 0.2);
    assert.equal(s.glass.refractScale, 60);
    assert.equal(s.motion.morphMs, 80);
});

test('non-numeric values fall back instead of becoming NaN', () => {
    const s = normalize({ glass: { blurPx: 'lots', tint: null }, motion: { morphMs: {} } });
    assert.equal(s.glass.blurPx, DEFAULTS.glass.blurPx);
    assert.equal(s.glass.tint, DEFAULTS.glass.tint);
    assert.equal(s.motion.morphMs, DEFAULTS.motion.morphMs);
});

test('unknown position falls back to the default', () => {
    assert.equal(normalize({ island: { position: 'middle-of-nowhere' } }).island.position, 'top-center');
    assert.equal(normalize({ island: { position: 'bottom-left' } }).island.position, 'bottom-left');
});

test('non-boolean flags fall back to defaults', () => {
    const s = normalize({ island: { autoHide: 'yes', clickThrough: 1 }, glass: { specular: 'no' } });
    assert.equal(s.island.autoHide, DEFAULTS.island.autoHide);
    assert.equal(s.island.clickThrough, DEFAULTS.island.clickThrough);
    assert.equal(s.glass.specular, DEFAULTS.glass.specular);
});

test('isTopAnchored drives the vertical anchor', () => {
    assert.equal(isTopAnchored('top-center'), true);
    assert.equal(isTopAnchored('bottom-center'), false);
    assert.equal(isTopAnchored(undefined), false);
});

test('a whitespace-only accelerator falls back to the default', () => {
    // globalShortcut.register refuses a blank accelerator and reports nothing, so
    // the field must never be allowed to hold one.
    const s = normalize({ shortcuts: { toggle: '   ', next: ' Alt+Shift+Right ' } });
    assert.equal(s.shortcuts.toggle, DEFAULTS.shortcuts.toggle);
    assert.equal(s.shortcuts.next, 'Alt+Shift+Right');
});

test('defaultModule cannot be a module the user disabled', () => {
    const s = normalize({ modules: { enabled: ['media', 'todo'], defaultModule: 'volume' } });
    assert.equal(s.modules.defaultModule, DEFAULTS.modules.defaultModule);
    const ok = normalize({ modules: { enabled: ['media', 'todo'], defaultModule: 'todo' } });
    assert.equal(ok.modules.defaultModule, 'todo');
});
