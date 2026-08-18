const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('Введите корректный email.');
  }
  return email;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 128) {
    throw new Error('Пароль должен содержать от 10 до 128 символов.');
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    throw new Error('Добавьте в пароль хотя бы одну букву и одну цифру.');
  }
  return password;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url')
  ].join('$');
}

async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltValue, hashValue] = String(encoded).split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function randomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function codeHash(secret, purpose, email, code) {
  return crypto.createHmac('sha256', secret).update(`${purpose}:${email}:${code}`).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function gameNameFromEmail(email, id) {
  const local = email.split('@')[0]
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 9);
  const base = local.length >= 3 ? local : 'Player';
  const suffix = id.replace(/-/g, '').slice(0, 6);
  return `${base}_${suffix}`.slice(0, 16);
}

module.exports = {
  codeHash,
  gameNameFromEmail,
  hashPassword,
  normalizeEmail,
  randomCode,
  randomToken,
  safeEqualText,
  tokenHash,
  validatePassword,
  verifyPassword
};
