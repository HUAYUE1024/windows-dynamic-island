// Drives the running island window over the Chrome DevTools Protocol, so renderer
// behaviour is checked in the real app instead of guessed at from screenshots.
//   node scripts/cdp.mjs eval "<expression>"
//   node scripts/cdp.mjs file script.js
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.CDP_PORT || 9222);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findIslandTarget() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    // CDP_TARGET picks a window: "island" (default) or "settings". Both are ordinary
    // pages, so matching on the URL is the only way to tell them apart.
    const want = process.env.CDP_TARGET === 'settings' ? 'settings/index.html' : 'renderer/index.html';
    const page = list.find((t) => t.type === 'page' && t.url.includes(want));
    if (!page) throw new Error(`no ${want} page (saw: ${list.map((t) => t.url).join(', ')})`);
    return page.webSocketDebuggerUrl;
}

async function connect() {
    const ws = new WebSocket(await findIslandTarget());
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('cannot reach the island; is it running with --remote-debugging-port?')), { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        waiter(msg);
    });
    return (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });
}

const cdp = await connect();
// Everything after the mode, re-joined: the drag mode takes several arguments.
const [mode, ...rest] = process.argv.slice(2);
const payload = rest.join(' ');

let expression;
if (mode === 'eval') expression = payload;
else if (mode === 'file') expression = `(async () => {\n${await readFile(payload, 'utf8')}\n})()`;
else if (!['drag', 'shot'].includes(mode)) throw new Error('usage: cdp.mjs eval "<expr>" | cdp.mjs file script.js | cdp.mjs drag <x1> <y> <x2> <steps> [selector] | cdp.mjs shot <out.png>');

// Real input. A synthetic PointerEvent skips hit-testing and pointer capture,
// which is exactly the machinery a drag bug lives in, so the drag is driven the way
// a mouse drives it and the knob is sampled between every step.
//   cdp.mjs drag <x1> <y> <x2> <steps> [selector]
if (mode === 'drag') {
    const [x1, y, x2, steps, selector = '.slider-knob'] = payload.split(' ');
    const ax1 = Number(x1), ay = Number(y), ax2 = Number(x2), n = Number(steps) || 8;
    const mouse = async (type, x, yy, button, buttons) => {
        const params = { type, x, y: yy, button, buttons };
        // clickCount is only meaningful for press/release; sending it with a move
        // makes CDP reject the whole call.
        if (type !== 'mouseMoved') params.clickCount = 1;
        try {
            await cdp('Input.dispatchMouseEvent', params);
        } catch (e) {
            throw new Error(`${e.message} -- params were ${JSON.stringify(params)}`);
        }
    };
    const read = () => cdp('Runtime.evaluate', {
        expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return 'absent';
            const cs = getComputedStyle(el);
            const rail = el.closest('.slider-rail, .track');
            const rr = rail ? rail.getBoundingClientRect() : null;
            const left = parseFloat(cs.left);
            return JSON.stringify({
                left: cs.left,
                frac: rr && rr.width ? Math.round((left / rr.width) * 1000) / 1000 : null,
                label: (document.getElementById('v-level') || {}).textContent
                    || (document.getElementById('v-pos') || {}).textContent || null,
            });
        })()`,
        returnByValue: true,
    });

    // The module and card state drift between invocations (the media takeover
    // re-picks the active module), so pin them down before driving the mouse.
    // Async, and it waits for the push to land: reading dataset.module straight after
    // the IPC call sees the previous module, and clicking the glass while media is
    // active sends 'toggle' instead of pinning.
    const setup = await cdp('Runtime.evaluate', {
        expression: `(async () => {
            const isl = document.getElementById('island');
            window.island.command('select-module', 'volume');
            await new Promise(r => setTimeout(r, 400));
            for (let i = 0; i < 4 && isl.dataset.open !== '1'; i++) {
                isl.click();
                await new Promise(r => setTimeout(r, 300));
            }
            const el = document.querySelector(${JSON.stringify(selector)});
            const rail = el && el.closest('.slider-rail, .track');
            const rr = rail ? rail.getBoundingClientRect() : null;
            return JSON.stringify({ module: isl.dataset.module, open: isl.dataset.open,
                found: !!el, rail: rr && { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width) } });
        })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    const setupInfo = JSON.parse(setup.result.value);
    if (!setupInfo.found) {
        console.log(JSON.stringify({ error: 'control not found', setupInfo }));
        process.exit(1);
    }

    const samples = [];
    await mouse('mousePressed', ax1, ay, 'left', 1);
    for (let i = 1; i <= n; i++) {
        const x = ax1 + ((ax2 - ax1) * i) / n;
        await mouse('mouseMoved', x, ay, 'none', 1);
        const r = await read();
        const raw = r.result.value;
        samples.push({ x: Math.round(x), ...(typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : { raw }) });
    }
    await mouse('mouseReleased', ax2, ay, 'left', 0);
    const after = await read();
    console.log(JSON.stringify({ setupInfo, samples, afterRelease: JSON.parse(after.result.value) }, null, 1));
    process.exit(0);
}

// Screenshot the target window. Design work cannot be verified from the DOM alone.
if (mode === 'shot') {
    const file = payload || 'shot.png';
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`wrote ${file}`);
    process.exit(0);
}

const { result, exceptionDetails } = await Promise.race([
    cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    // A page that never settles must not wedge the driver.
    wait(20000).then(() => ({ timedOut: true })),
]);
if (result?.timedOut) {
    console.error('page did not answer within 20s');
    process.exit(1);
}
if (exceptionDetails) {
    console.error('page threw:', exceptionDetails.exception?.description || exceptionDetails.text);
    process.exit(1);
}
// A missing result means the reply carried neither result nor error — print it raw
// rather than crashing on `.value`, which hides what actually happened.
if (!result) {
    console.error('no result in reply');
    process.exit(1);
}
console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2));
