const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  play: (settings) => ipcRenderer.invoke('play', settings),
  getAuthState: () => ipcRenderer.invoke('auth:get-state'),
  registerRequest: (email, password) => ipcRenderer.invoke('auth:register-request', { email, password }),
  registerVerify: (email, code) => ipcRenderer.invoke('auth:register-verify', { email, code }),
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  passwordRequest: (email) => ipcRenderer.invoke('auth:password-request', { email }),
  passwordReset: (email, code, password) => ipcRenderer.invoke('auth:password-reset', { email, code, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
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
