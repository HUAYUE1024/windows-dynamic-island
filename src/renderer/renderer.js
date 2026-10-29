// Renderer: click-through is owned by the main process (see the comment there);
// this file renders whichever status module is active and wires its controls.
import { formatTime, advancePosition } from '../island-state.mjs';
import { isTopAnchored } from '../settings.mjs';
import { MODULES, MODULE_ICON, collapsedSummary, filterClipItems } from '../modules.mjs';

const $ = (id) => document.getElementById(id);
const island = $('island');
const artSm = $('art-sm');
const srcEl = $('src-collapsed');
const clockEl = $('clock');
const modName = $('mod-name');
const modDots = $('mod-dots');
const modBody = $('mod-body');
const modFoot = $('mod-foot');
const modIcon = $('mod-icon');
const refractMap = document.getElementById('glass-refract-map');

const send = (name, arg) => window.island.command(name, arg);


// Timestamp of the last optimistic play/pause flip, so an unrelated module's push
// cannot revert the icon before the media probe has landed.
let optimisticModeAt = 0;
let hoverDelayMs = 140;
let open = false;
let pinned = false;
let openTimer = null;
let state = null;         // { active, alert, modules }

// ── icons ────────────────────────────────────────────────────────────────
// One glyph per module, used by the collapsed pill.

// ── icons ────────────────────────────────────────────────────────────────
const I = {
    play: '<svg class="i-play" viewBox="0 0 24 24"><path d="M8 4.8v14.4a.8.8 0 0 0 1.22.68l11.2-7.2a.8.8 0 0 0 0-1.36L9.22 4.12A.8.8 0 0 0 8 4.8z"/></svg>',
    pause: '<svg class="i-pause" viewBox="0 0 24 24"><path d="M7 4.5h3.6v15H7zm6.4 0H17v15h-3.6z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M7 5h2.4v14H7zM20 5.5v13a.9.9 0 0 1-1.4.76l-9-6.5a.9.9 0 0 1 0-1.52l9-6.5A.9.9 0 0 1 20 5.5z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M14.6 5H17v14h-2.4zM4 5.5v13a.9.9 0 0 0 1.4.76l9-6.5a.9.9 0 0 0 0-1.52l-9-6.5A.9.9 0 0 0 4 5.5z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M17 3.5l4 4-4 4v-2.6h-2.7c-.5 0-.9.2-1.3.5l-1 1.1-1.3-1.4 1.2-1.3c.8-.9 1.9-1.4 3.1-1.4H17V3.5zM3 6.9c0-1 .8-1.9 1.9-1.9h3.4c1.1 0 2.1.5 2.9 1.3l6 6.5c.4.4.9.6 1.4.6H21v2.6h-2.4c-1.2 0-2.3-.5-3.1-1.4l-6-6.5c-.4-.4-.9-.6-1.4-.6H4.9c-.4 0-.9-.4-.9-.9v-1.3zm18 3.6v2.6h-2.4c-1.2 0-2.3-.5-3.1-1.4l-1.2-1.3 1.3-1.4 1 1.1c.4.3.8.5 1.3.5H21zM3 16.1c0-1 .8-1.9 1.9-1.9h3.4c.5 0 1 .2 1.4.6l1 1.1-1.3 1.4-1.2-1.3c-.4-.3-.8-.5-1.3-.5H4.9c-.5 0-.9-.4-.9-.9v-1.3z"/></svg><span class="dot"></span>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h9v2.6l3.5-3.3L16 3v2.6H5.6C4.7 5.6 4 6.3 4 7.2v9.6c0 .9.7 1.6 1.6 1.6h1.9v-2H6V7h1zm10 10H8v-2.6L4.5 17.7 8 21v-2.6h10.4c.9 0 1.6-.7 1.6-1.6V7.2c0-.9-.7-1.6-1.6-1.6h-1.9v2H18v7h-1z"/></svg><span class="dot"></span>',
    speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h3.6L13 20V4L7.6 9H4zm11.5-.6a5 5 0 0 1 0 7.2l1.3 1.3a7 7 0 0 0 0-9.8l-1.3 1.3z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h3.6L13 20V4L7.6 9H4zm12.7 3l2.3-2.3-1.4-1.4L15.3 10.6 13 8.3l-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm3 8H9V7a3 3 0 0 1 6 0v3z"/></svg>',
    sleep: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.4 5.4 0 0 1 12 3z"/></svg>',
    shot: '<svg viewBox="0 0 24 24"><path d="M4 6h3v2h2V6h6v2h2V6h3v14H4V6zm6 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
    task: '<svg viewBox="0 0 24 24"><path d="M4 4h16v3H4V4zm0 5h16v11H4V9zm3 3v5h4v-5H7z"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4c0-.4 0-.8-.1-1.2l2-1.5-2-3.4-2.3 1a8.6 8.6 0 0 0-2-1.2L16.5 3h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
};

// ── drag helpers ─────────────────────────────────────────────────────────
function fractionOf(el, e) {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

/**
 * Pointer drag on a rail; calls onMove while dragging and onDone once on release.
 * `onStart` fires on the press only, for state that has to be captured before the
 * first move rather than re-read on every one.
 *
 * The move/up listeners live on `window`, not on the element. Pointer capture is not
 * honoured by synthetic input and is lost outright if the element is re-rendered
 * mid-gesture; either way the drag silently stopped at the rail's edge instead of
 * following the cursor. `dataset.dragging` is the guard, so an idle rail costs
 * nothing.
 */
function dragRail(el, { onStart, onMove, onDone, onCancel }) {
    const endDrag = (f) => {
        if (!el.dataset.dragging) return;
        delete el.dataset.dragging;
        send('drag', false);
        onDone(f);
    };

    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dataset.dragging = '1';
        // Guarded: it throws for a pointer the browser is not tracking, and the throw
        // used to skip the rest of this handler, so the press did nothing at all.
        try { el.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
        // Tell the main process a drag is live. It drives click-through from a cursor
        // poll and enables it the moment the pointer crosses the island's edge, after
        // which the OS delivers no mouse message to this window at all — the drag
        // would die mid-gesture and pointerup would never arrive.
        send('drag', true);
        const f = fractionOf(el, e);
        if (onStart) onStart(f);
        onMove(f);
    });

    window.addEventListener('pointermove', (e) => {
        // isConnected: a module switch mid-drag detaches the rail, and a detached
        // element reports an all-zero rect, which would drive the control to 0.
        if (el.dataset.dragging && el.isConnected) onMove(fractionOf(el, e));
    });
    window.addEventListener('pointerup', (e) => {
        if (el.dataset.dragging && el.isConnected) endDrag(fractionOf(el, e));
    });
    // A cancelled drag must clear the caller's flag too, or that control freezes.
    const cancel = () => {
        if (!el.dataset.dragging) return;
        delete el.dataset.dragging;
        send('drag', false);
        if (onCancel) onCancel();
    };
    window.addEventListener('pointercancel', cancel);
    // The window can lose the pointer outright (alt-tab, a modal); without this the
    // main process would keep click-through suppressed forever.
    window.addEventListener('blur', cancel);
}

