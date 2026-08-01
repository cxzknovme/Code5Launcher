const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const { syncMods } = require('./lib/updater');
const { launchGame } = require('./lib/launch');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

let win = null;
let updateCheckStarted = false;
let launcherUpdating = false;
let playInProgress = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

function dataDir() {
  return path.join(app.getPath('appData'), 'Code5Launcher');
}

function skinDir() {
  return path.join(dataDir(), 'code5');
}

function resetToDefaultSkin() {
  const dir = skinDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'assets', 'default-skin.png'), path.join(dir, 'skin.png'));
  fs.writeFileSync(path.join(dir, 'skin_model.txt'), 'default', 'utf8');
  fs.writeFileSync(path.join(dir, 'skin_name.txt'), 'Hermit', 'utf8');
  fs.writeFileSync(path.join(dir, 'skin_source.txt'), 'default', 'utf8');
}

function ensureDefaultSkin() {
  const dir = skinDir();
  const selectedPath = path.join(dir, 'skin.png');
  const sourcePath = path.join(dir, 'skin_source.txt');

  if (!fs.existsSync(selectedPath)) {
    resetToDefaultSkin();
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, 'custom', 'utf8');
  if (!fs.existsSync(path.join(dir, 'skin_name.txt'))) {
    fs.writeFileSync(path.join(dir, 'skin_name.txt'), 'skin.png', 'utf8');
  }
  if (!fs.existsSync(path.join(dir, 'skin_model.txt'))) {
    fs.writeFileSync(path.join(dir, 'skin_model.txt'), 'default', 'utf8');
  }
}

function skinModel() {
  const modelPath = path.join(skinDir(), 'skin_model.txt');
  if (!fs.existsSync(modelPath)) return 'default';
  return fs.readFileSync(modelPath, 'utf8').trim().toLowerCase() === 'slim' ? 'slim' : 'default';
}

function currentSkin() {
  ensureDefaultSkin();
  const selectedPath = path.join(skinDir(), 'skin.png');
  const namePath = path.join(skinDir(), 'skin_name.txt');
  const sourcePath = path.join(skinDir(), 'skin_source.txt');
  const isDefault = fs.readFileSync(sourcePath, 'utf8').trim() !== 'custom';

  return {
    selected: true,
    isDefault,
    model: skinModel(),
    fileName: fs.existsSync(namePath) ? fs.readFileSync(namePath, 'utf8').trim() : 'Hermit',
    dataUrl: `data:image/png;base64,${fs.readFileSync(selectedPath).toString('base64')}`
  };
}

