const nick = document.getElementById('nick');
const play = document.getElementById('play');
const bar = document.getElementById('bar');
const percent = document.getElementById('percent');
const status = document.getElementById('status');
const errorMessage = document.getElementById('error');
const progressTrack = document.querySelector('.progress-track');

let busy = false;
let updateLocked = true;
let errorTimer = null;

window.lucide.createIcons({
  attrs: {
    'stroke-width': 2
  }
});

nick.value = localStorage.getItem('nick') || '';

function syncPlayState() {
  play.disabled = busy || updateLocked;
}

function setProgress(value) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${safeValue}%`;
  percent.textContent = `${Math.round(safeValue)}%`;
  progressTrack.setAttribute('aria-valuenow', String(Math.round(safeValue)));
}

function showError(message) {
  clearTimeout(errorTimer);
  errorMessage.textContent = String(message || 'Неизвестная ошибка');
  errorMessage.classList.add('visible');
  errorTimer = setTimeout(() => errorMessage.classList.remove('visible'), 8000);
}

function setTransientStatus(message) {
  if (busy || updateLocked) return;
  const previous = status.textContent;
  status.textContent = message;
  setTimeout(() => {
    if (!busy && !updateLocked) status.textContent = previous;
  }, 1800);
}

window.launcher.getConfig().then((config) => {
  const address = `${config.server.host}:${config.server.port}`;
  document.getElementById('server-address').textContent = address;
  document.getElementById('minecraft-version').textContent = config.mcVersion;
  document.getElementById('neoforge-version').textContent = config.neoforgeVersion;
  document.getElementById('launcher-version').textContent = `v${config.appVersion}`;
});

window.launcher.onStatus((payload) => {
  status.textContent = payload.message;
  document.body.dataset.state = payload.state || 'idle';
  updateLocked =
    Boolean(payload.locked) && ['checking', 'updating', 'restarting'].includes(payload.state);
  syncPlayState();
});

window.launcher.onProgress(setProgress);
window.launcher.onError(showError);

async function start() {
  const name = nick.value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    showError('Ник: 3–16 символов, латиница, цифры или подчёркивание.');
    nick.focus();
    return;
  }

  localStorage.setItem('nick', name);
  busy = true;
  play.classList.add('busy');
  syncPlayState();
  setProgress(0);

  try {
    const result = await window.launcher.play(name);
    if (!result.ok) showError(result.error || 'Не удалось запустить игру.');
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    busy = false;
    play.classList.remove('busy');
    syncPlayState();
  }
}

play.addEventListener('click', start);
nick.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') start();
});

document.getElementById('minimize').addEventListener('click', () => window.launcher.minimize());
document.getElementById('close').addEventListener('click', () => window.launcher.close());
document.getElementById('open-folder').addEventListener('click', async () => {
  await window.launcher.openGameDir();
  setTransientStatus('Папка игры открыта');
});
document.getElementById('copy-server').addEventListener('click', async () => {
  await window.launcher.copyServer();
  setTransientStatus('Адрес сервера скопирован');
});

// --- Скин ---
const skinImg = document.getElementById('skin-img');
const skinPick = document.getElementById('skin-pick');
const modelClassic = document.getElementById('model-classic');
const modelSlim = document.getElementById('model-slim');
let skinModel = 'classic';

function setModelUI(model) {
  skinModel = model === 'slim' ? 'slim' : 'classic';
  modelClassic.classList.toggle('active', skinModel === 'classic');
  modelSlim.classList.toggle('active', skinModel === 'slim');
}

function setSkinPreview(dataUrl) {
  if (dataUrl) {
    skinImg.src = dataUrl;
    skinImg.classList.add('has');
  } else {
    skinImg.removeAttribute('src');
    skinImg.classList.remove('has');
  }
}

window.launcher.getSkin().then((skin) => {
  setModelUI(skin.model);
  setSkinPreview(skin.dataUrl);
});

skinPick.addEventListener('click', async () => {
  const result = await window.launcher.chooseSkin(skinModel);
  if (result.canceled) return;
  if (!result.ok) {
    showError('Скин: ' + (result.error || 'не удалось'));
    return;
  }
  setSkinPreview(result.dataUrl);
  setModelUI(result.model);
  setTransientStatus('Скин сохранён');
});

async function chooseModel(model) {
  const result = await window.launcher.setSkinModel(model);
  setModelUI(result.ok ? result.model : model);
}
modelClassic.addEventListener('click', () => chooseModel('classic'));
modelSlim.addEventListener('click', () => chooseModel('slim'));
