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
const authGate = document.getElementById('auth-gate');
const authLoading = document.getElementById('auth-loading');
const authContent = document.getElementById('auth-content');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authError = document.getElementById('auth-error');
const authViews = [...document.querySelectorAll('[data-auth-view]')];
const accountProfile = document.getElementById('account-profile');

const SETTINGS_KEY = 'code5-settings';
const EMAIL_KEY = 'code5-email';
const DEFAULT_SETTINGS = { theme: 'system', memoryGb: 3, autoRotate: true };
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
const viewCopy = {
  login: ['Вход', 'Продолжите в свой мир.'],
  register: ['Регистрация', 'Создайте защищённый аккаунт.'],
  'verify-register': ['Подтверждение', 'Введите шесть цифр из письма.'],
  'reset-request': ['Восстановление', 'Получите код на почту аккаунта.'],
  'reset-confirm': ['Новый пароль', 'Подтвердите код и задайте новый пароль.']
};

let busy = false;
let updateLocked = true;
let authBusy = false;
let account = null;
let errorTimer = null;
let skinViewer = null;
let skinSelection = null;
let settings = loadSettings();
let pendingRegistration = null;
let pendingResetEmail = '';
let resendTimer = null;

window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const theme = ['system', 'dark', 'light'].includes(stored.theme)
      ? stored.theme
      : DEFAULT_SETTINGS.theme;
    const parsedMemory = Math.round(Number(stored.memoryGb));
    return {
      theme,
      memoryGb: Number.isFinite(parsedMemory) ? Math.max(2, Math.min(12, parsedMemory)) : 3,
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

  new ResizeObserver(() => {
    const next = skinCanvas.getBoundingClientRect();
    skinViewer.width = Math.max(1, Math.round(next.width));
    skinViewer.height = Math.max(1, Math.round(next.height));
  }).observe(skinCanvas);
}

async function renderSkin(selection) {
  skinSelection = selection;
  const model = selection.model === 'slim' ? 'slim' : 'default';
  modelOptions.forEach((button) => button.classList.toggle('active', button.dataset.model === model));
  resetSkin.disabled = Boolean(selection.isDefault) && model === 'default';
  skinState.textContent = selection.isDefault ? 'Стандартный' : 'Скин активен';
  skinFile.textContent = selection.fileName || (selection.isDefault ? 'Hermit' : 'skin.png');
  skinFile.title = skinFile.textContent;
  await skinViewer.loadSkin(selection.dataUrl || '../assets/default-skin.png', { model });
}

function syncPlayState() {
  play.disabled = busy || updateLocked || !account;
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

function accountInitials(user) {
  return String(user?.gameName || 'C5').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'C5';
}

function renderAccount(user) {
  account = user;
  const initials = accountInitials(user);
  for (const id of ['account-avatar', 'settings-avatar']) document.getElementById(id).textContent = initials;
  for (const id of ['account-name', 'settings-account-name']) document.getElementById(id).textContent = user.gameName;
  for (const id of ['account-email', 'settings-account-email']) document.getElementById(id).textContent = user.email;
  authGate.hidden = true;
  syncPlayState();
}

function showAuthMessage(message, success = false) {
  authError.textContent = message || '';
  authError.classList.toggle('success', success);
}

function clearOtp(name) {
  document.querySelectorAll(`[data-otp="${name}"] input`).forEach((input) => { input.value = ''; });
}

function otpValue(name) {
  return [...document.querySelectorAll(`[data-otp="${name}"] input`)].map((input) => input.value).join('');
}

function fillOtp(name, code) {
  const inputs = [...document.querySelectorAll(`[data-otp="${name}"] input`)];
  String(code || '').slice(0, 6).split('').forEach((digit, index) => { inputs[index].value = digit; });
}

function setAuthView(name, message = '') {
  const copy = viewCopy[name] || viewCopy.login;
  authTitle.textContent = copy[0];
  authSubtitle.textContent = copy[1];
  authViews.forEach((view) => { view.hidden = view.dataset.authView !== name; });
  showAuthMessage(message);
  const active = authViews.find((view) => view.dataset.authView === name);
  setTimeout(() => active?.querySelector('input')?.focus(), 0);
}

function setAuthBusy(value) {
  authBusy = value;
  authContent.classList.toggle('busy', value);
  authViews.forEach((view) => {
    if (!view.hidden) view.querySelectorAll('button, input').forEach((control) => { control.disabled = value; });
  });
}

function openAuth(message = '') {
  account = null;
  authGate.hidden = false;
  authLoading.hidden = true;
  authContent.hidden = false;
  setAuthView('login', message);
  syncPlayState();
}

async function runAuth(action) {
  if (authBusy) return null;
  showAuthMessage('');
  setAuthBusy(true);
  try {
    const result = await action();
    if (!result?.ok) {
      showAuthMessage(result?.error || 'Не удалось выполнить запрос.');
      return null;
    }
    return result;
  } catch (error) {
    showAuthMessage(error.message || String(error));
    return null;
  } finally {
    setAuthBusy(false);
  }
}

function startResendCountdown(button, seconds = 60) {
  clearInterval(resendTimer);
  let remaining = seconds;
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  button.disabled = true;
  button.textContent = `Повторить через ${remaining} сек.`;
  resendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendTimer);
      button.disabled = false;
      button.textContent = label;
      return;
    }
    button.textContent = `Повторить через ${remaining} сек.`;
  }, 1000);
}

