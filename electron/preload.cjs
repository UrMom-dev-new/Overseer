const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('overseerDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
});
