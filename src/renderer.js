const nick = document.getElementById('nick');
const play = document.getElementById('play');
const bar = document.getElementById('bar');
const log = document.getElementById('log');
const verLine = document.getElementById('ver');
const serverLine = document.getElementById('server-line');

// Восстановить последний ник.
nick.value = localStorage.getItem('nick') || '';

window.launcher.getConfig().then((cfg) => {
  verLine.textContent = `Minecraft ${cfg.mcVersion} · NeoForge ${cfg.neoforgeVersion}`;
  serverLine.textContent = `${cfg.server.host}:${cfg.server.port}`;
});

function addLog(msg) {
  log.textContent += msg + '\n';
  log.scrollTop = log.scrollHeight;
}

window.launcher.onLog(addLog);
window.launcher.onProgress((p) => {
  bar.style.width = Math.max(0, Math.min(100, p)) + '%';
});

async function start() {
  const name = nick.value.trim();
  localStorage.setItem('nick', name);
  play.disabled = true;
  play.textContent = 'ЗАПУСК…';
  bar.style.width = '0%';
  log.textContent = '';
  const res = await window.launcher.play(name);
  if (!res.ok) {
    addLog('✖ ' + (res.error || 'не удалось запустить'));
  } else {
    addLog('✔ Готово.');
  }
  play.disabled = false;
  play.textContent = 'ИГРАТЬ';
}

play.addEventListener('click', start);
nick.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start();
});
