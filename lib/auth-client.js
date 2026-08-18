const http = require('http');
const https = require('https');

class AuthApiError extends Error {
  constructor(message, { status = 0, code = 'AUTH_UNAVAILABLE', retryAfter = 0 } = {}) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

class AuthClient {
  constructor(baseUrl, { timeoutMs = 12_000 } = {}) {
    this.baseUrl = new URL(baseUrl);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(this.baseUrl.hostname);
    if (this.baseUrl.protocol !== 'https:' && !(this.baseUrl.protocol === 'http:' && loopback)) {
      throw new Error('Code5 Auth API должен использовать HTTPS. HTTP разрешён только локально.');
    }
    if (this.baseUrl.username || this.baseUrl.password) {
      throw new Error('Auth API URL не должен содержать логин или пароль.');
    }
    this.timeoutMs = timeoutMs;
  }

  request(endpoint, { method = 'GET', body, token } = {}) {
    const url = new URL(endpoint, this.baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method,
        timeout: this.timeoutMs,
        headers: {
          accept: 'application/json',
          'user-agent': 'Code5Launcher',
          ...(payload ? {
            'content-type': 'application/json',
            'content-length': payload.length
          } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 128 * 1024) {
            request.destroy(new Error('Auth API вернул слишком большой ответ.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          let data;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            reject(new AuthApiError('Сервис аккаунтов вернул некорректный ответ.'));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300 || data.ok === false) {
            reject(new AuthApiError(data.error || 'Не удалось выполнить запрос.', {
              status: response.statusCode,
              code: data.code || 'AUTH_REQUEST_FAILED',
              retryAfter: data.retryAfter || 0
            }));
            return;
          }
          resolve(data);
        });
      });

      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (error) => {
        if (error instanceof AuthApiError) {
          reject(error);
          return;
        }
        const message = error.message === 'timeout'
          ? 'Сервис аккаунтов не ответил вовремя.'
          : 'Не удалось подключиться к сервису аккаунтов.';
        reject(new AuthApiError(message));
      });
      if (payload) request.write(payload);
      request.end();
    });
  }

  registerRequest(email, password) {
    return this.request('/v1/auth/register/request', { method: 'POST', body: { email, password } });
  }

  registerVerify(email, code) {
    return this.request('/v1/auth/register/verify', { method: 'POST', body: { email, code } });
  }

  login(email, password) {
    return this.request('/v1/auth/login', { method: 'POST', body: { email, password } });
  }

  passwordRequest(email) {
    return this.request('/v1/auth/password/request', { method: 'POST', body: { email } });
  }

  passwordReset(email, code, password) {
    return this.request('/v1/auth/password/reset', {
      method: 'POST',
      body: { email, code, password }
    });
  }

  getSession(token) {
    return this.request('/v1/auth/session', { token });
  }

  logout(token) {
    return this.request('/v1/auth/logout', { method: 'POST', token });
  }

  createLaunchTicket(token) {
    return this.request('/v1/auth/tickets', { method: 'POST', token });
  }
}

module.exports = { AuthApiError, AuthClient };
