const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');
const { ensureJava21 } = require('./java-runtime');

function offlineUUID(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https
      .get(url, { headers: { 'User-Agent': 'Code5Launcher' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          resolve(download(response.headers.location, destination));
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode}: ${url}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve(destination)));
      })
      .on('error', (error) => {
        file.close();
        reject(error);
      });
  });
}

async function ensureNeoForgeInstaller(config, dir) {
  const name = `neoforge-${config.neoforgeVersion}-installer.jar`;
  const destination = path.join(dir, name);
  if (!fs.existsSync(destination)) {
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${config.neoforgeVersion}/${name}`;
    await download(url, destination);
  }
  return destination;
}

async function launchGame(config, dir, nick, io, beforeLaunch) {
  const javaPath = await ensureJava21(dir, io);
  const forgeInstaller = await ensureNeoForgeInstaller(config, dir);
  if (beforeLaunch) await beforeLaunch();
  const client = new Client();

  const options = {
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
    forge: forgeInstaller,
    javaPath,
    memory: { max: config.memory.max, min: config.memory.min },
    // Убираем раннее окно NeoForge — старт сразу в окно игры с иконкой Code5.
    customArgs: ['-Dfml.earlyWindowControl=false'],
    quickPlay: {
      type: 'multiplayer',
      identifier: `${config.server.host}:${config.server.port}`
    },
    overrides: { detached: false }
  };

  client.on('progress', (event) => {
    if (event && event.total) io.progress(Math.round((event.task / event.total) * 100));
  });

  return new Promise((resolve, reject) => {
    client.on('close', resolve);
    client.launch(options).catch(reject);
  });
}

module.exports = { launchGame };
