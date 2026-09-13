const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overseerDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
  onStartupStatus: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('overseer:startup-status', listener);
    return () => ipcRenderer.removeListener('overseer:startup-status', listener);
  },
  retryStartup: () => ipcRenderer.invoke('overseer:retry-startup'),
  openLogs: () => ipcRenderer.invoke('overseer:open-logs'),
  copyDiagnostics: () => ipcRenderer.invoke('overseer:copy-diagnostics'),
});
