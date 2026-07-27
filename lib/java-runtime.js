const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const extractZip = require('extract-zip');
const tar = require('tar');

const JAVA_MAJOR = 21;
const MAX_REDIRECTS = 10;

function platformInfo() {
  const os = { win32: 'windows', darwin: 'mac' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];

  if (!os || !arch) {
    throw new Error(`Java 21 auto-install is not supported on ${process.platform}/${process.arch}.`);
  }

  return {
    os,
    arch,
    executableName: process.platform === 'win32' ? 'java.exe' : 'java',
    archiveType: process.platform === 'win32' ? 'zip' : 'tar.gz'
  };
}

function getResponse(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('Too many redirects while downloading Java 21.'));
      return;
    }

    const request = https.get(
      url,
      { headers: { 'User-Agent': 'Code5Launcher/1.0' } },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          resolve(getResponse(nextUrl, redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} while downloading Java 21.`));
          return;
        }

        resolve(response);
      }
    );

    request.on('error', reject);
  });
}

async function getJson(url) {
  const response = await getResponse(url);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function downloadFile(url, destination, onProgress) {
  const partial = `${destination}.part`;
  await fsp.rm(partial, { force: true });

  const response = await getResponse(url);
  const total = Number(response.headers['content-length'] || 0);
  let received = 0;
  let lastPercent = -1;
  const output = fs.createWriteStream(partial);
  const outputError = new Promise((_, reject) => output.once('error', reject));

  try {
    await Promise.race([
      (async () => {
        for await (const chunk of response) {
          if (!output.write(chunk)) {
            await new Promise((resolve) => output.once('drain', resolve));
          }
          received += chunk.length;
          if (total > 0) {
            const percent = Math.floor((received / total) * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              onProgress(percent);
            }
          }
        }
      })(),
      outputError
    ]);

    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });
    await fsp.rename(partial, destination);
  } catch (error) {
    output.destroy();
    await fsp.rm(partial, { force: true });
    throw error;
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

async function findExecutable(dir, executableName) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) {
      if (path.basename(path.dirname(entryPath)).toLowerCase() === 'bin') return entryPath;
    }
    if (entry.isDirectory()) {
      const found = await findExecutable(entryPath, executableName);
      if (found) return found;
    }
  }
  return null;
}

function javaMajor(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      const match = `${stdout}\n${stderr}`.match(/version\s+"(?:1\.)?(\d+)/i);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

async function existingRuntime(runtimeDir, markerPath) {
  try {
    const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    const javaPath = path.join(runtimeDir, marker.javaRelative);
    if (marker.major !== JAVA_MAJOR || !fs.existsSync(javaPath)) return null;
    return (await javaMajor(javaPath)) === JAVA_MAJOR ? javaPath : null;
  } catch {
    return null;
  }
}

async function ensureJava21(gameDir, io) {
  const info = platformInfo();
  const runtimeDir = path.join(gameDir, 'runtime', `java-${JAVA_MAJOR}`);
  const markerPath = path.join(runtimeDir, 'code5-runtime.json');
  const installed = await existingRuntime(runtimeDir, markerPath);
  if (installed) {
    io.log('Java 21 готова.');
    return installed;
  }

  const workDir = path.join(gameDir, 'runtime', `.java-${JAVA_MAJOR}-install`);
  const extractDir = path.join(workDir, 'extracted');
  const archivePath = path.join(workDir, `java-${JAVA_MAJOR}.${info.archiveType}`);
  const apiUrl =
    `https://api.adoptium.net/v3/assets/latest/${JAVA_MAJOR}/hotspot` +
    `?architecture=${info.arch}&image_type=jre&os=${info.os}&vendor=eclipse`;

  io.log('Java 21 не найдена. Загрузка среды запуска...');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });

  try {
    const assets = await getJson(apiUrl);
    const pkg = assets?.[0]?.binary?.package;
    if (!pkg?.link || !pkg?.checksum) {
      throw new Error(`Temurin JRE 21 is unavailable for ${info.os}/${info.arch}.`);
    }

    await downloadFile(pkg.link, archivePath, (percent) => io.progress(percent));
    io.log('Проверка Java 21...');
    const actualChecksum = await sha256(archivePath);
    if (actualChecksum.toLowerCase() !== String(pkg.checksum).toLowerCase()) {
      throw new Error('Java 21 checksum verification failed.');
    }

    io.log('Установка Java 21...');
    if (info.archiveType === 'zip') {
      await extractZip(archivePath, { dir: extractDir });
    } else {
      await tar.x({ file: archivePath, cwd: extractDir });
    }

    const extractedJava = await findExecutable(extractDir, info.executableName);
    if (!extractedJava) throw new Error('Java executable was not found in the downloaded archive.');

    const javaRelative = path.relative(extractDir, extractedJava);
    await fsp.rm(runtimeDir, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(runtimeDir), { recursive: true });
    await fsp.rename(extractDir, runtimeDir);
    await fsp.writeFile(
      markerPath,
      JSON.stringify({ major: JAVA_MAJOR, javaRelative, checksum: pkg.checksum }, null, 2),
      'utf8'
    );

    const javaPath = path.join(runtimeDir, javaRelative);
    if ((await javaMajor(javaPath)) !== JAVA_MAJOR) {
      throw new Error('Downloaded Java runtime did not report version 21.');
    }

    io.progress(100);
    io.log('Java 21 установлена.');
    return javaPath;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = { ensureJava21 };
