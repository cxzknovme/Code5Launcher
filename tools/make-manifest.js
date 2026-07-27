// Генератор manifest.json для релиза.
//   node tools/make-manifest.js <папка-с-модами> <тег-релиза>
// Пример:
//   node tools/make-manifest.js ./mods v1.0.0
//
// Считает sha1 каждого .jar и проставляет url на ассеты GitHub Release с этим тегом.
// Потом создаёшь релиз с этим тегом, заливаешь туда все .jar-ы И manifest.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

const modsDir = process.argv[2];
const tag = process.argv[3];
if (!modsDir || !tag) {
  console.error('Использование: node tools/make-manifest.js <папка-с-модами> <тег-релиза>');
  process.exit(1);
}

const base =
  `https://github.com/${config.update.githubOwner}/${config.update.githubRepo}/releases/download/${tag}/`;

const mods = fs
  .readdirSync(modsDir)
  .filter((f) => f.toLowerCase().endsWith('.jar'))
  .map((name) => {
    const buf = fs.readFileSync(path.join(modsDir, name));
    return {
      name,
      sha1: crypto.createHash('sha1').update(buf).digest('hex'),
      url: base + encodeURIComponent(name)
    };
  });

const manifest = {
  modpackVersion: tag,
  mods
};

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`manifest.json создан: ${mods.length} модов, тег ${tag}.`);
console.log('Дальше: создай GitHub Release с тегом ' + tag + ', залей туда все .jar + manifest.json.');
