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
const resetSkin = document.getElementById('reset-skin');
const modelOptions = [...document.querySelectorAll('.model-option')];
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsPanel = document.getElementById('settings-panel');
const openSettingsButton = document.getElementById('open-settings');
const closeSettingsButton = document.getElementById('close-settings');
const themeOptions = [...document.querySelectorAll('.theme-option')];
const memorySlider = document.getElementById('memory');
const memoryValue = document.getElementById('memory-value');
const autoRotate = document.getElementById('auto-rotate');

const SETTINGS_KEY = 'code5-settings';
const DEFAULT_SETTINGS = { theme: 'system', memoryGb: 3, autoRotate: true };
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');

let busy = false;
let updateLocked = true;
let errorTimer = null;
let skinViewer = null;
let skinSelection = null;
let settings = loadSettings();

window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
nick.value = localStorage.getItem('nick') || '';

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const theme = ['system', 'dark', 'light'].includes(stored.theme)
      ? stored.theme
      : DEFAULT_SETTINGS.theme;
    const parsedMemory = Math.round(Number(stored.memoryGb));
    const memoryGb = Number.isFinite(parsedMemory)
      ? Math.max(2, Math.min(12, parsedMemory))
      : DEFAULT_SETTINGS.memoryGb;

    return {
      theme,
      memoryGb,
      autoRotate: typeof stored.autoRotate === 'boolean' ? stored.autoRotate : true
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings() {
  const resolvedTheme = settings.theme === 'system'
    ? (systemTheme.matches ? 'light' : 'dark')
    : settings.theme;

  document.documentElement.dataset.theme = resolvedTheme;
  themeOptions.forEach((button) => {
    const active = button.dataset.theme === settings.theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  memorySlider.value = String(settings.memoryGb);
  memoryValue.textContent = `${settings.memoryGb} ГБ`;
  autoRotate.checked = settings.autoRotate;
  if (skinViewer) skinViewer.autoRotate = settings.autoRotate;
}

function initSkinViewer() {
  const bounds = skinCanvas.getBoundingClientRect();
  skinViewer = new window.skinview3d.SkinViewer({
    canvas: skinCanvas,
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    skin: '../assets/default-skin.png',
    model: 'default',
    background: null,
    fov: 47,
    zoom: 0.86,
    pixelRatio: 'match-device'
  });
  skinViewer.autoRotate = settings.autoRotate;
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
  const source = selection.dataUrl || '../assets/default-skin.png';

  modelOptions.forEach((button) => {
    button.classList.toggle('active', button.dataset.model === model);
  });
  resetSkin.disabled = Boolean(selection.isDefault) && model === 'default';
  skinState.textContent = selection.isDefault ? 'Стандартный' : 'Скин активен';
  skinFile.textContent = selection.fileName || (selection.isDefault ? 'Hermit' : 'skin.png');
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

function openSettings() {
  settingsBackdrop.hidden = false;
  settingsPanel.setAttribute('aria-hidden', 'false');
  openSettingsButton.classList.add('active');
  closeSettingsButton.focus();
}

function closeSettings() {
  settingsBackdrop.hidden = true;
  settingsPanel.setAttribute('aria-hidden', 'true');
  openSettingsButton.classList.remove('active');
  openSettingsButton.focus();
}

applySettings();
initSkinViewer();
window.launcher.getSkin().then(renderSkin).catch((error) => showError(error.message || String(error)));

systemTheme.addEventListener('change', () => {
  if (settings.theme === 'system') applySettings();
});

window.launcher.onStatus((payload) => {
  status.textContent = payload.message;
  document.body.dataset.state = payload.state || 'idle';
  updateLocked = Boolean(payload.locked) && ['checking', 'updating', 'restarting'].includes(payload.state);
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
    const result = await window.launcher.play(name, { memoryGb: settings.memoryGb });
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
openSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', (event) => {
  if (event.target === settingsBackdrop) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsBackdrop.hidden) closeSettings();
});

themeOptions.forEach((button) => {
  button.addEventListener('click', () => {
    settings.theme = button.dataset.theme;
    saveSettings();
    applySettings();
  });
});

memorySlider.addEventListener('input', () => {
  settings.memoryGb = Number(memorySlider.value);
  memoryValue.textContent = `${settings.memoryGb} ГБ`;
  saveSettings();
});

autoRotate.addEventListener('change', () => {
  settings.autoRotate = autoRotate.checked;
  saveSettings();
  applySettings();
});

document.getElementById('open-folder').addEventListener('click', async () => {
  await window.launcher.openGameDir();
  closeSettings();
  setTransientStatus('Папка игры открыта');
});

document.getElementById('reset-settings').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  applySettings();
  setTransientStatus('Настройки сброшены');
});

chooseSkin.addEventListener('click', async () => {
  try {
    const selection = await window.launcher.chooseSkin();
    await renderSkin(selection);
    if (!selection.isDefault) setTransientStatus('Скин выбран');
  } catch (error) {
    showError(error.message || String(error));
  }
});

resetSkin.addEventListener('click', async () => {
  if (skinSelection?.isDefault && skinSelection?.model === 'default') return;
  try {
    await renderSkin(await window.launcher.resetSkin());
    setTransientStatus('Стандартный скин восстановлен');
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
