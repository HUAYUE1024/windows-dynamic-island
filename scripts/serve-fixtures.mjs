// Serves test/fixtures so the app's Browser pane can host the media fixture.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test', 'fixtures');
const port = Number(process.argv[2] || 5178);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.wav': 'audio/wav',
    '.png': 'image/png',
};

createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/player.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(port, '127.0.0.1', () => console.log(`fixture server on http://127.0.0.1:${port}`));
