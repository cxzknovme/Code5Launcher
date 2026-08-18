const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/service');
const { MemoryStore } = require('../src/store');

const config = {
  codeSecret: 'test-code-secret-that-is-long-enough',
  serverApiKey: 'test-server-api-key-that-is-long-enough',
  sessionDays: 30,
  codeTtlMinutes: 10,
  codeResendSeconds: 0,
  launchTicketSeconds: 90,
  maxCodeAttempts: 5,
  exposeDevCodes: true
};

const mailer = {
  async sendCode({ code }) {
    return { devCode: code };
  }
};

const store = new MemoryStore();
const service = new AuthService({ store, mailer, config });
const app = createApp({ service, store, config, disableRateLimits: true });
let server;
let baseUrl;

async function request(path, { method = 'POST', body, token, serverKey } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(serverKey ? { 'x-code5-server-key': serverKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  await store.init();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await store.close();
});

test('registration, session and one-time launch ticket', async () => {
  const weak = await request('/v1/auth/register/request', {
    body: { email: 'hero@example.com', password: 'short' }
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.data.code, 'WEAK_PASSWORD');

  const requested = await request('/v1/auth/register/request', {
    body: { email: 'Hero@Example.com', password: 'StrongPassword42' }
  });
  assert.equal(requested.status, 200);
  assert.match(requested.data.devCode, /^\d{6}$/);

  const verified = await request('/v1/auth/register/verify', {
    body: { email: 'hero@example.com', code: requested.data.devCode }
  });
  assert.equal(verified.status, 201);
  assert.equal(verified.data.user.email, 'hero@example.com');
  assert.match(verified.data.user.gameName, /^hero_[a-f0-9]{6}$/);
  assert.ok(verified.data.token.length >= 40);

  const session = await request('/v1/auth/session', { method: 'GET', token: verified.data.token });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.gameName, verified.data.user.gameName);

  const issued = await request('/v1/auth/tickets', { token: verified.data.token });
  assert.equal(issued.status, 201);

  const consumed = await request('/v1/server/tickets/consume', {
    serverKey: config.serverApiKey,
    body: { ticket: issued.data.ticket, gameName: verified.data.user.gameName }
  });
  assert.equal(consumed.status, 200);
  assert.equal(consumed.data.user.id, verified.data.user.id);

  const replay = await request('/v1/server/tickets/consume', {
    serverKey: config.serverApiKey,
    body: { ticket: issued.data.ticket, gameName: verified.data.user.gameName }
  });
  assert.equal(replay.status, 401);
});

test('password recovery revokes the old session', async () => {
  const login = await request('/v1/auth/login', {
    body: { email: 'hero@example.com', password: 'StrongPassword42' }
  });
  assert.equal(login.status, 200);

  const resetRequest = await request('/v1/auth/password/request', {
    body: { email: 'hero@example.com' }
  });
  assert.match(resetRequest.data.devCode, /^\d{6}$/);

  const reset = await request('/v1/auth/password/reset', {
    body: {
      email: 'hero@example.com',
      code: resetRequest.data.devCode,
      password: 'NewStrongPassword84'
    }
  });
  assert.equal(reset.status, 200);

  const oldSession = await request('/v1/auth/session', { method: 'GET', token: login.data.token });
  assert.equal(oldSession.status, 401);

  const newLogin = await request('/v1/auth/login', {
    body: { email: 'hero@example.com', password: 'NewStrongPassword84' }
  });
  assert.equal(newLogin.status, 200);
});
