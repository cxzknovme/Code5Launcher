const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  play: (nick, settings) => ipcRenderer.invoke('play', nick, settings),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),
  getSkin: () => ipcRenderer.invoke('skin:get'),
  chooseSkin: () => ipcRenderer.invoke('skin:choose'),
  setSkinModel: (model) => ipcRenderer.invoke('skin:set-model', model),
  resetSkin: () => ipcRenderer.invoke('skin:reset'),
  onStatus: (callback) => ipcRenderer.on('status', (_event, payload) => callback(payload)),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('launcher-error', (_event, message) => callback(message))
});
