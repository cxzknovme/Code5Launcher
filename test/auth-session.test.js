const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AuthApiError } = require('../lib/auth-client');
const { AuthSession } = require('../lib/auth-session');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
  decryptString: (value) => [...value.toString('utf8')].reverse().join('')
};

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code5-auth-session-'));
}

test('persists an encrypted session and restores it', async (context) => {
  const directory = temporaryDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const user = { id: 'user-1', email: 'test@example.com', gameName: 'test_123456' };
  let seenToken = '';
  const client = {
    login: async () => ({ token: 'session-token', user }),
    getSession: async (token) => {
      seenToken = token;
      return { user };
    }
  };

  const first = new AuthSession({ client, directory, safeStorage });
  await first.login('test@example.com', 'Password123!');
  const restored = new AuthSession({ client, directory, safeStorage });
  const state = await restored.getState();

  assert.equal(state.status, 'authenticated');
  assert.equal(seenToken, 'session-token');
  assert.equal(fs.readFileSync(path.join(directory, 'account-session.json'), 'utf8').includes('session-token'), false);
});

test('clears a rejected session before the next launch attempt', async (context) => {
  const directory = temporaryDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = {
    login: async () => ({
      token: 'expired-token',
      user: { id: 'user-1', email: 'test@example.com', gameName: 'test_123456' }
    }),
    getSession: async () => {
      throw new AuthApiError('Сессия истекла.', { status: 401, code: 'SESSION_EXPIRED' });
    }
  };

  const session = new AuthSession({ client, directory, safeStorage });
  await session.login('test@example.com', 'Password123!');
  await assert.rejects(() => session.requireSession(), { code: 'SESSION_EXPIRED' });

  assert.equal(session.token, '');
  assert.equal(fs.existsSync(path.join(directory, 'account-session.json')), false);
});
