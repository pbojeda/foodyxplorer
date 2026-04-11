// Actor ID management for nutriXplorer web client.
//
// Generates a UUID (crypto.randomUUID) on first visit and persists it to
// localStorage under the key 'nxi_actor_id'.
//
// Falls back to an in-memory UUID for the session if localStorage is
// unavailable (SSR, private browsing, quota exceeded).

const LOCAL_STORAGE_KEY = 'nxi_actor_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// In-memory fallback for environments where localStorage is unavailable.
let memoryActorId: string | null = null;

/**
 * Returns the actor ID for the current session.
 * Reads from localStorage if available; generates and persists a new UUID
 * on first call. Falls back to an in-memory UUID if localStorage throws.
 */
export function getActorId(): string {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored && UUID_RE.test(stored)) {
      return stored;
    }
    const newId = crypto.randomUUID();
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, newId);
    } catch {
      // Quota exceeded or other write error — continue without persisting
    }
    return newId;
  } catch {
    // localStorage entirely unavailable — use in-memory UUID
    if (!memoryActorId) {
      memoryActorId = crypto.randomUUID();
    }
    return memoryActorId;
  }
}

/**
 * Persists a server-issued actor ID to localStorage.
 * Called when the API returns a new X-Actor-Id response header.
 * No-op if localStorage is unavailable.
 */
export function persistActorId(id: string): void {
  if (!UUID_RE.test(id)) return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable — silently ignore
  }
}