/** Wheel on a rail. `passive: false` so the event can be cancelled. */
function wheelRail(el, { onStep }) {
    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 10 : 2;
        onStep(e.deltaY < 0 ? step : -step);
    }, { passive: false });
}

// ── module views ─────────────────────────────────────────────────────────
// Each view returns HTML for the body and footer; `mount` attaches listeners to
// the freshly-rendered nodes.
const VIEWS = {
    media: {
        body: (s) => `
          <div class="m-media mod-body-inner" style="display:flex;flex-direction:row;align-items:center;gap:14px">
            <div class="art art-lg"><img id="v-art" alt=""><div class="art-glow"></div></div>
            <div class="meta">
              <div class="title ellipsis" id="v-title">${esc(s.title)}</div>
              <div class="artist ellipsis">${esc(s.artist || s.sourceName)}</div>
              <div class="track" id="v-track" role="slider" tabindex="0"
                   aria-label="播放进度" aria-valuemin="0" aria-valuemax="100">
                <div class="track-fill" id="v-fill"></div>
                <div class="track-knob"></div>
              </div>
              <div class="times"><span id="v-pos">${s.positionLabel ?? '--:--'}</span><span id="v-dur">${s.durationLabel ?? '--:--'}</span></div>
            </div>
          </div>`,
        foot: (s) => `
          <div class="controls">
            <button class="btn btn-toggle" id="v-shuffle" aria-label="随机播放" aria-pressed="${s.shuffle ? 'true' : 'false'}">${I.shuffle}</button>
            <button class="btn" id="v-prev" aria-label="上一首" ${s.caps.prev ? '' : 'disabled'}>${I.prev}</button>
            <button class="btn btn-main" id="v-toggle" aria-label="播放或暂停" ${s.caps.toggle ? '' : 'disabled'}>${I.play}${I.pause}</button>
            <button class="btn" id="v-next" aria-label="下一首" ${s.caps.next ? '' : 'disabled'}>${I.next}</button>
            <button class="btn btn-toggle" id="v-repeat" aria-label="循环模式" aria-pressed="${repeatOn(s.repeat) ? 'true' : 'false'}">${I.repeat}</button>
          </div>`,
        mount(body, foot, s) {
            const art = body.querySelector('#v-art');
            const titleEl2 = body.querySelector('#v-title');
            const artistEl2 = body.querySelector('#v-artist') || body.querySelector('.artist');
            const track = body.querySelector('#v-track');
            const pos = body.querySelector('#v-pos');
            const dur = body.querySelector('#v-dur');
            const shuffleBtn = foot.querySelector('#v-shuffle');
            const repeatBtn = foot.querySelector('#v-repeat');

            // Mutable so update() can hand us fresh poll data; the rAF loop below
            // reads this instead of a snapshot taken at mount time.
            let live = s;
            // The last duration the player actually reported. Several report 0 while
            // paused, and reading live.durationMs directly made both the drag and the
            // arrow keys dead in that window even though the track has a length.
            let knownDuration = s.durationMs > 0 ? s.durationMs : 0;
            // The poll already extrapolates positionMs to the moment it was taken, so
            // the only local term is the time since we received that state. Reading a
            // field the poll never sends made this NaN, and `left: calc(NaN * 100%)`
            // is invalid at computed-value time — the knob silently fell back to the
            // start of the track and the elapsed time read as garbage.
            let liveAt = performance.now();
            let scrubbing = false;

            // durationMs is a parameter so a drag keeps using the value it captured
            // even after a poll has replaced `live`.
            const setP = (f, durationMs = live.durationMs) => {
                if (!Number.isFinite(f)) return;
                f = Math.min(1, Math.max(0, f));
                track.style.setProperty('--p', String(f));
                pos.textContent = formatTime(f * durationMs);
            };

            const paintText = (st) => {
                titleEl2.textContent = st.title;
                artistEl2.textContent = st.artist || st.sourceName;
                dur.textContent = st.durationLabel ?? '--:--';
                if (st.art && art.src !== st.art) art.src = st.art;
                island.dataset.hasart = st.art ? '1' : '0';
                island.style.setProperty('--accent', String(st.accentHue));
                shuffleBtn.setAttribute('aria-pressed', st.shuffle ? 'true' : 'false');
                const on = repeatOn(st.repeat);
                repeatBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
                repeatBtn.title = { None: '循环：关', List: '循环：列表', Track: '循环：单曲' }[st.repeat] || '循环模式';
            };

            paintText(live);
            setP(live.progress ?? 0);

            // Attached unconditionally and guarded inside instead: wiring these
            // only when a timeline already existed at mount left the bar inert for
            // any player that reports durationMs 0 while paused and a real duration
            // once playing — visible, but not draggable and not keyboard-operable.
            // The duration is captured once, when the drag starts. Reading
            // live.durationMs on every move let a poll replace it mid-drag — and a
            // player that reports 0 while paused left scrubbing unset, so the rAF
            // loop kept running the bar forward while the user dragged, the knob
            // never followed, and the release sent no seek at all.
            let dragDuration = 0;
            {
                dragRail(track, {
                    onStart: () => { dragDuration = knownDuration; },
                    onMove: (f) => {
                        if (dragDuration <= 0) return;
                        scrubbing = true;
                        setP(f, dragDuration);
                    },
                    onDone: (f) => {
                        scrubbing = false;
                        if (dragDuration <= 0) return;
                        const ms = Math.round(f * dragDuration);
                        // Optimistic: the next poll is seconds away and must not snap back.
                        live.positionMs = ms;
                        liveAt = performance.now();
                        setP(f, dragDuration);
                        send('seek', ms);
                    },
                    onCancel: () => { scrubbing = false; dragDuration = 0; },
                });
                track.addEventListener('keydown', (e) => {
                    const dur = knownDuration;
                    if (dur <= 0) return;
                    const step = e.shiftKey ? 30_000 : 5_000;
                    let f = (live.progress == null ? 0 : live.positionMs / dur);
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') f += step / dur;
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') f -= step / dur;
                    else if (e.key === 'Home') f = 0;
                    else if (e.key === 'End') f = 1;
                    else return;
                    e.preventDefault();
                    e.stopPropagation();
                    f = Math.min(1, Math.max(0, f));
                    const ms = Math.round(f * dur);
                    live.positionMs = ms;
                    liveAt = performance.now();
                    setP(f, dur);
                    send('seek', ms);
                });
            }

            foot.querySelector('#v-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                // Flip the icon now instead of waiting a full poll interval for the
                // probe; the next poll corrects it if the command was refused.
                const playing = island.dataset.mode === 'playing';
                island.dataset.mode = playing ? 'paused' : 'playing';
                live.mode = playing ? 'paused' : 'playing';
                liveAt = performance.now();
                optimisticModeAt = performance.now();
                send('toggle');
            });
            foot.querySelector('#v-prev').addEventListener('click', (e) => { e.stopPropagation(); send('prev'); });
            foot.querySelector('#v-next').addEventListener('click', (e) => { e.stopPropagation(); send('next'); });
            foot.querySelector('#v-shuffle').addEventListener('click', (e) => {
                e.stopPropagation();
                send('shuffle', shuffleBtn.getAttribute('aria-pressed') !== 'true');
            });
            foot.querySelector('#v-repeat').addEventListener('click', (e) => {
                e.stopPropagation();
                const cycle = ['None', 'List', 'Track'];
                const now = cycle.includes(live.repeat) ? live.repeat : 'None';
                send('repeat', cycle[(cycle.indexOf(now) + 1) % cycle.length]);
            });

            // Local extrapolation between polls keeps the bar smooth.
            // Bail once a newer render supersedes this mount, otherwise every
            // module switch leaks another 60fps loop writing to dead nodes.
            const myGen = renderGeneration;
            const tick = () => {
                if (myGen !== renderGeneration) return;
                if (!scrubbing && live.mode === 'playing' && live.durationMs > 0) {
                    const now = advancePosition(
                        live.positionMs, liveAt, performance.now(), live.rate, live.durationMs,
                    );
                    setP(now / live.durationMs);
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);

            // Called on every poll while this module stays active.
            return (next) => {
                live = next;
                liveAt = performance.now();
                if (next.durationMs > 0) knownDuration = next.durationMs;
                paintText(next);
                if (!scrubbing && next.progress != null) setP(next.progress);
            };
        },
    },

    volume: {
        body: (s) => {
            if (!s || s.ok === false) return pendingCard(s, '音量');
            return `
          <div class="m-volume" style="display:flex;flex-direction:column;gap:8px">
            <div class="big" id="v-level">${s.muted ? '静音' : s.level + '%'}</div>
            <div class="slider" id="v-slider">
              <div class="slider-rail">
                <div class="slider-fill" id="v-fill"></div>
                <div class="slider-knob"></div>
              </div>
            </div>
            <div class="mid dim ellipsis">${esc(s.device || '默认输出设备')}</div>
          </div>`;
        },
        foot: (s) => `
          <div class="controls">
            <button class="btn btn-toggle" id="v-mute" aria-label="静音" aria-pressed="${s.muted ? 'true' : 'false'}">${s.muted ? I.mute : I.speaker}</button>
            <button class="btn" id="v-b5" aria-label="降低 5">−5</button>
            <button class="btn" id="v-b1" aria-label="提高 5">+5</button>
          </div>`,
        mount(body, foot, s) {
            const slider = body.querySelector('#v-slider');
            const label = body.querySelector('#v-level');
            const deviceEl = body.querySelector('.mid');
            const muteBtn = foot.querySelector('#v-mute');

            // Mutable so the poll refresh below has fresh data.
            let live = s;
            let dragging = false;

            const paint = (st) => {
                const pct = st.level ?? 0;
                // --p goes on the slider, not the fill: .slider-knob is a SIBLING of
                // .slider-fill, so a value set on the fill never reaches it and the
                // knob sat at the left edge forever. The media track sets it on its
                // own container for the same reason.
                slider.style.setProperty('--p', String(pct / 100));
                label.textContent = st.muted ? '静音' : `${Math.round(pct)}%`;
                deviceEl.textContent = st.device || '默认输出设备';
                muteBtn.setAttribute('aria-pressed', st.muted ? 'true' : 'false');
                muteBtn.innerHTML = st.muted ? I.mute : I.speaker;
                slider.setAttribute('aria-valuenow', String(Math.round(pct)));
                slider.setAttribute('aria-valuetext', st.muted ? '静音' : `${Math.round(pct)}%`);
            };
            paint(live);

            const setP = (f, commit) => {
                const pct = f * 100;
                slider.style.setProperty('--p', String(f));
                label.textContent = live.muted ? '静音' : `${Math.round(pct)}%`;
                slider.setAttribute('aria-valuenow', String(Math.round(pct)));
                slider.setAttribute('aria-valuetext', live.muted ? '静音' : `${Math.round(pct)}%`);
                if (commit) {
                    live.level = pct;
                    // Fractional, not rounded: the probe parses a double and the audio
                    // endpoint is continuous, so rounding here is what made the knob
                    // feel like it was moving in steps.
                    send('setvol', Math.round(pct * 100) / 100);
                }
            };

            dragRail(slider, {
                onMove: (f) => { dragging = true; setP(f, false); },
                onDone: (f) => { dragging = false; setP(f, true); },
                onCancel: () => { dragging = false; },
            });

            wheelRail(slider, {
                onStep: (d) => {
                    const next = Math.max(0, Math.min(100, (live.level ?? 0) + d));
                    live.level = next;
                    setP(next / 100, true);
                },
            });

            // Keyboard parity with the music progress bar.
            slider.setAttribute('role', 'slider');
            slider.setAttribute('tabindex', '0');
            slider.setAttribute('aria-label', '音量');
            slider.setAttribute('aria-valuemin', '0');
            slider.setAttribute('aria-valuemax', '100');
            slider.addEventListener('keydown', (e) => {
                const step = e.shiftKey ? 10 : 2;
                let f = (live.level ?? 0) / 100;
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') f += step / 100;
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') f -= step / 100;
                else if (e.key === 'Home') f = 0;
                else if (e.key === 'End') f = 1;
                else return;
                e.preventDefault();
                e.stopPropagation();
                f = Math.min(1, Math.max(0, f));
                live.level = Math.round(f * 100);
                setP(f, true);
            });

            muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                send('mute', live.muted !== true);
            });
            const step = (sel, delta) => foot.querySelector(sel).addEventListener('click', (e) => {
                e.stopPropagation();
                const next = Math.max(0, Math.min(100, (live.level ?? 0) + delta));
                live.level = next;
                send('setvol', next);
            });
            step('#v-b5', -5);
            step('#v-b1', 5);

            // Polls keep the level honest when it changes outside the island
            // (media keys, the system mixer) — but never fight an active drag.
            return (next) => {
                live = next;
                if (!dragging) paint(next);
            };
        },
    },

    battery: {
        body: (s) => {
            // The stub check has to come first: !s.present is true for {ok:false}
            // too, which told every laptop it had no battery for the first 10s.
            if (!s || s.ok === false) return pendingCard(s, '电池');
            if (!s.present) {
                return `<div class="mid dim" style="text-align:center">这台机器没有电池</div>`;
            }
            const mins = s.remainingMinutes;
            const left = mins == null ? '' : `· 剩余 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
            return `
          <div style="display:flex;flex-direction:column;gap:10px">
            <div class="big">${s.percent}%${s.charging ? ' <span style="font-size:14px;opacity:.7">充电中</span>' : ''}</div>
            <div class="bar"><div class="bar-fill" style="--p:${(s.percent / 100).toFixed(3)}" data-warn="${s.percent <= 20 && !s.charging ? 1 : 0}"></div></div>
            <div class="mid dim">${esc(s.status || '')}${left}${s.powerSaver ? ' · 节电模式' : ''}</div>
            <div class="bar-row" style="margin-top:2px">
              <span class="bar-label">亮度</span>
              <div class="slider" id="v-bright" style="height:20px">
                <div class="slider-rail"><div class="slider-fill" id="v-bright-fill"></div><div class="slider-knob"></div></div>
              </div>
              <span class="bar-value" id="v-bright-val">--</span>
            </div>
          </div>`;
        },
        foot: (s) => `<div class="mid dim">${s.present ? '系统电量' : '台式机'}</div>`,
        mount(body) {
            const big = body.querySelector('.big');
            const fill = body.querySelector('.bar-fill');
            const detail = body.querySelectorAll('.mid')[0];

            // Brightness needs a separate probe call — the battery poll does not
            // carry it — and not every panel supports DDC/CI.
            const bright = body.querySelector('#v-bright');
            const brightVal = body.querySelector('#v-bright-val');
            let brightLevel = 50;

            const paintBright = (v) => {
                // On the slider, not the fill — see the volume module for why.
                bright.style.setProperty('--p', String(v / 100));
                brightVal.textContent = `${Math.round(v)}%`;
                bright.setAttribute('aria-valuenow', String(Math.round(v)));
            };
            paintBright(brightLevel);
            bright.setAttribute('role', 'slider');
            bright.setAttribute('tabindex', '0');
            bright.setAttribute('aria-label', '屏幕亮度');
            bright.setAttribute('aria-valuemin', '0');
            bright.setAttribute('aria-valuemax', '100');

            const commitBright = (v) => {
                brightLevel = Math.max(0, Math.min(100, Math.round(v)));
                paintBright(brightLevel);
                send('bright', brightLevel);
            };
            dragRail(bright, {
                // The knob follows the pointer exactly; only the committed value is
                // rounded, because WMI brightness is integer on almost every panel.
                onMove: (f) => paintBright(f * 100),
                onDone: (f) => commitBright(f * 100),
            });
            wheelRail(bright, { onStep: (d) => commitBright(brightLevel + d) });
            bright.addEventListener('keydown', (e) => {
                const step = e.shiftKey ? 20 : 5;
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') commitBright(brightLevel + step);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') commitBright(brightLevel - step);
                else if (e.key === 'Home') commitBright(0);
                else if (e.key === 'End') commitBright(100);
                else return;
                e.preventDefault();
                e.stopPropagation();
            });

            return (s) => {
                if (!s.present || !big) return;
                const mins = s.remainingMinutes;
                const left = mins == null ? '' : `· 剩余 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
                big.innerHTML = `${s.percent}%${s.charging ? ' <span style="font-size:14px;opacity:.7">充电中</span>' : ''}`;
                fill.style.setProperty('--p', String(Math.min(1, s.percent / 100)));
                fill.dataset.warn = s.percent <= 20 && !s.charging ? '1' : '0';
                detail.textContent = `${s.status || ''}${left}${s.powerSaver ? ' · 节电模式' : ''}`;
            };
        },
    },

    network: {
        body: (s) => {
            if (!s || s.ok === false) return pendingCard(s, '网络');
            if (!s.connected) {
                return `<div style="display:flex;flex-direction:column;gap:8px">
                  <div class="big">未连接</div>
                  <div class="mid dim">没有可用的 Internet 连接</div>
                </div>`;
            }
            const kind = { wifi: 'Wi-Fi', ethernet: '以太网', wwan: '移动网络', other: '网络' }[s.kind] || '网络';
            return `
          <div style="display:flex;flex-direction:column;gap:9px">
            <div class="big ellipsis">${esc(s.name || '已连接')}</div>
            <div class="bars">
              <div class="bar-row"><span class="bar-label">类型</span><span class="bar-value">${kind}</span><span></span></div>
              ${s.signal != null ? `<div class="bar-row"><span class="bar-label">信号</span>
                <div class="bar"><div class="bar-fill" style="--p:${(s.signal / 5).toFixed(3)}"></div></div>
                <span class="bar-value">${s.signal}/5</span></div>` : ''}
            </div>
          </div>`;
        },
        foot: () => `<button class="btn" id="v-open" aria-label="打开网络设置">${I.gear}</button>`,
        mount(body, foot, s) {
            foot.querySelector('#v-open').addEventListener('click', (e) => {
                e.stopPropagation();
                send('quick', 'settings');
            });
            const paint = () => {
                const signalFill = modBody.querySelectorAll('.bar-fill')[0];
                if (!signalFill) return;
                const v = signalFill.closest('.bar-row').querySelector('.bar-value');
                signalFill.style.setProperty('--p', String(live.signal / 5));
                v.textContent = `${live.signal}/5`;
            };
            let live = s;
            let wasConnected = s.connected;
            return (next) => {
                live = next;
                // Rebuild the whole card when connectivity itself flips: the
                // connected and disconnected layouts share no nodes, so patching
                // fields in place is not possible.
                if (next.connected !== wasConnected) {
                    wasConnected = next.connected;
                    renderModule('network', next);
                    return;
                }
                if (next.signal != null) paint();
            };
        },
    },

    perf: {
        body: (s) => {
            // s.ramUsedGb.toFixed() throws on the {ok:false} stub, and the throw
            // landed outside the guard that would have shown an error card.
            if (!s || s.ok === false) return pendingCard(s, '性能');
            const ram = s.ramTotalGb > 0 ? s.ramUsedGb / s.ramTotalGb : 0;
            return `
          <div class="bars">
            <div class="bar-row"><span class="bar-label">CPU</span>
              <div class="bar"><div class="bar-fill" id="v-cpu" style="--p:${(s.cpu / 100).toFixed(3)}" data-warn="${s.cpu > 85 ? 1 : 0}"></div></div>
              <span class="bar-value">${Math.round(s.cpu)}%</span></div>
            <div class="bar-row"><span class="bar-label">内存</span>
              <div class="bar"><div class="bar-fill" style="--p:${ram.toFixed(3)}" data-warn="${ram > 0.9 ? 1 : 0}"></div></div>
              <span class="bar-value">${s.ramUsedGb.toFixed(1)}/${s.ramTotalGb.toFixed(0)}G</span></div>
            <div class="bar-row"><span class="bar-label">进程</span><span class="bar-value">${s.processes}</span><span></span></div>
          </div>`;
        },
        foot: () => `<button class="btn" id="v-task" aria-label="打开任务管理器">${I.task}</button>`,
        mount(body, foot) {
            const cpu = body.querySelector('#v-cpu');
            const cpuVal = cpu.closest('.bar-row').querySelector('.bar-value');
            const ramFill = body.querySelectorAll('.bar-fill')[1];
            const ramVal = ramFill.closest('.bar-row').querySelector('.bar-value');
            const procVal = body.querySelectorAll('.bar-row')[2].querySelector('.bar-value');

            foot.querySelector('#v-task').addEventListener('click', (e) => {
                e.stopPropagation();
                send('quick', 'taskmgr');
            });

            return (s) => {
                const ram = s.ramTotalGb > 0 ? s.ramUsedGb / s.ramTotalGb : 0;
                cpu.style.setProperty('--p', String(Math.min(1, s.cpu / 100)));
                cpu.dataset.warn = s.cpu > 85 ? '1' : '0';
                cpuVal.textContent = `${Math.round(s.cpu)}%`;
                ramFill.style.setProperty('--p', String(ram));
                ramFill.dataset.warn = ram > 0.9 ? '1' : '0';
                ramVal.textContent = `${s.ramUsedGb.toFixed(1)}/${s.ramTotalGb.toFixed(0)}G`;
                procVal.textContent = String(s.processes);
            };
        },
    },

    quick: {
        body: () => `
          <div class="grid-actions">
            <button class="quick-btn" data-a="lock" data-confirm="1">${I.lock}<span class="q-label">锁屏</span></button>
            <button class="quick-btn" data-a="sleep" data-confirm="1">${I.sleep}<span class="q-label">睡眠</span></button>
            <button class="quick-btn" data-a="screenshot">${I.shot}截图</button>
            <button class="quick-btn" data-a="taskmgr">${I.task}任务管理</button>
            <button class="quick-btn" data-a="explorer" data-confirm="1">${I.reload}<span class="q-label">重启桌面</span></button>
            <button class="quick-btn" data-a="settings">${I.gear}设置</button>
          </div>`,
        foot: () => `<div class="mid dim">常用系统操作</div>`,
        mount(body) {
            const armed = new Map();   // button -> reset timer id
            body.querySelectorAll('.quick-btn').forEach((b) => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Destructive actions need a second click; the first only arms.
                    if (b.dataset.confirm) {
                        if (!armed.has(b)) {
                            armed.set(b, setTimeout(() => {
                                armed.delete(b);
                                b.removeAttribute('data-armed');
                                const lbl = b.querySelector('.q-label');
                                if (lbl) lbl.textContent = b.dataset.label;
                            }, 3000));
                            b.dataset.label = b.querySelector('.q-label').textContent;
                            b.querySelector('.q-label').textContent = '再点一次确认';
                            b.setAttribute('data-armed', '1');
                            return;
                        }
                        clearTimeout(armed.get(b));
                        armed.delete(b);
                        b.removeAttribute('data-armed');
                        b.querySelector('.q-label').textContent = b.dataset.label;
                    }
                    send('quick', b.dataset.a);
                });
            });
        },
    },

    timer: {
        body: (s) => {
            const left = s.running ? Math.max(0, s.endsAt - Date.now()) : (s.remainingMs || s.durationMs);
            const total = s.durationMs || 1;
            const mm = String(Math.floor(left / 60000)).padStart(2, '0');
            const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
            const presets = [25, 45, 5];
            return `
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="big" id="v-clock" style="font-variant-numeric:tabular-nums">${mm}:${ss}</div>
            <div class="bar"><div class="bar-fill" id="v-bar" style="--p:${(1 - left / total).toFixed(3)}"></div></div>
            <div class="presets">
              ${presets.map((m) => `<button class="preset" data-min="${m}" aria-pressed="${total === m * 60000 ? 'true' : 'false'}">${m} 分钟</button>`).join('')}
            </div>
            <div class="mid dim">已完成 ${s.completed} 段</div>
          </div>`;
        },
        foot: (s) => `
          <div class="controls">
            <button class="btn btn-main" id="v-toggle" aria-label="${s.running ? '暂停' : '开始'}">${s.running ? I.pause : I.play}</button>
            <button class="btn" id="v-reset" aria-label="重置">${I.reload}</button>
          </div>`,
        mount(body, foot, s) {
            const clock = body.querySelector('#v-clock');
            const bar = body.querySelector('#v-bar');
            const completedEl = body.querySelectorAll('.mid')[0];
            const presets = Array.from(body.querySelectorAll('.preset'));
            const toggleBtn = foot.querySelector('#v-toggle');
            const resetBtn = foot.querySelector('#v-reset');

            // Mutable so the poll refresh below has fresh data.
            let live = s;

            let lastShownSec = -1;
            const paint = (st) => {
                const left = st.running ? Math.max(0, st.endsAt - Date.now()) : (st.remainingMs || st.durationMs);
                const total = st.durationMs || 1;
                // The bar moves every frame; the text and the three aria-pressed
                // writes only change once a second. Doing all of it at 60fps was
                // ~240 DOM writes a second for no visible difference.
                bar.style.setProperty('--p', String(1 - left / total));
                const sec = Math.ceil(left / 1000);
                if (sec === lastShownSec) return;
                lastShownSec = sec;
                clock.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
                if (completedEl) completedEl.textContent = `已完成 ${st.completed} 段`;
                for (const b of presets) {
                    b.setAttribute('aria-pressed', total === Number(b.dataset.min) * 60000 ? 'true' : 'false');
                }
            };
            paint(live);

            // The guard is the render generation, not body.isConnected: `body` is
            // modBody, a permanent container that innerHTML never detaches.
            const myGen = renderGeneration;
            const tick = () => {
                if (myGen !== renderGeneration) return;
                paint(live);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);

            const restartWith = (min) => {
                send('timer-duration', min * 60_000);
                send('timer-reset');
                // Start straight away so switching presets feels immediate.
                send('timer-start', min * 60_000);
            };

            presets.forEach((b) => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    restartWith(Number(b.dataset.min));
                });
            });

            const startOrResume = () => {
                // Pausing mid-session and pressing play must resume, not restart
                // the full duration — otherwise a 25min timer paused at 10min left
                // jumps back to 25:00.
                if (live.remainingMs > 0 && !live.running) send('timer-resume');
                else send('timer-start', live.durationMs);
            };

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (live.running) send('timer-pause');
                else startOrResume();
            });
            resetBtn.addEventListener('click', (e) => { e.stopPropagation(); send('timer-reset'); });

            const paintToggle = (st) => {
                toggleBtn.innerHTML = st.running ? I.pause : I.play;
                toggleBtn.setAttribute('aria-label', st.running ? '暂停' : '开始');
            };
            paintToggle(live);

            return (next) => {
                live = next;
                paint(next);
                // Swapped in place. Rebuilding the footer here is what made the
                // buttons look dead: the new nodes replaced the ones a click was
                // already travelling toward.
                paintToggle(next);
            };
        },
    },

    todo: {
        body: (s) => {
            const items = s.items || [];
            if (items.length === 0) {
                return `<div class="empty">还没有待办，下面加一条</div>`;
            }
            return `<div class="list">${items.map((t) => `
              <div class="list-item" data-done="${t.done ? 1 : 0}">
                <input class="check" type="checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="完成">
                <span class="txt ellipsis">${esc(t.text)}</span>
                <button class="icon-btn" data-del="${t.id}" aria-label="删除">${I.trash}</button>
              </div>`).join('')}</div>`;
        },
        foot: (s) => {
            const done = (s.items || []).filter((t) => t.done).length;
            return `<div class="add-row" style="width:100%">
              <input id="v-input" type="text" placeholder="加一条待办，回车确认" maxlength="80">
              <button class="btn" id="v-add" aria-label="添加">${I.plus}</button>
              ${done > 0 ? `<button class="btn" id="v-clear" aria-label="清空已完成">${I.trash}</button>` : ''}
            </div>`;
        },
        mount(body, foot) {
            const input = foot.querySelector('#v-input');
            const addBtn = foot.querySelector('#v-add');
            const add = () => {
                const text = input.value.trim();
                if (!text) return;
                send('todo-add', text);
                input.value = '';
                input.focus();
            };
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') add();
            });
            // Select-on-focus so re-focusing the field replaces the text instead of
            // dropping the caret in the middle of what is already there.
            input.addEventListener('focus', () => input.select());
            addBtn.addEventListener('click', (e) => { e.stopPropagation(); add(); });
            let clear = foot.querySelector('#v-clear');
            if (clear) clear.addEventListener('click', (e) => { e.stopPropagation(); send('todo-clear-done'); });

            /** Wire the list rows (re-attached after every in-place refresh). */
            const wireRows = () => {
                body.querySelectorAll('.check').forEach((c) => {
                    c.addEventListener('change', (e) => { e.stopPropagation(); send('todo-toggle', c.dataset.id); });
                });
                body.querySelectorAll('[data-del]').forEach((b) => {
                    b.addEventListener('click', (e) => { e.stopPropagation(); send('todo-remove', b.dataset.del); });
                });

                // Double-click a row to edit it inline; Enter commits, Esc cancels,
                // and emptying the field deletes the item.
                body.querySelectorAll('.list-item').forEach((row) => {
                    const del = row.querySelector('[data-del]');
                    if (!del) return;
                    const id = del.dataset.del;
                    const txt = row.querySelector('.txt');
                    row.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        if (row.querySelector('input.edit')) return;
                        const original = txt.textContent;
                        const edit = document.createElement('input');
                        edit.className = 'edit';
                        edit.type = 'text';
                        edit.value = original;
                        edit.maxLength = 80;
                        txt.replaceWith(edit);
                        edit.focus();
                        edit.select();
                        let done = false;
                        const commit = (save) => {
                            if (done) return;
                            done = true;
                            if (save) send('todo-edit', `${id}\u0000${edit.value}`);
                            else refresh();
                        };
                        edit.addEventListener('keydown', (ev) => {
                            ev.stopPropagation();
                            if (ev.key === 'Enter') commit(true);
                            else if (ev.key === 'Escape') commit(false);
                        });
                        edit.addEventListener('blur', () => commit(true));
                    });
                });
            };

            wireRows();

            /**
             * In-place refresh. Only the list is replaced, so the add-input keeps
             * focus and whatever the user has typed — rebuilding the whole body on
             * every poll would throw that away mid-typing.
             */
            const refresh = (s) => {
                const items = s.items || [];
                const list = body.querySelector('.list');
                const empty = body.querySelector('.empty');
                if (items.length === 0) {
                    if (list) list.remove();
                    if (empty) return;
                    body.innerHTML = '<div class="empty">还没有待办，下面加一条</div>';
                    return;
                }
                if (empty) empty.remove();
                const html = items.map((t) => `
              <div class="list-item" data-done="${t.done ? 1 : 0}">
                <input class="check" type="checkbox" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="完成">
                <span class="txt ellipsis">${esc(t.text)}</span>
                <button class="icon-btn" data-del="${esc(t.id)}" aria-label="删除">${I.trash}</button>
              </div>`).join('');
                if (list) list.innerHTML = html;
                else body.insertAdjacentHTML('beforeend', `<div class="list">${html}</div>`);
                wireRows();

                // The clear-done button only exists once something is done.
                const done = items.filter((t) => t.done).length;
                const wantClear = done > 0;
                if (wantClear && !clear) {
                    addBtn.insertAdjacentHTML('afterend',
                        `<button class="btn" id="v-clear" aria-label="清空已完成">${I.trash}</button>`);
                    clear = foot.querySelector('#v-clear');
                    clear.addEventListener('click', (e) => { e.stopPropagation(); send('todo-clear-done'); });
                } else if (!wantClear && clear) {
                    clear.remove();
                    clear = null;
                }
            };

            return refresh;
        },
    },

    clipboard: {
        body: (s) => `<div class="list">${clipRows(s.items || [])}</div>`,
        // The footer is constant on purpose: rebuilding it would throw away the
        // filter field and whatever the user typed in it.
        foot: (s) => `<div class="add-row" style="width:100%">
                 <input id="v-filter" type="text" placeholder="过滤 ${(s.items || []).length} 条记录" maxlength="40" aria-label="过滤剪贴板记录">
                 <button class="btn" id="v-clear" aria-label="清空">${I.trash}</button>
               </div>`,
        // The mount argument is the live state. Stashing it on the DOM node instead
        // meant the filter box read an empty list until the next poll landed — and
        // clipboard has interval 0, so no poll ever comes.
        mount(body, foot, s) {
            let live = s;
            const filter = foot.querySelector('#v-filter');
            if (filter) {
                filter.value = clipQuery;
                filter.addEventListener('input', () => {
                    clipQuery = filter.value;
                    clipSel = 0;
                    refresh(live);
                });
                filter.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                        clipQuery = '';
                        filter.value = '';
                        clipSel = 0;
                        refresh(live);
                    }
                });
            }
            const clear = foot.querySelector('#v-clear');
            if (clear) clear.addEventListener('click', (e) => { e.stopPropagation(); send('clip-clear'); });

            const wire = () => {
                body.querySelectorAll('.clip-row').forEach((row) => {
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const i = Number(row.dataset.i);
                        // The row is "paste it where I was"; the small icon is
                        // "just put it on the clipboard". Two different intents.
                        if (e.target.closest('[data-copy]')) {
                            send('clip-pick', String(i));
                            return;
                        }
                        clipFlash = row.querySelector('.txt').textContent;
                        send('clip-pick', `${i}:paste`);
                    });
                });
            };
            wire();

            const refresh = (next) => {
                live = next;
                const items = visibleClipItems(live.items || []);
                if (items.length === 0) {
                    body.innerHTML = clipQuery
                        ? '<div class="empty">没有匹配的记录</div>'
                        : '<div class="empty">复制点什么，这里会出现历史</div>';
                } else {
                    const empty = body.querySelector('.empty');
                    if (empty) empty.remove();
                    const html = clipRows(items, live.items || []);
                    const list = body.querySelector('.list');
                    if (list) list.innerHTML = html;
                    else body.insertAdjacentHTML('beforeend', `<div class="list">${html}</div>`);
                    wire();
                    paintClipSel(body);
                    applyClipFlash(body);
                }
            };
            return refresh;
        },
    },
};

