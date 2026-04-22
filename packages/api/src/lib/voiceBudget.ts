// voiceBudget.ts — Monthly voice spend accumulator (F091 AC26)
//
// Tracks cumulative OpenAI Whisper spend against a €100/month hard cap.
// All Redis updates are atomic via a Lua script (read-modify-write).
// No cron job — fully in-process, called inline from POST /conversation/audio.
//
// Redis keys:
//   budget:voice:current-month       → JSON VoiceBudgetData (no TTL — manually reset)
//   budget:voice:alerted:<N>:<YYYY-MM> → "1" with 35-day TTL (alert dedup)
//
// Cost formula:
//   EUR = durationSec × ($0.006 / 60) × 0.92  (USD→EUR at hardcoded 0.92)
//   Whisper pricing: $0.006 per minute (as of 2026)
//
// Failure policy: fail-open — all functions return safe defaults on Redis errors.

import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Public types (exported for tests and route consumers)
// ---------------------------------------------------------------------------

export interface VoiceBudgetData {
  exhausted: boolean;
  spendEur: number;
  capEur: 100;
  alertLevel: 'none' | 'warn40' | 'warn70' | 'warn90' | 'warn100' | 'cap';
  monthKey: string; // 'YYYY-MM'
}

export interface AlertFired {
  threshold: 40 | 70 | 90 | 100;
}

