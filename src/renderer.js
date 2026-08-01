const nick = document.getElementById('nick');
const play = document.getElementById('play');
const bar = document.getElementById('bar');
const percent = document.getElementById('percent');
const status = document.getElementById('status');
const errorMessage = document.getElementById('error');
const progressTrack = document.querySelector('.progress-track');
const skinCanvas = document.getElementById('skin-viewer');
const skinState = document.getElementById('skin-state');
const skinFile = document.getElementById('skin-file');
const chooseSkin = document.getElementById('choose-skin');
const removeSkin = document.getElementById('remove-skin');
const modelOptions = [...document.querySelectorAll('.model-option')];

let busy = false;
let updateLocked = true;
let errorTimer = null;
let skinViewer = null;
let skinSelection = null;

window.lucide.createIcons({
  attrs: {
    'stroke-width': 2
  }
});

nick.value = localStorage.getItem('nick') || '';

function defaultSkinDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;

  const fillPart = (x, y, width, height, base, accent) => {
    context.fillStyle = base;
    context.fillRect(x, y, width, height);
    context.fillStyle = accent;
    for (let row = y; row < y + height; row += 4) {
      context.fillRect(x, row, width, 1);
    }
  };

  fillPart(0, 0, 32, 16, '#c78a34', '#e8b843');
  fillPart(0, 16, 16, 16, '#17191f', '#292c34');
  fillPart(16, 16, 24, 16, '#111319', '#242731');
  fillPart(40, 16, 16, 16, '#17191f', '#292c34');
  fillPart(16, 48, 16, 16, '#111319', '#242731');
  fillPart(32, 48, 16, 16, '#17191f', '#292c34');

  context.fillStyle = '#dca74c';
  context.fillRect(8, 8, 8, 8);
  context.fillStyle = '#17191f';
  context.fillRect(9, 11, 2, 1);
  context.fillRect(14, 11, 2, 1);
  context.fillStyle = '#2f8cff';
  context.fillRect(10, 11, 1, 1);
  context.fillRect(14, 11, 1, 1);
  context.fillStyle = '#e8b843';
  context.fillRect(20, 20, 8, 2);
  context.fillRect(23, 22, 2, 10);
  context.fillStyle = '#2f8cff';
  context.fillRect(23, 24, 2, 2);

  return canvas.toDataURL('image/png');
}

const fallbackSkin = defaultSkinDataUrl();

function initSkinViewer() {
  const bounds = skinCanvas.getBoundingClientRect();
  skinViewer = new window.skinview3d.SkinViewer({
    canvas: skinCanvas,
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    skin: fallbackSkin,
    model: 'default',
    background: null,
    fov: 47,
    zoom: 0.86,
    pixelRatio: 'match-device'
  });
  skinViewer.autoRotate = true;
  skinViewer.autoRotateSpeed = 0.34;
  skinViewer.animation = new window.skinview3d.IdleAnimation();
  skinViewer.animation.speed = 0.72;
  skinViewer.globalLight.intensity = 2.4;
  skinViewer.cameraLight.intensity = 0.72;
  skinViewer.controls.enablePan = false;

  const resizeObserver = new ResizeObserver(() => {
    const next = skinCanvas.getBoundingClientRect();
    skinViewer.width = Math.max(1, Math.round(next.width));
    skinViewer.height = Math.max(1, Math.round(next.height));
  });
  resizeObserver.observe(skinCanvas);
}

async function renderSkin(selection) {
  skinSelection = selection;
  const model = selection.model === 'slim' ? 'slim' : 'default';
  const source = selection.selected && selection.dataUrl ? selection.dataUrl : fallbackSkin;

  modelOptions.forEach((button) => {
    button.classList.toggle('active', button.dataset.model === model);
  });
  removeSkin.disabled = !selection.selected;
  skinState.textContent = selection.selected ? 'Скин активен' : 'Базовый образ';
  skinFile.textContent = selection.selected ? selection.fileName || 'skin.png' : 'Скин не выбран';
  skinFile.title = skinFile.textContent;

  await skinViewer.loadSkin(source, { model });
}

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

initSkinViewer();
window.launcher.getSkin().then(renderSkin).catch((error) => showError(error.message || String(error)));

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

document.getElementById('server-address').addEventListener('click', async () => {
  await window.launcher.copyServer();
  setTransientStatus('Адрес сервера скопирован');
});

chooseSkin.addEventListener('click', async () => {
  try {
    const selection = await window.launcher.chooseSkin();
    await renderSkin(selection);
    if (selection.selected) setTransientStatus('Скин выбран');
  } catch (error) {
    showError(error.message || String(error));
  }
});

removeSkin.addEventListener('click', async () => {
  if (!skinSelection?.selected) return;
  try {
    await renderSkin(await window.launcher.removeSkin());
    setTransientStatus('Скин сброшен');
  } catch (error) {
    showError(error.message || String(error));
  }
});

modelOptions.forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.classList.contains('active')) return;
    try {
      await renderSkin(await window.launcher.setSkinModel(button.dataset.model));
      setTransientStatus(button.dataset.model === 'slim' ? 'Тонкие руки' : 'Обычные руки');
    } catch (error) {
      showError(error.message || String(error));
    }
  });
});
