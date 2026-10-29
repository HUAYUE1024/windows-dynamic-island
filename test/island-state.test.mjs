import test from 'node:test';
import assert from 'node:assert/strict';
import {
    friendlySource, trackKey, extrapolatePosition, advancePosition, formatTime, accentHue, deriveIslandState,
} from '../src/island-state.mjs';

test('friendlySource strips UWP package names and app ids', () => {
    assert.equal(friendlySource('Foo_pzs8sxrjxfjjc!Foo'), 'Foo');
    assert.equal(friendlySource('SpotifyAB.SpotifyMusic.Spotify_zpdnekdrzreaq!Spotify'), 'Spotify');
    assert.equal(friendlySource('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'ZuneMusic');
    assert.equal(friendlySource('MSEdge'), 'MSEdge');
    assert.equal(friendlySource(''), '');
    assert.equal(friendlySource(null), '');
});

test('extrapolatePosition advances while playing and freezes when paused', () => {
    const base = {
        positionMs: 10_000, durationMs: 60_000, rate: 1,
        lastUpdatedUtc: '2026-10-28T12:00:00.000Z',
    };
    const later = Date.parse('2026-10-28T12:00:02.000Z');
    assert.equal(extrapolatePosition({ ...base, status: 'Playing' }, later), 12_000);
    assert.equal(extrapolatePosition({ ...base, status: 'Paused' }, later), 10_000);
    // clamped at the end of the track
    assert.equal(extrapolatePosition({ ...base, status: 'Playing' }, later + 600_000), 60_000);
    // faster-than-real playback rate scales the drift
    assert.equal(
        extrapolatePosition({ ...base, status: 'Playing', rate: 2 }, later),
        14_000,
    );
    // no duration reported: never clamp
    assert.equal(
        extrapolatePosition({ ...base, status: 'Playing', durationMs: 0 }, later + 600_000),
        612_000,
    );
});

test('formatTime renders m:ss and rejects junk', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(61_000), '1:01');
    assert.equal(formatTime(3_599_000), '59:59');
    assert.equal(formatTime(-1), null);
    assert.equal(formatTime(NaN), null);
});

test('accentHue is stable per track and inside the colour wheel', () => {
    const a = accentHue(trackKey({ session: 'ok', source: 'MSEdge', title: 'X', artist: 'Y' }));
    const b = accentHue(trackKey({ session: 'ok', source: 'MSEdge', title: 'X', artist: 'Y' }));
    const c = accentHue(trackKey({ session: 'ok', source: 'MSEdge', title: 'Z', artist: 'Y' }));
    assert.equal(a, b);
    assert.notEqual(a, c);
    for (const h of [a, c]) assert.ok(h >= 0 && h < 360, `hue ${h} out of range`);
});

const playing = {
    session: 'ok', source: 'SpotifyAB.SpotifyMusic.Spotify_zpdnekdrzreaq!Spotify',
    title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', status: 'Playing',
    positionMs: 30_000, durationMs: 240_000, rate: 1,
    lastUpdatedUtc: '2026-10-28T12:00:00.000Z', art: null,
    canToggle: true, canNext: true, canPrev: true, shuffle: false, repeat: 'None',
};

test('deriveIslandState maps a playing session', () => {
    const s = deriveIslandState(playing, {
        art: 'data:image/png;base64,AAA',
        nowMs: Date.parse('2026-10-28T12:00:00.000Z'),
    });
    assert.equal(s.mode, 'playing');
    assert.equal(s.sourceName, 'Spotify');
    assert.equal(s.title, 'Nightcall');
    assert.equal(s.artist, 'Kavinsky');
    assert.equal(s.art, 'data:image/png;base64,AAA');
    assert.equal(s.progress, 0.125);
    assert.equal(s.durationLabel, '4:00');
    assert.deepEqual(s.caps, { toggle: true, next: true, prev: true });
});

test('position keeps advancing between polls while playing', () => {
    const s = deriveIslandState(playing, { nowMs: Date.parse('2026-10-28T12:00:05.000Z') });
    assert.equal(s.positionLabel, '0:35');
    assert.equal(s.progress, 35 / 240);
});

test('a session with no timeline hides the progress bar instead of faking one', () => {
    const s = deriveIslandState({ ...playing, durationMs: 0, positionMs: 0 });
    assert.equal(s.progress, null);
    assert.equal(s.durationLabel, null);
});

test('paused and idle states', () => {
    assert.equal(deriveIslandState({ ...playing, status: 'Paused' }).mode, 'paused');
    const idle = deriveIslandState(null);
    assert.equal(idle.mode, 'idle');
    assert.equal(idle.title, '');
    assert.equal(idle.progress, null);
    assert.equal(deriveIslandState({ session: null }).mode, 'idle');
});

test('missing probe is reported so the UI can say why', () => {
    assert.equal(deriveIslandState({ probeMissing: true }).probeMissing, true);
});

test('empty title falls back to the app name', () => {
    const s = deriveIslandState({ ...playing, title: '   ' });
    assert.equal(s.title, 'Spotify');
});

test('advancePosition never extrapolates from a non-finite base', () => {
    // 0 + elapsed would report a position the track never reached.
    assert.equal(advancePosition(NaN, 0, 1000), 0);
    assert.equal(advancePosition(undefined, 0, 1000), 0);
    assert.equal(advancePosition(5000, 4000, 5000), 6000);
});

test('accentHue is neutral for an empty key', () => {
    // Hashing '' gives 0, which is red.
    assert.equal(accentHue(''), 210);
    assert.equal(accentHue(null), 210);
    assert.notEqual(accentHue('douyin'), 210);
});

test('advancePosition falls back to the base position when the timestamp is missing', () => {
    // The knob is placed with left: calc(var(--p) * 100%). A NaN --p is invalid at
    // computed-value time, so the declaration is dropped and the knob snaps to the
    // start of the track with no error anywhere — this is the "knob never moves" bug.
    assert.equal(advancePosition(5000, undefined, 10_000), 5000);
    assert.equal(advancePosition(5000, NaN, 10_000), 5000);
    assert.equal(advancePosition(5000, 'not-a-number', 10_000), 5000);
    assert.equal(advancePosition(5000, 4000, 5000), 6000);
    // Clamped to the duration, and never negative.
    assert.equal(advancePosition(5000, 0, 999_999, 1, 6000), 6000);
    assert.equal(advancePosition(0, 999_999, 0), 0);
});

test('friendlySource does not mistake a file extension for a name separator', () => {
    // "cloudmusic.exe" read as "exe" on the collapsed pill.
    assert.equal(friendlySource('cloudmusic.exe'), 'cloudmusic');
    assert.equal(friendlySource('msedge.exe'), 'msedge');
    // The UWP dot rule still applies.
    assert.equal(friendlySource('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'ZuneMusic');
    assert.equal(friendlySource('MSEdge'), 'MSEdge');
});

test('deriveIslandState marks a real track as hasTrack', () => {
    const p = { session: 'ok', source: 'cloudmusic.exe', title: '50 Feet', artist: 'SoMo', status: 'Paused' };
    assert.equal(deriveIslandState(p).hasTrack, true);
    // A bare app holding a session with nothing playing is not a track.
    const bare = { session: 'ok', source: 'cloudmusic.exe', title: '', artist: '', status: 'Paused' };
    assert.equal(deriveIslandState(bare).hasTrack, false);
});
