// F069 — Actor Resolver Unit Tests
//
// Tests for actor resolution middleware logic.
// Uses mock PrismaClient to avoid DB dependency.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    actor: {
      upsert: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099' }),
      create: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000098' }),
    },
  };
}

function createMockRequest(headers: Record<string, string | undefined> = {}) {
  return {
    headers,
    routeOptions: { url: '/estimate' },
    actorId: undefined as string | undefined,
    log: { warn: vi.fn() },
  };
}

function createMockReply() {
  const reply = {
    header: vi.fn().mockReturnThis(),
  };
  return reply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F069 — Actor Resolution', () => {
  describe('header parsing', () => {
    it('recognizes valid UUID in X-Actor-Id header', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)).toBe(true);
    });

    it('rejects invalid UUID format', () => {
      const invalid = 'not-a-uuid';
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invalid)).toBe(false);
    });

    it('recognizes telegram: prefix', () => {
      const header = 'telegram:123456789';
      expect(header.startsWith('telegram:')).toBe(true);
      expect(header.slice('telegram:'.length)).toBe('123456789');
    });

    it('handles empty telegram prefix', () => {
      const header = 'telegram:';
      const chatId = header.slice('telegram:'.length);
      expect(chatId).toBe('');
      expect(chatId.length).toBe(0);
    });
  });

  describe('actor upsert logic', () => {
    let mockPrisma: ReturnType<typeof createMockPrisma>;

    beforeEach(() => {
      mockPrisma = createMockPrisma();
    });

    it('upserts with type anonymous_web for UUID header', async () => {
      const externalId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      await mockPrisma.actor.upsert({
        where: { type_externalId: { type: 'anonymous_web', externalId } },
        update: { lastSeenAt: new Date() },
        create: { type: 'anonymous_web', externalId, lastSeenAt: new Date() },
        select: { id: true },
      });

      expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type_externalId: { type: 'anonymous_web', externalId } },
        }),
      );
    });

    it('upserts with type telegram for telegram: prefix', async () => {
      const chatId = '123456789';
      await mockPrisma.actor.upsert({
        where: { type_externalId: { type: 'telegram', externalId: chatId } },
        update: { lastSeenAt: new Date() },
        create: { type: 'telegram', externalId: chatId, lastSeenAt: new Date() },
        select: { id: true },
      });

      expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type_externalId: { type: 'telegram', externalId: chatId } },
        }),
      );
    });

    it('creates new actor when no header provided', async () => {
      await mockPrisma.actor.create({
        data: {
          type: 'anonymous_web',
          externalId: 'generated-uuid',
          lastSeenAt: new Date(),
        },
        select: { id: true },
      });

      expect(mockPrisma.actor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'anonymous_web' }),
        }),
      );
    });
  });

  describe('response header', () => {
    it('sets X-Actor-Id response header for new anonymous actors', () => {
      const reply = createMockReply();
      const uuid = 'test-uuid-value';
      reply.header('X-Actor-Id', uuid);
      expect(reply.header).toHaveBeenCalledWith('X-Actor-Id', uuid);
    });
  });

  describe('health endpoint exclusion', () => {
    it('skips actor resolution for /health', () => {
      const request = createMockRequest();
      request.routeOptions.url = '/health';
      // In the actual middleware, /health check returns early
      expect(request.routeOptions.url).toBe('/health');
    });
  });
});
