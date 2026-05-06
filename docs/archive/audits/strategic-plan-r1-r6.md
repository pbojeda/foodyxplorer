# Plan Estratégico: Extensión de Capacidades foodXPlorer (R1-R6)

## Contexto

El usuario necesita usar foodXPlorer en campo (desde el móvil, en restaurantes) pero los endpoints de ingestion son admin-only y requieren UUIDs. Además, hay funcionalidades nuevas de alto valor: estimación por foto de menú, cálculo de recetas, y consultas ad-hoc sin contexto de restaurante. Este plan analiza 6 áreas de requisitos, propone soluciones con pros/contras, y define un roadmap de implementación.

---

## Análisis de Requisitos

### R1: Subir fotos/PDFs desde Telegram

**Problema:** Los endpoints de ingest requieren admin auth + UUIDs y no se pueden usar cómodamente desde el móvil.

**Solución recomendada: Opción A — Bot descarga archivo → multipart upload a API**

> **Revisión externa (Codex + Gemini): CRITICAL** — La Opción B original (pasar URL de Telegram al API) filtra el bot token, ya que la URL contiene el token en texto plano (`https://api.telegram.org/file/bot<TOKEN>/...`) y los endpoints guardan/devuelven `sourceUrl`. Descartada.

El bot llama a `bot.getFileLink(file_id)` → descarga el archivo a un Buffer en memoria → envía como multipart a los endpoints existentes `POST /ingest/pdf` (PDFs) o un nuevo `POST /ingest/image` (imágenes, equivalente multipart de `/ingest/image-url`).

| Aspecto | Detalle |
|---------|---------|
| Seguridad | El bot token NUNCA sale del proceso bot — la API solo recibe bytes |
| PDF upload | Ya existe `POST /ingest/pdf` (multipart) — reutilizar directamente |
| Image upload | Nuevo endpoint `POST /ingest/image` (multipart) — equivalente a `/ingest/image-url` |
| Auth | Bot necesita `ADMIN_API_KEY` como env var adicional para llamar endpoints admin |
| Restricción usuario | Nuevo env var `ALLOWED_CHAT_IDS` — solo esos chat IDs pueden usar comandos de upload |
| ApiClient | Extender con método para enviar multipart (FormData + fetch) |

**Descartadas:**
- Opción B (pasar URL Telegram → API): **DESCARTADA — filtra bot token en sourceUrl/logs** (flagged by Codex + Gemini)
- Opción C (API importa SDK Telegram): viola separación de responsabilidades

**Archivos a modificar:**
- `packages/api/src/routes/ingest/image.ts` — **nuevo** endpoint multipart para imágenes
- `packages/api/src/app.ts` — registrar nueva ruta
- `packages/bot/src/config.ts` — añadir `ADMIN_API_KEY`, `ALLOWED_CHAT_IDS`
- `packages/bot/src/apiClient.ts` — añadir método multipart upload (`ingestImage()`, `ingestPdf()`)
- `packages/bot/src/bot.ts` — añadir handlers `photo` y `document`

---

### R2: Resolución de restaurante por nombre + Creación

**Problema:** El usuario no puede memorizar UUIDs de restaurantes. Además, no siempre irá a cadenas — necesita poder crear restaurantes independientes desde Telegram. Una vez tenga el restaurante con su carta, no hará falta volver a subir fotos/PDFs.

**Solución recomendada: Búsqueda + selección + creación interactiva**

1. Añadir parámetro `q` a `GET /restaurants` (trigram search en `name`/`nameEs`, como ya hace `/dishes/search`)
2. Bot command `/restaurante <nombre>` → muestra lista paginada (máx 5-10 resultados) → usuario elige
3. Si no se encuentra → flujo de creación: "No encontrado. ¿Quieres crearlo?"
4. Estado conversacional simple: `Map<chatId, { restaurantId, chainSlug }>` en memoria
5. Tras seleccionar/crear, los siguientes uploads usan ese restaurante

**Paginación:** La lista de restaurantes crecerá con el tiempo (no solo cadenas). El bot debe limitar resultados mostrados (top 5-10 por relevancia trigram) y ofrecer "ver más" si hay más resultados.

