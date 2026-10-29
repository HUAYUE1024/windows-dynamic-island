// Compiles src/Probe.cs and src/SysProbe.cs into bin/ using the .NET Framework csc
// that ships with Windows plus the Windows SDK's winmd. No MSBuild, no NuGet, no VS.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const fx = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';
const winrtShim = join(fx, 'System.Runtime.WindowsRuntime.dll');
const unionBase = 'C:\\Program Files (x86)\\Windows Kits\\10\\UnionMetadata';

if (!existsSync(csc)) throw new Error('csc.exe not found (needs .NET Framework 4.x)');

const refs = [
    winrtShim,
    join(fx, 'System.Runtime.dll'),
    join(fx, 'System.Threading.Tasks.dll'),
];

// SysProbe uses System.Management for the WMI brightness call.
for (const optional of [join(fx, 'System.Management.dll')]) {
    if (existsSync(optional)) refs.push(optional);
}

const versions = readdirSync(unionBase)
    .filter((d) => /^\d+(\.\d+)+$/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (versions.length === 0) throw new Error(`no Windows SDK UnionMetadata under ${unionBase}`);
const winmd = join(unionBase, versions[versions.length - 1], 'Windows.winmd');
if (!existsSync(winmd)) throw new Error(`winmd not found at ${winmd}`);
refs.push(winmd);

const out = join(root, 'bin');
mkdirSync(out, { recursive: true });

for (const [src, exe] of [['Probe.cs', 'probe.exe'], ['SysProbe.cs', 'sysprobe.exe'], ['Paste.cs', 'paste.exe']]) {
    execFileSync(csc, [
        '-nologo', '-optimize+', '-target:exe', '-utf8output',
        `-out:${join(out, exe)}`,
        ...refs.map((r) => `-reference:${r}`),
        join(root, 'src', src),
    ], { stdio: 'inherit' });
    console.log(`built ${exe}`);
}

// The app refuses to start without both binaries; say so loudly rather than
// failing later with a confusing "probe missing".
for (const exe of ['probe.exe', 'sysprobe.exe', 'paste.exe']) {
    if (!existsSync(join(out, exe))) throw new Error(`${exe} was not produced`);
}
writeFileSync(join(out, '.built'), `${new Date().toISOString()}\n`);
console.log(`winmd: ${winmd}`);