/**
 * Card shown while a module's first poll is still outstanding. `collapsedSummary`
 * already guarded this case; the view templates did not, so the expanded card read
 * "undefined%", told a laptop it had no battery, claimed the network was down, and
 * threw in perf — all from a state that simply had not arrived yet.
 */
function pendingCard(s, label) {
    if (s && s.missing) {
        return `<div class="mid dim" style="text-align:center">${esc(label)}探针缺失<br><span style="opacity:.55">运行 npm run build:probe</span></div>`;
    }
    return `<div class="mid dim" style="text-align:center">正在读取${esc(label)}…</div>`;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ── clipboard helpers ────────────────────────────────────────────────────
// Module-level so they survive an in-place refresh AND a full remount: the filter
// text and the highlighted row must not reset just because a poll landed.
let clipQuery = '';
let clipSel = 0;
let clipFlash = null;
let clipFlashTimer = null;

function clipRows(items, all = items) {
    return items.map((t) => {
        const i = all.indexOf(t);
        return `
              <div class="list-item clip-row" data-i="${i}" role="button">
                <span class="clip-idx">${i < 9 ? i + 1 : ''}</span>
                <span class="txt ellipsis" title="${esc(t.text)}">${esc(t.text)}</span>
                <button class="icon-btn" data-copy="${i}" aria-label="仅复制" tabindex="-1">${I.shot}</button>
              </div>`;
    }).join('');
}

function visibleClipItems(items) {
    return filterClipItems(items, clipQuery);
}

function paintClipSel(body) {
    const rows = [...body.querySelectorAll('.clip-row')];
    rows.forEach((r, i) => {
        const on = i === clipSel;
        r.dataset.sel = on ? '1' : '0';
        if (on) r.scrollIntoView({ block: 'nearest' });
    });
}

/** Highlight the row that was just pasted, once, then let it fade back. */
function applyClipFlash(body) {
    if (!clipFlash) return;
    const row = [...body.querySelectorAll('.clip-row')]
        .find((r) => r.querySelector('.txt').textContent === clipFlash);
    if (!row) return;
    clipFlash = null;
    row.dataset.pasted = '1';
    clearTimeout(clipFlashTimer);
    clipFlashTimer = setTimeout(() => { delete row.dataset.pasted; }, 1200);
}

function repeatOn(mode) {
    return mode && mode !== 'None';
}

// ── settings ─────────────────────────────────────────────────────────────
function applySettings(s) {
    hoverDelayMs = s.island.hoverDelayMs;
    island.style.setProperty('--lg-blur', `${s.glass.blurPx}px`);
    island.style.setProperty('--lg-tint', String(s.glass.tint));
    island.style.setProperty('--island-opacity', String(s.glass.opacity));
    island.style.setProperty('--morph-ms', `${s.motion.morphMs}ms`);
    island.dataset.waveform = s.motion.waveform ? '1' : '0';
    island.dataset.specular = s.glass.specular ? '1' : '0';
    // The main process moves the *window* to the bottom of the screen for a
    // bottom-* position, so the glass has to sit at the bottom of that window.
    // Hard-coded `top: 32px` left it floating ~270px above the edge, and the
    // click-through hit rect (islandRect(), bottom-anchored) missed it entirely.
    island.dataset.vert = isTopAnchored(s.island.position) ? 'top' : 'bottom';
    if (refractMap) refractMap.setAttribute('scale', String(s.glass.refractScale));
}

window.island.onSettings(applySettings);

// ── hover: the main process owns click-through and tells us when the pointer is over ──
window.island.onEngage((on) => {
    island.dataset.hover = on ? '1' : '0';
    if (on) {
        if (!open && !openTimer) {
            openTimer = setTimeout(() => {
                openTimer = null;
                open = true;
                island.dataset.open = '1';
            }, hoverDelayMs);
        }
        return;
    }
    if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
    }
    // Pinned stays open after the pointer leaves; only an explicit click/Esc clears it.
    if (open && !pinned) {
        open = false;
        island.dataset.open = '0';
    }
});