**Para sourceId:** Solución transparente — usar una DataSource global "Telegram Upload" con UUID fijo (seedeado). El usuario nunca necesita saberlo.

> **Revisión externa (Codex + Gemini): IMPORTANT** — El modelo `Restaurant` actual tiene `chainSlug` como campo required y con unique constraint `@@unique([chainSlug, countryCode])`. Esto no funciona para restaurantes independientes. Además, no hay campos de dirección/ubicación.

**Prerequisito — Migración de schema (F032):**
- Hacer `chainSlug` opcional (nullable) o añadir campo `isIndependent: Boolean`
- Añadir campos: `address String?`, `googleMapsUrl String?`, `latitude Float?`, `longitude Float?`
- Definir regla de slugging para independientes: `independent-<nombre-slugified>-<uuid-short>` (evita colisiones)
- Ajustar unique constraint: `@@unique([chainSlug, countryCode])` debe permitir null chainSlug

**Creación de restaurantes (Phase 1 — necesario para field testing):**
- `POST /restaurants` endpoint admin — recibe `{ name, chainSlug?, countryCode?, address?, googleMapsUrl? }`
- Bot: flujo interactivo "no encontrado → ¿crear?" con nombre mínimo
- Google Maps link: **diferido a Phase 2** — los short links (`maps.app.goo.gl/...`) requieren HTTP redirect following + HTML parsing, demasiada complejidad para Phase 1 (flagged by Gemini). Phase 1: el usuario escribe el nombre manualmente.

> **Revisión externa (Gemini): IMPORTANT** — In-memory Map es anti-pattern cuando Redis ya está en el stack. Pérdida de estado en restart, no escala a múltiples instancias.

**Estado conversacional:** Usar **Redis** (ya disponible) en lugar de in-memory Map.
- Key: `bot:state:{chatId}` → `{ restaurantId, chainSlug, step }`
- TTL: 2 horas (auto-expira por inactividad)
- Reutilizar `cacheGet`/`cacheSet` del bot (o nuevo helper dedicado)

**Nota sobre cartas de restaurantes independientes:** Las cartas de restaurantes no-cadena típicamente solo contienen nombres de platos y quizás ingredientes, NO información nutricional. Esto significa que la ingestion de estas cartas servirá para poblar el catálogo de platos, pero los valores nutricionales vendrán del motor de estimación (L3/L4). **El bot debe informar al usuario de que las estimaciones para platos desconocidos tienen confianza baja.**

**Archivos a modificar:**
- `packages/api/prisma/schema.prisma` — migración: chainSlug nullable, campos address/location
- `packages/shared/src/schemas/restaurant.ts` — actualizar schemas
- `packages/api/src/routes/catalog.ts` — añadir filtro `q` a `/restaurants` + `POST /restaurants`
- `packages/bot/src/bot.ts` — nuevo comando, estado conversacional Redis, flujo de creación

---

### R3: Comportamiento de ingest (upsert)

**Estado actual ya resuelto:** El ingest hace upsert por `(restaurantId, name)` — actualiza platos existentes, crea nuevos. NO borra platos que no aparezcan en el nuevo documento.

**Acción:** Solo documentar y comunicar. No requiere cambios de código.

---

### R4: Estimación ad-hoc (sin restaurante)

**Estado actual ya resuelto:** `/estimate?query=plato mediano de lentejas` funciona sin `chainSlug`. L4 Strategy B descompone en ingredientes y calcula. El NL handler del bot ya llama a `/estimate`.

**Acción:** Verificar con tests manuales. No requiere cambios de código.

---

### R5: Análisis de foto/PDF de menú (estimación, NO ingestion)

**Problema:** El usuario quiere enviar una foto de un menú y recibir los valores nutricionales de los platos que aparecen, o saber cuál tiene menos calorías. Esto es fundamentalmente diferente de ingestar — es una consulta que no guarda nada en BD.

**Observación clave del usuario:** Ya tenemos un pipeline completo de OCR (Tesseract) y parsing de PDFs. ¿Podemos reutilizarlo para extraer nombres de platos de un menú y estimar cada uno, sin necesidad de Vision API?

**Análisis de dos sub-capacidades:**

