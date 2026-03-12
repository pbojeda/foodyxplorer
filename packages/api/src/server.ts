// API server entry point.
//
// Builds the Fastify application, binds to the configured port, and registers
// graceful shutdown handlers for SIGTERM and SIGINT.
//
// This file is NOT unit tested — it is the process entry point. Tests import
// buildApp() directly from app.ts and use .inject().

import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';

let shuttingDown = false;

const main = async (): Promise<void> => {
  const server = buildApp();
  await server.ready();

  // Register graceful shutdown handlers before listen() so signals received
  // during startup are handled correctly.
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[server] Received ${signal}, shutting down gracefully`);

    try {
      await server.close();
      await prisma.$disconnect();
      console.log('[server] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[server] Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  await server.listen({ port: config.PORT, host: '0.0.0.0' });

  console.log(`[server] Listening on port ${config.PORT}`);
};

main().catch((err: unknown) => {
  console.error('[server] Fatal startup error', err);
  process.exit(1);
});