function setPinned(on) {
    pinned = on;
    island.dataset.pinned = on ? '1' : '0';
    // The rim gradient only renders while pinned, so its angle has to be re-synced
    // on the transition or it comes back showing a stale direction.
    syncRim();
    // Pinning always opens: a click on the collapsed pill must not leave the card
    // collapsed-but-pinned, or the next hover would hold it open forever.
    if (on) {
        open = true;
        island.dataset.open = '1';
    } else if (open) {
        open = false;
        island.dataset.open = '0';
    }
}

// ── specular tracking ────────────────────────────────────────────────────
// Three things made this feel sticky near the edges: getBoundingClientRect() on
// every pointermove forced a synchronous layout (the island resizes while it
// morphs), the two full-size gradient layers repainted per mouse event, and
// --rim-angle was rewritten even when no rule consumed it. The rect is cached and
// invalidated on resize/enter, and the writes are coalesced into one frame.
let islandBox = null;
const measureIsland = () => { islandBox = island.getBoundingClientRect(); };
if (typeof ResizeObserver === 'function') new ResizeObserver(measureIsland).observe(island);
island.addEventListener('pointerenter', measureIsland);

let rimAngle = 135;
let lightFrame = 0;
let lightX = 0;
let lightY = 0;

/** Only called when a rule actually reads --rim-angle (pinned or on alert). */
function syncRim() {
    island.style.setProperty('--rim-angle', `${rimAngle.toFixed(1)}deg`);
}