#### Sub-R5a: Análisis de menú (texto) — Reutilizar OCR/PDF pipeline

El pipeline actual hace: imagen/PDF → texto → `parseNutritionTable()` → platos con nutrientes.
Para análisis de menú necesitamos: imagen/PDF → texto → **`parseDishNames()`** (nuevo) → nombres → `runEstimationCascade()` cada uno.

| Aspecto | OCR Pipeline (Tesseract) | Vision API |
|---------|-------------------------|------------|
| Precisión en fotos con ángulo/reflejos | Baja-Media | Alta |
| Precisión en PDFs | Alta | Alta |
| Coste | Gratis | ~$0.01-0.03/foto |
| Infraestructura existente | Ya la tenemos | Nueva dependencia |
| Extracción de nombres de platos | Necesita nuevo parser (`parseDishNames`) | Prompt directo |

**Solución recomendada: OCR para PDFs, Vision API para fotos**

> **Revisión externa (Gemini): SUGGESTION** — Tesseract en fotos de móvil producirá texto basura (ángulos, reflejos, fuentes decorativas). Reservar OCR para PDFs; para imágenes, usar Vision API directamente.
> **Revisión externa (Gemini): CRITICAL** — El endpoint `/analyze/menu` NO puede ser público sin auth. Crea un proxy gratis a OpenAI billing. Requiere al menos API key auth + rate limiting.

1. **PDFs de menú:** Reutilizar pipeline PDF existente (`pdf-parse` → texto) + nuevo parser `parseDishNames()` (más simple que `parseNutritionTable` — busca líneas que parecen nombres de platos, ignora precios/decoración). Sin coste, alta precisión en PDFs.
2. **Fotos de menú:** Vision API (gpt-4o-mini) — extraer nombres de platos de la imagen. OCR no es viable para fotos de móvil.
3. Endpoint: `POST /analyze/menu` (**requiere API key auth, no admin pero no anónimo**)
4. Acepta multipart (imagen/PDF directo) — consistente con el cambio de R1 (no URLs)
5. Rate limiting específico: máx 10 análisis/hora por key (Vision API tiene coste)
6. Para cada plato extraído → `runEstimationCascade()`
7. Devuelve: array de `{ dishName, estimate: EstimateData }`
8. **Fallback policy:** Si Vision API falla → intentar Tesseract OCR como fallback; si OCR produce <3 líneas de texto → devolver error descriptivo

**Ventaja:** Cada herramienta donde es mejor: OCR para PDFs limpios, Vision API para fotos reales.

#### Sub-R5b: Identificación de plato por foto (foto de comida, no de menú)

Caso de uso diferente: el usuario envía una foto de un plato de comida servido y quiere saber qué es y sus valores nutricionales. Aquí Tesseract NO sirve — no hay texto que leer.

**Solución:** Vision API necesaria (gpt-4o-mini con vision).
1. Prompt: "Identifica el plato de comida en esta foto. Responde con el nombre del plato."
2. Con el nombre → `runEstimationCascade()`
3. Puede ser parte del mismo endpoint `/analyze/menu` con `mode: 'vision'`

**Cumple ADR-001:** El LLM solo identifica nombres de platos, el motor calcula los nutrientes.

> **Revisión externa (Codex + Gemini): IMPORTANT** — El bot necesita un contrato explícito para disambiguar fotos. Cuando el usuario envía una foto sin comando previo, el bot muestra un **Inline Keyboard** con botones:
> - `[ 📖 Subir al catálogo ]` → ingest (requiere restaurante seleccionado)
> - `[ 🧮 Analizar menú ]` → /analyze/menu
> - `[ 🍽️ Identificar plato ]` → /analyze/menu mode:vision
> Esto da inputs/outputs claros para TDD.

**Archivos a crear/modificar:**
- `packages/api/src/routes/analyze.ts` — nuevo route plugin
- `packages/api/src/routes/ingest/image.ts` — **nuevo** endpoint multipart para imágenes (de R1)
- `packages/api/src/app.ts` — registrar rutas
- `packages/api/src/analyze/dishNameParser.ts` — nuevo parser (extrae nombres de menús de texto PDF)
- `packages/shared/src/schemas/analyze.ts` — schemas de request/response
- `packages/bot/src/bot.ts` — handler foto con inline keyboard + callback handlers

