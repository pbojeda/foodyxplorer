// HTTP client for the foodXPlorer API.
//
// createApiClient(config) returns an ApiClient implementation that wraps
// native fetch, attaches the X-API-Key header, handles non-2xx responses
// uniformly, and parses the { success, data } envelope.
//
// The ApiClient interface is designed for dependency injection — tests inject
// a mock implementation, no real HTTP is made during unit tests.

import type { DishListItem, RestaurantListItem, ChainListItem, EstimateData, PaginationMeta, Restaurant, CreateRestaurantBody, MenuAnalysisData, RecipeCalculateData, ConversationMessageData } from '@foodxplorer/shared';
import type { BotConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface IngestImageResult {
  dishesFound: number;
  dishesUpserted: number;
  dishesSkipped: number;
  dryRun: boolean;
  dishes: unknown[];
  skippedReasons: Array<{ dishName: string; reason: string }>;
}

export type IngestPdfResult = IngestImageResult;

export interface ApiClient {
  searchDishes(params: { q: string; page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>;
  /**
   * Estimate nutrition for a query.
   * Always returns EstimateData (never null, never throws on null result).
   * The caller should check `data.result === null` to decide what to show.
   */
  estimate(params: { query: string; chainSlug?: string; portionMultiplier?: number }): Promise<EstimateData>;
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
  /**
   * Search restaurants by name using trigram similarity (F032).
   * Returns up to the requested number of results ordered by similarity.
   */
  searchRestaurants(q: string): Promise<PaginatedResult<RestaurantListItem>>;
  /**
   * Create a new restaurant via the admin endpoint (F032).
   * Requires ADMIN_API_KEY in config.
   * Throws ApiError(409) if a duplicate restaurant exists.
   */
  createRestaurant(body: CreateRestaurantBody): Promise<Restaurant>;
  /**
   * Upload an image file as multipart to POST /ingest/image (F031).
   * Requires ADMIN_API_KEY in config. Throws ApiError(500, CONFIG_ERROR) if absent.
   * Uses UPLOAD_TIMEOUT_MS (90s) to allow for server-side OCR processing.
   */
  uploadImage(params: {
    fileBuffer: Buffer;
    filename: string;
    mimeType: string;
    restaurantId: string;
    sourceId: string;
    dryRun?: boolean;
    chainSlug?: string;
  }): Promise<IngestImageResult>;
  /**
   * Upload a PDF file as multipart to POST /ingest/pdf (F031).
   * Requires ADMIN_API_KEY in config. Throws ApiError(500, CONFIG_ERROR) if absent.
   * Uses UPLOAD_TIMEOUT_MS (90s) to allow for server-side PDF processing.
   */
  uploadPdf(params: {
    fileBuffer: Buffer;
    filename: string;
    restaurantId: string;
    sourceId: string;
    dryRun?: boolean;
    chainSlug?: string;
  }): Promise<IngestPdfResult>;
  /**
   * Analyze a menu photo or PDF via POST /analyze/menu (F034).
   * Uses BOT_API_KEY (not adminKey — public API key endpoint).
   * Uses UPLOAD_TIMEOUT_MS (90s) to allow for server-side OCR/Vision processing.
   */
  analyzeMenu(params: {
    fileBuffer: Buffer;
    filename: string;
    mimeType: string;
    mode: 'auto' | 'ocr' | 'vision' | 'identify';
  }): Promise<MenuAnalysisData>;
  /**
   * Calculate aggregate nutrition for a free-form recipe text (F041).
   * Uses BOT_API_KEY (not adminKey — public endpoint).
   * Uses RECIPE_TIMEOUT_MS (30s) — LLM parsing + multi-ingredient resolution
   * can take up to ~10s; the default 10s REQUEST_TIMEOUT_MS is too short.
   */
  calculateRecipe(text: string, portions?: number): Promise<RecipeCalculateData>;
  /**
   * Process a natural language message via the Conversation Core (F070).
   * POSTs to POST /conversation/message with { text, chainSlug?, chainName? }.
   * Bot already sends X-Actor-Id (telegram:<chatId>) and X-API-Key headers.
   * Returns ConversationMessageData (structured, never formatted text).
   */
  processMessage(
    text: string,
    chatId: number,
    legacyChainContext?: { chainSlug: string; chainName: string },
  ): Promise<ConversationMessageData>;
  /**
   * Transcribe and process a voice message via POST /conversation/audio (F075).
   * Sends multipart/form-data with audio file + duration + optional chain context.
   * Uses VOICE_TIMEOUT_MS (30s) — Whisper + ConversationCore can exceed 10s default.
   * Returns ConversationMessageData (same shape as processMessage).
   * Throws ApiError on non-2xx (EMPTY_TRANSCRIPTION, TRANSCRIPTION_FAILED, TIMEOUT, etc.).
   */
  sendAudio(params: {
    audioBuffer: Buffer;
    filename: string;
    mimeType: string;
    duration: number;
    chatId: number;
    legacyChainContext?: { chainSlug: string; chainName: string };
  }): Promise<ConversationMessageData>;
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
export const UPLOAD_TIMEOUT_MS = 90_000;
export const RECIPE_TIMEOUT_MS = 30_000;
export const VOICE_TIMEOUT_MS = 30_000;

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
        headers: { 'X-API-Key': apiKey, 'X-FXP-Source': 'bot' },
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

  /**
   * Generic JSON POST with envelope parsing.
   * Attaches X-API-Key and X-FXP-Source: bot headers.
   * When `adminKey` is provided, it replaces the default BOT_API_KEY in the X-API-Key header.
   * Throws ApiError on any non-2xx or network/timeout error.
   */
  async function postJson<T>(path: string, body: unknown, adminKey?: string, timeout: number = REQUEST_TIMEOUT_MS): Promise<T> {
    const url = new URL(path, baseUrl + '/');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': adminKey ?? apiKey,
      'X-FXP-Source': 'bot',
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let code = 'API_ERROR';
        let message = `HTTP ${response.status}`;
        try {
          const errBody = await response.json() as { success: boolean; error?: { code?: string; message?: string } };
          if (errBody.error?.code) code = errBody.error.code;
          if (errBody.error?.message) message = errBody.error.message;
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

  /**
   * Multipart POST with FormData body and envelope parsing.
   * Does NOT set Content-Type header — fetch derives it automatically from
   * the FormData body, which is required for the multipart boundary to be set.
   * Uses UPLOAD_TIMEOUT_MS (90s) instead of REQUEST_TIMEOUT_MS.
   * When `adminKey` is provided, it replaces the default BOT_API_KEY.
   */
  async function postFormData<T>(path: string, body: FormData, adminKey?: string): Promise<T> {
    const url = new URL(path, baseUrl + '/');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'X-API-Key': adminKey ?? apiKey,
      'X-FXP-Source': 'bot',
      // NOTE: Content-Type is intentionally omitted — fetch sets it automatically
      // with the correct multipart boundary when body is a FormData instance.
    };

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let code = 'API_ERROR';
        let message = `HTTP ${response.status}`;
        try {
          const errBody = await response.json() as { success: boolean; error?: { code?: string; message?: string } };
          if (errBody.error?.code) code = errBody.error.code;
          if (errBody.error?.message) message = errBody.error.message;
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
      if (params.portionMultiplier !== undefined && params.portionMultiplier !== 1.0) {
        sp['portionMultiplier'] = String(params.portionMultiplier);
      }
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

    async searchRestaurants(q) {
      return fetchJson<PaginatedResult<RestaurantListItem>>('/restaurants', { q, pageSize: '5' });
    },

    async createRestaurant(body) {
      return postJson<Restaurant>('/restaurants', body, config.ADMIN_API_KEY);
    },

    async uploadImage(params) {
      if (!config.ADMIN_API_KEY) {
        throw new ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured');
      }

      const form = new FormData();
      form.append('restaurantId', params.restaurantId);
      form.append('sourceId', params.sourceId);
      form.append('dryRun', String(params.dryRun ?? false));
      if (params.chainSlug !== undefined) {
        form.append('chainSlug', params.chainSlug);
      }
      form.append('file', new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType }), params.filename);

      return postFormData<IngestImageResult>('/ingest/image', form, config.ADMIN_API_KEY);
    },

    async uploadPdf(params) {
      if (!config.ADMIN_API_KEY) {
        throw new ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured');
      }

      const form = new FormData();
      form.append('restaurantId', params.restaurantId);
      form.append('sourceId', params.sourceId);
      form.append('dryRun', String(params.dryRun ?? false));
      if (params.chainSlug !== undefined) {
        form.append('chainSlug', params.chainSlug);
      }
      form.append('file', new Blob([new Uint8Array(params.fileBuffer)], { type: 'application/pdf' }), params.filename);

      return postFormData<IngestPdfResult>('/ingest/pdf', form, config.ADMIN_API_KEY);
    },

    async analyzeMenu(params) {
      const form = new FormData();
      form.append('mode', params.mode);
      form.append('file', new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType }), params.filename);

      // Uses BOT_API_KEY (no adminKey override) — public API key endpoint.
      // postFormData already unwraps the { success, data } envelope and returns data.
      return postFormData<MenuAnalysisData>('/analyze/menu', form);
    },

    async calculateRecipe(text, portions) {
      // Uses BOT_API_KEY (no adminKey) — public endpoint.
      // RECIPE_TIMEOUT_MS (30s) overrides the default 10s — LLM parsing + multi-ingredient
      // resolution can take up to ~10s per ingredient before returning.
      const body = portions !== undefined
        ? { mode: 'free-form' as const, text, portions }
        : { mode: 'free-form' as const, text };
      return postJson<RecipeCalculateData>('/calculate/recipe', body, undefined, RECIPE_TIMEOUT_MS);
    },

    async sendAudio({ audioBuffer, filename, mimeType, duration, chatId, legacyChainContext }) {
      const url = new URL('/conversation/audio', baseUrl + '/');

      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
      form.append('duration', String(duration));
      if (legacyChainContext) {
        form.append('chainSlug', legacyChainContext.chainSlug);
        form.append('chainName', legacyChainContext.chainName);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);

      const headers: Record<string, string> = {
        'X-API-Key': apiKey,
        'X-FXP-Source': 'bot',
        'X-Actor-Id': `telegram:${chatId}`,
        // NOTE: Content-Type intentionally omitted — fetch sets it automatically with boundary
      };

      try {
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: form,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          let code = 'API_ERROR';
          let message = `HTTP ${response.status}`;
          try {
            const errBody = await response.json() as { success: boolean; error?: { code?: string; message?: string } };
            if (errBody.error?.code) code = errBody.error.code;
            if (errBody.error?.message) message = errBody.error.message;
          } catch {
            // ignore parse error — use defaults
          }
          throw new ApiError(response.status, code, message);
        }

        const envelope = await response.json() as { success: boolean; data: ConversationMessageData };
        return envelope.data;
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof ApiError) throw err;

        if (err instanceof Error && err.name === 'AbortError') {
          throw new ApiError(408, 'TIMEOUT', 'Request timed out');
        }

        throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
      }
    },

    async processMessage(text, chatId, legacyChainContext) {
      const url = new URL('/conversation/message', baseUrl + '/');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const body: { text: string; chainSlug?: string; chainName?: string } = { text };
      if (legacyChainContext) {
        body.chainSlug = legacyChainContext.chainSlug;
        body.chainName = legacyChainContext.chainName;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-FXP-Source': 'bot',
        'X-Actor-Id': `telegram:${chatId}`,
      };

      try {
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          let code = 'API_ERROR';
          let message = `HTTP ${response.status}`;
          try {
            const errBody = await response.json() as { success: boolean; error?: { code?: string; message?: string } };
            if (errBody.error?.code) code = errBody.error.code;
            if (errBody.error?.message) message = errBody.error.message;
          } catch {
            // ignore parse error — use defaults
          }
          throw new ApiError(response.status, code, message);
        }

        const envelope = await response.json() as { success: boolean; data: ConversationMessageData };
        return envelope.data;
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof ApiError) throw err;

        if (err instanceof Error && err.name === 'AbortError') {
          throw new ApiError(408, 'TIMEOUT', 'Request timed out');
        }

        throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
      }
    },
  };
}
