// Integration tests for F113 — web_metrics_events migration
//
// Tests: insert, nullable ip_hash, jsonb columns, defaults, index, no-FK.
// Fixture UUID pattern: fd000000-0113-4000-a000-000000000XXX

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// web_metrics_events — Schema correctness
// ---------------------------------------------------------------------------

describe('WebMetricsEvent — Schema correctness', () => {
  const EVENT_ID = 'fd000000-0113-4000-a000-000000000001';

  beforeAll(async () => {
    await prisma.webMetricsEvent.deleteMany({ where: { id: EVENT_ID } });
  });

  afterAll(async () => {
    await prisma.webMetricsEvent.deleteMany({ where: { id: EVENT_ID } });
    // Clean up any auto-id rows created in tests
    await prisma.$executeRaw`DELETE FROM web_metrics_events WHERE session_started_at < NOW() - INTERVAL '1 minute'`;
  });

  it('inserts a web_metrics_events row with all columns populated and reads it back', async () => {
    const event = await prisma.webMetricsEvent.create({
      data: {
        id: EVENT_ID,
        queryCount: 5,
        successCount: 4,
        errorCount: 1,
        retryCount: 0,
        intents: { nutritional_query: 3, comparison: 1 },
        errors: { NETWORK_ERROR: 1 },
        avgResponseTimeMs: 1200,
        sessionStartedAt: new Date('2026-04-08T10:00:00.000Z'),
        ipHash: 'abc123deadbeef',
      },
    });

    expect(event.id).toBe(EVENT_ID);
    expect(event.queryCount).toBe(5);
    expect(event.successCount).toBe(4);
    expect(event.errorCount).toBe(1);
    expect(event.retryCount).toBe(0);
    expect(event.intents).toEqual({ nutritional_query: 3, comparison: 1 });
    expect(event.errors).toEqual({ NETWORK_ERROR: 1 });
    expect(event.avgResponseTimeMs).toBe(1200);
    expect(event.sessionStartedAt).toBeInstanceOf(Date);
    expect(event.ipHash).toBe('abc123deadbeef');
    expect(event.receivedAt).toBeInstanceOf(Date);
  });

  it('ip_hash: null is valid', async () => {
    const event = await prisma.webMetricsEvent.create({
      data: {
        queryCount: 1,
        successCount: 1,
        errorCount: 0,
        retryCount: 0,
        intents: {},
        errors: {},
        avgResponseTimeMs: 0,
        sessionStartedAt: new Date(),
        ipHash: null,
      },
    });

    expect(event.ipHash).toBeNull();
    // cleanup
    await prisma.webMetricsEvent.delete({ where: { id: event.id } });
  });

  it('intents and errors are stored as JSONB and read back as objects', async () => {
    const event = await prisma.webMetricsEvent.findUnique({
      where: { id: EVENT_ID },
    });

    expect(typeof event?.intents).toBe('object');
    expect(typeof event?.errors).toBe('object');
  });

  it('received_at defaults to now() when omitted', async () => {
    const before = new Date();
    const event = await prisma.webMetricsEvent.create({
      data: {
        queryCount: 1,
        successCount: 0,
        errorCount: 1,
        retryCount: 0,
        intents: {},
        errors: { TIMEOUT: 1 },
        avgResponseTimeMs: 500,
        sessionStartedAt: new Date(),
      },
    });

    expect(event.receivedAt).toBeInstanceOf(Date);
    expect(event.receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // cleanup
    await prisma.webMetricsEvent.delete({ where: { id: event.id } });
  });

  it('id defaults to gen_random_uuid() when omitted', async () => {
    const event = await prisma.webMetricsEvent.create({
      data: {
        queryCount: 1,
        successCount: 1,
        errorCount: 0,
        retryCount: 0,
        intents: {},
        errors: {},
        avgResponseTimeMs: 100,
        sessionStartedAt: new Date(),
      },
    });

    expect(event.id).toBeTruthy();
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // cleanup
    await prisma.webMetricsEvent.delete({ where: { id: event.id } });
  });

  it('index web_metrics_events_received_at_idx exists', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'web_metrics_events'
        AND indexname = 'web_metrics_events_received_at_idx'
    `;

    expect(rows.length).toBe(1);
    expect(rows[0]?.['indexname']).toBe('web_metrics_events_received_at_idx');
  });

  it('no FK to actors table — row accepted with any ip_hash string', async () => {
    // ip_hash is VARCHAR(64), not a UUID FK — this insert must succeed
    const event = await prisma.webMetricsEvent.create({
      data: {
        queryCount: 2,
        successCount: 2,
        errorCount: 0,
        retryCount: 0,
        intents: { test: 1 },
        errors: {},
        avgResponseTimeMs: 300,
        sessionStartedAt: new Date(),
        ipHash: 'not-a-uuid-just-a-string',
      },
    });

    expect(event.ipHash).toBe('not-a-uuid-just-a-string');
    // cleanup
    await prisma.webMetricsEvent.delete({ where: { id: event.id } });
  });
});
