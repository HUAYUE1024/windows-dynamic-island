// End-to-end check of the clipboard round trip, driven over CDP against the real
// app: host clipboard -> island poll -> row click -> clipboard written back + card
// collapses. Kept as one runnable check per ponytail's rule.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = () => [...document.querySelectorAll('.clip-row')];
const out = {};

// 1. Open the card. A programmatic click on the glass takes the pin path, which is
//    the same handler a real click takes (no cursor movement needed).
document.getElementById('island').click();
out.openAfterPin = document.getElementById('island').dataset.open;

// 2. Switch to the clipboard module through the real IPC channel.
window.island.command('select-module', 'clipboard');
await wait(400);
out.module = document.getElementById('island').dataset.module;
out.railHasIcons = [...document.querySelectorAll('.mod-dot')].every((d) => d.querySelector('svg'));
out.railCount = document.querySelectorAll('.mod-dot').length;

out.rowCount = rows().length;
out.idxBadges = rows().map((r) => r.querySelector('.clip-idx').textContent);
out.firstText = rows()[0]?.querySelector('.txt').textContent;
out.cursorOnRow = getComputedStyle(rows()[0] || document.body).cursor;

// 3. Filter. Typing goes through the real input event the mount listens for. The
// query is derived from the data so the check does not depend on what was seeded.
const filter = document.getElementById('v-filter');
if (filter) {
    const probe = rows()[1]?.querySelector('.txt').textContent ?? '';
    out.filterProbe = probe;
    filter.value = probe.slice(0, 4).toUpperCase();
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(60);
    out.filteredRows = rows().length;
    out.filterHit = rows()[0]?.querySelector('.txt').textContent;
    filter.value = 'zzzz-no-such-entry';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(60);
    out.noMatchShowsEmpty = !!document.querySelector('.empty');
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(60);
    out.unfilteredRows = rows().length;
} else {
    out.filter = 'absent';
}

// 4. Keyboard: arrows move the selection, Enter activates the selected row.
document.body.focus();
const before = rows().findIndex((r) => r.dataset.sel === '1');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
await wait(40);
const after = rows().findIndex((r) => r.dataset.sel === '1');
out.selMoved = after === before + 1;
out.selBefore = before;
out.selAfter = after;

// 5. The paste round trip: click the row, then read the host clipboard back.
const target = rows()[after] || rows()[0];
out.targetText = target?.querySelector('.txt').textContent ?? null;
if (target) {
    target.click();
    // Give the main process time to write the clipboard, run the paste helper and
    // send the collapse back. The host clipboard is read from the shell instead:
    // navigator.clipboard is denied in a document that does not have focus.
    await wait(1200);
    out.collapsedAfterPaste = document.getElementById('island').dataset.open;
    // The degraded path used to raise an in-card bar that sat over the footer
    // controls; it now goes through an OS notification, so nothing may linger.
    out.noInCardBar = !document.getElementById('toast');
}

return JSON.stringify(out);