island.addEventListener('pointermove', (e) => {
    if (!islandBox) measureIsland();
    lightX = e.clientX - islandBox.left;
    lightY = e.clientY - islandBox.top;
    if (lightFrame) return;
    lightFrame = requestAnimationFrame(() => {
        lightFrame = 0;
        island.style.setProperty('--mouse-x', `${lightX}px`);
        island.style.setProperty('--mouse-y', `${lightY}px`);
        // The rim gradient only exists while pinned or on alert. Repainting it on
        // every mouse move the rest of the time is pure waste.
        if (island.dataset.pinned !== '1' && island.dataset.alert !== '1') return;
        // 2° steps: the caustic is far too fine for the difference to be visible.
        const deg = (Math.atan2(lightY - islandBox.height / 2, lightX - islandBox.width / 2) * 180) / Math.PI + 180;
        const q = Math.round(deg / 2) * 2;
        if (q !== rimAngle) {
            rimAngle = q;
            syncRim();
        }
    });
});

// ── render ───────────────────────────────────────────────────────────────
let enabledIds = MODULES.map((m) => m.id);

// Each mount may return a function that refreshes its own DOM in place. Keeping
// the last one per module lets a poll update the visible module without rebuilding
// it — rebuilding is what froze the track title and threw away drags.
const updaters = new Map();

