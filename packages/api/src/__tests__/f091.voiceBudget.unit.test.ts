// F091 — Unit tests for voiceBudget.ts
//
// Tests the Lua-script-based voice spend accumulator and related helpers.
// The Lua script itself is opaque — tests mock redis.eval return values
// simulating all result scenarios. Slack alert dispatch uses a globalThis.fetch mock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkBudgetExhausted,
  incrementSpendAndCheck,
  dispatchSlackAlerts,
  type VoiceBudgetData,
  type AlertFired,
} from '../lib/voiceBudget.js';

// ---------------------------------------------------------------------------
// Mock Redis factory
// ---------------------------------------------------------------------------

function createMockRedis(evalResult: string | null = null) {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
    get: vi.fn().mockResolvedValue(evalResult),
  };
}

function createFailingRedis() {
  return {
    eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  };
}

// ---------------------------------------------------------------------------
// Helper to build the JSON string that the Lua script would return
// ---------------------------------------------------------------------------

function makeLuaResult(data: VoiceBudgetData, alertsFired: AlertFired[] = []): string {
  return JSON.stringify({ data, alertsFired });
}

// ---------------------------------------------------------------------------
// Tests: checkBudgetExhausted
// ---------------------------------------------------------------------------

describe('checkBudgetExhausted', () => {
  it('returns false when Redis key does not exist (null)', async () => {
    const redis = createMockRedis(null);
    expect(await checkBudgetExhausted(redis as Parameters<typeof checkBudgetExhausted>[0])).toBe(false);
  });

  it('returns false when budget data has exhausted: false', async () => {
    const data: VoiceBudgetData = {
      exhausted: false,
      spendEur: 20,
      capEur: 100,
      alertLevel: 'none',
      monthKey: '2026-04',
    };
    const redis = createMockRedis(JSON.stringify(data));
    expect(await checkBudgetExhausted(redis as Parameters<typeof checkBudgetExhausted>[0])).toBe(false);
  });

  it('returns true when budget data has exhausted: true', async () => {
    const data: VoiceBudgetData = {
      exhausted: true,
      spendEur: 100.5,
      capEur: 100,
      alertLevel: 'cap',
      monthKey: '2026-04',
    };
    const redis = createMockRedis(JSON.stringify(data));
    expect(await checkBudgetExhausted(redis as Parameters<typeof checkBudgetExhausted>[0])).toBe(true);
  });

  it('returns false (fail-open) when Redis throws', async () => {
    const redis = createFailingRedis();
    expect(await checkBudgetExhausted(redis as Parameters<typeof checkBudgetExhausted>[0])).toBe(false);
  });

  it('returns false when Redis returns malformed JSON', async () => {
    const redis = createMockRedis('not-valid-json');
    expect(await checkBudgetExhausted(redis as Parameters<typeof checkBudgetExhausted>[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: incrementSpendAndCheck — mocking redis.eval return values
// ---------------------------------------------------------------------------

describe('incrementSpendAndCheck', () => {
  const MONTH_KEY = '2026-04';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fresh month: initialises budget with correct spend for 60s at $0.006/min', async () => {
    // 60s * (0.006/60) USD * 0.92 EUR/USD = 0.0092 EUR
    const expectedSpend = 60 * (0.006 / 60) * 0.92;
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: expectedSpend,
      capEur: 100,
      alertLevel: 'none',
      monthKey: MONTH_KEY,
    };
    const redis = createMockRedis(makeLuaResult(resultData, []));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      60,
    );

    expect(redis.eval).toHaveBeenCalledOnce();
    expect(result.data.spendEur).toBeCloseTo(expectedSpend, 6);
    expect(result.data.exhausted).toBe(false);
    expect(result.alertsFired).toHaveLength(0);
  });

  it('mid-month: accumulated spend reflects previous + new increment', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: 25.5,
      capEur: 100,
      alertLevel: 'none',
      monthKey: MONTH_KEY,
    };
    const redis = createMockRedis(makeLuaResult(resultData, []));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      30,
    );

    expect(result.data.spendEur).toBe(25.5);
    expect(result.alertsFired).toHaveLength(0);
  });

  it('threshold crossing at 40 EUR fires warn40 alert', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: 40.5,
      capEur: 100,
      alertLevel: 'warn40',
      monthKey: MONTH_KEY,
    };
    const alertsFired: AlertFired[] = [{ threshold: 40 }];
    const redis = createMockRedis(makeLuaResult(resultData, alertsFired));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      120,
    );

    expect(result.data.alertLevel).toBe('warn40');
    expect(result.alertsFired).toHaveLength(1);
    expect(result.alertsFired[0]?.threshold).toBe(40);
  });

  it('threshold crossing at 70 EUR fires warn70 alert', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: 70.2,
      capEur: 100,
      alertLevel: 'warn70',
      monthKey: MONTH_KEY,
    };
    const alertsFired: AlertFired[] = [{ threshold: 70 }];
    const redis = createMockRedis(makeLuaResult(resultData, alertsFired));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      300,
    );

    expect(result.alertsFired[0]?.threshold).toBe(70);
  });

  it('threshold crossing at 90 EUR fires warn90 alert', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: 90.1,
      capEur: 100,
      alertLevel: 'warn90',
      monthKey: MONTH_KEY,
    };
    const alertsFired: AlertFired[] = [{ threshold: 90 }];
    const redis = createMockRedis(makeLuaResult(resultData, alertsFired));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      600,
    );

    expect(result.alertsFired[0]?.threshold).toBe(90);
  });

  it('exhausted when spend >= 100: exhausted: true returned', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: true,
      spendEur: 101.2,
      capEur: 100,
      alertLevel: 'cap',
      monthKey: MONTH_KEY,
    };
    const alertsFired: AlertFired[] = [{ threshold: 100 }];
    const redis = createMockRedis(makeLuaResult(resultData, alertsFired));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      1200,
    );

    expect(result.data.exhausted).toBe(true);
    expect(result.data.alertLevel).toBe('cap');
    expect(result.alertsFired[0]?.threshold).toBe(100);
  });

  it('month rollover: new month resets spend and returns updated monthKey', async () => {
    const resultData: VoiceBudgetData = {
      exhausted: false,
      spendEur: 0.0092,
      capEur: 100,
      alertLevel: 'none',
      monthKey: '2026-05', // new month
    };
    const redis = createMockRedis(makeLuaResult(resultData, []));

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      60,
    );

    expect(result.data.monthKey).toBe('2026-05');
    expect(result.data.spendEur).toBeCloseTo(0.0092, 4);
  });

  it('returns safe default on Redis eval failure (fail-open)', async () => {
    const redis = createFailingRedis();

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      60,
    );

    expect(result.data.exhausted).toBe(false);
    expect(result.alertsFired).toHaveLength(0);
  });

  it('returns safe default on malformed JSON from eval', async () => {
    const redis = createMockRedis('not-json');

    const result = await incrementSpendAndCheck(
      redis as Parameters<typeof incrementSpendAndCheck>[0],
      60,
    );

    expect(result.data.exhausted).toBe(false);
    expect(result.alertsFired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: dispatchSlackAlerts
// ---------------------------------------------------------------------------

describe('dispatchSlackAlerts', () => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore globalThis.fetch after each test
    vi.restoreAllMocks();
  });

  it('does nothing when alertsFired is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await dispatchSlackAlerts([], 50, 'https://hooks.slack.com/test', logger);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when webhookUrl is falsy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await dispatchSlackAlerts([{ threshold: 40 }], 42, undefined, logger);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls fetch once per alert with correct Slack payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await dispatchSlackAlerts(
      [{ threshold: 70 }],
      72.5,
      'https://hooks.slack.com/test',
      logger,
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.com/test');
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(String(body['text'])).toContain('72.5');
    expect(String(body['text'])).toContain('70');
  });

  it('fires once for each alert in the array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await dispatchSlackAlerts(
      [{ threshold: 40 }, { threshold: 70 }],
      72,
      'https://hooks.slack.com/test',
      logger,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
