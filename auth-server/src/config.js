const path = require('path');

require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    production,
    host: env.HOST || (production ? '127.0.0.1' : '0.0.0.0'),
    port: integer(env.PORT, 8787, 1, 65535),
    databaseUrl: env.DATABASE_URL || '',
    codeSecret: env.CODE_SECRET || 'development-code-secret-change-me',
    serverApiKey: env.SERVER_API_KEY || 'development-server-key-change-me',
    sessionDays: integer(env.SESSION_DAYS, 30, 1, 365),
    codeTtlMinutes: integer(env.CODE_TTL_MINUTES, 10, 2, 60),
    codeResendSeconds: integer(env.CODE_RESEND_SECONDS, 60, 0, 3600),
    launchTicketSeconds: integer(env.LAUNCH_TICKET_SECONDS, 90, 30, 300),
    maxCodeAttempts: 5,
    exposeDevCodes: !production && env.MAIL_MODE !== 'smtp',
    smtp: {
      mode: production ? 'smtp' : (env.MAIL_MODE || 'console'),
      host: env.SMTP_HOST || '',
      port: integer(env.SMTP_PORT, 465, 1, 65535),
      secure: boolean(env.SMTP_SECURE, true),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || 'Code5 <no-reply@localhost>'
    }
  };

  if (production) {
    const missing = [];
    if (!config.databaseUrl) missing.push('DATABASE_URL');
    if (config.codeSecret.length < 32) missing.push('CODE_SECRET (минимум 32 символа)');
    if (config.serverApiKey.length < 32) missing.push('SERVER_API_KEY (минимум 32 символа)');
    for (const [name, value] of [
      ['SMTP_HOST', config.smtp.host],
      ['SMTP_USER', config.smtp.user],
      ['SMTP_PASS', config.smtp.pass],
      ['SMTP_FROM', config.smtp.from]
    ]) {
      if (!value) missing.push(name);
    }
    if (missing.length) throw new Error(`Не заполнены настройки auth-server: ${missing.join(', ')}`);
  }

  return config;
}

module.exports = { loadConfig };
