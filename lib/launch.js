const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');

/** Offline-UUID из ника (как у сервера в offline-mode): UUIDv3 от "OfflinePlayer:<name>". */
function offlineUUID(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30; // версия 3
  h[8] = (h[8] & 0x3f) | 0x80; // вариант
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'Code5Launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error('HTTP ' + res.statusCode + ' → ' + url));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (e) => {
        file.close();
        reject(e);
      });
  });
}

/** Скачиваем NeoForge-инсталлятор из Maven (один раз) — MCLC сам его развернёт. */
async function ensureNeoForgeInstaller(config, dir) {
  const name = `neoforge-${config.neoforgeVersion}-installer.jar`;
  const dest = path.join(dir, name);
  if (!fs.existsSync(dest)) {
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${config.neoforgeVersion}/${name}`;
    await download(url, dest);
  }
  return dest;
}

/** Запуск Minecraft: offline-аккаунт по нику + NeoForge + автозаход на сервер. */
async function launchGame(config, dir, nick, io) {
  const forgeInstaller = await ensureNeoForgeInstaller(config, dir);

  const client = new Client();
  const opts = {
    authorization: {
      access_token: '0',
      client_token: crypto.randomUUID(),
      uuid: offlineUUID(nick),
      name: nick,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false }
    },
    root: dir,
    version: { number: config.mcVersion, type: 'release' },
    // NeoForge: MCLC 3.18+ разворачивает инсталлятор (как Forge).
    forge: forgeInstaller,
    memory: { max: config.memory.max, min: config.memory.min },
    // Автозаход на сервер (MC 1.20+): --quickPlayMultiplayer host:port.
    quickPlay: {
      type: 'multiplayer',
      identifier: `${config.server.host}:${config.server.port}`
    },
    overrides: { detached: false }
  };

  client.on('debug', (m) => io.log(String(m)));
  client.on('data', (m) => io.log(String(m)));
  client.on('progress', (e) => {
    if (e && e.total) io.progress(Math.round((e.task / e.total) * 100));
  });

  return new Promise((resolve, reject) => {
    client.on('close', () => resolve());
    client.launch(opts).catch(reject);
  });
}

module.exports = { launchGame };
