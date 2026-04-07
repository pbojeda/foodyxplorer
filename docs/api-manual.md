# foodXPlorer API — Developer Manual

> Complete reference for integrating with the foodXPlorer nutritional data API.
> Last updated: 2026-04-07 (audited against codebase — includes F070–F089)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Response Format](#3-response-format)
4. [Rate Limits](#4-rate-limits)
5. [GET /estimate — Nutrition Estimation](#5-get-estimate--nutrition-estimation)
6. [POST /calculate/recipe — Recipe Calculation](#6-post-calculaterecipe--recipe-calculation)
7. [POST /analyze/menu — Menu Photo Analysis](#7-post-analyzemenu--menu-photo-analysis)
8. [POST /conversation/message — Natural Language](#8-post-conversationmessage--natural-language)
9. [POST /conversation/audio — Voice Input](#9-post-conversationaudio--voice-input)
10. [GET /dishes/search — Dish Search](#10-get-dishessearch--dish-search)
11. [GET /chains — List Chains](#11-get-chains--list-chains)
12. [GET /restaurants — List Restaurants](#12-get-restaurants--list-restaurants)
13. [GET /restaurants/:id/dishes — Restaurant Dishes](#13-get-restaurantsiddishes--restaurant-dishes)
14. [GET /health — Health Check](#14-get-health--health-check)
15. [Error Codes](#15-error-codes)
16. [Data Coverage](#16-data-coverage)
17. [Estimation Engine](#17-estimation-engine)
18. [Cooking State & Yield Factors](#18-cooking-state--yield-factors)
19. [Caching Behavior](#19-caching-behavior)
20. [GET /reverse-search — Reverse Search](#20-get-reverse-search--reverse-search)
21. [Estimation Enrichments](#21-estimation-enrichments)

---

## 1. Overview

foodXPlorer provides nutritional data for restaurant dishes and common foods via a REST API. It covers **14 Spanish restaurant chains** (~1,400 dishes), **250 canonical Spanish dishes**, and **534 base foods** from USDA and BEDCA databases.

**Base URLs:**

| Environment | URL |
|-------------|-----|
| Production | `https://api.nutrixplorer.com` |
| Staging | `https://api-dev.nutrixplorer.com` |
| Local | `http://localhost:3001` |

**Key characteristics:**

- All responses use a standard JSON envelope (see [Section 3](#3-response-format))
- Authentication is optional for most read endpoints but provides higher rate limits
- The estimation engine is deterministic and auditable — LLMs are used only for query interpretation, never for nutrient calculations
- 15 nutrients tracked per food item, including alcohol
- Responses include explicit confidence levels and source traceability

---

## 2. Authentication

### API Key (X-API-Key header)

Include your API key in every request as a header:

```
X-API-Key: your-api-key-here
```

**Behavior by authentication state:**

| State | Rate Limit | Actor Tracking |
|-------|-----------|----------------|
| No API key | 30 req/15 min per IP | Anonymous actor (auto-generated) |
| Free tier key | 100 req/15 min per key | Linked to key |
| Pro tier key | 1,000 req/15 min per key | Linked to key |

API keys are validated via SHA-256 hash lookup. Invalid or expired keys return `401 UNAUTHORIZED`. Revoked keys return `403 FORBIDDEN`.

### Actor Identity (X-Actor-Id header)

The `X-Actor-Id` header identifies the end user for per-actor rate limiting and conversational context:

```
X-Actor-Id: your-user-uuid
```

- If omitted or invalid, the server generates a transient UUID and returns it in the response `X-Actor-Id` header
- Format: any valid UUID (for web clients) or `telegram:<chatId>` (for Telegram bots)
- Actors are automatically created on first request

> **Important:** The `X-Actor-Id` header you send is your **external identifier**. The `data.actorId` field in conversation responses is the server's **internal UUID** — these are different values. Always use your original `X-Actor-Id` for subsequent requests, not the `data.actorId` from responses.

### Source Attribution (X-FXP-Source header)

Optional. Set to `"bot"` or `"api"` (default: `"api"`). Used for analytics attribution in query logs.

---

## 3. Response Format

### Success (2xx)

```json
{
  "success": true,
  "data": { ... }
}
```

### Error (4xx / 5xx)

```json
{
  "success": false,
  "error": {
    "message": "Human-readable description",
    "code": "ERROR_CODE",
    "details": [
      { "path": ["field"], "message": "Validation message", "code": "zod_code" }
    ]
  }
}
```

The `details` array is only present for validation errors (`VALIDATION_ERROR`). For all other error codes, only `message` and `code` are returned.

---

## 4. Rate Limits

### Per-IP / Per-Key (15-minute sliding window)

| Tier | Limit | Scope |
|------|-------|-------|
| Anonymous (no key) | 30 req / 15 min | Per IP address |
| Free tier | 100 req / 15 min | Per API key |
| Pro tier | 1,000 req / 15 min | Per API key |

### Per-Actor Daily Limits

| Bucket | Limit | Endpoints |
|--------|-------|-----------|
| queries | 50 / day | GET /estimate, POST /conversation/message, POST /conversation/audio |
| photos | 10 / day | POST /analyze/menu |

Each HTTP request counts as **1** against the daily limit, regardless of internal complexity (a comparison that estimates 2 dishes still counts as 1 request).

> **Note:** Daily quota is consumed at request entry, before body validation. A request that fails with 400 VALIDATION_ERROR still counts against your daily limit.

### Per-Route Overrides

| Endpoint | Limit | Scope |
|----------|-------|-------|
| POST /analyze/menu | 10 / hour | Per API key |
| POST /waitlist | 5 / 15 min | Per IP |

### Rate Limit Headers

The **global per-IP/key limiter** includes these headers on every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (only on 429 responses) |

> **Note:** The per-actor daily limiter (50/day queries, 10/day photos) returns 429 with `Retry-After: 3600` (1 hour) but **without** `X-RateLimit-*` headers. On Redis failure, anonymous actors get `Retry-After: 60` (fail-closed). The per-route analysis limiter (10/hour) returns 429 without `Retry-After`. Only the global per-IP/key limiter provides the full header set.

### Failure Policy

**Per-actor daily limits (50/day queries, 10/day photos):**
- **Anonymous actors (no API key):** fail-closed — if Redis is unavailable, requests are denied (429)
- **Authenticated actors (with API key):** fail-open — if Redis is unavailable, requests proceed

**Per-IP/key request rate limits (15-min window):**
- Fail-open for all callers — if Redis is unavailable, rate limits are skipped

---

## 5. GET /estimate — Nutrition Estimation

Estimate nutritional values for a dish or food item. This is the primary endpoint for most use cases.

### Request

```
GET /estimate?query=big+mac&chainSlug=mcdonalds-es
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string (1–255 chars) | Yes | Dish or food name to estimate |
| `chainSlug` | string | No | Restaurant chain filter (e.g., `mcdonalds-es`) |
| `restaurantId` | UUID | No | Specific restaurant filter |
| `portionMultiplier` | number (0.1–5.0) | No | Scale all nutrient values (default: 1.0) |
| `cookingState` | `"raw"` \| `"cooked"` \| `"as_served"` | No | Declare whether the food is raw, cooked, or as-served (see [Section 18](#18-cooking-state--yield-factors)) |
| `cookingMethod` | string (max 100) | No | Cooking method for yield correction (e.g., `"grilled"`, `"fried"`) |

### Response

```json
{
  "success": true,
  "data": {
    "query": "big mac",
    "chainSlug": "mcdonalds-es",
    "portionMultiplier": 1,
    "level1Hit": true,
    "level2Hit": false,
    "level3Hit": false,
    "level4Hit": false,
    "matchType": "exact_dish",
    "result": {
      "entityType": "dish",
      "entityId": "uuid-here",
      "name": "Big Mac",
      "nameEs": "Big Mac",
      "restaurantId": "uuid-here",
      "chainSlug": "mcdonalds-es",
      "portionGrams": 200,
      "nutrients": {
        "calories": 563,
        "proteins": 26.5,
        "carbohydrates": 45,
        "sugars": 9,
        "fats": 30,
        "saturatedFats": 10,
        "fiber": 3,
        "salt": 2.2,
        "sodium": 880,
        "transFats": 0.5,
        "cholesterol": 80,
        "potassium": 0,
        "monounsaturatedFats": 0,
        "polyunsaturatedFats": 0,
        "alcohol": 0,
        "referenceBasis": "per_serving"
      },
      "confidenceLevel": "high",
      "estimationMethod": "official",
      "source": {
        "id": "uuid-here",
        "name": "McDonald's España",
        "type": "scraped",
        "url": "https://mcdonalds.es/nutricion",
        "priorityTier": 2,
        "attributionNote": null,
        "license": null,
        "sourceUrl": null
      },
      "similarityDistance": null
    },
    "cachedAt": null,
    "yieldAdjustment": null
  }
}
```

### Key Response Fields

| Field | Description |
|-------|-------------|
| `level1Hit` – `level4Hit` | Which estimation level resolved the query (exactly one is true, or all false if no result) |
| `matchType` | How the query was matched: `exact_dish`, `fts_dish`, `similarity_food`, `llm_food_match`, etc. |
| `result` | `null` when no data found at any level |
| `result.nutrients` | 15 nutrients + `referenceBasis` (`per_100g`, `per_serving`, or `per_package`) |
| `result.confidenceLevel` | `"high"` (L1 official), `"medium"` (L2/L3), `"low"` (L4 LLM) |
| `result.source` | Data provenance: who provided this data and how. For OFF-sourced results, includes `attributionNote`, `license` ("ODbL 1.0"), and `sourceUrl` |
| `cachedAt` | ISO 8601 timestamp if served from Redis cache, `null` if freshly computed |
| `yieldAdjustment` | Present when `cookingState`/`cookingMethod` triggered a yield correction |

### No-Result Response

When the estimation engine cannot find data at any level, `result` is `null`:

```json
{
  "success": true,
  "data": {
    "query": "nonexistent dish",
    "result": null,
    "level1Hit": false,
    "level2Hit": false,
    "level3Hit": false,
    "level4Hit": false,
    "matchType": null,
    ...
  }
}
```

This is a **200 OK** — the engine successfully determined there is no data. Check `result === null` to handle this case.

---

## 6. POST /calculate/recipe — Recipe Calculation

Calculate aggregate nutritional information for a recipe. Supports two modes.

### Structured Mode

```json
POST /calculate/recipe
{
  "mode": "structured",
  "ingredients": [
    { "name": "chicken breast", "grams": 200 },
    { "name": "rice", "grams": 100, "cookingState": "cooked" },
    { "foodId": "uuid-of-olive-oil", "grams": 15 }
  ]
}
```

Each ingredient can specify:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `foodId` | UUID | No* | Direct food ID lookup (skips name matching) |
| `name` | string | No* | Food name for text-based matching |

> *Exactly one of `foodId` or `name` must be provided per ingredient. Supplying both or neither is a validation error.
| `grams` | number (positive, max 5000) | Yes | Weight in grams |
| `portionMultiplier` | number (0.1–5.0) | No | Scale factor (default: 1.0) |
| `cookingState` | `"raw"` \| `"cooked"` \| `"as_served"` | No | For yield correction |
| `cookingMethod` | string | No | Cooking method for yield profile |

### Free-Form Mode

```json
POST /calculate/recipe
{
  "mode": "free-form",
  "text": "200g chicken breast, 100g rice, 1 tablespoon olive oil"
}
```

The `text` field (1–2,000 chars) is parsed by an LLM into structured ingredient tuples, then each ingredient is resolved through the estimation engine.

### Portion Division (F087 — "El Tupper")

Both modes accept an optional `portions` field to divide the total into per-portion nutrients:

```json
{
  "mode": "free-form",
  "text": "2kg lentejas, 500g chorizo, 200g zanahoria",
  "portions": 5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `portions` | integer (1–50) | No | Divide totals by N portions |

### Response

```json
{
  "success": true,
  "data": {
    "mode": "free-form",
    "resolvedCount": 3,
    "unresolvedCount": 0,
    "confidenceLevel": "medium",
    "totalNutrients": {
      "calories": 845,
      "proteins": 69.1,
      "carbohydrates": 78,
      "fats": 28.5,
      ...
    },
    // Note: each nutrient in totalNutrients can be null if no ingredient
    // contributed data for that nutrient. Per-ingredient nutrients is null
    // for unresolved ingredients.
    "ingredients": [
      {
        "input": { "foodId": null, "name": "chicken breast", "grams": 200, "portionMultiplier": 1 },
        "resolved": true,
        "resolvedAs": {
          "entityId": "uuid",
          "name": "Chicken breast",
          "nameEs": "Pechuga de pollo",
          "matchType": "exact_food",
          "yieldAdjustment": null
        },
        "nutrients": { "calories": 330, "proteins": 62, ... }
      }
    ],
    "unresolvedIngredients": [],
    "parsedIngredients": [
      { "name": "chicken breast", "grams": 200, "portionMultiplier": 1 }
    ],
    "cachedAt": null,
    "portions": 5,
    "perPortion": {
      "calories": 169,
      "proteins": 13.82,
      "carbohydrates": 15.6,
      "fats": 5.7,
      ...
    }
  }
}
```

When `portions` is not provided, both fields are `null`:

```json
{
  "portions": null,
  "perPortion": null
}
```

The `perPortion` object has the same shape as `totalNutrients`. Null nutrient values in `totalNutrients` remain null in `perPortion`.

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `RECIPE_UNRESOLVABLE` | 422 | Zero ingredients could be resolved |
| `FREE_FORM_PARSE_FAILED` | 422 | LLM could not parse the text into ingredients |
| `PROCESSING_TIMEOUT` | 408 | Processing exceeded 30-second limit |

### Notes

- Partial resolution returns **200** with `unresolvedCount > 0` and `unresolvedIngredients` listing the names that failed
- The `totalNutrients` includes only resolved ingredients
- Free-form mode includes `parsedIngredients` showing how the LLM interpreted the text
- Results are cached for 300 seconds

---

## 7. POST /analyze/menu — Menu Photo Analysis

Analyze a photo or PDF of a restaurant menu to extract dish names and estimate their nutritional values.

### Request

```
POST /analyze/menu
Content-Type: multipart/form-data
X-API-Key: your-api-key (required)
```

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | JPEG, PNG, WebP image or PDF. Max 10 MB |
| `mode` | string | Yes | `"ocr"` (Tesseract only), `"vision"` (OpenAI Vision only), `"auto"` (Vision with OCR fallback), `"identify"` (single dish identification) |

### Response

```json
{
  "success": true,
  "data": {
    "mode": "auto",
    "dishCount": 5,
    "partial": false,
    "dishes": [
      {
        "dishName": "Ensalada César",
        "estimate": {
          "result": {
            "name": "Ensalada César",
            "nutrients": { "calories": 280, ... },
            "confidenceLevel": "high",
            ...
          },
          ...
        }
      },
      {
        "dishName": "Sopa del día",
        "estimate": null
      }
    ]
  }
}
```

### Important Notes

- **Authentication required** — this endpoint returns `401 UNAUTHORIZED` without an API key
- **Partial results:** if processing exceeds 60 seconds, `partial: true` and only successfully processed dishes are returned
- The `dishes` array uses `{ dishName, estimate }` shape — check `estimate` for `null` (no nutritional data found)
- Each dish goes through the full estimation cascade (L1→L4)
- Mode `"identify"` returns a single dish (first detected) — useful for single-dish photos
- Mode `"auto"` uses Vision API when `OPENAI_API_KEY` is configured; returns `422 VISION_API_UNAVAILABLE` if not
- Rate limit: 10 analyses per hour per API key, plus 10 per day per actor

---

## 8. POST /conversation/message — Natural Language

Process a plain-text natural language query. The Conversation Core detects intent and returns structured data.

### Request

```json
POST /conversation/message
X-Actor-Id: your-actor-uuid
{
  "text": "cuántas calorías tiene un big mac",
  "chainSlug": "mcdonalds-es",
  "chainName": "McDonald's Spain"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string (1–2,000 chars) | Yes | Natural language input (Spanish) |
| `chainSlug` | string | No | Legacy chain context fallback |
| `chainName` | string | No | Legacy chain context fallback |

### Response (varies by intent)

The `intent` field determines which data fields are populated:

#### intent: "estimation"

Single-dish estimation. `estimation` contains the same `EstimateData` structure as GET /estimate.

```json
{
  "success": true,
  "data": {
    "intent": "estimation",
    "actorId": "uuid",
    "estimation": { "query": "big mac", "result": { ... }, ... },
    "activeContext": { "chainSlug": "mcdonalds-es", "chainName": "McDonald's Spain" },
    "usedContextFallback": true
  }
}
```

#### intent: "comparison"

Two-dish comparison. `comparison` contains both dishes and an optional nutrient focus.

```json
{
  "success": true,
  "data": {
    "intent": "comparison",
    "actorId": "uuid",
    "comparison": {
      "dishA": { "query": "big mac", "result": { ... }, ... },
      "dishB": { "query": "whopper", "result": { ... }, ... },
      "nutrientFocus": "calorías"
    },
    "activeContext": null
  }
}
```

#### intent: "menu_estimation"

Multi-dish menu. `menuEstimation` contains per-item results and aggregated totals.

```json
{
  "success": true,
  "data": {
    "intent": "menu_estimation",
    "actorId": "uuid",
    "menuEstimation": {
      "items": [
        { "query": "ensalada", "estimation": { ... } },
        { "query": "filete", "estimation": { ... } }
      ],
      "totals": { "calories": 850, "proteins": 65, ... },
      "itemCount": 2,
      "matchedCount": 2,
      "diners": null,
      "perPerson": null
    },
    "activeContext": null
  }
}
```

**Modo Tapeo (F089):** When the text includes "para N personas" (or similar), the response includes per-person breakdown:

```json
{
  "diners": 3,
  "perPerson": { "calories": 283.33, "proteins": 21.67, ... }
}
```

#### intent: "context_set"

Chain context established. The actor's conversation context is stored in Redis for 2 hours.

```json
{
  "success": true,
  "data": {
    "intent": "context_set",
    "actorId": "uuid",
    "contextSet": { "chainSlug": "mcdonalds-es", "chainName": "McDonald's Spain" }
  }
}
```

If ambiguous (multiple chains match), `ambiguous: true` is set instead of `contextSet`.

#### intent: "reverse_search"

Reverse search results. `reverseSearch` contains matching dishes within a chain.

```json
{
  "success": true,
  "data": {
    "intent": "reverse_search",
    "actorId": "uuid",
    "reverseSearch": {
      "chainSlug": "mcdonalds-es",
      "chainName": "McDonald's Spain",
      "maxCalories": 600,
      "minProtein": 30,
      "results": [
        { "name": "Chicken McNuggets", "nameEs": null, "calories": 280, "proteins": 32, "fats": 14, "carbohydrates": 12, "portionGrams": 150, "proteinDensity": 11.43 }
      ],
      "totalMatches": 5
    }
  }
}
```

Triggered by NL patterns like "qué como con 600 kcal", "me quedan 400 calorías". Requires active chain context — without it, `reverseSearch` is absent and the response indicates the user should set a chain context first.

#### intent: "text_too_long"

Input exceeded 500 characters after trimming. This is a **200 OK** response (not an error) — the server successfully determined the input is too long. Handle it as a domain-level rejection, not an HTTP error.

### Supported Patterns (Spanish)

| Pattern | Intent | Example |
|---------|--------|---------|
| `cuántas calorías tiene X` | estimation | "cuántas calorías tiene un big mac" |
| `qué lleva X` | estimation | "qué lleva un whopper" |
| `X en cadena-slug` | estimation (with chain) | "big mac en mcdonalds-es" |
| `qué engorda más, X o Y` | comparison (focus: calories) | "qué engorda más, pizza o hamburguesa" |
| `qué tiene más proteínas, X vs Y` | comparison (focus: proteins) | |
| `compara X con Y` | comparison (no focus) | |
| `menú: X, Y, Z` | menu_estimation | "menú del día: ensalada, filete, flan" |
| `menú X para N personas` | menu_estimation (with diners) | "menú bravas, croquetas para 3 personas" |
| `qué como con X kcal` | reverse_search | "qué como con 600 kcal" (requires chain context) |
| `me quedan X calorías` | reverse_search | "me quedan 400 calorías" |
| `estoy en X` | context_set | "estoy en mcdonalds" |

### Conversational Context

- Context is stored per actor in Redis with a 2-hour TTL
- Once set, subsequent queries without an explicit chain slug are filtered by the active chain
- Context is refreshed only when explicitly set (not on every query)
- Pass `chainSlug` / `chainName` in the request body as a legacy fallback if your client manages its own context

---

## 9. POST /conversation/audio — Voice Input

Transcribe a voice message via OpenAI Whisper, then process through the Conversation Core pipeline.

### Request

```
POST /conversation/audio
Content-Type: multipart/form-data
X-Actor-Id: your-actor-uuid
```

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | binary | Yes | Audio file (ogg, mpeg, mp4, wav, webm) |
| `duration` | number | Yes | Duration in seconds (0–120) |
| `chainSlug` | string | No | Legacy chain context fallback |
| `chainName` | string | No | Legacy chain context fallback |

### Response

Same structure as POST /conversation/message — the response is identical regardless of whether the input was text or audio.

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `EMPTY_TRANSCRIPTION` | 422 | Whisper returned empty text or a detected hallucination |
| `TRANSCRIPTION_FAILED` | 502 | Whisper API returned an error |
| `VALIDATION_ERROR` | 400 | Missing audio part, unsupported MIME type, or duration out of range |

### Notes

- Maximum audio duration: **120 seconds** (2 minutes). The duration is validated after the file is uploaded — the `duration` field in the request body is the client-reported duration.
- A hallucination filter detects and rejects common Whisper artifacts (e.g., generic phrases transcribed from silence).
- Shares the 50/day per-actor rate limit with text queries.

---

## 10. GET /dishes/search — Dish Search

Search dishes across all restaurants using trigram similarity matching.

### Request

```
GET /dishes/search?q=big+mac&pageSize=10
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string (1–255 chars) | Yes | Search term |
| `page` | number | No | Page number (default: 1) |
| `pageSize` | number (1–100) | No | Results per page (default: 20) |
| `chainSlug` | string | No | Filter by chain |
| `restaurantId` | UUID | No | Filter by restaurant (takes precedence over chainSlug) |
| `availability` | string | No | Filter by availability: `"available"`, `"seasonal"`, `"discontinued"`, `"regional"` |

### Response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Big Mac",
        "nameEs": "Big Mac",
        "restaurantId": "uuid",
        "chainSlug": "mcdonalds-es",
        "restaurantName": "McDonald's España",
        "availability": "available",
        "portionGrams": 200,
        "priceEur": null
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "totalItems": 3,
      "totalPages": 1
    }
  }
}
```

- Empty results return 200 with an empty `items` array (never 404)
- Responses cached for 60 seconds

---

## 11. GET /chains — List Chains

List all restaurant chains with aggregated dish counts.

### Request

```
GET /chains?isActive=true
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `countryCode` | string (2 chars) | No | Filter by country (e.g., `ES`) |
| `isActive` | `"true"` \| `"false"` | No | Filter by active status |

### Response

```json
{
  "success": true,
  "data": [
    {
      "chainSlug": "mcdonalds-es",
      "name": "McDonald's España",
      "nameEs": "McDonald's España",
      "countryCode": "ES",
      "dishCount": 120,
      "isActive": true
    },
    {
      "chainSlug": "cocina-espanola",
      "name": "Cocina Española",
      "nameEs": "Cocina Española",
      "countryCode": "ES",
      "dishCount": 250,
      "isActive": true
    }
  ]
}
```

This endpoint is **not paginated** — the response includes all matching chains (currently ~15 max). Cached for 60 seconds.

> **Note:** `cocina-espanola` is a virtual chain representing 250 canonical Spanish dishes. It is not a physical restaurant.

---

## 12. GET /restaurants — List Restaurants

### Request

```
GET /restaurants?chainSlug=mcdonalds-es&page=1&pageSize=20
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Default: 1 |
| `pageSize` | number (1–100) | No | Default: 20 |
| `chainSlug` | string | No | Filter by chain |
| `countryCode` | string | No | Filter by country |
| `isActive` | `"true"` \| `"false"` | No | Filter by active status |
| `q` | string | No | Trigram similarity search by name |

### Response

Same paginated structure as dish search. Each item includes `id`, `name`, `nameEs`, `chainSlug`, `countryCode`, `isActive`, `dishCount`, `logoUrl`, `website`, `address`.

---

## 13. GET /restaurants/:id/dishes — Restaurant Dishes

List dishes for a specific restaurant.

```
GET /restaurants/uuid-here/dishes?page=1&pageSize=20&search=mac&availability=available
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Default: 1 |
| `pageSize` | number (1–100) | No | Default: 20 |
| `search` | string | No | Trigram similarity search within this restaurant's dishes |
| `availability` | string | No | Filter: `"available"`, `"seasonal"`, `"discontinued"` |

Returns `404 NOT_FOUND` if the restaurant UUID does not exist. Otherwise, returns a paginated dish list (same item structure as /dishes/search).

---

## 14. GET /health — Health Check

```
GET /health
GET /health?db=true&redis=true
```

Returns server status. Optional `db` and `redis` query params trigger connectivity checks.

> **Note:** The `db` check validates both the Prisma connection pool (catalog endpoints) and the Kysely/pg connection pool (estimation, conversation, recipe endpoints).

```json
{
  "status": "ok",
  "timestamp": "2026-04-06T10:00:00.000Z",
  "version": "0.7.0",
  "uptime": 86400,
  "db": "connected",
  "redis": "connected"
}
```

> **Note:** This endpoint does NOT use the standard `{ success, data }` envelope. It returns the object directly.

---

## 15. Error Codes

### HTTP Status Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body or query params failed Zod validation. Check `details` array. |
| 401 | `UNAUTHORIZED` | Missing, invalid, or expired API key |
| 403 | `FORBIDDEN` | Valid API key but access has been revoked |
| 404 | `NOT_FOUND` | Resource not found (restaurant, tracking entry, etc.) |
| 408 | `PROCESSING_TIMEOUT` | Server-side processing exceeded time limit |
| 409 | `DUPLICATE_RESTAURANT` | Restaurant with same (chainSlug, countryCode) already exists |
| 413 | `PAYLOAD_TOO_LARGE` | Uploaded file exceeds the 10 MB size limit |
| 404 | `CHAIN_NOT_FOUND` | Unknown chainSlug in reverse search |
| 422 | `RECIPE_UNRESOLVABLE` | Zero ingredients resolved in recipe calculation |
| 422 | `FREE_FORM_PARSE_FAILED` | LLM could not parse free-form recipe text |
| 422 | `MENU_ANALYSIS_FAILED` | Could not extract any dish names from the photo/PDF |
| 422 | `EMPTY_TRANSCRIPTION` | Whisper returned empty or hallucinated transcription |
| 502 | `TRANSCRIPTION_FAILED` | Whisper API upstream failure |
| 422 | `INVALID_IMAGE` | File is not a valid image (bad format or MIME type) |
| 422 | `OCR_FAILED` | OCR could not extract text from the image |
| 422 | `VISION_API_UNAVAILABLE` | OpenAI Vision API not configured on the server |
| 429 | `RATE_LIMIT_EXCEEDED` | Request rate limit exceeded (per-IP or per-key) |
| 429 | `ACTOR_RATE_LIMIT_EXCEEDED` | Daily per-actor limit exceeded |
| 500 | `DB_UNAVAILABLE` | Database query failed |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

---

## 16. Data Coverage

### Chains (14 + 1 virtual)

All chains are Spanish (`countryCode: "ES"`). Use GET /chains for the current list.

| Chain | Slug | Approximate Dishes |
|-------|------|--------------------|
| McDonald's España | `mcdonalds-es` | ~120 |
| Burger King España | `burger-king-es` | ~100 |
| Telepizza | `telepizza-es` | ~80 |
| ... (11 more chains) | ... | ... |
| **Cocina Española** (virtual) | `cocina-espanola` | **250** |

### Cocina Española

The `cocina-espanola` virtual chain contains 250 canonical Spanish dishes with nutritional data sourced from BEDCA (Spanish national food composition database) and recipe-based estimation. Includes: tortilla de patatas, gazpacho, paella, croquetas, fabada, cocido madrileño, and 25+ alcoholic beverages.

Regional aliases are recognized: `bravas` → Patatas bravas, `bocata de jamón` → Bocadillo de jamón serrano, `caña` → Cerveza (caña).

### Base Foods

- **514 foods** from USDA SR Legacy database
- **20 foods** from BEDCA (placeholder, pending AESAN commercial authorization)

### Nutrients Tracked (15)

`calories`, `proteins`, `carbohydrates`, `sugars`, `fats`, `saturatedFats`, `fiber`, `salt`, `sodium`, `transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`, `alcohol`

Plus `referenceBasis`: `"per_100g"`, `"per_serving"`, or `"per_package"`.

---

## 17. Estimation Engine

The engine cascades through four levels until a match is found:

| Level | Strategy | Confidence | When |
|-------|----------|------------|------|
| **L1** | Official data lookup | High | Exact or full-text match in dishes/foods tables |
| **L2** | Ingredient-based calculation | Medium | Dish has ingredient composition data |
| **L3** | pgvector similarity | Medium | No exact match; uses embedding cosine distance |
| **L4** | LLM identification | Low | No DB match; LLM maps query to known entities |

**Key design principle (ADR-001):** The LLM in Level 4 is strictly an identification layer. It maps the user's query to known database entities or decomposes a dish into known ingredients. All nutrient arithmetic is performed by the deterministic engine — never by the LLM.

### Match Types

| matchType | Level | Description |
|-----------|-------|-------------|
| `exact_dish` | L1 | Exact name match on dish |
| `fts_dish` | L1 | Full-text search match on dish |
| `exact_food` | L1 | Exact name match on base food |
| `fts_food` | L1 | Full-text search match on base food |
| `ingredient_dish_exact` | L2 | Dish resolved via ingredient composition |
| `ingredient_dish_fts` | L2 | Ingredient FTS match |
| `similarity_dish` | L3 | pgvector cosine similarity (dish) |
| `similarity_food` | L3 | pgvector cosine similarity (food) |
| `llm_food_match` | L4 | LLM identified a matching food entity |
| `llm_ingredient_decomposition` | L4 | LLM decomposed dish into ingredients |
| `direct_id` | L1 | Resolved via direct `foodId` parameter |

---

## 18. Cooking State & Yield Factors

When `cookingState` and/or `cookingMethod` are provided, the engine applies yield correction factors from 60 cooking profiles.

**Problem:** nutritional databases store values per 100g of *raw* weight, but users often report *cooked* weight. Cooking changes weight (water loss, fat absorption), so 100g of cooked chicken ≠ 100g of raw chicken nutritionally.

**How it works:**

1. You send `query=chicken breast&cookingState=cooked&cookingMethod=grilled`
2. The engine finds a matching cooking profile with `yieldFactor: 0.75` (chicken loses 25% weight when grilled)
3. Nutrient values are adjusted: `raw_nutrients * (1 / yieldFactor)` to account for the concentration effect
4. The response includes `yieldAdjustment` with the correction details

**When to use:** only when the user explicitly reports cooked weight. If omitted, the engine assumes the weight matches the database's reference basis.

**YieldAdjustment structure** (returned in `yieldAdjustment` field):

```json
{
  "applied": true,
  "cookingState": "cooked",
  "cookingStateSource": "explicit",
  "cookingMethod": "grilled",
  "yieldFactor": 0.75,
  "fatAbsorptionApplied": false,
  "reason": "yield_applied"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `applied` | boolean | Whether yield correction was applied |
| `cookingState` | `"raw"` \| `"cooked"` \| `"as_served"` | Effective cooking state |
| `cookingStateSource` | `"explicit"` \| `"default_assumption"` \| `"none"` | How the cooking state was determined |
| `cookingMethod` | string \| null | Cooking method used for profile lookup |
| `yieldFactor` | number \| null | Factor applied (null when not applied) |
| `fatAbsorptionApplied` | boolean | Whether fat absorption was added |
| `reason` | string | Outcome reason code (e.g., `yield_applied`, `no_profile_found`, `nutrients_not_per_100g`) |

---

## 19. Caching Behavior

All cacheable responses are stored in Redis with fail-open behavior (cache errors never block responses).

| Endpoint | Cache Key Pattern | TTL |
|----------|-------------------|-----|
| GET /estimate | `fxp:estimate:<query>:<chainSlug>:<restaurantId>:<portionMultiplier>:<cookingState>:<cookingMethod>` | 300s |
| POST /calculate/recipe | `fxp:recipe:<mode>:<sha256(canonical_input)>[:pN]` | 300s |
| GET /dishes/search | `fxp:dishes-search:<params>` | 60s |
| GET /chains | `fxp:chains:<params>` | 60s |
| GET /restaurants | `fxp:restaurants:<params>` | 60s |
| GET /restaurants/:id/dishes | `fxp:restaurant-dishes:<params>` | 60s |

Cached responses include a `cachedAt` ISO 8601 timestamp (when applicable) so clients know whether they received fresh or cached data.

---

---

## 20. GET /reverse-search — Reverse Search

Find chain dishes that fit a calorie budget with optional protein minimum.

### Request

```
GET /reverse-search?chainSlug=mcdonalds-es&maxCalories=600&minProtein=30&limit=5
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainSlug` | string | Yes | Chain to search within |
| `maxCalories` | number (100–3000) | Yes | Maximum calories per dish |
| `minProtein` | number (0–200) | No | Minimum protein grams |
| `limit` | number (1–20) | No | Max results (default: 5) |

### Response

```json
{
  "success": true,
  "data": {
    "chainSlug": "mcdonalds-es",
    "chainName": "McDonald's Spain",
    "maxCalories": 600,
    "minProtein": 30,
    "results": [
      {
        "name": "Chicken McNuggets 9pc",
        "nameEs": null,
        "calories": 420,
        "proteins": 38,
        "fats": 22,
        "carbohydrates": 18,
        "portionGrams": 250,
        "proteinDensity": 9.05
      }
    ],
    "totalMatches": 12
  }
}
```

Results sorted by `proteinDensity` (proteins/calories × 100) descending. Only `available` dishes with `per_serving` reference basis are included.

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid query params |
| `CHAIN_NOT_FOUND` | 404 | Unknown chainSlug |

No results matching → empty `results` array (200 OK, not an error).

---

## 21. Estimation Enrichments

Starting from Phase B, each `GET /estimate` and `POST /conversation/message` (estimation intent) response includes optional enrichment fields alongside the standard result. These fields are present only when relevant data exists.

### Response Fields

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `healthHackerTips` | `HealthHackerTip[]` | F081 | Calorie-saving suggestions for chain dishes |
| `substitutions` | `NutritionalSubstitution[]` | F082 | Healthier alternatives with nutrient diff |
| `allergens` | `DetectedAllergen[]` | F083 | Potential allergens detected from dish name |
| `uncertaintyRange` | `UncertaintyRange` | F084 | Calorie min/max based on confidence level |
| `portionSizing` | `PortionSizing` | F085 | Standard gram range for detected Spanish portion terms |

All fields are optional (omitted when not applicable). They appear at the top level of the `data` object alongside `query`, `result`, etc.

### HealthHackerTip

```json
{
  "tip": "Pedir sin salsa",
  "caloriesSaved": 120
}
```

### NutritionalSubstitution

```json
{
  "original": "Patatas fritas",
  "substitute": "Ensalada",
  "nutrientDiff": { "calories": -180, "proteins": 2, "carbohydrates": -22, "fats": -12, "fiber": 3 }
}
```

### DetectedAllergen

```json
{
  "allergen": "Gluten",
  "keyword": "harina"
}
```

14 EU allergen categories covered. Detection is keyword-based (not ingredient-list verification) — flagged as advisory only.

### UncertaintyRange

```json
{
  "caloriesMin": 535,
  "caloriesMax": 591,
  "percentage": 5
}
```

Margin varies by confidence: ±5% (high/official), ±10% (medium/L2), ±15% (medium/L3), ±20% (low/L4 match), ±30% (low/L4 decomposition).

### PortionSizing

```json
{
  "term": "media ración",
  "gramsMin": 100,
  "gramsMax": 125,
  "description": "Media ración estándar española"
}
```

Recognized terms: `tapa`, `pincho`/`pintxo`, `ración`, `media ración`, `montadito`, `bocadillo`, `plato`, `cuenco`.

---

*All nutritional data is approximate. Always consult official sources for critical dietary decisions.*
