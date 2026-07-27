const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/** GET с поддержкой редиректов, возвращает Buffer. */
function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Code5Launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' → ' + url));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * Синхронизация модов по манифесту из последнего GitHub Release.
 * manifest.json: { "modpackVersion": "...", "mods": [ { name, sha1, url } ] }
 * Докачиваем недостающие/изменённые, удаляем лишние *.jar.
 */
async function syncMods(config, dir, io) {
  const modsDir = path.join(dir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const api =
    'https://api.github.com/repos/' +
    config.update.githubOwner +
    '/' +
    config.update.githubRepo +
    '/releases/latest';

  let manifest;
  try {
    const rel = JSON.parse((await get(api)).toString());
    const asset = (rel.assets || []).find((a) => a.name === config.update.manifestAsset);
    if (!asset) throw new Error(config.update.manifestAsset + ' не найден в последнем релизе');
    manifest = JSON.parse((await get(asset.browser_download_url)).toString());
  } catch (err) {
    io.log('Не удалось получить манифест обновлений (' + err.message + '). Пропускаю синк.');
    return;
  }

  const mods = Array.isArray(manifest.mods) ? manifest.mods : [];
  const wanted = new Map(mods.map((m) => [m.name, m]));

  // удалить лишние jar-ы
  for (const f of fs.readdirSync(modsDir)) {
    if (f.toLowerCase().endsWith('.jar') && !wanted.has(f)) {
      fs.unlinkSync(path.join(modsDir, f));
      io.log('Удалён устаревший мод: ' + f);
    }
  }

  // докачать/обновить
  let i = 0;
  for (const m of mods) {
    const dest = path.join(modsDir, m.name);
    let need = true;
    if (fs.existsSync(dest)) {
      need = sha1(fs.readFileSync(dest)) !== m.sha1;
    }
    if (need) {
      io.log('Скачивание ' + m.name + '…');
      fs.writeFileSync(dest, await get(m.url));
    }
    io.progress(Math.round((++i / mods.length) * 100));
  }
  io.log('Моды актуальны (' + mods.length + ').');
}

module.exports = { syncMods };
