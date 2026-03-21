// HTTP client for the foodXPlorer API.
//
// createApiClient(config) returns an ApiClient implementation that wraps
// native fetch, attaches the X-API-Key header, handles non-2xx responses
// uniformly, and parses the { success, data } envelope.
//
// The ApiClient interface is designed for dependency injection — tests inject
// a mock implementation, no real HTTP is made during unit tests.

import type { DishListItem, RestaurantListItem, ChainListItem, EstimateData, PaginationMeta } from '@foodxplorer/shared';
import type { BotConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ApiClient {
  searchDishes(params: { q: string; page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>;
  /**
   * Estimate nutrition for a query.
   * Always returns EstimateData (never null, never throws on null result).
   * The caller should check `data.result === null` to decide what to show.
   */
  estimate(params: { query: string; chainSlug?: string }): Promise<EstimateData>;
  listRestaurants(params: { chainSlug?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<RestaurantListItem>>;
  listRestaurantDishes(restaurantId: string, params: { page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>;
  /** Always sends ?isActive=true per spec — bot only shows active chains. */
  listChains(): Promise<ChainListItem[]>;
  /**
   * Checks API health.
   * /health returns { status, timestamp, ... } directly (NOT the { success, data } envelope).
   * Treats any 2xx as true, anything else as false.
   * Never throws.
   */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;

export function createApiClient(config: BotConfig): ApiClient {
  const baseUrl = config.API_BASE_URL.replace(/\/$/, '');
  const apiKey = config.BOT_API_KEY;

  /**
   * Generic JSON fetch with envelope parsing.
   * Throws ApiError on any non-2xx or network/timeout error.
   * Parses the { success, data } envelope and returns data.
   */
  async function fetchJson<T>(path: string, searchParams?: Record<string, string>): Promise<T> {
    const url = new URL(path, baseUrl + '/');
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        url.searchParams.set(k, v);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        headers: { 'X-API-Key': apiKey },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let code = 'API_ERROR';
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json() as { success: boolean; error?: { code?: string; message?: string } };
          if (body.error?.code) code = body.error.code;
          if (body.error?.message) message = body.error.message;
        } catch {
          // ignore parse error — use defaults
        }
        throw new ApiError(response.status, code, message);
      }

      const envelope = await response.json() as { success: boolean; data: T };
      return envelope.data;
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof ApiError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(408, 'TIMEOUT', 'Request timed out');
      }

      throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
    }
  }

  return {
    async searchDishes(params) {
      const sp: Record<string, string> = {
        q: params.q,
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 10),
      };
      return fetchJson<PaginatedResult<DishListItem>>('/dishes/search', sp);
    },

    async estimate(params) {
      const sp: Record<string, string> = { query: params.query };
      if (params.chainSlug) sp['chainSlug'] = params.chainSlug;
      return fetchJson<EstimateData>('/estimate', sp);
    },

    async listRestaurants(params) {
      const sp: Record<string, string> = {
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 10),
      };
      if (params.chainSlug) sp['chainSlug'] = params.chainSlug;
      return fetchJson<PaginatedResult<RestaurantListItem>>('/restaurants', sp);
    },

    async listRestaurantDishes(restaurantId, params) {
      const sp: Record<string, string> = {
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 10),
      };
      return fetchJson<PaginatedResult<DishListItem>>(`/restaurants/${encodeURIComponent(restaurantId)}/dishes`, sp);
    },

    async listChains() {
      // Always send isActive=true — bot only shows active chains (spec requirement).
      return fetchJson<ChainListItem[]>('/chains', { isActive: 'true' });
    },

    async healthCheck() {
      // /health does NOT use the { success, data } envelope — treat any 2xx as true.
      const url = new URL('/health', baseUrl + '/');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url.toString(), {
          headers: { 'X-API-Key': apiKey },
          signal: controller.signal,
        });
        clearTimeout(timer);
        return response.ok;
      } catch {
        clearTimeout(timer);
        return false;
      }
    },
  };
}