async function initializeAuth() {
  const remembered = localStorage.getItem(EMAIL_KEY) || '';
  document.getElementById('login-email').value = remembered;
  document.getElementById('register-email').value = remembered;
  document.getElementById('reset-email').value = remembered;
  try {
    const state = await window.launcher.getAuthState();
    if (state.status === 'authenticated' && state.user) {
      renderAccount(state.user);
      return;
    }
    openAuth(state.status === 'unavailable'
      ? (state.error || 'Сервис аккаунтов временно недоступен.')
      : (state.reason === 'expired' ? 'Сессия истекла. Войдите снова.' : ''));
  } catch (error) {
    openAuth(error.message || 'Не удалось проверить аккаунт.');
  }
}

function openSettings() {
  if (!account) return;
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

document.querySelectorAll('.otp-inputs').forEach((group) => {
  const inputs = [...group.querySelectorAll('input')];
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && inputs[index + 1]) inputs[index + 1].focus();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus();
      if (event.key === 'ArrowLeft' && inputs[index - 1]) inputs[index - 1].focus();
      if (event.key === 'ArrowRight' && inputs[index + 1]) inputs[index + 1].focus();
    });
    input.addEventListener('paste', (event) => {
      const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      digits.split('').forEach((digit, digitIndex) => { inputs[digitIndex].value = digit; });
      inputs[Math.min(digits.length, 6) - 1].focus();
    });
  });
});

document.querySelectorAll('[data-auth-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.authTarget;
    if (target === 'register') {
      document.getElementById('register-email').value = document.getElementById('login-email').value;
    }
    if (target === 'reset-request') {
      document.getElementById('reset-email').value = document.getElementById('login-email').value;
    }
    setAuthView(target);
  });
});

document.querySelectorAll('.password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.title = visible ? 'Показать пароль' : 'Скрыть пароль';
    button.setAttribute('aria-label', button.title);
  });
});

document.querySelector('[data-auth-view="login"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const result = await runAuth(() => window.launcher.login(email, password));
  if (!result) return;
  localStorage.setItem(EMAIL_KEY, email);
  document.getElementById('login-password').value = '';
  renderAccount(result.user);
  setTransientStatus('Вход выполнен');
});

document.querySelector('[data-auth-view="register"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const gameName = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirmation = document.getElementById('register-confirm').value;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(gameName)) {
    showAuthMessage('Ник: 3–16 латинских букв, цифр или символов _.');
    return;
  }
  if (password !== confirmation) {
    showAuthMessage('Пароли не совпадают.');
    return;
  }
  const result = await runAuth(() => window.launcher.registerRequest(email, password, gameName));
  if (!result) return;
  pendingRegistration = { email, password, gameName };
  localStorage.setItem(EMAIL_KEY, email);
  document.getElementById('register-code-email').textContent = email;
  clearOtp('register');
  setAuthView('verify-register');
  if (result.devCode) {
    fillOtp('register', result.devCode);
    showAuthMessage('Локальный тестовый код подставлен автоматически.', true);
  }
  startResendCountdown(document.getElementById('resend-register'));
});

