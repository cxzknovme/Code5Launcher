const { contextBridge, ipcRenderer } = require('electron');

// Безопасный мост: рендерер (UI) не имеет прямого доступа к Node, только эти методы.
contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  play: (nick) => ipcRenderer.invoke('play', nick),
  onLog: (cb) => ipcRenderer.on('log', (_e, m) => cb(m)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p))
});
