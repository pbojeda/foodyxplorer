// API server entry point.
//
// Builds the Fastify application, binds to the configured port, and registers
// graceful shutdown handlers for SIGTERM and SIGINT.
//
// This file is NOT unit tested — it is the process entry point. Tests import
// buildApp() directly from app.ts and use .inject().

import * as Sentry from '@sentry/node';
import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { initSentry, captureException } from './lib/sentry.js';

let shuttingDown = false;

const main = async (): Promise<void> => {
  // F030-lite: initialize Sentry BEFORE buildApp() so startup errors and
  // request-path 5xx errors are captured. No-op unless NODE_ENV=production
  // AND SENTRY_DSN is set (see lib/sentry.ts).
  initSentry(config.SENTRY_DSN, config.NODE_ENV);

  const server = await buildApp();

  // Register graceful shutdown handlers before listen() so signals received
  // during startup are handled correctly.
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[server] Received ${signal}, shutting down gracefully`);

    try {
      await server.close();
      await prisma.$disconnect();
      await disconnectRedis();
      // Flush pending Sentry events with a bounded timeout (no-op when SDK
      // was not initialized — Sentry.close returns immediately).
      await Sentry.close(2000);
      console.log('[server] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[server] Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Connect to Redis after app is built (fail-open: warn and continue if unavailable)
  await connectRedis();

  await server.listen({ port: config.PORT, host: '0.0.0.0' });

  console.log(`[server] Listening on port ${config.PORT}`);
};

main().catch((err: unknown) => {
  console.error('[server] Fatal startup error', err);
  // Capture the startup failure so beta operators see it in Sentry rather
  // than only in ephemeral Render logs. Flush before exit so the event
  // actually reaches Sentry — captureException + Sentry.close are no-ops
  // when the SDK was not initialized.
  captureException(err, { internalCode: 'STARTUP_FAILURE' });
  void Sentry.close(2000).then(() => {
    process.exit(1);
  });
});