---

### R6: Cálculo de receta por ingredientes

**Problema:** El usuario puede preguntar por los valores nutricionales de un plato/receta de tres formas diferentes:

| Modo de entrada | Ejemplo | Procesamiento |
|----------------|---------|---------------|
| Ingredientes + pesos explícitos | "200g arroz, 200g pollo, 100g brócoli" | Determinístico: resolver cada ingrediente → agregar |
| Ingredientes sin pesos | "arroz, pollo y brócoli" | LLM estima pesos razonables → resolver → agregar |
| Nombre de plato + tamaño opcional | "1 plato pequeño de huevos con jamón" | Cascada L1→L4 (ya funciona via `/estimate`) |

Además, el usuario puede hacer mención al **tamaño de ración** (pequeño/mediano/grande, 1 ración, medio plato), que debe influir en los gramos estimados.

**Estado actual:** L4 Strategy B YA descompone y calcula, pero:
- El prompt dice "approximate gram weights" → puede ignorar cantidades explícitas del usuario
- La cascada pasa por L1→L2→L3 antes de llegar a L4 (latencia innecesaria para recetas)
- No tiene conciencia de tamaños de ración (pequeño/grande)

**Solución en dos fases:**

**Fase inmediata (prompt fix — F033):**

> **Revisión externa (Gemini): IMPORTANT** — ADR-001 dice "Engine calculates, LLM interprets". Si el LLM ajusta gramos internamente por tamaño de ración, está haciendo math. Los LLMs son malos en aritmética.

- Modificar prompt de Strategy B para:
  1. Respetar cantidades explícitas del usuario ("200g arroz" → usar 200g exactos)
  2. Cuando no hay cantidades, estimar pesos razonables para una ración estándar
  3. **Para modificadores de tamaño:** El LLM debe devolver un campo `portion_multiplier` (ej: 0.7 para "pequeño", 1.0 para normal, 1.3 para "grande") — el motor Node.js aplica el multiplicador matemáticamente, no el LLM
- Prompt update: "If the user specifies exact gram amounts, use those exact values. If the user mentions portion sizes (small/medium/large), return a portion_multiplier field (0.7 for small, 1.0 for regular, 1.3 for large) — do NOT adjust the gram weights yourself."
- El código de aggregation en Strategy B aplica: `finalGrams = grams * portion_multiplier`

**Fase posterior (endpoint dedicado — F035):**
- `POST /calculate/recipe` — dos modos:
  - Modo estructurado: `{ ingredients: [{name, grams}] }` → determinístico, sin LLM
  - Modo texto libre: `{ query: "arroz con pollo", portionSize?: "small"|"medium"|"large" }` → LLM descompone → calcula
- Resuelve cada ingrediente vía `fetchFoodByName()` (reutilizar de L4)
- Agrega nutrientes con aritmética L2: `SUM(per_100g * grams / 100)`
- Endpoint público (no admin)

**El modo 3 (nombre de plato + tamaño) ya funciona via `/estimate`** — solo necesita el prompt fix de F033 para respetar tamaños.

**Archivos a modificar:**
- `packages/api/src/estimation/level4Lookup.ts` — prompt fix (línea 416)
- `packages/api/src/routes/calculate.ts` — nuevo endpoint (fase posterior)

---

## Roadmap de Implementación

### Phase 1: Field Testing ASAP (F031-F033)

```
F033 (Prompt fix)              ─── independiente, quick win
F032 (Restaurant search+create)─── schema migration + search + creation
F031 (Bot file upload)         ─── depende de F032 (necesita restaurantId)
                                   incluye: POST /ingest/image, inline keyboard, multipart
```

**F033: L4 Prompt Enhancement** (Simple)
- Modificar Strategy B prompt para respetar cantidades explícitas del usuario
- Incluir interpretación de modificadores de tamaño (pequeño/mediano/grande)
- Tests: verificar que "200g arroz, 200g pollo" devuelve esos gramos exactos
- Tests: verificar que "plato pequeño de lentejas" ajusta gramos a la baja
- Archivos: `level4Lookup.ts`