// Bumped on every renderModule. A mount captures the value it started with and its
// rAF loop bails once it differs, i.e. once a newer render superseded it. Testing
// body.isConnected does NOT work here: `body` is modBody itself, a permanent
// container that innerHTML replacement never detaches.
let renderGeneration = 0;

/** Enabled modules in rail order — the rail, Ctrl+1..9 and Ctrl+arrows must agree. */
const railIds = () => MODULES.filter((m) => enabledIds.includes(m.id)).map((m) => m.id);

let lastRailId = null;

function renderDots(active) {
    modDots.textContent = '';
    for (const mod of MODULES) {
        if (!enabledIds.includes(mod.id)) continue;
        const b = document.createElement('button');
        b.className = 'mod-dot';
        b.type = 'button';
        b.dataset.id = mod.id;
        // Bare 6px dots carried no information at all — you could not tell which
        // module a dot meant without expanding and reading the header.
        b.innerHTML = MODULE_ICON[mod.id] || '';
        b.title = mod.label;
        b.setAttribute('aria-label', mod.label);
        b.setAttribute('aria-current', mod.id === active ? 'true' : 'false');
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            send('select-module', mod.id);
        });
        modDots.append(b);
    }
}

function renderModule(id, s) {
    const view = VIEWS[id];
    island.dataset.module = id;
    renderGeneration += 1;
    modIcon.innerHTML = MODULE_ICON[id] || '';
    const mod = MODULES.find((m) => m.id === id);
    modName.textContent = mod ? mod.label : id;

    if (!view) {
        modBody.innerHTML = '<div class="empty">模块未实现</div>';
        modFoot.innerHTML = '';
        return;
    }

    // Direction of travel, so walking the rail reads as moving along it rather
    // than the card resetting every time.
    const from = lastRailId ? railIds().indexOf(lastRailId) : -1;
    const to = railIds().indexOf(id);
    lastRailId = id;
    const dir = from >= 0 && to >= 0 && from !== to ? (to > from ? 'right' : 'left') : null;

    // body()/foot() must sit inside the try as well: a throwing view would
    // otherwise leave the previous module's DOM on screen while dataset.module
    // already claims the new one, which reads as "the switcher is broken".
    try {
        modBody.innerHTML = view.body(s);
        modFoot.innerHTML = view.foot(s);
        const upd = view.mount(modBody, modFoot, s);
        updaters.set(id, typeof upd === 'function' ? upd : null);
    } catch (e) {
        // One broken module must not take the whole island down with it.
        console.error(`module ${id} failed to mount:`, e);
        modBody.innerHTML = `<div class="empty">${esc(id)} 模块出错了</div>`;
        modFoot.innerHTML = '';
        updaters.set(id, null);
    }
    // Restart the swap so every module change reads as a transition, and carry the
    // direction of travel so walking the rail feels like moving along it.
    modBody.classList.remove('swap-in', 'swap-from-left', 'swap-from-right');
    void modBody.offsetWidth;
    modBody.classList.add('swap-in');
    if (dir) modBody.classList.add(`swap-from-${dir}`);
    modName.classList.remove('name-swap');
    modFoot.classList.remove('foot-swap');
    void modName.offsetWidth;
    modName.classList.add('name-swap');
    modFoot.classList.add('foot-swap');
    renderDots(id);
}

