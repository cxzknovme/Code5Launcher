const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { Mailer } = require('./mailer');
const { AuthService } = require('./service');
const { MemoryStore, PostgresStore } = require('./store');

async function main() {
  const config = loadConfig();
  const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new MemoryStore();
  const mailer = new Mailer(config.smtp);
  await store.init();
  await mailer.verify();

  const service = new AuthService({ store, mailer, config });
  const app = createApp({ service, store, config });
  const server = app.listen(config.port, config.host, () => {
    const storage = config.databaseUrl ? 'PostgreSQL' : 'memory';
    console.log(`[auth-server] listening on ${config.host}:${config.port}, storage=${storage}`);
  });

  const pruneTimer = setInterval(() => store.prune().catch((error) => {
    console.error('[auth-server] prune failed', error);
  }), 60 * 60 * 1000);
  pruneTimer.unref();

  const shutdown = async () => {
    clearInterval(pruneTimer);
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[auth-server] startup failed', error);
  process.exit(1);
});