function validateSkin(sourcePath) {
  const stat = fs.statSync(sourcePath);
  if (stat.size === 0 || stat.size > 512 * 1024) {
    throw new Error('Скин должен быть PNG-файлом размером не более 512 КБ.');
  }

  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('Не удалось прочитать PNG-файл скина.');

  const { width, height } = image.getSize();
  const validShape = width === height || width === height * 2;
  if (!validShape || width < 64 || height < 32) {
    throw new Error('Поддерживаются квадратные HD-скины и классические PNG 64x32.');
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendStatus(message, state = 'idle', locked = false) {
  send('status', { message, state, locked });
}

function sendProgress(value) {
  send('progress', Math.max(0, Math.min(100, Number(value) || 0)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 1100,
    minHeight: 680,
    maxWidth: 1100,
    maxHeight: 680,
    resizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#090a0d',
    icon: path.join(__dirname, 'assets', 'code5-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', checkLauncherUpdates);
}

function checkLauncherUpdates() {
  if (!app.isPackaged || updateCheckStarted) {
    if (!app.isPackaged) {
      sendProgress(100);
      sendStatus('Готов к игре');
    }
    return;
  }

  updateCheckStarted = true;
  sendStatus('Проверяем обновление лаунчера', 'checking', true);
  sendProgress(8);

  autoUpdater.on('update-available', (info) => {
    launcherUpdating = true;
    sendStatus(`Загружаем лаунчер ${info.version}`, 'updating', true);
    sendProgress(0);
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus(`Загружаем лаунчер ${Math.round(progress.percent)}%`, 'updating', true);
    sendProgress(progress.percent);
  });

  autoUpdater.on('update-not-available', () => {
    launcherUpdating = false;
    sendProgress(100);
    sendStatus('Готов к игре');
  });

  autoUpdater.on('update-downloaded', (info) => {
    launcherUpdating = true;
    sendProgress(100);
    sendStatus(`Устанавливаем версию ${info.version}`, 'restarting', true);
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 1200);
  });

  autoUpdater.on('error', (error) => {
    launcherUpdating = false;
    sendProgress(100);
    sendStatus('Готов к игре');
    send('launcher-error', `Обновление лаунчера недоступно: ${error.message}`);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    launcherUpdating = false;
    sendProgress(100);
    sendStatus('Готов к игре');
    send('launcher-error', `Обновление лаунчера недоступно: ${error.message}`);
  });
}

app.whenReady().then(() => {
  ensureDefaultSkin();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const io = {
  log: (message) => sendStatus(String(message), 'working', true),
  progress: sendProgress
};

ipcMain.handle('play', async (_event, nick, requestedSettings = {}) => {
  if (launcherUpdating) {
    return { ok: false, error: 'Дождитесь установки обновления лаунчера.' };
  }
  if (playInProgress) {
    return { ok: false, error: 'Игра уже запускается.' };
  }

  const cleanNick = String(nick || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanNick)) {
    return { ok: false, error: 'Ник: 3–16 символов, латиница, цифры или подчёркивание.' };
  }

  const dir = dataDir();
  const requestedMemory = Number(requestedSettings.memoryGb);
  const memoryGb = Number.isInteger(requestedMemory)
    ? Math.max(2, Math.min(12, requestedMemory))
    : 3;
  const launchConfig = {
    ...config,
    memory: { min: '1G', max: `${memoryGb}G` }
  };
  fs.mkdirSync(dir, { recursive: true });
  ensureDefaultSkin();
  playInProgress = true;
  sendProgress(0);

  try {
    sendStatus('Проверяем игровые файлы', 'working', true);
    await syncMods(config, dir, io);
    sendStatus('Запускаем Minecraft', 'launching', true);
    await launchGame(launchConfig, dir, cleanNick, io);
    sendProgress(100);
    sendStatus('Готов к игре');
    return { ok: true };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    sendProgress(0);
    sendStatus('Не удалось запустить игру', 'error');
    send('launcher-error', message);
    return { ok: false, error: message };
  } finally {
    playInProgress = false;
  }
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('open-game-dir', async () => {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('skin:get', () => currentSkin());

ipcMain.handle('skin:choose', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner, {
    title: 'Выберите скин Minecraft',
    properties: ['openFile'],
    filters: [{ name: 'Minecraft skin', extensions: ['png'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return currentSkin();

  const sourcePath = result.filePaths[0];
  validateSkin(sourcePath);
  fs.mkdirSync(skinDir(), { recursive: true });

  const destination = path.join(skinDir(), 'skin.png');
  if (path.resolve(sourcePath) !== path.resolve(destination)) {
    fs.copyFileSync(sourcePath, destination);
  }
  fs.writeFileSync(path.join(skinDir(), 'skin_name.txt'), path.basename(sourcePath), 'utf8');
  fs.writeFileSync(path.join(skinDir(), 'skin_source.txt'), 'custom', 'utf8');
  return currentSkin();
});

ipcMain.handle('skin:set-model', (_event, requestedModel) => {
  const model = requestedModel === 'slim' ? 'slim' : 'default';
  fs.mkdirSync(skinDir(), { recursive: true });
  fs.writeFileSync(path.join(skinDir(), 'skin_model.txt'), model, 'utf8');
  return currentSkin();
});

ipcMain.handle('skin:reset', () => {
  resetToDefaultSkin();
  return currentSkin();
});