document.querySelector('[data-auth-view="verify-register"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingRegistration) {
    setAuthView('register', 'Введите данные регистрации ещё раз.');
    return;
  }
  const result = await runAuth(() => window.launcher.registerVerify(
    pendingRegistration.email,
    otpValue('register')
  ));
  if (!result) return;
  pendingRegistration = null;
  renderAccount(result.user);
  setTransientStatus('Аккаунт создан');
});

document.getElementById('resend-register').addEventListener('click', async () => {
  if (!pendingRegistration) return;
  const result = await runAuth(() => window.launcher.registerRequest(
    pendingRegistration.email,
    pendingRegistration.password,
    pendingRegistration.gameName
  ));
  if (!result) return;
  clearOtp('register');
  if (result.devCode) fillOtp('register', result.devCode);
  startResendCountdown(document.getElementById('resend-register'));
});

document.querySelector('[data-auth-view="reset-request"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  const result = await runAuth(() => window.launcher.passwordRequest(email));
  if (!result) return;
  pendingResetEmail = email;
  localStorage.setItem(EMAIL_KEY, email);
  document.getElementById('reset-code-email').textContent = email;
  clearOtp('reset');
  setAuthView('reset-confirm');
  if (result.devCode) {
    fillOtp('reset', result.devCode);
    showAuthMessage('Локальный тестовый код подставлен автоматически.', true);
  }
  startResendCountdown(document.getElementById('resend-reset'));
});

document.querySelector('[data-auth-view="reset-confirm"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('reset-password').value;
  const confirmation = document.getElementById('reset-confirm').value;
  if (password !== confirmation) {
    showAuthMessage('Пароли не совпадают.');
    return;
  }
  const result = await runAuth(() => window.launcher.passwordReset(
    pendingResetEmail,
    otpValue('reset'),
    password
  ));
  if (!result) return;
  pendingResetEmail = '';
  renderAccount(result.user);
  setTransientStatus('Пароль обновлён');
});

document.getElementById('resend-reset').addEventListener('click', async () => {
  if (!pendingResetEmail) return;
  const result = await runAuth(() => window.launcher.passwordRequest(pendingResetEmail));
  if (!result) return;
  clearOtp('reset');
  if (result.devCode) fillOtp('reset', result.devCode);
  startResendCountdown(document.getElementById('resend-reset'));
});

applySettings();
initSkinViewer();
window.launcher.getSkin().then(renderSkin).catch((error) => showError(error.message || String(error)));
initializeAuth();

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
  if (!account) {
    openAuth('Войдите в аккаунт, чтобы запустить игру.');
    return;
  }
  busy = true;
  play.classList.add('busy');
  syncPlayState();
  setProgress(0);
  try {
    const result = await window.launcher.play({ memoryGb: settings.memoryGb });
    if (!result.ok) {
      if (['AUTH_REQUIRED', 'SESSION_EXPIRED', 'ACCOUNT_CHANGED'].includes(result.code)) {
        openAuth(result.error);
      } else {
        showError(result.error || 'Не удалось запустить игру.');
      }
    }
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    busy = false;
    play.classList.remove('busy');
    syncPlayState();
  }
}

play.addEventListener('click', start);
document.getElementById('minimize').addEventListener('click', () => window.launcher.minimize());
document.getElementById('close').addEventListener('click', () => window.launcher.close());
openSettingsButton.addEventListener('click', openSettings);
accountProfile.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', (event) => {
  if (event.target === settingsBackdrop) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsBackdrop.hidden) closeSettings();
});

document.getElementById('logout').addEventListener('click', async () => {
  await window.launcher.logout();
  closeSettings();
  openAuth('Вы вышли из аккаунта.');
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
