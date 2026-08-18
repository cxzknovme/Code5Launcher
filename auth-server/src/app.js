const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { AppError } = require('./service');
const { safeEqualText } = require('./security');

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function requestMeta(request) {
  return {
    userAgent: request.headers['user-agent'] || '',
    ipAddress: request.ip || request.socket.remoteAddress || ''
  };
}

function createApp({ service, store, config, disableRateLimits = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '16kb', strict: true }));

  if (!disableRateLimits) {
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { ok: false, code: 'RATE_LIMIT', error: 'Слишком много запросов. Попробуйте позже.' }
    }));
  }

  const sensitiveLimit = disableRateLimits
    ? (_request, _response, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { ok: false, code: 'RATE_LIMIT', error: 'Слишком много попыток. Подождите немного.' }
      });
  const serverTicketLimit = disableRateLimits
    ? (_request, _response, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { ok: false, code: 'RATE_LIMIT', error: 'Слишком много проверок билетов.' }
      });

  app.get('/health', asyncRoute(async (_request, response) => {
    await store.ping();
    response.json({ ok: true });
  }));

  app.post('/v1/auth/register/request', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.requestRegistration(request.body || {});
    response.json({ ok: true, ...result });
  }));

  app.post('/v1/auth/register/verify', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.verifyRegistration(request.body || {}, requestMeta(request));
    response.status(201).json({ ok: true, ...result });
  }));

  app.post('/v1/auth/login', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.login(request.body || {}, requestMeta(request));
    response.json({ ok: true, ...result });
  }));

  app.post('/v1/auth/password/request', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.requestPasswordReset(request.body || {});
    response.json({ ok: true, ...result });
  }));

  app.post('/v1/auth/password/reset', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.resetPassword(request.body || {}, requestMeta(request));
    response.json({ ok: true, ...result });
  }));

  app.get('/v1/auth/session', asyncRoute(async (request, response) => {
    const result = await service.getSession(bearerToken(request));
    response.json({ ok: true, ...result });
  }));

  app.post('/v1/auth/logout', asyncRoute(async (request, response) => {
    await service.logout(bearerToken(request));
    response.json({ ok: true });
  }));

  app.post('/v1/auth/tickets', sensitiveLimit, asyncRoute(async (request, response) => {
    const result = await service.createLaunchTicket(bearerToken(request));
    response.status(201).json({ ok: true, ...result });
  }));

  app.post('/v1/server/tickets/consume', serverTicketLimit, asyncRoute(async (request, response) => {
    if (!safeEqualText(request.headers['x-code5-server-key'], config.serverApiKey)) {
      throw new AppError(401, 'SERVER_AUTH_REQUIRED', 'Сервер не авторизован.');
    }
    const result = await service.consumeLaunchTicket(request.body || {});
    response.json({ ok: true, ...result });
  }));

  app.use((_request, response) => {
    response.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Маршрут не найден.' });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && error.status === 400) {
      response.status(400).json({ ok: false, code: 'INVALID_JSON', error: 'Некорректный запрос.' });
      return;
    }
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('[auth-server]', error);
    const payload = {
      ok: false,
      code: error.code || 'INTERNAL_ERROR',
      error: status >= 500 ? 'Сервис временно недоступен.' : error.message
    };
    if (error.retryAfter) payload.retryAfter = error.retryAfter;
    response.status(status).json(payload);
  });

  return app;
}

module.exports = { bearerToken, createApp };
