// Assembles a portable Electron package using the electron binary already in
// node_modules — no electron-builder, no installer toolchain, no download.
// Produces dist/liquid-island/ with liquid-island.exe next to resources/app.
//
//   npm run dist
//
// The app has no runtime npm dependencies (its only import is electron itself),
// so resources/app needs just package.json, src/ and bin/ — the three .NET
// probes are build artefacts that `npm run build:probe` regenerates.
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'node_modules', 'electron', 'dist');
if (!existsSync(join(dist, 'electron.exe'))) {
    console.error(`electron.exe not found under ${dist} — run npm install first`);
    process.exit(1);
}

const out = join(root, 'dist', 'liquid-island');
const appDir = join(out, 'resources', 'app');
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(appDir, { recursive: true });

// The runtime itself, minus the parts only a dev checkout needs.
for (const entry of await (await import('node:fs/promises')).readdir(dist)) {
    if (entry === 'resources') continue;
    await cp(join(dist, entry), join(out, entry), { recursive: true });
}

await cp(join(root, 'src'), join(appDir, 'src'), { recursive: true });
await cp(join(root, 'bin'), join(appDir, 'bin'), { recursive: true });
await cp(join(root, 'package.json'), join(appDir, 'package.json'));

// The published copy must not claim to be a private workspace package, and its
// scripts point at paths that only exist in the repo.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
pkg.private = false;
pkg.scripts = {};
await writeFile(join(appDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Electron locates its app next to the executable, so the name is free to change.
await cp(join(out, 'electron.exe'), join(out, 'liquid-island.exe'));
await rm(join(out, 'electron.exe'));

console.log(`packaged ${out}`);
console.log(`run it: "${join(out, 'liquid-island.exe')}"`);
