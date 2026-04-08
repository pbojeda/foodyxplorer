// TDD tests for actorId.ts
// Tests: UUID generation, localStorage persistence, fallback when unavailable

// UUID v4 pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCAL_STORAGE_KEY = 'nxi_actor_id';

// Re-import the module fresh before each test to reset module-level state
// (memoryActorId singleton must start null for each test).
let getActorId: typeof import('../../lib/actorId').getActorId;
let persistActorId: typeof import('../../lib/actorId').persistActorId;

describe('getActorId', () => {
  beforeEach(async () => {
    localStorage.clear();
    jest.restoreAllMocks();
    jest.resetModules();
    const mod = await import('../../lib/actorId');
    getActorId = mod.getActorId;
    persistActorId = mod.persistActorId;
  });

  it('generates a valid UUID on first call', () => {
    const id = getActorId();
    expect(id).toMatch(UUID_PATTERN);
  });

  it('persists the UUID to localStorage under nxi_actor_id', () => {
    getActorId();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toMatch(UUID_PATTERN);
  });

  it('returns the same UUID on subsequent calls', () => {
    const first = getActorId();
    const second = getActorId();
    expect(first).toBe(second);
  });

  it('reads the existing UUID from localStorage if present', () => {
    const existingId = '123e4567-e89b-42d3-a456-426614174000';
    localStorage.setItem(LOCAL_STORAGE_KEY, existingId);
    const id = getActorId();
    expect(id).toBe(existingId);
  });

  it('generates an in-memory UUID when localStorage.getItem throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    // Should not throw
    const id = getActorId();
    expect(id).toMatch(UUID_PATTERN);
  });

  it('does not throw when localStorage.setItem throws', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => getActorId()).not.toThrow();
  });
});

describe('persistActorId', () => {
  beforeEach(async () => {
    localStorage.clear();
    jest.restoreAllMocks();
    jest.resetModules();
    const mod = await import('../../lib/actorId');
    getActorId = mod.getActorId;
    persistActorId = mod.persistActorId;
  });

  it('writes the given id to localStorage', () => {
    const id = 'abc12345-0000-4000-a000-000000000001';
    persistActorId(id);
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(id);
  });

  it('overwrites an existing id in localStorage', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, 'old-id');
    persistActorId('new-id');
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe('new-id');
  });

  it('is a no-op (no throw) when localStorage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    expect(() => persistActorId('some-id')).not.toThrow();
  });
});
