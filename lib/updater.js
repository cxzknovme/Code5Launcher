const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 8;

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('Слишком много перенаправлений при скачивании обновления.'));
      return;
    }

    const request = https.get(url, {
      headers: {
        'User-Agent': 'Code5Launcher',
        Accept: 'application/octet-stream, application/json',
        'Cache-Control': 'no-cache'
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(get(nextUrl, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Сервер обновлений ответил HTTP ${response.statusCode}.`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Сервер обновлений не ответил за 30 секунд.'));
    });
    request.on('error', reject);
  });
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function manifestUrl(config) {
  if (config.update.manifestUrl) return config.update.manifestUrl;
  const owner = encodeURIComponent(config.update.githubOwner);
  const repo = encodeURIComponent(config.update.githubRepo);
  const asset = encodeURIComponent(config.update.manifestAsset || 'manifest.json');
  return `https://github.com/${owner}/${repo}/releases/latest/download/${asset}`;
}

function validateManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('Манифест обновлений повреждён.');
  if (!Array.isArray(value.mods) || value.mods.length === 0) {
    throw new Error('В манифесте обновлений нет модов.');
  }

  const names = new Set();
  for (const mod of value.mods) {
    if (!mod || typeof mod !== 'object') throw new Error('Некорректная запись мода в манифесте.');
    if (typeof mod.name !== 'string' || path.basename(mod.name) !== mod.name || !mod.name.endsWith('.jar')) {
      throw new Error('Некорректное имя мода в манифесте.');
    }
    if (names.has(mod.name)) throw new Error(`Мод ${mod.name} указан в манифесте дважды.`);
    if (!/^[a-f0-9]{40}$/i.test(mod.sha1 || '')) {
      throw new Error(`У мода ${mod.name} отсутствует корректный SHA-1.`);
    }
    if (!/^https:\/\//i.test(mod.url || '')) {
      throw new Error(`У мода ${mod.name} отсутствует безопасная ссылка.`);
    }
    names.add(mod.name);
  }
  return value;
}

function parseManifest(buffer) {
  try {
    return validateManifest(JSON.parse(buffer.toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Манифест обновлений содержит некорректный JSON.');
    throw error;
  }
}

async function syncMods(config, directory, io, dependencies = {}) {
  const fetchBuffer = dependencies.get || get;
  const modsDir = path.join(directory, 'mods');
  const stateDir = path.join(directory, 'code5');
  fs.mkdirSync(modsDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  io.log('Получаем актуальный модпак Code5');
  const manifest = parseManifest(await fetchBuffer(manifestUrl(config)));
  const wanted = new Map(manifest.mods.map((mod) => [mod.name, mod]));
  const pending = [];

  try {
    let completed = 0;
    for (const mod of manifest.mods) {
      const destination = path.join(modsDir, mod.name);
      const currentHash = fs.existsSync(destination) ? sha1(fs.readFileSync(destination)) : '';
      if (currentHash !== mod.sha1.toLowerCase()) {
        io.log(`Скачиваем ${mod.name}`);
        const contents = await fetchBuffer(mod.url);
        const downloadedHash = sha1(contents);
        if (downloadedHash !== mod.sha1.toLowerCase()) {
          throw new Error(`Проверка ${mod.name} не пройдена: скачанный файл повреждён.`);
        }
        const temporary = path.join(modsDir, `.${mod.name}.${process.pid}.part`);
        fs.writeFileSync(temporary, contents);
        pending.push({ temporary, destination });
      }
      io.progress(Math.round((++completed / manifest.mods.length) * 85));
    }

    for (const file of pending) {
      if (fs.existsSync(file.destination)) fs.unlinkSync(file.destination);
      fs.renameSync(file.temporary, file.destination);
    }

    for (const fileName of fs.readdirSync(modsDir)) {
      if (fileName.toLowerCase().endsWith('.jar') && !wanted.has(fileName)) {
        fs.unlinkSync(path.join(modsDir, fileName));
        io.log(`Удалён устаревший мод: ${fileName}`);
      }
    }
  } catch (error) {
    for (const file of pending) {
      if (fs.existsSync(file.temporary)) fs.unlinkSync(file.temporary);
    }
    throw error;
  }

  const version = String(manifest.modpackVersion || 'без версии');
  fs.writeFileSync(path.join(stateDir, 'modpack-state.json'), JSON.stringify({
    version,
    syncedAt: new Date().toISOString(),
    mods: manifest.mods.map((mod) => ({ name: mod.name, sha1: mod.sha1.toLowerCase() }))
  }, null, 2));
  io.progress(100);
  io.log(`Модпак ${version} актуален (${manifest.mods.length} модов)`);
  return { version, count: manifest.mods.length };
}

module.exports = { get, manifestUrl, parseManifest, sha1, syncMods, validateManifest };
