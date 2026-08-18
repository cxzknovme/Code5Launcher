const crypto = require('crypto');
const {
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
} = require('./security');

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    gameName: user.gameName,
    verified: true
  };
}

class AuthService {
  constructor({ store, mailer, config }) {
    this.store = store;
    this.mailer = mailer;
    this.config = config;
  }

  normalizeEmail(value) {
    try {
      return normalizeEmail(value);
    } catch (error) {
      throw new AppError(400, 'INVALID_EMAIL', error.message);
    }
  }

  password(value) {
    try {
      return validatePassword(value);
    } catch (error) {
      throw new AppError(400, 'WEAK_PASSWORD', error.message);
    }
  }

  async assertResendAllowed(email, purpose) {
    const existing = await this.store.getChallenge(email, purpose);
    if (!existing || this.config.codeResendSeconds === 0) return;
    const elapsed = Date.now() - new Date(existing.createdAt).getTime();
    const cooldown = this.config.codeResendSeconds * 1000;
    if (elapsed < cooldown) {
      const retryAfter = Math.ceil((cooldown - elapsed) / 1000);
      const error = new AppError(429, 'CODE_COOLDOWN', `Новый код можно запросить через ${retryAfter} сек.`);
      error.retryAfter = retryAfter;
      throw error;
    }
  }

  async saveAndSendCode({ email, purpose, passwordHashValue = null }) {
    const code = randomCode();
    await this.store.saveChallenge({
      email,
      purpose,
      passwordHash: passwordHashValue,
      codeHash: codeHash(this.config.codeSecret, purpose, email, code),
      expiresAt: new Date(Date.now() + this.config.codeTtlMinutes * 60_000)
    });
    const result = await this.mailer.sendCode({ email, code, purpose });
    return this.config.exposeDevCodes ? result.devCode : undefined;
  }

  async requestRegistration({ email: rawEmail, password: rawPassword }) {
    const email = this.normalizeEmail(rawEmail);
    const password = this.password(rawPassword);
    if (await this.store.findUserByEmail(email)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Аккаунт с этой почтой уже существует.');
    }
    await this.assertResendAllowed(email, 'register');
    const passwordHashValue = await hashPassword(password);
    const devCode = await this.saveAndSendCode({
      email,
      purpose: 'register',
      passwordHashValue
    });
    return { email, devCode };
  }

  async verifyChallenge(email, purpose, code) {
    if (!/^\d{6}$/.test(String(code || ''))) {
      throw new AppError(400, 'INVALID_CODE', 'Введите все 6 цифр кода.');
    }
    const challenge = await this.store.getChallenge(email, purpose);
    if (!challenge || new Date(challenge.expiresAt) <= new Date()) {
      if (challenge) await this.store.deleteChallenge(email, purpose);
      throw new AppError(400, 'CODE_EXPIRED', 'Код истёк. Запросите новый.');
    }
    if (challenge.attempts >= this.config.maxCodeAttempts) {
      await this.store.deleteChallenge(email, purpose);
      throw new AppError(429, 'CODE_ATTEMPTS', 'Слишком много попыток. Запросите новый код.');
    }
    const expected = codeHash(this.config.codeSecret, purpose, email, String(code));
    if (!safeEqualText(challenge.codeHash, expected)) {
      await this.store.incrementChallengeAttempts(email, purpose);
      throw new AppError(400, 'INVALID_CODE', 'Неверный код. Проверьте цифры и попробуйте ещё раз.');
    }
    return challenge;
  }

  async issueSession(user, meta = {}) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionDays * 86_400_000);
    await this.store.createSession({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      userAgent: String(meta.userAgent || '').slice(0, 300),
      ipAddress: String(meta.ipAddress || '').slice(0, 64),
      expiresAt
    });
    return { token, expiresAt: expiresAt.toISOString(), user: publicUser(user) };
  }

  async verifyRegistration({ email: rawEmail, code }, meta) {
    const email = this.normalizeEmail(rawEmail);
    if (await this.store.findUserByEmail(email)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Аккаунт с этой почтой уже существует.');
    }
    const challenge = await this.verifyChallenge(email, 'register', code);
    const id = crypto.randomUUID();
    let user;
    try {
      user = await this.store.createUser({
        id,
        email,
        passwordHash: challenge.passwordHash,
        gameName: gameNameFromEmail(email, id)
      });
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'EMAIL_EXISTS', 'Аккаунт уже был создан. Выполните вход.');
      }
      throw error;
    }
    await this.store.deleteChallenge(email, 'register');
    return this.issueSession(user, meta);
  }

  async login({ email: rawEmail, password: rawPassword }, meta) {
    const email = this.normalizeEmail(rawEmail);
    const password = String(rawPassword || '');
    const user = await this.store.findUserByEmail(email);
    if (!user) await hashPassword(password || 'invalid-password-0');
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!valid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверная почта или пароль.');
    }
    return this.issueSession(user, meta);
  }

  async requestPasswordReset({ email: rawEmail }) {
    const email = this.normalizeEmail(rawEmail);
    const user = await this.store.findUserByEmail(email);
    if (!user) return { email };
    await this.assertResendAllowed(email, 'reset');
    const devCode = await this.saveAndSendCode({ email, purpose: 'reset' });
    return { email, devCode };
  }

  async resetPassword({ email: rawEmail, code, password: rawPassword }, meta) {
    const email = this.normalizeEmail(rawEmail);
    const password = this.password(rawPassword);
    const user = await this.store.findUserByEmail(email);
    if (!user) throw new AppError(400, 'INVALID_CODE', 'Неверный или истёкший код.');
    await this.verifyChallenge(email, 'reset', code);
    await this.store.updatePassword(user.id, await hashPassword(password));
    await this.store.deleteChallenge(email, 'reset');
    await this.store.deleteSessionsForUser(user.id);
    return this.issueSession(user, meta);
  }

  async sessionFromToken(token, touch = true) {
    if (!token || String(token).length < 32) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Войдите в аккаунт Code5.');
    }
    const session = await this.store.getSession(tokenHash(token));
    if (!session) throw new AppError(401, 'SESSION_EXPIRED', 'Сессия истекла. Войдите снова.');
    if (touch) await this.store.touchSession(session.id);
    return session;
  }

  async getSession(token) {
    const session = await this.sessionFromToken(token);
    return { user: publicUser(session.user), expiresAt: new Date(session.expiresAt).toISOString() };
  }

  async logout(token) {
    if (token) await this.store.deleteSession(tokenHash(token));
  }

  async createLaunchTicket(token) {
    const session = await this.sessionFromToken(token);
    const ticket = randomToken();
    const expiresAt = new Date(Date.now() + this.config.launchTicketSeconds * 1000);
    await this.store.createLaunchTicket({
      id: crypto.randomUUID(),
      userId: session.user.id,
      tokenHash: tokenHash(ticket),
      expiresAt
    });
    return { ticket, expiresAt: expiresAt.toISOString(), user: publicUser(session.user) };
  }

  async consumeLaunchTicket({ ticket, gameName }) {
    if (!ticket || !/^[A-Za-z0-9_-]{40,80}$/.test(String(ticket))) {
      throw new AppError(401, 'INVALID_TICKET', 'Недействительный билет запуска.');
    }
    const user = await this.store.consumeLaunchTicket(tokenHash(ticket), String(gameName || ''));
    if (!user) throw new AppError(401, 'INVALID_TICKET', 'Билет запуска истёк или уже использован.');
    return { user: publicUser(user) };
  }
}

module.exports = { AppError, AuthService, publicUser };
