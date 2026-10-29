// Sandboxed preload for the settings window (CommonJS, like preload.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (next) => ipcRenderer.invoke('settings:save', next),
    // Fire-and-forget: the settings window flushes a pending debounced save on
    // unload, and invoke() is async — the context can be torn down before it
    // resolves. send() is queued synchronously.
    saveNow: (next) => ipcRenderer.send('settings:save-now', next),
    reset: () => ipcRenderer.invoke('settings:reset'),
    onChange: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
    // Which accelerators actually registered. globalShortcut.register() reports a
    // taken accelerator by returning false, never by throwing, so without this the
    // settings window would claim a binding that silently does nothing.
    onShortcuts: (cb) => ipcRenderer.on('shortcuts', (_e, b) => cb(b)),
});