**F032: Restaurant Name Resolution + Creation** (Standard)
- **Schema migration:** `chainSlug` nullable, nuevos campos `address`, `googleMapsUrl`, `latitude`, `longitude`
- API: añadir `q` param a `GET /restaurants` con trigram search (paginado, top 10)
- API: `POST /restaurants` admin endpoint — crear restaurante con nombre
- Bot: comando `/restaurante <nombre>`, estado conversacional en **Redis** (`bot:state:{chatId}`, TTL 2h)
- Bot: flujo "no encontrado → ¿crear?" con inline keyboard
- Google Maps: **diferido a Phase 2** (short links requieren redirect following + HTML parsing)
- Auto-seed DataSource "Telegram Upload" con UUID fijo
- Archivos: `schema.prisma` (migration), `catalog.ts`, `bot.ts`, `apiClient.ts`, `config.ts`

**F031: Bot File Upload** (Standard)
- API: nuevo `POST /ingest/image` endpoint multipart (equivalente a `/ingest/image-url` pero sin URL)
- Bot: handlers para `photo` y `document` events
- Bot: descarga archivo via `getFileLink()` → Buffer → multipart upload a API (token nunca sale del bot)
- Bot: inline keyboard para disambiguación de fotos (subir/analizar/identificar)
- Config: `ADMIN_API_KEY`, `ALLOWED_CHAT_IDS` env vars
- ApiClient: método multipart upload (`ingestImage()`, `ingestPdf()`)
- Chat ID guard: verificar `msg.from?.id` contra allowlist
- Nota: las cartas de restaurantes no-cadena probablemente solo tendrán nombres de platos (sin nutrientes). La ingestion poblará el catálogo y L3/L4 estimará los nutrientes.
- Archivos: nuevo `routes/ingest/image.ts`, `bot.ts`, `apiClient.ts`, `config.ts`

### Phase 2: Analysis Capabilities (F034-F035)

**F034: Menu Analysis (OCR + Vision API)** (Standard-Complex)
- API: `POST /analyze/menu` endpoint (**requiere API key auth** — no anónimo, rate limit 10/hora)
- PDFs: pipeline OCR/PDF existente + nuevo `parseDishNames()` parser (gratis)
- Imágenes: Vision API (gpt-4o-mini) — extraer nombres de platos (OCR no viable en fotos móvil)
- Identificación de plato por foto de comida: Vision API con prompt diferente
- Acepta multipart (imagen/PDF directo, no URLs)
- Fallback: Vision API falla → intentar Tesseract → <3 líneas → error descriptivo
- Para cada plato extraído → `runEstimationCascade()`
- **No depende de F031** — flujo independiente (fixedby Codex review)
- Archivos: nuevo `routes/analyze.ts`, nuevo `analyze/dishNameParser.ts`, schemas, `bot.ts`

**F035: Recipe Calculation Endpoint** (Standard)
- API: `POST /calculate/recipe` endpoint (público)
- Modo estructurado: `{ ingredients: [{name, grams}] }` → determinístico
- Modo texto libre: `{ query: "arroz con pollo" }` → LLM descompone → calcula
- Reutilizar `fetchFoodByName()` de L4
- Aritmética de agregación de L2
- Bot: detección de patrón receta en NL handler
- Archivos: nuevo `routes/calculate.ts`, schemas

### Phase 3: UX Polish (F037)

**F037: Conversational Context Manager** (Standard)
- Estado persistente por chatId (contexto de restaurante/cadena)
- "Estoy en McDonald's Fuencarral" → establece contexto
- Timeout: 2 horas de inactividad
- Preparación para futura web UI

---

## Nuevos Features para Product Tracker

| ID | Feature | Epic | Complejidad | Dependencias |
|----|---------|------|-------------|--------------|
| F031 | Bot File Upload (multipart, inline keyboard) | E004 | Standard | F032 |
| F032 | Restaurant Resolution + Creation (schema migration) | E004 | Standard | — |
| F033 | L4 Prompt Enhancement (explicit amounts + portion_multiplier) | E003 | Simple | — |
| F034 | Menu Analysis (PDF OCR + Vision API, auth required) | E005* | Standard-Complex | — (independiente) |
| F035 | Recipe Calculation Endpoint (structured + free-form) | E005* | Standard | F033 |
| F037 | Conversational Context Manager | E005* | Standard | — |

