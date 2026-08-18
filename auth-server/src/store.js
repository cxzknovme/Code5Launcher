const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    gameName: row.game_name,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at
  };
}

class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async init() {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '001_initial.sql'),
      'utf8'
    );
    await this.pool.query(migration);
  }

  async close() {
    await this.pool.end();
  }

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return userFromRow(result.rows[0]);
  }

  async findUserById(id) {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return userFromRow(result.rows[0]);
  }

  async createUser(user) {
    const result = await this.pool.query(
      `INSERT INTO users (id, email, password_hash, game_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user.id, user.email, user.passwordHash, user.gameName]
    );
    return userFromRow(result.rows[0]);
  }

  async updatePassword(userId, passwordHash) {
    await this.pool.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
      [userId, passwordHash]
    );
  }

  async saveChallenge(challenge) {
    await this.pool.query(
      `INSERT INTO email_challenges
         (email, purpose, code_hash, password_hash, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, NOW())
       ON CONFLICT (email, purpose) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         password_hash = EXCLUDED.password_hash,
         attempts = 0,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [
        challenge.email,
        challenge.purpose,
        challenge.codeHash,
        challenge.passwordHash || null,
        challenge.expiresAt
      ]
    );
  }

  async getChallenge(email, purpose) {
    const result = await this.pool.query(
      'SELECT * FROM email_challenges WHERE email = $1 AND purpose = $2',
      [email, purpose]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      email: row.email,
      purpose: row.purpose,
      codeHash: row.code_hash,
      passwordHash: row.password_hash,
      attempts: row.attempts,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    };
  }

  async incrementChallengeAttempts(email, purpose) {
    await this.pool.query(
      'UPDATE email_challenges SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2',
      [email, purpose]
    );
  }

  async deleteChallenge(email, purpose) {
    await this.pool.query(
      'DELETE FROM email_challenges WHERE email = $1 AND purpose = $2',
      [email, purpose]
    );
  }

  async createSession(session) {
    await this.pool.query(
      `INSERT INTO sessions
         (id, user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.userAgent || null,
        session.ipAddress || null,
        session.expiresAt
      ]
    );
  }

  async getSession(tokenHashValue) {
    const result = await this.pool.query(
      `SELECT
         s.id AS session_id,
         s.expires_at AS session_expires_at,
         u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHashValue]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.session_id,
      expiresAt: row.session_expires_at,
      user: userFromRow(row)
    };
  }

  async touchSession(sessionId) {
    await this.pool.query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [sessionId]);
  }

  async deleteSession(tokenHashValue) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHashValue]);
  }

  async deleteSessionsForUser(userId) {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async createLaunchTicket(ticket) {
    await this.pool.query(
      `INSERT INTO launch_tickets (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [ticket.id, ticket.userId, ticket.tokenHash, ticket.expiresAt]
    );
  }

  async consumeLaunchTicket(tokenHashValue, gameName) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(
        `DELETE FROM launch_tickets
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHashValue]
      );
      if (!deleted.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const userResult = await client.query('SELECT * FROM users WHERE id = $1', [deleted.rows[0].user_id]);
      await client.query('COMMIT');
      const user = userFromRow(userResult.rows[0]);
      return user && user.gameName === gameName ? user : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async prune() {
    await this.pool.query('DELETE FROM email_challenges WHERE expires_at <= NOW()');
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    await this.pool.query('DELETE FROM launch_tickets WHERE expires_at <= NOW()');
  }
}

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.challenges = new Map();
    this.sessions = new Map();
    this.tickets = new Map();
  }

  async init() {}
  async close() {}
  async ping() { return true; }

  async findUserByEmail(email) {
    return [...this.users.values()].find((user) => user.email === email) || null;
  }

  async findUserById(id) {
    return this.users.get(id) || null;
  }

  async createUser(user) {
    if (await this.findUserByEmail(user.email)) {
      const error = new Error('duplicate email');
      error.code = '23505';
      throw error;
    }
    if ([...this.users.values()].some((item) => item.gameName === user.gameName)) {
      const error = new Error('duplicate game name');
      error.code = '23505';
      throw error;
    }
    const stored = {
      ...user,
      emailVerifiedAt: new Date(),
      createdAt: new Date()
    };
    this.users.set(user.id, stored);
    return stored;
  }

  async updatePassword(userId, passwordHashValue) {
    const user = this.users.get(userId);
    if (user) user.passwordHash = passwordHashValue;
  }

  challengeKey(email, purpose) {
    return `${purpose}:${email}`;
  }

  async saveChallenge(challenge) {
    this.challenges.set(this.challengeKey(challenge.email, challenge.purpose), {
      ...challenge,
      attempts: 0,
      createdAt: new Date()
    });
  }

  async getChallenge(email, purpose) {
    return this.challenges.get(this.challengeKey(email, purpose)) || null;
  }

  async incrementChallengeAttempts(email, purpose) {
    const challenge = await this.getChallenge(email, purpose);
    if (challenge) challenge.attempts += 1;
  }

  async deleteChallenge(email, purpose) {
    this.challenges.delete(this.challengeKey(email, purpose));
  }

  async createSession(session) {
    this.sessions.set(session.tokenHash, { ...session, createdAt: new Date() });
  }

  async getSession(tokenHashValue) {
    const session = this.sessions.get(tokenHashValue);
    if (!session || session.expiresAt <= new Date()) return null;
    const user = this.users.get(session.userId);
    return user ? { ...session, user } : null;
  }

  async touchSession() {}

  async deleteSession(tokenHashValue) {
    this.sessions.delete(tokenHashValue);
  }

  async deleteSessionsForUser(userId) {
    for (const [key, session] of this.sessions.entries()) {
      if (session.userId === userId) this.sessions.delete(key);
    }
  }

  async createLaunchTicket(ticket) {
    this.tickets.set(ticket.tokenHash, { ...ticket });
  }

  async consumeLaunchTicket(tokenHashValue, gameName) {
    const ticket = this.tickets.get(tokenHashValue);
    this.tickets.delete(tokenHashValue);
    if (!ticket || ticket.expiresAt <= new Date()) return null;
    const user = this.users.get(ticket.userId);
    return user && user.gameName === gameName ? user : null;
  }

  async prune() {
    const now = new Date();
    for (const [key, challenge] of this.challenges.entries()) {
      if (challenge.expiresAt <= now) this.challenges.delete(key);
    }
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
    for (const [key, ticket] of this.tickets.entries()) {
      if (ticket.expiresAt <= now) this.tickets.delete(key);
    }
  }
}

module.exports = { MemoryStore, PostgresStore };
