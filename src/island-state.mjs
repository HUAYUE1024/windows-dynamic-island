// Pure mapping from probe JSON to what the island renders. No Electron, no DOM —
// so the state logic stays testable with plain node --test.

export function friendlySource(appUserModelId) {
    if (!appUserModelId) return '';
    let s = String(appUserModelId);
    const bang = s.lastIndexOf('!');
    if (bang >= 0) s = s.slice(bang + 1);            // UWP: PackageFamily!AppId
    // A trailing file extension is not a name separator. Stripping it as one turned
    // "cloudmusic.exe" into "exe", so the collapsed pill read "exe".
    s = s.replace(/\.(exe|app|bin|com|bat|cmd)$/i, '');
    const dot = s.lastIndexOf('.');
    if (dot >= 0 && dot < s.length - 1) s = s.slice(dot + 1);
    return s.trim();
}

export function trackKey(p) {
    return p && p.session === 'ok' ? `${friendlySource(p.source)}|${p.title || ''}|${p.artist || ''}` : '';
}

// SMTC only reports a position snapshot at lastUpdatedUtc; advance it locally so the
// bar stays smooth between polls instead of stepping once a second.
export function extrapolatePosition(p, nowMs) {
    const base = Number(p.positionMs) || 0;
    const updated = Date.parse(p.lastUpdatedUtc);
    if (p.status !== 'Playing' || !Number.isFinite(updated)) return base;
    const next = base + (nowMs - updated) * (Number(p.rate) || 1);
    const duration = Number(p.durationMs) || 0;
    if (duration > 0) return Math.min(Math.max(next, 0), duration);
    return Math.max(next, 0);
}

/**
 * Advance a poll's position by the time elapsed since the renderer received it.
 *
 * `sinceMs` is the renderer's own clock reading, NOT a field from the probe — the
 * probe's positionMs is already extrapolated to the moment it was taken. A missing
 * or non-finite `sinceMs` must fall back to the base position rather than propagate
 * NaN: the knob is placed with `left: calc(var(--p) * 100%)`, and a NaN there is
 * invalid at computed-value time, so the declaration is dropped and the knob snaps
 * back to the start of the track with no error anywhere.
 */
export function advancePosition(positionMs, sinceMs, nowMs, rate = 1, durationMs = 0) {
    const raw = Number(positionMs);
    // A non-finite base must not be extrapolated from: 0 + elapsed would report a
    // position the track never reached.
    if (!Number.isFinite(raw)) return 0;
    const since = Number(sinceMs);
    const now = Number(nowMs);
    if (!Number.isFinite(since) || !Number.isFinite(now)) return raw;
    let next = raw + (now - since) * (Number(rate) || 1);
    next = Math.max(next, 0);
    if (Number(durationMs) > 0) next = Math.min(next, Number(durationMs));
    return next;
}

export function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function accentHue(key) {
    // An empty key hashed to 0, which is red — a session with no source, title or
    // artist got a hot accent instead of the neutral default.
    if (!key) return 210;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return h;
}

export function deriveIslandState(p, opts = {}) {
    const nowMs = opts.nowMs ?? Date.now();
    const art = opts.art ?? null;

    if (!p || p.session !== 'ok') {
        return {
            mode: 'idle',
            sourceName: '', title: '', artist: '', album: '', hasTrack: false,
            art: null, progress: null, durationMs: 0, positionMs: 0, rate: 1,
            positionLabel: null, durationLabel: null,
            caps: { toggle: false, next: false, prev: false },
            shuffle: false, repeat: '', accentHue: 210, probeMissing: !!p?.probeMissing,
        };
    }

    const sourceName = friendlySource(p.source);
    const durationMs = Number(p.durationMs) || 0;
    const positionMs = extrapolatePosition(p, nowMs);
    const title = (p.title || '').trim() || sourceName;
    const artist = (p.artist || '').trim();
    // A real track, as opposed to a bare app holding an SMTC session: either the
    // title is more than the process name, or there is an artist.
    const hasTrack = title !== sourceName || artist.length > 0;

    return {
        mode: p.status === 'Playing' ? 'playing' : 'paused',
        sourceName,
        title,
        artist,
        hasTrack,
        album: (p.album || '').trim(),
        art,
        // Browsers often report no usable timeline; hide the bar rather than show a lie.
        progress: durationMs > 0 ? Math.min(positionMs / durationMs, 1) : null,
        durationMs,
        positionMs,
        rate: Number(p.rate) || 1,
        positionLabel: formatTime(positionMs),
        durationLabel: durationMs > 0 ? formatTime(durationMs) : null,
        caps: { toggle: !!p.canToggle, next: !!p.canNext, prev: !!p.canPrev },
        shuffle: !!p.shuffle,
        repeat: p.repeat || '',
        accentHue: accentHue(trackKey(p)),
        probeMissing: false,
    };
}
