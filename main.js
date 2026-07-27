const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const { syncMods } = require('./lib/updater');
const { launchGame } = require('./lib/launch');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

let win = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

/** Каталог данных лаунчера (инстанс Minecraft) — кроссплатформенно (Win: %APPDATA%, Mac: ~/Library/Application Support). */
function dataDir() {
  return path.join(app.getPath('appData'), 'Code5Launcher');
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#140c06',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.once('did-finish-load', checkLauncherUpdates);
}

function checkLauncherUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => send('log', 'Проверка обновлений лаунчера...'));
  autoUpdater.on('update-available', (info) => {
    send('log', `Доступна версия лаунчера ${info.version}. Загрузка...`);
  });
  autoUpdater.on('download-progress', (progress) => {
    send('log', `Обновление лаунчера: ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    send('log', `Версия ${info.version} загружена и установится после закрытия лаунчера.`);
  });
  autoUpdater.on('error', (error) => {
    send('log', `Не удалось проверить обновление лаунчера: ${error.message}`);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    send('log', `Не удалось проверить обновление лаунчера: ${error.message}`);
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

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const io = {
  log: (m) => send('log', String(m)),
  progress: (p) => send('progress', p)
};

// Отдаём конфиг рендереру (адрес сервера, версии — для отображения).
ipcMain.handle('get-config', () => config);

// Кнопка «Играть»: сначала синк модов, затем запуск Minecraft с автозаходом.
ipcMain.handle('play', async (_e, nick) => {
  const cleanNick = String(nick || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanNick)) {
    return { ok: false, error: 'Ник: 3–16 символов, латиница/цифры/подчёркивание.' };
  }
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    io.log('Проверка обновлений…');
    await syncMods(config, dir, io);
    io.log('Запуск Minecraft…');
    await launchGame(config, dir, cleanNick, io);
    return { ok: true };
  } catch (err) {
    io.log('Ошибка: ' + (err && err.message ? err.message : String(err)));
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