*E005 sería un nuevo epic "Advanced Analysis & UX" o similar.
*F036 (Restaurant Creation) se fusiona con F032 — es parte del mismo flujo.

### Revisión Externa — Issues Resueltos

| # | Severidad | Fuente | Issue | Resolución |
|---|-----------|--------|-------|------------|
| 1 | CRITICAL | Codex+Gemini | Bot token leak en URLs Telegram | Cambiado a multipart upload (bot descarga → buffer → API) |
| 2 | CRITICAL | Gemini | `/analyze/menu` público = proxy OpenAI gratis | Requiere API key auth + rate limit 10/hora |
| 3 | IMPORTANT | Codex+Gemini | Restaurant model no encaja con independientes | Schema migration: chainSlug nullable, campos address/location |
| 4 | IMPORTANT | Codex+Gemini | Disambiguación de fotos sin definir | Inline keyboard con 3 opciones (subir/analizar/identificar) |
| 5 | IMPORTANT | Gemini | Google Maps short URLs imposibles de parsear | Diferido a Phase 2 |
| 6 | IMPORTANT | Gemini | In-memory Map anti-pattern | Cambiado a Redis con TTL 2h |
| 7 | IMPORTANT | Gemini | ADR-001 violación en portion sizes | LLM devuelve `portion_multiplier`, engine hace math |
| 8 | IMPORTANT | Codex | F034 dependency graph incorrecto | F034 no depende de F031 (independientes) |

---

## Prompt para Consulta a Gemini / Codex

Copiar el siguiente prompt y pegarlo en Gemini CLI (`cat prompt.txt | gemini`) o Codex:

---

