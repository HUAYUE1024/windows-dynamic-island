// Sandboxed preload scripts must be CommonJS, so this file is .cjs even though the
// rest of the app is ESM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
    onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
    onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
    onEngage: (cb) => ipcRenderer.on('engage', (_e, on) => cb(on)),
    onPasteResult: (cb) => ipcRenderer.on('paste-result', (_e, r) => cb(r)),
    onCollapse: (cb) => ipcRenderer.on('collapse', () => cb()),
    command: (name, arg) => ipcRenderer.send('command', name, arg),
});