window.island.onState((next) => {
    const prevActive = state ? state.active : null;
    state = next;
    enabledIds = next.enabled || enabledIds;

    const active = next.active;
    const media = next.modules.media;
    // Trust the probe again once it has had a poll interval to land. Without the
    // window, a push from the volume or perf timer (2s) reverted the icon the user
    // had just flipped, which read as the switch doing nothing.
    if (performance.now() - optimisticModeAt > 2000 || media.mode === island.dataset.mode) {
        island.dataset.mode = media.mode;
    }
    island.dataset.notimeline = media.progress == null ? '1' : '0';

    // Collapsed pill: the active module's one-line summary.
    const summary = collapsedSummary(active, next.modules[active] || {});
    srcEl.textContent = summary.text;
    if (active === 'media' && media.art) artSm.src = media.art;

    if (active !== prevActive || !modBody.innerHTML) {
        renderModule(active, next.modules[active] || {});
    } else {
        // Same module: refresh it in place instead of rebuilding the DOM, or the
        // track title would freeze and any drag would be thrown away.
        const upd = updaters.get(active);
        if (upd) upd(next.modules[active] || {});
    }
    // The alert rim is amber, so its angle needs the same re-sync on the transition.
    if (island.dataset.alert !== String(next.alert != null ? '1' : '0')) {
        island.dataset.alert = next.alert != null ? '1' : '0';
        syncRim();
    }
});