export interface IncrementResult {
  data: VoiceBudgetData;
  alertsFired: AlertFired[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUDGET_KEY = 'budget:voice:current-month';
const CAP_EUR = 100;
// USD→EUR exchange rate (hardcoded; drift is accepted per spec)
const USD_TO_EUR = 0.92;
// Whisper cost: $0.006 per minute
const WHISPER_COST_PER_MIN_USD = 0.006;
const ALERT_THRESHOLDS = [40, 70, 90, 100] as const;

// ---------------------------------------------------------------------------
// Safe default returned on any Redis / parse failure
// ---------------------------------------------------------------------------

function safeDefault(): IncrementResult {
  return {
    data: {
      exhausted: false,
      spendEur: 0,
      capEur: CAP_EUR,
      alertLevel: 'none',
      monthKey: new Date().toISOString().slice(0, 7),
    },
    alertsFired: [],
  };
}

// ---------------------------------------------------------------------------
// Lua script — atomic read-modify-write on budget:voice:current-month
//
// Arguments:
//   KEYS[1]  = 'budget:voice:current-month'
//   ARGV[1]  = increment in EUR (number string)
//   ARGV[2]  = current month key 'YYYY-MM'
//   ARGV[3]  = JSON array of already-fired alert keys to check (comma-separated threshold values)
//
// Returns: JSON string { data: VoiceBudgetData, alertsFired: AlertFired[] }
//
// Month rollover logic:
//   If stored monthKey !== ARGV[2], reset spendEur to 0 before accumulating.
//   The alerted:<N>:<old-month> keys will expire naturally (35-day TTL).
// ---------------------------------------------------------------------------

const LUA_SCRIPT = `
local key = KEYS[1]
local incrementEur = tonumber(ARGV[1])
local currentMonth = ARGV[2]
local capEur = 100

-- Read existing data
local raw = redis.call('GET', key)
local data = { exhausted = false, spendEur = 0, capEur = 100, alertLevel = 'none', monthKey = currentMonth }

if raw then
  local ok, parsed = pcall(cjson.decode, raw)
  if ok and parsed then
    data = parsed
  end
end

-- Month rollover: reset if month changed
if data.monthKey ~= currentMonth then
  data.spendEur = 0
  data.exhausted = false
  data.alertLevel = 'none'
  data.monthKey = currentMonth
end

-- Accumulate spend
local prevSpend = data.spendEur or 0
data.spendEur = prevSpend + incrementEur

-- Determine exhausted state and alert level
local alertsFired = {}
local thresholds = {40, 70, 90, 100}

if data.spendEur >= capEur then
  data.exhausted = true
  data.alertLevel = 'cap'
else
  data.exhausted = false
end

-- Check which thresholds were newly crossed
for i, threshold in ipairs(thresholds) do
  local thresholdEur = (threshold / 100) * capEur
  if data.spendEur >= thresholdEur and prevSpend < thresholdEur then
    -- Check dedup key
    local dedupKey = 'budget:voice:alerted:' .. threshold .. ':' .. currentMonth
    local alreadyFired = redis.call('EXISTS', dedupKey)
    if alreadyFired == 0 then
      redis.call('SET', dedupKey, '1')
      redis.call('EXPIRE', dedupKey, 3024000)  -- 35 days
      table.insert(alertsFired, { threshold = threshold })
      if threshold == 40 then data.alertLevel = 'warn40'
      elseif threshold == 70 then data.alertLevel = 'warn70'
      elseif threshold == 90 then data.alertLevel = 'warn90'
      elseif threshold == 100 then data.alertLevel = 'warn100'
      end
    end
  end
end

if data.exhausted then
  data.alertLevel = 'cap'
end

-- Persist updated data
redis.call('SET', key, cjson.encode(data))

return cjson.encode({ data = data, alertsFired = alertsFired })
`;

// ---------------------------------------------------------------------------
// checkBudgetExhausted — fast read-only check at request entry
// ---------------------------------------------------------------------------

/**
 * Check if the monthly voice budget has been exhausted.
 * Reads the Redis key directly (no Lua script needed for read-only).
 * Returns false on Redis miss or error (fail-open).
 */
export async function checkBudgetExhausted(
  redis: Pick<Redis, 'get'>,
): Promise<boolean> {
  try {
    const raw = await redis.get(BUDGET_KEY);
    if (raw === null) return false;

    const data = JSON.parse(raw) as Partial<VoiceBudgetData>;
    return data.exhausted === true;
  } catch {
    // Fail-open: if Redis is down or JSON is malformed, allow the request
    return false;
  }
}

// ---------------------------------------------------------------------------
// incrementSpendAndCheck — atomic accumulate + threshold check via Lua
// ---------------------------------------------------------------------------

/**
 * Increment the monthly EUR spend by the cost of a successful Whisper call
 * and return the updated budget state plus any newly crossed alert thresholds.
 *
 * Call this AFTER a successful Whisper transcription (not on error paths).
 * Returns safe defaults on Redis or parse failure (fail-open).
 *
 * @param redis       Redis client
 * @param durationSec Server-verified audio duration in seconds
 */
export async function incrementSpendAndCheck(
  redis: Pick<Redis, 'eval'>,
  durationSec: number,
): Promise<IncrementResult> {
  const incrementEur = (durationSec / 60) * WHISPER_COST_PER_MIN_USD * USD_TO_EUR;
  const monthKey = new Date().toISOString().slice(0, 7);

  try {
    const raw = await redis.eval(LUA_SCRIPT, 1, BUDGET_KEY, String(incrementEur), monthKey);

    if (raw === null || typeof raw !== 'string') {
      return safeDefault();
    }

    const result = JSON.parse(raw) as IncrementResult;
    return result;
  } catch {
    // Fail-open: budget tracking failure must not block voice requests
    return safeDefault();
  }
}

// ---------------------------------------------------------------------------
// dispatchSlackAlerts — fire-and-forget Slack webhook
// ---------------------------------------------------------------------------

type Logger = {
  warn(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
};

/**
 * Send Slack webhook notifications for newly crossed spend thresholds.
 *
 * Fire-and-forget: this function awaits each fetch but its caller wraps it
 * in `void promise.catch(...)` so failures never block the request path.
 *
 * Does nothing when alertsFired is empty or webhookUrl is falsy.
 *
 * @param alertsFired  List of threshold crossings returned by incrementSpendAndCheck
 * @param spendEur     Current spend (for message copy)
 * @param webhookUrl   Slack Incoming Webhook URL (SLACK_WEBHOOK_URL env var)
 * @param logger       Fastify request logger
 */
export async function dispatchSlackAlerts(
  alertsFired: AlertFired[],
  spendEur: number,
  webhookUrl: string | undefined,
  logger: Logger,
): Promise<void> {
  if (alertsFired.length === 0 || !webhookUrl) return;

  for (const alert of alertsFired) {
    const text = `nutriXplorer voice: €${spendEur.toFixed(2)} this month (threshold ${alert.threshold}% of €${CAP_EUR} cap)`;

    try {
      await globalThis.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      logger.warn({ err }, 'Slack voice budget alert failed to dispatch');
    }
  }
}

// ---------------------------------------------------------------------------
// ALERT_THRESHOLDS re-exported for testing
// ---------------------------------------------------------------------------

export { ALERT_THRESHOLDS };
