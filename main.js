const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
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

ipcMain.handle('get-config', () => ({
  ...config,
  appVersion: app.getVersion()
}));

ipcMain.handle('play', async (_event, nick) => {
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
  fs.mkdirSync(dir, { recursive: true });
  playInProgress = true;
  sendProgress(0);

  try {
    sendStatus('Проверяем игровые файлы', 'working', true);
    await syncMods(config, dir, io);
    sendStatus('Запускаем Minecraft', 'launching', true);
    await launchGame(config, dir, cleanNick, io);
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

ipcMain.handle('copy-server', () => {
  clipboard.writeText(`${config.server.host}:${config.server.port}`);
  return true;
});
