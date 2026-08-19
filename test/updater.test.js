const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { syncMods } = require('../lib/updater');

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code5-updater-'));
}

function config() {
  return {
    update: {
      githubOwner: 'owner',
      githubRepo: 'repo',
      manifestAsset: 'manifest.json'
    }
  };
}

test('downloads verified mods and removes stale jars', async (context) => {
  const directory = temporaryDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'mods'));
  fs.writeFileSync(path.join(directory, 'mods', 'old.jar'), 'old');
  const jar = Buffer.from('fresh-mod');
  const manifest = Buffer.from(JSON.stringify({
    modpackVersion: 'release-42',
    mods: [{ name: 'code5.jar', sha1: sha1(jar), url: 'https://example.test/code5.jar' }]
  }));
  const get = async (url) => url.endsWith('manifest.json') ? manifest : jar;
  const io = { log() {}, progress() {} };

  const result = await syncMods(config(), directory, io, { get });

  assert.deepEqual(result, { version: 'release-42', count: 1 });
  assert.equal(fs.readFileSync(path.join(directory, 'mods', 'code5.jar'), 'utf8'), 'fresh-mod');
  assert.equal(fs.existsSync(path.join(directory, 'mods', 'old.jar')), false);
});

test('keeps the installed modpack when a download hash is wrong', async (context) => {
  const directory = temporaryDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'mods'));
  fs.writeFileSync(path.join(directory, 'mods', 'code5.jar'), 'installed');
  const expected = Buffer.from('expected');
  const manifest = Buffer.from(JSON.stringify({
    modpackVersion: 'release-43',
    mods: [{ name: 'code5.jar', sha1: sha1(expected), url: 'https://example.test/code5.jar' }]
  }));
  const get = async (url) => url.endsWith('manifest.json') ? manifest : Buffer.from('broken');
  const io = { log() {}, progress() {} };

  await assert.rejects(() => syncMods(config(), directory, io, { get }), /повреждён/);
  assert.equal(fs.readFileSync(path.join(directory, 'mods', 'code5.jar'), 'utf8'), 'installed');
});

test('rejects an empty manifest instead of launching stale mods', async (context) => {
  const directory = temporaryDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const io = { log() {}, progress() {} };

  await assert.rejects(
    () => syncMods(config(), directory, io, { get: async () => Buffer.from('{"mods":[]}') }),
    /нет модов/
  );
});
