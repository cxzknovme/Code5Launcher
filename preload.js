const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  play: (nick) => ipcRenderer.invoke('play', nick),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),
  copyServer: () => ipcRenderer.invoke('copy-server'),
  onStatus: (callback) => ipcRenderer.on('status', (_event, payload) => callback(payload)),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('launcher-error', (_event, message) => callback(message))
});