```
You are reviewing the architecture and implementation plan for foodXPlorer, an open-source nutritional information platform for Spanish fast-food chains AND independent restaurants. The platform has a 4-level estimation cascade (L1: exact DB match → L2: ingredient-based → L3: pgvector similarity → L4: LLM decomposition). Core principle (ADR-001): "Engine calculates, LLM interprets" — the LLM never generates nutritional values, only identifies foods or decomposes recipes.

Stack: Node.js 22, TypeScript, Fastify, Prisma + Kysely, PostgreSQL (pgvector, pg_trgm), Redis, OpenAI API (embeddings + chat), Telegram bot (node-telegram-bot-api), Zod validation. Monorepo with packages: api, bot, shared, scraper.

Current state: 29 features completed (F001-F029), 2718 tests passing. The bot handles text commands and natural language queries. The API has admin-only ingest endpoints (PDF, URL, image-url, pdf-url) that require restaurantId + sourceId (UUIDs). All ingest endpoints are protected by ADMIN_API_KEY. The SSRF guard blocks private IPs but allows public URLs. Existing OCR pipeline: Tesseract.js v5 (spa+eng) for image→text, pdf-parse for PDF→text, parseNutritionTable() for extracting nutritional data from text.

THE USER WANTS TO EXTEND THE PLATFORM WITH 6 NEW CAPABILITIES:

R1: TELEGRAM FILE UPLOAD — Upload photos/PDFs directly from phone at restaurants (not URLs, actual files). Proposed: bot calls bot.getFileLink(file_id) to get temporary Telegram HTTPS URL, passes it to existing /ingest/image-url or /ingest/pdf-url endpoints. Restricted to specific chat IDs via env var.

R2: RESTAURANT NAME RESOLUTION + CREATION — User can't memorize UUIDs. Also, user visits independent restaurants (not just chains), so needs to create restaurants on-the-fly from Telegram. Proposed: add trigram search (q param) to GET /restaurants (paginated, top 10 by relevance), bot command /restaurante <name> with paginated selection + "create new" flow. In-memory Map for conversation state per chatId. Google Maps link support for restaurant creation (extract name/address). Important: independent restaurant menus typically only have dish names (no nutritional data) — ingestion populates the catalog, L3/L4 estimates the nutrients. Also: once a restaurant has its menu uploaded, no need to re-upload.

R3: SOURCE MANAGEMENT — sourceId is opaque to user. Proposed: seed a single global "Telegram Upload" DataSource with well-known UUID, bot hardcodes it.

R4: FREE-FORM ESTIMATION — "nutritional values of a medium plate of lentils" without chain context. Already works via /estimate without chainSlug. L4 Strategy B decomposes and calculates. No changes needed.

R5: MENU ANALYSIS (NOT ingestion) — Two sub-capabilities:
- R5a: MENU TEXT ANALYSIS — "Given this menu photo/PDF, extract dish names and estimate each." Proposed: REUSE existing Tesseract OCR and PDF parsing pipeline with a NEW simpler parser (parseDishNames instead of parseNutritionTable — extracts dish names from menu text, not nutritional tables). Then run runEstimationCascade() for each dish. This maximizes code reuse and costs nothing (no API calls). Endpoint: POST /analyze/menu with mode: 'ocr' (default).
- R5b: DISH PHOTO IDENTIFICATION — "Given this photo of a plate of food, what dish is it and what are its nutrients?" Here Tesseract can't help (it's food, not text). Proposed: OpenAI Vision API (gpt-4o-mini) to identify the dish name, then runEstimationCascade(). Same endpoint with mode: 'vision'. Complies with ADR-001 (LLM identifies dish name only, engine calculates nutrients).

R6: RECIPE CALCULATION — Three input modes the user may use:
- Mode A: Ingredients WITH explicit weights — "200g rice, 200g chicken, 100g broccoli" → deterministic calculation (no LLM needed)
- Mode B: Ingredients WITHOUT weights — "rice, chicken, broccoli" → LLM estimates reasonable weights → calculation
- Mode C: Dish name with optional portion size — "1 small plate of eggs with ham" → existing cascade (already works via /estimate)
L4 Strategy B already handles Mode B/C but its prompt says "approximate gram weights" which may override explicit amounts in Mode A. Also, the prompt doesn't handle portion size modifiers (small/medium/large, ración pequeña/grande).
Proposed: Phase 1 = fix L4 prompt to (a) respect explicit gram amounts, (b) interpret portion size modifiers. Phase 2 = new POST /calculate/recipe endpoint with two sub-modes: structured ({ingredients: [{name, grams}]}) for deterministic calculation, and free-form ({query: "arroz con pollo"}) which uses LLM decomposition.

PROPOSED IMPLEMENTATION ORDER:
1. F033: L4 prompt fix — explicit amounts + portion sizes (Simple, quick win)
2. F032: Restaurant name resolution + creation (Standard, includes Google Maps parsing)
3. F031: Bot file upload via Telegram URL (Standard, depends on F032)
4. F034: Menu analysis — OCR pipeline reuse + Vision API (Standard-Complex)
5. F035: Recipe calculation endpoint — structured + free-form (Standard)
6. F037: Conversational context manager (Standard, deferred)

Note: F036 (restaurant creation) was merged into F032 — same flow.

REVIEW THE FOLLOWING AND PROVIDE YOUR ANALYSIS:

1. ARCHITECTURE: Is the approach of passing Telegram file URLs to existing ingest endpoints sound? Are there security concerns with embedding the bot token in the URL that the API receives? Should we use a different approach?

2. CONVERSATION STATE: In-memory Map for bot conversation state (restaurant selection persists for subsequent uploads). Is this sufficient for a single-instance bot, or should we use Redis from the start? What about race conditions?

3. OCR REUSE vs VISION API: For R5a (menu text analysis), we propose reusing the existing Tesseract OCR/PDF pipeline with a new simpler parser (parseDishNames) instead of requiring Vision API. Vision API is reserved for R5b (dish photo identification) where OCR can't help. Is this dual approach sound? Concerns: Tesseract quality on phone photos (angles, glare, decorative fonts) — should we default to OCR and offer Vision as fallback, or the other way around?

4. RECIPE INPUT MODES: For R6, the user can specify ingredients with weights, without weights, or just a dish name with portion size. The prompt fix (F033) handles this at the L4 level. The dedicated endpoint (F035) adds a deterministic path for Mode A. Is the two-phase approach right? Should we handle portion sizes ("small plate") differently?

5. RESTAURANT CREATION FLOW: Restaurant creation is now in Phase 1 (merged with F032). The bot flow is: search → not found → "Create?" → user provides name (or Google Maps link) → POST /restaurants. Google Maps link parsing extracts name/address. Is this flow complete? Should the Google Maps integration be its own feature or is it simple enough to include in F032?

6. INDEPENDENT RESTAURANTS: Menus from non-chain restaurants typically only have dish names (no nutritional data). After ingestion, the catalog has dishes but no nutrients — L3/L4 will estimate. Is this the right approach? Should we warn the user that estimates for unknown dishes are less accurate?

7. PHOTO FLOW DISAMBIGUATION: The bot receives a photo. It could be: (a) a menu to ingest into a restaurant's catalog, (b) a menu to analyze for nutritional info, (c) a photo of a plate of food to identify. How should the bot decide? Options: explicit commands, caption parsing, ask the user, or default behavior.

8. MISSING CONCERNS: What are we missing? Think about: error handling for Vision API failures, cost tracking, rate limiting for new endpoints, testing strategy (mocking Vision API, mocking Telegram getFileLink), handling of multi-page menus, i18n (menus in Spanish but food DB may have English names), Google Maps API rate limits/costs, parseDishNames accuracy on diverse menu formats.

9. IMPLEMENTATION ORDER: Is the proposed order optimal? Should anything be reordered? Are there hidden dependencies we're missing?

Please be direct and critical. If something is wrong, say so. If the plan is solid, say APPROVED with any minor suggestions. End with: VERDICT: APPROVED | VERDICT: REVISE (with specific issues to address).
```