// ── clock (idle pill) ────────────────────────────────────────────────────
function tickClock() {
    const d = new Date();
    clockEl.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
setInterval(tickClock, 1000);
tickClock();

// Clicking the glass (outside any control) pins the card open so it survives the
// pointer leaving; clicking again or pressing Esc releases it. When media is the
// active module the same click toggles playback instead.
// The selector must cover every interactive thing inside the body, or a click on a
// checkbox / slider / list row would bubble up here and pin the card.
const INTERACTIVE = 'button, input, select, textarea, a, [role="slider"], .list-item, .track, .slider';

// Any interaction inside the island marks the module on screen as the one in use.
// Capture phase so it fires before a handler stops propagation. Without this,
// pausing the music let the priority engine fall through to the default module and
// teleported the user to the volume card on the very next poll.
island.addEventListener('pointerdown', () => send('touch'), true);

island.addEventListener('click', (e) => {
    if (e.target.closest(INTERACTIVE)) return;
    // A pinned card releases on the next click. This has to come first: with the
    // media branch ahead of it, pinning while music was the active module made
    // setPinned(!pinned) unreachable, and only Escape could get you out.
    if (pinned) {
        setPinned(false);
        return;
    }
    if (state && state.active === 'media') {
        send('toggle');
        return;
    }
    setPinned(true);
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // While typing, Escape should leave the field first, not unpin the island.
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.blur();
        return;
    }
    if (pinned) setPinned(false);
});

// ── module keyboard ──────────────────────────────────────────────────────
// One document-level handler for the whole island. A per-module mount() must not
// add its own: modBody is a permanent container, so a listener attached in mount()
// would outlive the module it was written for and fire for its replacement.
document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    // Arrows and Enter belong to whatever control has focus.
    if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
    if (!state) return;

    if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const rail = railIds();
        let target = null;
        if (e.key >= '1' && e.key <= '9') target = rail[Number(e.key) - 1] || null;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const i = rail.indexOf(state.active);
            if (i >= 0) target = rail[(i + (e.key === 'ArrowRight' ? 1 : -1) + rail.length) % rail.length];
        }
        if (target && target !== state.active) {
            e.preventDefault();
            send('select-module', target);
        }
        return;
    }

    if (state.active !== 'clipboard') return;
    const rows = [...modBody.querySelectorAll('.clip-row')];
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        clipSel = (clipSel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        paintClipSel(modBody);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (rows[clipSel]) rows[clipSel].click();
    }
});

// ── paste round-trip ─────────────────────────────────────────────────────
window.island.onCollapse(() => {
    // A successful paste hands focus back to the user's app; the card must not
    // sit there expanded on top of the thing they just pasted into.
    pinned = false;
    open = false;
    island.dataset.open = '0';
});

window.island.onPasteResult((r) => {
    // The success path already collapsed. The degraded path says so through the OS
    // notification rather than an in-card bar: the bar sat on top of the footer
    // controls and inside a stage that scales while morphing, so it never looked
    // centred anyway.
    if (r && r.ok) return;
    send('notify', { title: '已复制', body: '按 Ctrl+V 粘贴到刚才的窗口' });
});
