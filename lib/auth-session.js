const fs = require('fs');
const path = require('path');
const { AuthApiError } = require('./auth-client');

class AuthSession {
  constructor({ client, directory, safeStorage }) {
    this.client = client;
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.token = '';
    this.user = null;
    this.load();
  }

  filePath() {
    return path.join(this.directory, 'account-session.json');
  }

  load() {
    const file = this.filePath();
    if (!fs.existsSync(file) || !this.safeStorage.isEncryptionAvailable()) return;
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.token = this.safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
      this.user = stored.user || null;
    } catch {
      this.clearLocal();
    }
  }

  save() {
    if (!this.token || !this.safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(this.directory, { recursive: true });
    const payload = {
      encryptedToken: this.safeStorage.encryptString(this.token).toString('base64'),
      user: this.user
    };
    const temporary = `${this.filePath()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload), 'utf8');
    if (fs.existsSync(this.filePath())) fs.unlinkSync(this.filePath());
    fs.renameSync(temporary, this.filePath());
  }

  clearLocal() {
    this.token = '';
    this.user = null;
    for (const file of [this.filePath(), `${this.filePath()}.tmp`]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  acceptSession(result) {
    this.token = result.token;
    this.user = result.user;
    this.save();
    return { status: 'authenticated', user: this.user };
  }

  async getState() {
    if (!this.token) return { status: 'anonymous', user: null };
    try {
      const result = await this.client.getSession(this.token);
      this.user = result.user;
      this.save();
      return { status: 'authenticated', user: this.user };
    } catch (error) {
      if (error instanceof AuthApiError && [401, 403].includes(error.status)) {
        this.clearLocal();
        return { status: 'anonymous', user: null, reason: 'expired' };
      }
      return { status: 'unavailable', user: this.user, error: error.message };
    }
  }

  registerRequest(email, password, gameName) {
    return this.client.registerRequest(email, password, gameName);
  }

  async registerVerify(email, code) {
    return this.acceptSession(await this.client.registerVerify(email, code));
  }

  async login(email, password) {
    return this.acceptSession(await this.client.login(email, password));
  }

  passwordRequest(email) {
    return this.client.passwordRequest(email);
  }

  async passwordReset(email, code, password) {
    return this.acceptSession(await this.client.passwordReset(email, code, password));
  }

  async requireSession() {
    if (!this.token) throw new AuthApiError('Войдите в аккаунт Code5.', { status: 401, code: 'AUTH_REQUIRED' });
    try {
      const result = await this.client.getSession(this.token);
      this.user = result.user;
      this.save();
      return this.user;
    } catch (error) {
      this.clearIfRejected(error);
      throw error;
    }
  }

  async createLaunchTicket() {
    if (!this.token) throw new AuthApiError('Войдите в аккаунт Code5.', { status: 401, code: 'AUTH_REQUIRED' });
    try {
      return await this.client.createLaunchTicket(this.token);
    } catch (error) {
      this.clearIfRejected(error);
      throw error;
    }
  }

  clearIfRejected(error) {
    if (error instanceof AuthApiError && [401, 403].includes(error.status)) this.clearLocal();
  }

  async logout() {
    const token = this.token;
    this.clearLocal();
    if (token) await this.client.logout(token).catch(() => {});
    return { status: 'anonymous', user: null };
  }
}

module.exports = { AuthSession };