---

## Consideraciones para Futura Web UI

Todas las nuevas capacidades se diseñan **API-first**:
- `/analyze/menu` → la web puede enviar fotos/PDFs directamente
- `/calculate/recipe` → la web puede tener un formulario de ingredientes
- `GET /restaurants?q=` → la web puede tener un buscador de restaurantes
- El bot se convierte en un "cliente" más de la API, al igual que la web

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Bot token leak en URLs | Eliminado | — | Resuelto: multipart upload, token nunca sale del bot |
| Vision API coste se dispara | Baja | Medio | Rate limit + ALLOWED_CHAT_IDS + logs de uso. OCR mode por defecto |
| Estado conversacional se pierde en restart | Eliminado | — | Resuelto: Redis con TTL 2h desde el inicio |
| LLM ignora cantidades explícitas | Media | Medio | Prompt engineering + tests de regresión |
| parseDishNames baja precisión en menús variados | Media | Medio | Parser iterativo, fallback a Vision API si OCR falla |
| Restaurantes independientes sin nutrientes | Baja | Bajo | Esperado — L3/L4 estima. Informar al usuario de confianza baja |
| Google Maps API costes/límites | Baja | Bajo | Parsing básico de URL (no API), futuro: Places API si necesario |
| Lista de restaurantes crece demasiado | Media | Bajo | Paginación en bot (top 5-10), trigram ranking por relevancia |

---

## Verificación

Para validar que el plan es correcto:
1. Confirmar que `bot.getFileLink()` devuelve URL HTTPS válida para descarga (doc de node-telegram-bot-api)
2. Verificar que multipart upload funciona con `POST /ingest/pdf` existente (test de integración)
3. Verificar que nuevo `POST /ingest/image` multipart acepta JPEG/PNG (test unitario)
4. Verificar que L4 Strategy B maneja cantidades explícitas (test con prompt modificado)
5. Verificar que L4 Strategy B devuelve `portion_multiplier` para tamaños (test con "plato pequeño")
6. Confirmar que schema migration permite `chainSlug` nullable sin romper existentes
7. Confirmar que gpt-4o-mini soporta vision (documentación OpenAI — sí lo soporta)
8. Verificar que `parseDishNames()` extrae nombres razonables de PDFs de menú (test con fixtures)
9. Verificar inline keyboard de Telegram funciona con callback_query handlers
10. Verificar flujo completo: bot → crear restaurante → subir foto → estimar platos
