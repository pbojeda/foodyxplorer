// f091.edge-cases.test.ts — QA edge-case tests for F091 voice feature
//
// Originally authored by the qa-engineer agent to DOCUMENT bugs. The bugs
// have since been fixed, so the tests are now inverted to assert the FIX.
//
// AC22 regression guard:
//   incrementVoiceSeconds previously passed the float durationSec directly to
//   redis.incrby(), which rejects non-integer arguments. After the fix, values
//   are normalized via Math.ceil before reaching Redis.

import { describe, it, expect, vi } from 'vitest';
import {
  incrementVoiceSeconds,
} from '../plugins/voiceIpRateLimit.js';
import { parseAudioDuration } from '../lib/audioDuration.js';

// ---------------------------------------------------------------------------
// AC22: per-IP cap still accumulates when parseAudioDuration returns a float
// ---------------------------------------------------------------------------

describe('AC22: incrementVoiceSeconds with float durationSec (cap regression guard)', () => {
  const ip = '203.0.113.10';
  const dateKey = '2026-04-21';

  it('rounds float durationSec UP before calling redis.incrby (integer required)', async () => {
    const redis = {
      incrby: vi.fn().mockResolvedValue(11),
      expire: vi.fn().mockResolvedValue(1),
    };

    await incrementVoiceSeconds(
      redis as Parameters<typeof incrementVoiceSeconds>[0],
      ip,
      10.734,
      dateKey,
    );

    expect(redis.incrby).toHaveBeenCalledTimes(1);
    const [, incrementArg] = redis.incrby.mock.calls[0]!;
    expect(Number.isInteger(incrementArg)).toBe(true);
    expect(incrementArg).toBe(11); // Math.ceil(10.734)
  });

  it('sets TTL on first increment with float durationSec (newValue === ceil)', async () => {
    const redis = {
      incrby: vi.fn().mockResolvedValue(11), // Redis returns the rounded value
      expire: vi.fn().mockResolvedValue(1),
    };

    await incrementVoiceSeconds(
      redis as Parameters<typeof incrementVoiceSeconds>[0],
      ip,
      10.734,
      dateKey,
    );

    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining(ip),
      86400,
    );
  });

  it('never sends durationSec of 0 — sub-second clips still count as ≥ 1s', async () => {
    const redis = {
      incrby: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };

    await incrementVoiceSeconds(
      redis as Parameters<typeof incrementVoiceSeconds>[0],
      ip,
      0.2,
      dateKey,
    );

    const [, incrementArg] = redis.incrby.mock.calls[0]!;
    expect(incrementArg).toBe(1);
  });

  it('integer durationSec (client fallback path) still works correctly', async () => {
    const redis = {
      incrby: vi.fn().mockResolvedValue(11),
      expire: vi.fn().mockResolvedValue(1),
    };

    await incrementVoiceSeconds(
      redis as Parameters<typeof incrementVoiceSeconds>[0],
      ip,
      11,
      dateKey,
    );

    const [, incrementArg] = redis.incrby.mock.calls[0]!;
    expect(incrementArg).toBe(11);
    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining(ip),
      86400,
    );
  });

  it('real parseAudioDuration returning a float is correctly rounded before Redis', async () => {
    const timeScale = 1000;
    const durationTicks = 10500; // 10.5 seconds

    const mvhdContent = Buffer.alloc(100);
    mvhdContent.writeUInt8(0, 0);
    mvhdContent.writeUInt32BE(0, 4);
    mvhdContent.writeUInt32BE(0, 8);
    mvhdContent.writeUInt32BE(timeScale, 12);
    mvhdContent.writeUInt32BE(durationTicks, 16);

    const mvhdSize = 8 + mvhdContent.length;
    const mvhd = Buffer.alloc(mvhdSize);
    mvhd.writeUInt32BE(mvhdSize, 0);
    mvhd.write('mvhd', 4, 'ascii');
    mvhdContent.copy(mvhd, 8);

    const moovSize = 8 + mvhd.length;
    const moov = Buffer.alloc(moovSize);
    moov.writeUInt32BE(moovSize, 0);
    moov.write('moov', 4, 'ascii');
    mvhd.copy(moov, 8);

    const ftyp = Buffer.from([
      0x00, 0x00, 0x00, 0x0C,
      0x66, 0x74, 0x79, 0x70,
      0x6D, 0x70, 0x34, 0x31,
    ]);

    const buf = Buffer.concat([ftyp, moov]);
    const parsed = parseAudioDuration(buf, 'audio/mp4');

    expect(parsed).toBe(10.5);
    expect(Number.isInteger(parsed)).toBe(false);

    const redis = {
      incrby: vi.fn().mockResolvedValue(11),
      expire: vi.fn().mockResolvedValue(1),
    };

    await incrementVoiceSeconds(
      redis as Parameters<typeof incrementVoiceSeconds>[0],
      '203.0.113.10',
      parsed!,
      '2026-04-21',
    );

    const [, incrementArg] = redis.incrby.mock.calls[0]!;
    expect(incrementArg).toBe(11); // Math.ceil(10.5) → 11
  });
});
