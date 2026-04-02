# nutriXplorer — Product Evolution Analysis

> **Date:** 2026-03-31
> **Authors:** Claude Opus 4.6, Gemini CLI (Gemini 2.5 Pro), Codex CLI (GPT-5.4)
> **Type:** Strategic product analysis — **Iteration 4 (Final)**
> **Status:** Complete — reviewed by 3 models, 4 iterations

---

## Executive Summary

nutriXplorer has an excellent technical foundation with a 4-level estimation engine, 14 restaurant chains (~885 dishes), 514 USDA base foods, and a complete bot+API+landing stack. However, the product is **too narrow in effective coverage** while being **too broad in its promise** ("any dish, any restaurant, any context"). The gap between promise and delivery is the #1 barrier to product-market fit.

**The core insight:** Users eat at fast-food chains 1-2 times/week, but eat generic/homemade food every day. Until the product handles "menú del día", tapas, and common Spanish dishes reliably, it cannot become a daily-use tool — and daily use is what drives retention and monetization.

**Iteration 2 corrections:** Timelines revised upward (40-60%), Google Maps deprioritized, BEDCA prioritized over LLM bootstrapping, audio input elevated to Phase A.

**Iteration 3 (critical structural review):** Three foundational infrastructures must be built BEFORE feature work: **Provenance Graph** (data source hierarchy), **Anonymous Identity** (actor_id from day 1), and **Shared Conversation Core** (unified backend for bot + web assistant). Phase A split into A0 (foundations) + A1 (value). Conversational assistant integrated into roadmap.

**Iteration 4 (founder corrections + voice architecture):** BEDCA always wins by default (no user disambiguation). i18n ADR already exists (ADR-010). OFF/barcodes back to Phase C (product is conversational-first, not barcode scanner). **Realtime voice added as core differentiator** with hybrid architecture: V1 async (validate engine) → V2 pipeline desacoplado (STT stream + LLM + TTS stream via WebSockets, ~$2,500/mo at scale, ~800-1500ms latency). OpenAI Realtime API rejected ($45K/mo at scale).

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Gap Analysis](#2-gap-analysis)
3. [Proposed Improvements (Priority Matrix)](#3-proposed-improvements)
4. [External API Analysis](#4-external-api-analysis)
5. [Spanish Common Dishes Database Strategy](#5-spanish-common-dishes-database-strategy)
6. [Raw vs Cooked Resolution](#6-raw-vs-cooked-resolution)
7. [Google Maps Restaurant Discovery](#7-google-maps-restaurant-discovery)
8. [New Use Cases Unlocked](#8-new-use-cases-unlocked)
9. [User-Centric Feature Ideas](#9-user-centric-feature-ideas)
10. [Innovative Differentiators](#10-innovative-differentiators)
11. [Monetization Strategy](#11-monetization-strategy)
12. [Risk Assessment](#12-risk-assessment)
13. [Implementation Plan (Revised)](#13-implementation-plan-revised)
14. [Cost Estimates (Revised)](#14-cost-estimates-revised)
15. [Cross-Model Consensus & Disagreements](#15-cross-model-consensus--disagreements)
16. [Iteration 2: Corrections & Improvements](#16-iteration-2-corrections--improvements)

---

## 1. Current State Assessment

### What Works Well

| Capability | Status | Notes |
|---|---|---|
| Estimation Engine (L1-L4) | Excellent | 4-level cascade with graceful degradation, explicit confidence |
| Chain Coverage | Good | 14 chains, ~885 dishes with official data |
| Recipe Calculator | Good | Structured + free-form modes, LLM parsing |
| Menu Photo Analysis | Good | OCR + Vision API, partial results on timeout |
| Bot UX | Good | 12 commands, NL handler, portion modifiers, chain context |
| API Design | Excellent | RESTful, cached, rate-limited, well-documented |
| Landing Page | Excellent | A/B variants, GA4, accessibility, legal compliance |
| Data Quality | Good | Confidence levels, source traceability, quality reports |
| Test Coverage | Very Good | ~4500+ tests across packages |

### What's Missing (All 3 Models Agree)

1. **Generic dish coverage** — Can't reliably estimate "tortilla de patatas", "lentejas", "fabada"
2. **Raw vs cooked distinction** — 100g raw rice ≠ 100g cooked rice nutritionally
3. **Spanish food database** — USDA is American-centric; no BEDCA/AESAN integration
4. **Non-chain restaurant support** — Can't handle "el bar de la esquina"
5. **User personalization** — No goals, no history, no preferences
6. **Daily-use capability** — Product is weekend-use (fast food) not daily-use

### Honest Assessment (Codex)

> "Technically solid for an advanced MVP. Real differentiator in multi-level engine. Very good base for demos, PRs, pilots, and open-source community. But: too broad in promise, too narrow in effective coverage."

### Honest Assessment (Gemini)

> "You currently have an excellent 'Feature', but not yet a 'Product'. The mass public needs visual progress bars, daily calorie tracking, and streaks. A Telegram bot is great for early adopters but limiting for mainstream adoption."

---

## 2. Gap Analysis

### User Journey: What Works vs What Fails

```
User asks about...                        Works?    Level Hit   Confidence
───────────────────────────────────────── ───────── ─────────── ──────────
"Big Mac"                                 ✅ Yes    L1          High
"Big Mac en mcdonalds-es"                 ✅ Yes    L1          High
"Whopper doble"                           ✅ Yes    L1+portion  High
"200g pollo, 100g arroz"                  ✅ Yes    /receta     Medium
Photo of McDonald's menu                  ✅ Yes    /analyze    Varies
"tortilla de patatas"                     ⚠️ Maybe  L3/L4      Low
"lentejas con chorizo"                    ⚠️ Maybe  L4         Low
"menú del día: sopa + filete + flan"      ❌ No     —           —
"rabo de toro con papas"                  ❌ No     —           —
"fabada asturiana"                        ❌ No     —           —
"pintxo de tortilla"                      ❌ No     —           —
"media ración de calamares"               ❌ No     —           —
URL de Google Maps de un bar              ❌ No     —           —
"¿qué pido en BK con 600kcal?"           ❌ No     —           —
[audio] "Me he comido lentejas y flan"    ❌ No     —           —
```

### The "menú del día" Problem

Spain's most common eating-out scenario is the "menú del día" at local bars/restaurants:
- 1st course + 2nd course + dessert + bread + drink
- €10-15 typical price
- Changes daily
- Written on a chalkboard or printed on a sheet
- No nutritional info available anywhere
- **Not on the internet in most cases** (Gemini R2 correction)

The current product **cannot handle this at all**, which means the most frequent Spanish dining scenario is unsupported.

### The "Any Restaurant" Problem

The product promises to work with any restaurant, but:
- Only 14 chains have data
- Independent restaurants have zero coverage
- There's no mechanism to add restaurant data on-the-fly
- Google Maps integration has legal constraints (Terms of Service prohibit storing Places data — Codex R2)
- Photo analysis can extract dish names but needs reference data for estimation

---

## 3. Proposed Improvements

### Priority Matrix (Revised in Iteration 2)

Based on cross-model review feedback, Google Maps has been deprioritized and audio input elevated:

```
         HIGH IMPACT
              │
   ┌──────────┼──────────┐
   │  P1      │  P4      │
   │ Spanish  │ User     │
   │ Dishes   │ Profiles │
   │ DB+BEDCA │ +Tracking│
   ├──────────┼──────────┤
   │  P2      │  P5      │
   │ Raw/     │ Google   │
   │ Cooked   │ Maps *   │
   ├──────────┤ (* legal │
   │  P3      │  issues) │
   │ Audio    │          │
   │ Input    │          │
   └──────────┼──────────┘
   LOW EFFORT │ HIGH EFFORT
              │
   ┌──────────┼──────────┐
   │  P6      │  P7      │
   │ External │ Mobile   │
   │ APIs     │ App/PWA  │
   └──────────┴──────────┘
         LOW IMPACT
```

### P1: Spanish Common Dishes Database + BEDCA Import (HIGHEST impact, MEDIUM effort)

**What:** Import BEDCA official Spanish food composition database + create a curated database of 300-500 common Spanish dishes.

**Why (Gemini):**
> "Transforms the product from 'fast-food tracker' to 'daily nutrition companion'. Unlocks the most common user queries that currently fail."

**Critical correction (Gemini R2):**
> "BEDCA already has 'Tortilla de patatas' calculated by laboratories (with real oil absorption). Using an LLM to decompose recipes and infer calories introduces enormous error margins. Use BEDCA data directly for canonical dishes. Use LLM bootstrapping only for the long-tail of rare variants."

**How:** See [Section 5](#5-spanish-common-dishes-database-strategy) — **revised to BEDCA-first approach**.

**Effort:** 3-4 features, ~2-3 weeks (revised from 1-2 weeks)
**Dependencies:** None

---

### P2: Raw vs Cooked Factors (HIGH impact, LOW-MEDIUM effort)

**What:** Add cooking state awareness with yield factors for ~50 high-impact foods.

**Why:** A user saying "100g arroz" could mean 33g dry (360 kcal) or 100g cooked (130 kcal) — a **2.8x caloric difference**. The fitness/gym segment demands this precision.

**How:** See [Section 6](#6-raw-vs-cooked-resolution).

**Effort:** 2 features, ~1 week
**Dependencies:** None (enhanced by P1 data)

---

### P3: Audio Input (HIGH impact, LOW effort) — **Elevated from Phase C**

**What:** Process Telegram voice messages to estimate meals.

**Why (Gemini R2):**
> "Spain is the paradise of WhatsApp voice notes. The bot must process audio from day 1, not leave it for week 10. It's the biggest UX differentiator vs opening MyFitnessPal and typing ingredient by ingredient."

**How:** Telegram voice messages → Whisper API transcription → existing NL handler or /receta parsing.

**Effort:** 1 feature, ~3-4 days
**Dependencies:** None (leverages existing NL handler)

---

### P4: User Profiles & Tracking (MEDIUM-HIGH impact, HIGH effort) — **Elevated from Phase C**

**What:** User goals (lose fat, gain muscle, maintain), daily targets, history, favorites, BMR calculation.

**Why (Gemini R2):**
> "If you want daily use, people need to see their progress bar and total macros. Move profiles to Phase B."

**Hidden dependency (Gemini R2):**
> "You need unified authentication. Currently users identify by Telegram ID. For a PWA later, you need Supabase Auth or similar to link bot sessions with web sessions."

**Effort:** 4-5 features, ~3-4 weeks
**Dependencies:** Authentication system design decision (ADR needed)

---

### P5: Google Maps Restaurant Discovery (MEDIUM impact, HIGH effort) — **Deprioritized**

**What:** Accept Google Maps URL → extract restaurant → find menu → estimate dishes.

**Why deprioritized (Gemini R2 + Codex R2):**
- Google Maps ToS prohibit extracting/storing Places data outside the service
- Most "menú del día" at Spanish bars **is not on the internet** — it's on a chalkboard
- Scraping restaurant websites requires expensive residential proxies ($50-100/month)
- Menu discovery engine (web crawl + cookie banners + Cloudflare + dynamic JS) is a project in itself, not a 3-4 day feature

**Revised approach:** Move to Phase D. Focus on photo-based menu analysis instead (already built). Consider as a premium feature with explicit Google API billing per-user.

**Effort:** 5-6 features, ~4-5 weeks (revised from 2-3 weeks)
**Dependencies:** P1 (needs reference dishes), legal review

---

### P6: External API Integration (MEDIUM impact, MEDIUM effort)

**What:** BEDCA + Open Food Facts. FatSecret as optional commercial enrichment.

**How:** See [Section 4](#4-external-api-analysis).

**Effort:** 2-3 features, ~1-2 weeks
**Dependencies:** None

---

### P7: Mobile App / PWA (LOW-MEDIUM impact on core, HIGH effort)

**What:** Progressive Web App for visual tracking.

**Effort:** Major initiative, ~8-10 weeks (revised from 6-8)
**Dependencies:** P4 (user profiles), authentication system

---

## 4. External API Analysis

### Recommended APIs (Consensus of 3 Models)

| API | Role | Coverage ES | Cost | License | Priority |
|---|---|---|---|---|---|
| **BEDCA/AESAN** | Spanish official food composition | Excellent | Free | Public | **CRITICAL** |
| **Open Food Facts** | Packaged products, barcodes | Good | Free | ODbL | **HIGH** |
| **FatSecret Platform** | Commercial coverage, servings | Good (56 countries) | Paid | Commercial | MEDIUM |
| **Edamam** | Recipe parsing, multilingual | OK | Paid | Commercial | LOW |
| **Google Places** | Restaurant metadata | Excellent | Paid | Restrictive ToS | LOW (legal issues) |

### BEDCA (Base de Datos Española de Composición de Alimentos)

**Source:** AESAN (Agencia Española de Seguridad Alimentaria)
- URL: https://www.bedca.net/bdpub/  |  API: XML POST at `procquery.php`
- **Evaluation completed 2026-04-02 (real data, not assumptions):**
  - 969 entries total, **only ~431 with actual nutrient data** (BEDCA2 entries mostly empty)
  - 55 nutrients (macros + 19 lipids + 13 vitamins + 11 minerals) — more detailed than USDA
  - Bilingual names (Spanish + English)
  - **Very few prepared dishes** (~85 cooked items, mostly "arroz hervido" not "paella"). Paella exists but WITHOUT nutrient data.
  - **Commercial license: REQUIRES AUTHORIZATION** from AESAN. Email sent 2026-04-02.
- **Existing parser:** `statickidz/bedca-api` (PHP, MIT, 19 stars)
- **Revised strategy:** BEDCA = ingredient-level data (complements USDA with Spanish foods). NOT sufficient for prepared dishes. LLM bootstrapping still needed for canonical dishes.
- **Effort:** 1 feature (F071), ~3-4 days
- **Cost:** Free (pending authorization)

### Open Food Facts — **ELEVATED PRIORITY (R4 evaluation)**

**Source:** https://world.openfoodfacts.org/
- **Evaluation completed 2026-04-02:**
  - **11,150+ Hacendado/Mercadona products** already in OFF
  - Includes prepared dishes (tortillas, croquetas, lasañas, ensaladas) with official packaging data
  - Free API, ODbL license (attribution required)
  - Includes: nutritional values, ingredients, allergens, Nutri-Score, NOVA group
- **Revised strategy (Founder + R4):** OFF is now a primary data source, not just enrichment:
  - **Tier 0:** For branded queries ("tortilla hacendado") → direct OFF lookup, HIGH confidence
  - **Tier 3 fallback:** For generic queries ("tortilla de patatas") when BEDCA + LLM recipe don't match → show OFF data with clear attribution: "Valores de referencia: Tortilla de Patatas Hacendado (plato preparado industrial)"
  - **Caveat:** Industrial prepared food ≠ homemade/bar version. Attribution must be clear.
- **Phase B** (moved from Phase D): Ingest OFF prepared foods early to maximize user value
- **Effort:** 1 feature (F080), ~3-4 days
- **Cost:** Free (ODbL attribution required)
- **Barcode scanning** remains Phase D (F100-F101) — product is conversational-first
- **Cost:** Free (ODbL license requires attribution)

### Mercadona/Hacendado (Gemini R2 Opportunity)

> "Mercadona represents almost a third of Spain's market share. A dedicated scraper or catalog export for Hacendado products would solve 80% of supermarket tracking for your users in a single move."

- **Strategy:** Evaluate Open Food Facts coverage of Hacendado products first. If insufficient, consider dedicated scraper.
- **Risk:** Scraping a specific retailer may have legal implications.
- **Priority:** Evaluate during Phase A, implement if ROI is clear.

### APIs NOT Recommended

| API | Why Not |
|---|---|
| **MyFitnessPal** | No public API. Closed. 41% data error rate. |
| **CalorieMama** | Expensive. US-focused. No Spanish food specialization. |
| **Nutritionix** | US-only coverage. |
| **Google Places** | ToS prohibit storing/caching data. Legal risk (Codex R2). |

---

## 5. Spanish Common Dishes Database Strategy

### Revised Approach: BEDCA-First + LLM Long-Tail (Iteration 2)

**Key correction from Gemini R2:**
> "BEDCA already has lab-measured values for many Spanish dishes. Using LLM to decompose recipes and infer calories through the engine introduces enormous error. Use BEDCA directly for canonical dishes. LLM only for the long tail."

#### Layer 1: BEDCA Official Data (Direct Import)

Import BEDCA's ~700 foods/dishes, many of which ARE common Spanish dishes with lab-measured nutrition:
- Tortilla de patatas (lab-measured, including oil absorption)
- Gazpacho, cocido, paella, etc.
- All with per-100g nutrition data from laboratory analysis
- Confidence: **HIGH** (official source)

**Effort:** 1 feature (F068), ~3-4 days

#### Layer 2: Canonical Spanish Dish List (LLM + Engine)

For dishes NOT in BEDCA, create ~150-200 additional common dishes:

Categories:
- **Desayunos/meriendas** (25): tostada con tomate, café con leche, churros, pincho de tortilla, zumo de naranja natural, magdalena, croissant, cola-cao...
- **Tapas/raciones** (40): croquetas de jamón, ensaladilla rusa, patatas bravas, calamares a la romana, pimientos de padrón, boquerones en vinagre, gambas al ajillo...
- **Primeros platos** (25): sopa castellana, crema de calabacín, ensalada mixta, ensalada César...
- **Segundos platos** (30): filete de pollo a la plancha, merluza a la plancha, rabo de toro, albóndigas en salsa, huevos rotos con jamón, chuletas de cordero...
- **Platos combinados** (10): hamburguesa + huevo + patatas, lomo con pimientos...
- **Bocadillos** (15): bocadillo de jamón serrano, de tortilla, de calamares, montadito de lomo...
- **Postres** (15): flan casero, arroz con leche, natillas, tarta de queso, crema catalana...
- **Bebidas** (20): café solo, caña de cerveza, copa de vino tinto, tinto de verano...

Process:
1. LLM generates standard recipe per dish (ingredients + grams + cooking state)
2. **Cross-validate against BEDCA** where overlap exists
3. Feed through `/calculate/recipe` (structured mode)
4. Human review of top 50 most impactful dishes
5. Store with confidence: **MEDIUM** (estimated), upgrade to HIGH after human review

**Effort:** 1-2 features (F070-F071), ~4-5 days

#### Layer 3: Virtual Restaurant Entry

Create `chainSlug: 'cocina-espanola'` as a virtual restaurant:
- All canonical dishes stored as `Dish` entries
- Enables L1 lookups without code changes
- Separate from BEDCA `Food` entries (foods vs dishes)

#### Layer 4: Regional Variants

Add aliases for regional vocabulary:
- "tortilla española" = "tortilla de patatas" = "tortilla de papas"
- "bocadillo" = "bocata" = "sandwichito"
- "pintxo" = "pincho" = "tapa" (contextual)
- "caña" = "cerveza" (in bar context)
- "media ración" = 0.5x portion

#### Layer 5: Demand-Driven Expansion

- Monitor `/estimate` queries returning `result: null`
- Track frequency in `QueryLog`
- Monthly batch: add top 20 missed queries
- Use existing `/calculate/recipe` for long-tail estimation

### Estimated Effort (Revised)

| Layer | Effort | Output |
|---|---|---|
| Layer 1: BEDCA import | 3-4 days | ~700 foods with lab data |
| Layer 2: LLM canonical dishes | 4-5 days | ~200 additional dishes |
| Layer 3: Virtual restaurant | 1 day | DB entries |
| Layer 4: Regional aliases | 1 day | Aliases in DB |
| Layer 5: Monitoring pipeline | 2 days | Demand tracking |
| **Total** | **~12-14 days** | **~900 foods/dishes** |

---

## 6. Raw vs Cooked Resolution

### The Problem

| Ingredient | Raw (per 100g) | Cooked (per 100g) | Ratio |
|---|---|---|---|
| Rice | 360 kcal | 130 kcal | 2.8x |
| Pasta | 350 kcal | 160 kcal | 2.2x |
| Lentils | 352 kcal | 116 kcal | 3.0x |
| Chicken breast | 165 kcal | 195 kcal | 0.85x |
| Potatoes | 77 kcal | 86 kcal | 0.9x |

### Proposed Solution (Pragmatic)

#### New Table: CookingProfile

```
CookingProfile {
  id: UUID
  foodGroup: String       // "grains", "legumes", "meat", "fish", "vegetables"
  foodName: String?       // Optional specific food override
  cookingMethod: String   // "boiled", "fried", "grilled", "baked", "raw", "steamed"
  yieldFactor: Decimal    // cooked_weight / raw_weight (e.g., 2.5 for rice boiled)
  fatAbsorption: Decimal? // grams fat absorbed per 100g (frying only)
  source: String          // "USDA retention factors" / "BEDCA"
}
```

~50 entries for high-impact foods (see priority list in Iteration 1).

#### Default Assumptions

- **Grains/legumes/pasta:** Default to `cooked` (users usually mean cooked weight)
- **Meat/fish:** Default to `raw` (users usually mean pre-cooking weight)
- **Vegetables:** Default to `raw`
- **Composite dishes:** Default to `as_served`

#### LLM Enhancement

Modify L4 decomposition prompt to extract cooking state:
```json
{ "ingredients": [{ "name": "arroz", "grams": 200, "state": "cooked" }] }
```

#### User Clarification (Bot)

When cooking state causes >15% caloric difference, bot asks once:
"¿Los 100g de arroz son en crudo o cocido?"

#### Transparent Display

Always show: "Estimación basada en arroz **cocido** (asumido)"

### Alcohol Handling (Gemini R2 Addition)

> "Tapeo in Spain includes beer, wine, and vermouth. Alcohol provides 7 kcal/g — a different calculation than carbs/fats/proteins."

**Action:** Add `alcohol` as a nutrient field in the calculation pipeline. When a beverage is detected, apply:
- `alcohol_kcal = alcohol_grams * 7`
- This is separate from the standard Atwater factors (protein=4, carbs=4, fat=9)

**BEDCA includes alcohol content** for beverages, so this integrates naturally with P1.

### Estimated Effort (Revised)

| Task | Effort |
|---|---|
| CookingProfile table + seed data (50 foods) | 1.5 days |
| LLM prompt enhancement | 0.5 days |
| Recipe calculator integration | 1.5 days |
| Bot clarification flow | 0.5 days |
| Alcohol nutrient support | 1 day |
| Tests | 1.5 days |
| **Total** | **~7 days** |

---

## 7. Google Maps Restaurant Discovery

### Revised Assessment (Iteration 2)

**Status:** Deprioritized from Phase B → Phase D due to:

#### Legal Constraints (Codex R2)

> "Google Maps ToS prohibit extracting/storing Places data outside the service. The pricing model changed in 2025 to free quotas per SKU, not the old $200 flat credit. Treating Google Maps as a data acquisition channel violates their terms."

**Implication:** Cannot cache restaurant metadata from Google Places for long-term use. Each lookup must be live and per-user-request.

#### Practical Constraints (Gemini R2)

> "The 'menú del día' at the average Spanish bar is NOT on the internet. It's written in chalk on a blackboard, or at best posted as an Instagram Story that expires in 24h. The entire effort of F074-F079 will fail for the most frequent use case in Spain."

> "Building a scraper that navigates websites, bypasses cookie banners, Cloudflare protection, and finds menus (sometimes in dynamic JS or PDFs) is a project in itself, not a 3-4 day feature."

#### Revised Approach

**Phase D (optional premium feature):**
1. Accept Google Maps URL → extract Place ID → live API call for name + website
2. If website found → attempt menu scraping (best-effort, using existing Crawlee infrastructure)
3. If no website or menu → prompt user to send photo of physical menu
4. All results go through existing estimation engine

**Cost containment:**
- Per-user daily limit (3 restaurant lookups/day)
- Cache within session only (not persistent, ToS-compliant)
- Residential proxy budget: $50-100/month if web scraping is implemented

**Alternative short-term:** Enhance the existing `/analyze/menu` photo flow. User sends photo of chalkboard menu → Vision API extracts dishes → estimation engine provides values. **This already works** and is the more practical path for Spanish bars.

---

## 8. New Use Cases Unlocked

### Per Improvement

| Improvement | New Use Cases |
|---|---|
| **P1: Spanish Dishes + BEDCA** | Estimate "menú del día", tapas, raciones, bocadillos. Compare common dishes. "¿Qué engorda más, paella o fabada?" Daily use at any bar. |
| **P2: Raw/Cooked** | Home cooking tracking. Meal prep calculations. Fitness/gym precision. Recipe imports from cooking websites. |
| **P3: Audio Input** | "Me he comido dos pinchos de tortilla y una caña" → instant estimation. Zero typing friction. Spain's voice-note culture. |
| **P4: User Profiles** | "¿Qué pido con 600kcal y 40g proteína?" Weekly tracking. Goal progress. Personalized recommendations. |
| **P5: Google Maps** | Restaurant discovery (premium). Menu scraping when available. Fallback to photo analysis. |
| **P6: External APIs** | Scan barcode of packaged food. Breakfast/snack tracking. Better ingredient resolution. |

### Combined Scenarios (The Full Vision)

**Scenario 1: "Menú del día" (Voice)**
User sends voice note: "Hoy he comido de menú del día: gazpacho, filete de pollo con patatas fritas y flan de huevo, más un café solo" → Whisper transcribes → NL handler identifies 4 items → Each matched against Spanish dishes DB (L1) → Total: 920 kcal, 42g protein → Shown against daily goal of 1800 kcal.

**Scenario 2: "Cooking at home" (Recipe + Cooking State)**
User says `/receta arroz con pollo: 200g arroz, 300g muslo de pollo, 50g pimiento, 20ml aceite` → Bot asks "¿arroz en crudo o cocido?" → User says "crudo" → Bot applies yield factor → Shows accurate per-serving nutrients.

**Scenario 3: "Quick bar decision" (Photo)**
User sends photo of bar chalkboard → Vision API extracts dish names → Matches against Spanish dishes DB → Shows "Patatas bravas (320 kcal) vs Pimientos de padrón (60 kcal)" → User makes informed choice.

**Scenario 4: "Meal prep / El Tupper" (Gemini R2)**
User says `/receta 2kg lentejas, 500g chorizo, 200g zanahoria... dividir en 5 tuppers` → System calculates total → Divides by 5 → Saves 1 portion as favorite → "Lo de siempre" button for recurring use.

---

## 9. User-Centric Feature Ideas

### Tier 1: High Impact, Low Effort (Quick Wins)

1. **Audio input (voice notes)** — Zero-friction meal logging
2. **"Modo menú del día"** — Input: "primero + segundo + postre + bebida" → complete meal breakdown
3. **"Modo tapeo"** — Multiple tapas → per-tapa + total / N people
4. **Semáforo de confianza visual** — 🟢 High / 🟡 Medium / 🔴 Low with explanation
5. **Guardar comidas frecuentes** — "Lo de siempre" for repeat queries

### Tier 2: Medium Impact, Medium Effort

6. **Reverse search** — "Estoy en BK, me quedan 600 kcal, necesito 30g proteína. ¿Qué pido?"
7. **Nutritional substitutions** — "Si cambias patatas fritas por ensalada, ahorras 200 kcal"
8. **"Health-hacker" chain suggestions** — "Pide sin queso ni salsa: -120 kcal, mismo precio"
9. **Comparison mode v2** — Compare entire meals, not just individual dishes
10. **Allergen cross-reference** — Ingredient-level allergen detection from L2 data
11. **"El Tupper" / Meal prep** — Divide recipe by N portions, save as favorite
12. **Onboarding wizard** — BMR calculation (weight, height, age, activity) for calorie targets

### Tier 3: High Impact, High Effort (Future)

13. **Nutritional copilot** — "Si cenas ligero, esta comida encaja en tu objetivo"
14. **Restaurant nutritional ranking** — "Best high-protein options near you"
15. **Weekly summary** — Charts, trends, patterns
16. **Apple Health / Google Fit integration** — Export daily totals
17. **Community corrections** with inline "Cálculo incorrecto" buttons (Gemini R2)
18. **"Modo España Real"** vocabulary — medias raciones, montaditos, pintxos, "tapa incluida"

---

## 10. Innovative Differentiators

### All 3 Models Found Unique

#### 1. "Health-Hacker" de Cadenas (Gemini)
> "Vas a pedir un Big Mac (508 kcal). Si lo pides sin queso y sin salsa, te ahorras 120 kcal y cuesta lo mismo."

High-value, unique. No competitor does this at scale.

#### 2. "Nutrición por Contexto Real" (Codex)
Adapt estimation to dining scenario: menú del día (fixed portions), tapeo (shared/smaller), afterwork (drinks + snacks), delivery (larger portions), comida compartida (÷ N people).

#### 3. "Índice Saciedad vs Precio" — Data Journalism (Gemini)
Viral public reports: "Los 10 platos de comida rápida que dan más proteína por euro" — drives organic landing traffic.

#### 4. "Modo España Real" (Codex)
Handle uniquely Spanish vocabulary and scenarios: "media ración", "montadito", "pintxo", "menú del día", "tapa incluida con la caña", "pan con aceite", "ración para compartir".

#### 5. Estimación con Incertidumbre Explícita (Codex)
Instead of pretending exactitude, show ranges: "320-420 kcal (depende del aceite de fritura y el tamaño de la ración)".

#### 6. Motor de Corrección Comunitaria (Codex)
Users propose adjustments → experts validate → reputation system → dataset improves with traceability.

#### 7. Google Maps → Full Menu Analysis (User Idea)
Send Google Maps URL → get menu with nutritional estimates. Powerful but legally constrained (Phase D premium).

---

## 11. Monetization Strategy

### Recommended Path (3 Models Consensus)

#### Short Term (0-6 months): B2C Freemium

**Free Tier:**
- 10 estimates/day
- Basic macros (calories, protein, carbs, fat)
- Chain restaurant data
- Text-based queries

**Premium (€3.99/month):**
- Unlimited estimates
- Full macro + micronutrient breakdown
- Photo analysis (menu/dish)
- Voice input
- Daily/weekly tracking
- Saved favorites
- Allergen alerts

**Reality check (Gemini R2):**
> "Charging €3.99 for a bot in Spain is very difficult against MyFitnessPal and Yazio which have beautiful free visual apps."

**Mitigation:** Position on Spanish food specialization, not as a generic calorie tracker. The value proposition is "estima platos españoles reales, no solo comida americana".

#### Medium Term (6-18 months): API B2B

**Clients:** Fitness apps, nutritionists, gym chains, delivery platforms
**Pricing:** Free (100/mo) → €49 (5K/mo) → €199 (50K/mo) → Enterprise

**Reality check (Gemini R2):**
> "Selling an enterprise API whose backend includes LLM-based estimation (L4) won't pass a basic reliability SLA audit from a corporate client."

**Mitigation:** B2B tier uses only L1+L2 (deterministic, auditable). L3+L4 as optional add-on with explicit confidence disclaimers.

#### Long Term (18+ months): SaaS for Restaurants

Help restaurants generate and maintain nutritional information:
- EU regulation compliance
- Widget for restaurant websites / QR menus
- Competitive benchmarking

### Revenue Projections (Conservative, Revised)

| Timeline | Source | Users/Clients | MRR |
|---|---|---|---|
| Month 6 | B2C Premium | 100-150 | €400-600 |
| Month 12 | B2C + API | 300 + 5 | €1,500-2,500 |
| Month 18 | B2C + API + SaaS pilots | 700 + 15 + 3 | €5,000-8,000 |
| Month 24 | Scale | 2,000 + 50 + 10 | €15,000-25,000 |

---

## 12. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| LLM "hallucinations" | Medium | **Critical** | ADR-001 (motor calculates, LLM interprets). Always show confidence. |
| Vision API cost spike if photo becomes primary path | Medium | High | Per-user daily limits. Cache aggressively. Consider local OCR fallback. |
| OpenAI API reliability | Medium | High | Graceful L3/L4 skip. Consider local embedding model fallback. |
| Scraper maintenance | High | Medium | Focus on estimation engine, not scraping. |
| BEDCA data format changes | Low | Low | One-time import; periodic manual refresh. |

### Product Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Perceived inaccuracy** | **High** | **Critical** | ALWAYS show confidence + ranges. Never present L3/L4 as precise. |
| "Just another calorie app" | Medium | High | Differentiate on Spanish food expertise + restaurant intelligence. |
| Scope creep | High | Medium | Focus on P1-P3 first. Ship and iterate. |
| Coverage promise > delivery | High | Critical | Be honest. "Estimación" not "datos oficiales" for non-chain dishes. |
| **Precision perception** (Gemini R2) | High | High | If you give a too-exact number for an ambiguous tapa, users trust more than they should. Show ranges. |

### Legal Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **GDPR: health data** (Gemini R2) | Medium | **High** | If crossing geolocation (Maps URLs) with health goals (profiles), this is special category data under RGPD Art. 9. Requires explicit consent. |
| Google Places ToS violation | High if caching | Medium | Don't cache. Live lookups only. Per-session data. |
| Restaurant menu scraping | Medium | Medium | Only public data. Respect robots.txt. |
| **SaaS nutritional claims** (Gemini R2) | Medium | High | AI-generated nutritional cards without restaurant consent = risk of cease & desist. |
| External API license (ODbL) | Low | Medium | Attribute Open Food Facts. Check BEDCA terms. |

### Hidden Dependencies (Gemini R2 + Codex R2)

| Dependency | Impact | Resolution |
|---|---|---|
| **Unified authentication** | Blocks P4 (profiles) and P7 (PWA) | Need Supabase Auth or similar. ADR required. Currently only Telegram ID. |
| **Barcode reading** | Open Food Facts integration needs barcode extraction | Photo → barcode reading library/API → OFF query. Additional step. |
| **Timezone management** | Daily tracking (P4) needs user timezone | Store timezone per user profile. |
| **Residential proxies** | Web scraping of restaurant sites gets blocked from cloud IPs | Budget $50-100/month if scraping implemented. |

---

## 13. Implementation Plan (Iteration 3 — Final)

### Phase A0: Structural Foundations (Week 1) — NEW IN R3, refined R4

```
Week 1:
  F068 — Provenance graph: DataSource priority_tier + BEDCA-first rules   [2 days]
  F069 — Anonymous identity: actor table + middleware + headers            [2 days]
  F070 — Conversation Core: extract bot NL logic → shared API service     [3 days]
```

**Milestone A0:** Data hierarchy, user identity, and shared conversation backend in place. All subsequent features build on these. i18n follows existing ADR-010 (no new ADR needed).

### Phase A1: Core Value (Weeks 2-4)

```
Week 2:
  F071 — BEDCA import (seed script, bilingual, priority_tier=1)           [3-4 days]
  F072 — Cooking profiles + yield factors (50 foods)                      [3-4 days]

Week 3:
  F073 — Spanish canonical dishes (BEDCA-first + LLM long tail)           [4-5 days]
  F074 — L4 cooking state extraction                                      [2-3 days]

Week 4:
  F075 — Audio input (Whisper → ConversationCore, bot async)              [3-4 days]
  F076 — "Modo menú del día" (/menu command)                              [2-3 days]
  F077 — Alcohol nutrient support                                         [2 days]
  F078 — Regional aliases + "Modo España Real"                            [2 days]
  F079 — Demand-driven expansion pipeline                                 [2 days]
```

**Milestone A1:** Product can estimate any common Spanish dish, accepts voice input, handles cooking state. Conversation Core (from A0) already in place.

### Phase B: Value Features Without Auth + Web Assistant (Weeks 5-10)

> **Reprioritized (Founder R4):** Voice/conversational experience BEFORE profiles/tracking. Features that don't need auth come first — they attract users. Tracking retains them later.

```
Week 5:
  F080 — OFF prepared foods ingestion (11K+ Hacendado products)           [3-4 days]
  F081 — "Health-hacker" chain suggestions                                [2 days]

Week 6:
  F082 — Nutritional substitutions                                        [2 days]
  F083 — Allergen cross-reference (L2 + OFF ingredients)                  [2 days]
  F084 — Estimation with uncertainty ranges                               [2 days]

Week 7:
  F085 — Portion sizing matrix (standard Spanish portions)                [2 days]
  F086 — Reverse search ("¿qué como con X kcal?")                        [3 days]
  F087 — "El Tupper" meal prep                                            [2 days]

Week 8:
  F088 — Community inline corrections ("Cálculo incorrecto")              [3 days]
  F089 — "Modo tapeo" (shared portions ÷ N people)                        [2 days]

Week 9:
  F090 — Web assistant: shell + text mode (/hablar route)                 [4-5 days]
  F091 — Web assistant: async voice (STT → ConversationCore → TTS)        [3-4 days]

Week 10:
  F092 — Web assistant: plate photo upload                                [3 days]
  F093 — Web assistant: landing integration + analytics                   [2-3 days]
```

**Milestone B:** Differentiated product with conversational web assistant, value features without auth, OFF data. Core differentiator delivered.

### Phase C: Realtime Voice + Personalization (Weeks 11-14)

```
Week 9:
  F090 — Web assistant: shell + text mode (/hablar route)                 [4-5 days]
  F091 — Web assistant: async voice (STT → ConversationCore → TTS)        [3-4 days]

Week 10:
  F092 — Web assistant: plate photo upload                                [3 days]
  F093 — Web assistant: landing integration + analytics                   [2-3 days]

Week 11:
  F094 — Voice spike: evaluate Web Speech API vs cloud STT/TTS            [2-3 days]
  F095 — Realtime voice: implement chosen architecture                    [4-5 days]

Week 12:
  F096 — Realtime voice: pause detection + barge-in + filler              [3-4 days]
  F097 — Realtime voice: frontend states + mobile QA                      [3 days]

Week 13:
  F098 — Premium tier (feature gates, rate limits)                        [3 days]
  F099 — User profiles: goals, BMR, daily targets (requires auth)         [4 days]

Week 14: Buffer / polish / QA / latency optimization
```

**Milestone C:** Full conversational assistant with realtime voice. Premium tier. User profiles for power users.

### Phase D: Scale & Monetization (Weeks 15-20) — Optional

```
Week 15:
  F100 — Open Food Facts integration (packaged products)                  [3-4 days]
  F101 — Barcode extraction from photos                                   [2-3 days]
  F102 — API B2B tiers + documentation                                    [3 days]

Week 16:
  F103 — Weekly summary + charts (in-bot + web)                           [3 days]
  F104 — "Índice Saciedad vs Precio" viral content                        [2 days]
  F105 — Landing coverage showcase                                        [2 days]

Week 17-18:
  F106 — Google Maps restaurant discovery (premium, legal review)         [5 days]
  F107 — Auth upgrade: Google Identity Platform (actor merge)             [3-4 days]

Week 19-20:
  F108 — PWA shell (if validated by /hablar usage)                        [5-7 days]
  F109 — Apple Health / Google Fit export                                  [3-4 days]
```

**Milestone D:** Revenue streams active, barcode scanning, cross-platform, auth for power users.

---

## 14. Cost Estimates (Revised)

### Infrastructure Costs (Monthly, at 1000 Active Users)

| Service | Phase A | Phase B | Phase C | Phase D |
|---|---|---|---|---|
| Render (API) | ~$7 | ~$15 | ~$15 | ~$25 |
| Supabase (PostgreSQL) | ~$25 | ~$25 | ~$25 | ~$50 |
| Upstash (Redis) | ~$10 | ~$10 | ~$10 | ~$20 |
| Vercel (Landing) | $0 | $0 | $0 | $20 |
| OpenAI API (embeddings + L4) | ~$15 | ~$25 | ~$35 | ~$50 |
| OpenAI Whisper (voice) | ~$5 | ~$10 | ~$10 | ~$10 |
| OpenAI Vision (photos) | ~$10 | ~$15 | ~$20 | ~$30 |
| Google Places API | $0 | $0 | $0 | ~$200-400 |
| Residential proxies | $0 | $0 | $0 | ~$50-100 |
| **Total** | **~$72** | **~$100** | **~$115** | **~$455-705** |

### Development Time (Iteration 4 — Solo Developer + AI)

| Phase | Features | Estimated Days | Calendar Weeks |
|---|---|---|---|
| Phase A0 | F068-F070 (3 foundations) | ~7 days | 1 week |
| Phase A1 | F071-F079 (9 features) | ~25 days | 3 weeks |
| Phase B | F080-F089 (10 features) | ~25 days | 4 weeks |
| Phase C | F090-F099 (10 features) | ~33 days | 6 weeks |
| Phase D | F100-F109 (10 features) | ~33 days | 6 weeks |
| **Total A0-C** | **32 features** | **~90 days** | **~14 weeks** |
| **Total A0-D** | **42 features** | **~123 days** | **~20 weeks** |

**Iteration 4 notes:** OFF/barcodes back to Phase D. Realtime voice (4 features) added to Phase C. Conversation Core moved to A0. i18n ADR removed (ADR-010 already exists). Voice pipeline adds ~$2,500/mo at scale but is the core product differentiator.

### OpenAI API Cost Breakdown (Per Query Type)

| Query Type | Cost/Call | Daily Vol (1000 users) | Monthly |
|---|---|---|---|
| Embedding generation | ~$0.00002 | 50 new items | ~$0.03 |
| L4 decomposition | ~$0.001 | 200 queries | ~$6 |
| Recipe parsing | ~$0.002 | 100 queries | ~$6 |
| Menu Vision analysis | ~$0.01 | 50 photos | ~$15 |
| Whisper transcription | ~$0.006/min | 100 voice notes | ~$18 |
| **Total monthly** | | | **~$45** |

---

## 15. Cross-Model Consensus & Disagreements

### Strong Consensus (All 3 Models Agree)

1. **Spanish Dishes DB is the #1 priority** — Highest impact, unlocks daily use
2. **BEDCA is the best Spanish food source** — Official, free, culturally relevant
3. **Raw vs cooked needs yield factors, not a complex model** — Pragmatic approach
4. **Open Food Facts for packaged products** — Open, good Spanish coverage
5. **Never let LLM calculate nutrition** — ADR-001 is correct
6. **Always show confidence levels** — Trust is everything
7. **MyFitnessPal API should be avoided** — Closed, unreliable, US-focused

### Iteration 2 Corrections (From Cross-Model Review)

| Issue | Source | Correction |
|---|---|---|
| LLM bootstrapping over BEDCA | Gemini R2 | BEDCA-first for canonical dishes. LLM only for long tail. |
| Google Maps timing (Phase B) | Both R2 | Moved to Phase D. Legal + practical constraints. |
| Timelines too optimistic | Both R2 | Revised upward 40-60% for complex features. |
| Audio input too late | Gemini R2 | Elevated to Phase A. Spain = voice note culture. |
| User profiles too late | Gemini R2 | Elevated to Phase B. Daily use needs tracking. |
| Alcohol not handled | Gemini R2 | Added as explicit nutrient + BEDCA has data. |
| Hidden auth dependency | Gemini R2 | ADR needed for unified auth (Telegram ID → Supabase Auth). |
| Barcode reading missing | Gemini R2 | Added as separate step for OFF integration. |
| Google ToS violation | Codex R2 | Cannot cache Places data. Live lookups only. |
| Proxy costs missing | Gemini R2 | Added $50-100/month for web scraping. |
| Monetization overconfident | Both R2 | Revenue projections halved. B2B L4 disclaimer. |
| "Menú del día" not online | Gemini R2 | Photo analysis is the practical path, not web scraping. |

### Key Insights

**Gemini:**
> "Your product is currently a weekend tool. To become a daily tool, handle 'menú del día'. That single scenario is more important than all other features combined."

**Codex:**
> "Choose ONE bet first: Consumer ('fastest way to estimate macros eating out in Spain') OR Infrastructure ('the Spanish reference API for restaurant nutrition'). Don't sell both at once."

**Claude:**
> "The combination of BEDCA official data + LLM long-tail + voice input + Spanish cultural vocabulary creates a moat that US-centric apps cannot replicate. That's the defensible advantage."

---

## 16. Iteration 2: Corrections & Improvements

### What Changed Between Iterations

| Aspect | Iteration 1 | Iteration 2 | Reason |
|---|---|---|---|
| Spanish dishes source | LLM bootstrapping primary | BEDCA primary, LLM secondary | Lab data >> estimated data |
| Google Maps priority | Phase B (P3) | Phase D (P5) | Legal constraints, practical limitations |
| Audio input | Phase C (week 10) | Phase A (week 3) | Spain = voice note culture |
| User profiles | Phase C (week 7) | Phase B (week 5) | Daily use requires tracking |
| Phase A duration | 3 weeks | 4 weeks | More realistic per-feature estimates |
| Total timeline | 14 weeks (28 features) | 12-18 weeks (27-33 features) | Revised estimates + Phase D optional |
| Monthly costs (Phase D) | $595 | $455-705 | Added proxies, Whisper, revised Places |
| Revenue projections | Optimistic | Conservative (halved) | Market reality in Spain |
| Alcohol handling | Not mentioned | Explicit feature (F074) | Tapeo = beer/wine, 7 kcal/g |
| Auth system | Not mentioned | ADR required (F077) | Hidden dependency for profiles + PWA |
| Barcode reading | Not mentioned | Explicit step in OFF integration | Hidden dependency |
| Community corrections | Phase D (F094) | Phase C (F090) + inline buttons | Earlier = better data quality |

### What Gemini R2 Added That Was Missing

1. **Alcohol calories** — Critical for Spanish tapeo culture
2. **Mercadona/Hacendado** — Biggest supermarket in Spain, OFF coverage evaluation
3. **BMR onboarding** — Essential before tracking makes sense
4. **"El Tupper" meal prep** — Key fitness/gym use case
5. **Audio first** — Spain's communication culture is voice, not text
6. **Inline correction buttons** — Human-in-the-loop from day 1
7. **Residential proxy costs** — Real cost of web scraping

### What Codex R2 Added That Was Missing

1. **Google ToS prohibition** on data caching — Critical legal issue
2. **Google pricing model change** (2025) — Field masks, not flat credit
3. **EU Database Directive** — Sui generis rights for data extraction
4. **B2B SLA concern** — LLM-based estimation can't pass corporate audits
5. **Restaurant consent** for SaaS nutritional cards — Legal risk

### Remaining Open Questions

1. **BEDCA data access format** — Need to investigate download format and licensing terms
2. **Authentication architecture** — Supabase Auth vs Auth0 vs custom (ADR needed)
3. **Whisper vs alternatives** — Cost comparison for voice transcription
4. **Open Food Facts Hacendado coverage** — Need to evaluate before deciding on dedicated scraper
5. **Premium pricing sweet spot** — €2.99 vs €3.99 vs €4.99 for Spanish market
6. **B2B first client** — Who is the ideal pilot customer?

---

## Appendix A: Complete Feature List (Iteration 4 — Final)

| ID | Feature | Phase | Days | Dependencies |
|---|---|---|---|---|
| **F068** | **Provenance graph: priority_tier + BEDCA-first** | **A0** | **2** | **None** |
| **F069** | **Anonymous identity: actor table + middleware** | **A0** | **2** | **None** |
| **F070** | **Conversation Core: extract bot NL → shared service** | **A0** | **3** | **None** |
| F071 | BEDCA food database import | A1 | 3-4 | F068 |
| F072 | Cooking profiles + yield factors | A1 | 3-4 | None |
| F073 | Spanish canonical dishes (BEDCA-first) | A1 | 4-5 | F071 |
| F074 | L4 cooking state extraction | A1 | 2-3 | F072 |
| F075 | Audio input (Whisper → ConversationCore, bot) | A1 | 3-4 | F070 |
| F076 | "Modo menú del día" | A1 | 2-3 | F073 |
| F077 | Alcohol nutrient support | A1 | 2 | F071 |
| F078 | Regional aliases + España Real vocab | A1 | 2 | F073 |
| F079 | Demand-driven expansion pipeline | A1 | 2 | F073 |
| F080 | User profiles: goals, BMR, targets | B | 4 | F069 |
| F081 | Daily tracking + meal log | B | 4 | F080 |
| F082 | Saved favorites / "lo de siempre" | B | 2 | F080 |
| F083 | Reverse search ("¿qué como con X kcal?") | B | 3 | F073 |
| F084 | Portion sizing matrix (Spanish portions) | B | 2 | F073 |
| F085 | "Health-hacker" chain suggestions | B | 2 | F073 |
| F086 | Nutritional substitutions | B | 2 | F073 |
| F087 | Allergen cross-reference | B | 2 | F073 |
| F088 | "El Tupper" meal prep | B | 2 | F082 |
| F089 | Estimation with uncertainty ranges | B | 2 | None |
| **F090** | **Web assistant: shell + text (/hablar)** | **C** | **4-5** | **F070** |
| **F091** | **Web assistant: async voice (STT→Core→TTS)** | **C** | **3-4** | **F090** |
| **F092** | **Web assistant: plate photo upload** | **C** | **3** | **F090** |
| **F093** | **Web assistant: landing integration** | **C** | **2-3** | **F090** |
| **F094** | **Voice spike: Web Speech API vs cloud** | **C** | **2-3** | **F091** |
| **F095** | **Realtime voice: implement chosen arch** | **C** | **4-5** | **F094** |
| **F096** | **Realtime voice: pause/barge-in/filler** | **C** | **3-4** | **F095** |
| **F097** | **Realtime voice: frontend states + mobile** | **C** | **3** | **F096** |
| F098 | Community inline corrections | C | 3 | None |
| F099 | Premium tier (feature gates) | C | 3 | F080 |
| F100 | Open Food Facts integration | D | 3-4 | None |
| F101 | Barcode extraction from photos | D | 2-3 | F100 |
| F102 | API B2B tiers | D | 3 | None |
| F103 | Weekly summary + charts | D | 3 | F081 |
| F104 | Viral content: "Saciedad vs Precio" | D | 2 | F073 |
| F105 | Landing coverage showcase | D | 2 | F073 |
| F106 | Google Maps restaurant discovery | D | 5 | Legal review |
| F107 | Auth: Google Identity Platform | D | 3-4 | F069 |
| F108 | PWA shell | D | 5-7 | F090, F081 |
| F109 | Apple Health / Google Fit export | D | 3-4 | F081 |

**Bold** = new or significantly changed features in Iteration 4. Total: 42 features (F068-F109).

---

## Appendix B: Decision Required Before Phase A

Before starting implementation, the following decisions should be made:

1. **Product bet:** Consumer-first ("fastest macro estimation eating out in Spain") vs Infrastructure-first ("Spanish reference nutrition API"). This affects prioritization of P4 vs P6.

2. **BEDCA data access:** Download and evaluate the data format, licensing, and coverage before committing to F068 estimates.

3. **Mercadona/Hacendado strategy:** Check OFF coverage. If >60% of top Hacendado products are covered, skip dedicated scraper.

4. **Authentication:** Even if PWA is Phase D, the auth decision (F077 ADR) affects how user profiles store data. Decide early.

5. **Naming:** Finalize nutriXplorer as the official name or choose another.

---

---

## 17. Iteration 3: Structural Foundations & Conversational Integration

> **Source:** Claude Opus 4.6 synthesis of Gemini R3 + Codex R3 deep analysis + founder decisions (2026-04-01)

### The Critical Insight (Both Models Agree)

**Codex R3:**
> "Stop thinking in features. Fix three base infrastructures first: provenance graph, anonymous identity, shared conversation core. That's what will make BEDCA, Mercadona, bot, assistant, tracking and i18n coexist without becoming an incoherent system."

**Gemini R3:**
> "Your competitive moat is the 'Hyper-Local Contextualized Nutritional Graph' — the only system that hears 'Me comí un pincho de tortilla en Lizarran y una caña' and knows how to cross NLP → hyper-local data → standard Spanish portion sizes → final calculation, without friction."

### Foundation 1: Provenance Graph (Data Source Hierarchy)

**The problem:** "Tortilla de patatas" exists in BEDCA (lab-measured average), Mercadona (industrial product with packaging data), and the engine (LLM-estimated recipe). These are NOT the same object.

**Architecture (Codex R3):**

```
                    ┌─────────────────────┐
                    │   Canonical Concept  │
                    │   "tortilla de       │
                    │    patatas"          │
                    └──────┬──────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
  ┌───────▼───────┐ ┌─────▼──────┐ ┌──────▼───────┐
  │ BEDCA (Lab)   │ │ Mercadona  │ │ Engine (L2)  │
  │ Generic prep  │ │ Industrial │ │ Estimated    │
  │ Confidence:   │ │ Exact SKU  │ │ Confidence:  │
  │ HIGH          │ │ Confidence:│ │ MEDIUM       │
  │ (laboratory)  │ │ HIGH       │ │              │
  └───────────────┘ │ (packaging)│ └──────────────┘
                    └────────────┘
```

**Resolution rules (Founder decision R4 — simplified, no user disambiguation):**
- **Generic query** ("tortilla de patatas"): BEDCA wins. Period. No alternatives shown, no questions asked.
- **Branded query** ("tortilla hacendado", "de mercadona"): Return supermarket packaging data directly.
- **Not in BEDCA, exists in supermarket**: Return supermarket data with source attribution ("Datos de Mercadona").
- **Not in BEDCA, not in supermarket**: Fall through to normal L1→L2→L3→L4 cascade.
- **Barcode scan** (Phase C): Return exact product data from OFF/retailer.
- **Never ask the user** which source they mean. The NLP must extract a `has_explicit_brand: boolean` flag. If `false`, route to BEDCA/generic.

**Implementation:** Extend `DataSource` model with a `priority_tier` field:
- Tier 0: Brand/restaurant official (packaging, chain PDF)
- Tier 1: National reference (BEDCA, AESAN lab data)
- Tier 2: International reference (USDA)
- Tier 3: Estimated (engine L2-L4, community)

**Impact on L1 cascade:** When multiple L1 hits exist for the same query, order by `priority_tier` and let user context disambiguate.

### Foundation 2: Anonymous Identity (actor_id from Day 1)

**Founder decision:** No auth barriers initially.

**Codex R3 reframe:**
> "The right decision is not 'no auth'. It's 'no visible friction, but internal identity from day 1'."

**Architecture:**

```
                    ┌─────────────────┐
                    │   actor table   │
                    ├─────────────────┤
                    │ actor_id (PK)   │
                    │ type: enum      │
                    │   anonymous_web │
                    │   telegram      │
                    │   authenticated │
                    │ external_id     │
                    │   (deviceId /   │
                    │    chatId /     │
                    │    userId)      │
                    │ locale          │
                    │ created_at      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼────┐  ┌──────▼─────┐
     │ favorites  │  │ meal_log  │  │ query_log  │
     │ actor_id   │  │ actor_id  │  │ actor_id   │
     └────────────┘  └───────────┘  └────────────┘
```

**Implementation:**
- **Web:** Generate UUID in `localStorage` on first visit. Send as `X-Actor-Id` header. Server creates `actor` row.
- **Telegram:** Use `chat_id` as `external_id` with `type: telegram`.
- **Auth migration (later):** Create `user_id`, run `ATTACH actor → user`. All history preserved.
- **Multi-device merge:** When user authenticates on a new device, link new `actor_id` to existing `user_id`.

**Why this matters now:**
- Without it, Fase B features (tracking, favorites) have no stable identity
- Analytics will be broken by device/channel duplicates
- Bot → web migration loses all user data
- Rate limiting per anonymous user requires stable actor_id

**Estimated effort:** 1 feature (F068-revised), ~2 days. Small table, middleware, header convention.

### Foundation 3: Shared Conversation Core

**The problem:** The plan has audio in bot (Phase A) AND a full conversational assistant (post-API). If built separately, you duplicate: prompts, context management, rate limiting, analytics, fallback logic, and bugs.

**Codex R3 architecture:**

```
┌─────────────────────────────────────────────────┐
│              Conversation Core (API)             │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Intent   │  │ Entity   │  │ Estimation    │  │
│  │ Resolver │  │ Resolver │  │ Orchestrator  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Context  │  │ Rate     │  │ Confidence    │  │
│  │ Manager  │  │ Limiter  │  │ Policy        │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└──────────┬──────────────┬───────────────┬────────┘
           │              │               │
   ┌───────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
   │ Telegram     │ │ Web Text  │ │ Web Voice   │
   │ Adapter      │ │ Adapter   │ │ Adapter     │
   │ (markdown)   │ │ (JSON)    │ │ (STT→JSON→  │
   │              │ │           │ │  TTS)        │
   └──────────────┘ └───────────┘ └─────────────┘
```

**Key decisions:**
- Bot is NOT temporary — it's a cheap retention channel (Codex R3)
- Web `/hablar` is the discovery/conversion channel (Gemini R3)
- Both are "thin clients" over the same Conversation Core
- STT/TTS are Media Adapters, not core logic

**Implementation strategy:**
- Phase A: Extract existing bot NL handler logic into a `ConversationCore` service in `packages/api`
- Phase A: Bot becomes a thin adapter calling ConversationCore
- Post-Phase B: Web assistant (`/hablar`) is another thin adapter over the same Core
- Voice = STT adapter (Whisper) → ConversationCore → TTS adapter (optional response)

**What this unlocks:**
- Single set of prompts, intents, entity resolution
- Unified analytics (same events from bot and web)
- Shared rate limiting per actor_id
- Context continuity across channels (start on bot, continue on web)

### Revised Phase Structure (Iteration 3)

```
Phase A0: Foundations (Week 1) — NEW
  F068 — Provenance graph: DataSource priority_tier + resolution rules    [2 days]
  F069 — Anonymous identity: actor table + middleware + header convention  [2 days]
  F070 — ADR: i18n architecture (translation table vs columns strategy)   [1 day]

Phase A1: Core Value (Weeks 2-4) — was Phase A
  F071 — BEDCA import (seed script, bilingual entries)                    [3-4 days]
  F072 — Cooking profiles + yield factors (50 foods)                      [3-4 days]
  F073 — Spanish canonical dishes (LLM + engine, BEDCA-first)             [4-5 days]
  F074 — L4 cooking state extraction                                      [2-3 days]
  F075 — Audio input (Whisper → NL handler, bot only)                     [3-4 days]
  F076 — "Modo menú del día" (/menu command)                              [2-3 days]
  F077 — Alcohol nutrient support                                         [2 days]
  F078 — Regional aliases + "Modo España Real"                            [2 days]
  F079 — Demand-driven expansion pipeline                                 [2 days]
  F080 — Conversation Core extraction (refactor bot NL → shared service)  [3 days]

Phase B: Experience & Retention (Weeks 5-9)
  F081 — Open Food Facts integration (moved from Phase C)                 [3-4 days]
  F082 — Barcode extraction from photos (moved from Phase C)              [2-3 days]
  F083 — User profiles: goals, BMR, targets (uses actor_id)               [4 days]
  F084 — Daily tracking + meal log                                        [4 days]
  F085 — Saved favorites / "lo de siempre"                                [2 days]
  F086 — Reverse search ("¿qué como con X kcal?")                        [3 days]
  F087 — "Health-hacker" chain suggestions                                [2 days]
  F088 — Nutritional substitutions                                        [2 days]
  F089 — Allergen cross-reference                                         [2 days]
  F090 — "El Tupper" meal prep                                            [2 days]
  F091 — Portion sizing matrix (standard Spanish portions)                [2 days]

Phase C: Conversational Assistant & Growth (Weeks 10-14)
  F092 — Web assistant: shell + text mode (/hablar route)                 [4-5 days]
  F093 — Web assistant: voice input (STT → ConversationCore)              [3-4 days]
  F094 — Web assistant: voice output (TTS, optional)                      [2-3 days]
  F095 — Web assistant: plate photo upload                                [3 days]
  F096 — Community inline corrections                                     [3 days]
  F097 — Estimation with uncertainty ranges                               [2 days]
  F098 — Premium tier (feature gates, rate limits)                        [3 days]
  F099 — Landing integration + analytics                                  [2-3 days]

Phase D: Scale & Monetization (Weeks 15-20) — Optional
  F100 — API B2B tiers + documentation                                    [3 days]
  F101 — Weekly summary + charts                                          [3 days]
  F102 — "Índice Saciedad vs Precio" viral content                        [2 days]
  F103 — Google Maps → Places API (premium, legal review)                 [5 days]
  F104 — PWA shell (if validated by /hablar usage)                        [5-7 days]
  F105 — Apple Health / Google Fit export                                  [3-4 days]
  F106 — Auth upgrade: Google Identity Platform                            [3-4 days]
```

### Key Changes from Iteration 2 → Iteration 3

| Change | Rationale | Source |
|---|---|---|
| **New Phase A0** (foundations) | Provenance, identity, i18n ADR must exist before features | Codex R3 |
| **Conversation Core extraction** added to Phase A1 | Prevents duplicating logic when web assistant arrives | Both R3 |
| **OFF + Barcodes moved** from Phase C → Phase B | Daily tracking needs packaged food coverage | Gemini R3 |
| **Web assistant moved** from "post-API" → Phase C | Integrated into main roadmap with clear sprint plan | Founder docs |
| **Portion sizing matrix** added to Phase B | "Plato de macarrones" = ???g — without this, macros are unreliable | Gemini R3 |
| **Auth ADR moved** from Phase B → Phase A0 | Identity architecture needed from day 1 (actor_id) | Codex R3 |
| **i18n treated as architecture** not feature | Column strategy decision affects all new DB entities | Codex R3 |
| **B2B moved** to Phase D | Need deterministic L1/L2 clearly separable from L4 first | Codex R3 |
| **Feature IDs renumbered** F068-F106 | Clean sequence reflecting new phase structure | — |

### i18n Architecture — Already Decided (ADR-010)

**Status:** ADR-010 approved (2026-03-25) after review by Codex + Gemini. No new ADR needed.

**Current strategy (ADR-010 — Enfoque A):**
- `name` = original PDF text (immutable, traceability)
- `name_es` = Spanish translation (batch LLM, ~$0.20)
- `name_source_locale` = language of the original name
- L1 FTS dual-language: `COALESCE(name_es, name)` with Spanish parser + `name` with English parser

**Evolution path (already documented in ADR-010):**
- When 3rd language needed: add `name_XX` column for small N
- For many languages: introduce `dish_translations` table (industry standard)
- Migration from `{name, name_es}` to `{name, dish_translations}` is mechanical and low-risk

**Embeddings:** OpenAI `text-embedding-3-small` is already multilingual (~100 languages). Current `buildDishText()` includes `nameEs` when non-null → embeddings are naturally bilingual. No change needed.

**R4 note:** The founder confirmed this decision is taken. New entities (e.g., canonical Spanish dishes from BEDCA) should follow the same pattern (`name` + `name_es`). The translations table evolution will happen when actual demand for a 3rd language arises (YAGNI).

### Competitive Landscape (Updated R3)

| Competitor | Strengths | Weaknesses vs nutriXplorer |
|---|---|---|
| **Yazio** | Strong tracking UX, AI photo feature, EU presence | Generic restaurant logging, no Spanish dish specialization |
| **MyFitnessPal** | Huge database, brand recognition | 41% data errors, US-centric, no NLP, no restaurant intelligence |
| **MenuScan** | Menu scanning concept | Very early, generic, no Spanish food data |
| **Yuka** | Barcode scanning, Nutriscore | No restaurant dishes, no macro tracking |
| **ChatGPT/Gemini** | Great NLP, broad knowledge | Hallucinate restaurant menus, no real data, no tracking |

**The gap:** No product combines (1) official Spanish food data with (2) restaurant chain coverage with (3) natural language estimation with (4) explicit confidence levels with (5) portion-aware calculation. This intersection IS the moat.

### Success Metrics (R3)

**Phase A0+A1 (MVP):**
- `Engine Hit Rate`: % queries resolved at L1/L2 (target: >60% of common Spanish dishes)
- `Query Miss Rate`: % returning null (target: <15% for top-300 dishes)
- `Time-To-Answer`: Median time from query to useful response (target: <3s text, <8s voice)
- `Cost per Estimation`: Average OpenAI cost per useful answer (target: <€0.005)
- `D7 Retention`: % users returning within 7 days (target: >25%)
- `Correction Rate`: % of estimates users flag as incorrect (target: <10%)

**Phase B:**
- `Tracking Adoption`: % of active users who log ≥3 meals/week (target: >15%)
- `Favorites Reuse Rate`: % of logged meals from favorites (target: >30% after month 2)
- `Cross-Channel Link`: % of actors with both bot + web activity (target: >5%)
- `Barcode Success Rate`: % of scanned barcodes resolved in OFF (target: >70%)
- `Anonymous → Auth Migration`: % data preserved when upgrading (target: 100%)

### Cost-of-Abuse Risk (Gemini R3)

> "Without mandatory auth, a competitor or bot can script against your public endpoint and burn €5,000 in OpenAI API costs overnight."

**Mandatory from Phase A0:**
- Rate limit by IP: 50 queries/day anonymous
- Rate limit by actor_id: 100 queries/day
- Rate limit L4 (LLM): 20 calls/day per actor
- Rate limit Vision: 10 photos/day per actor
- Rate limit STT: 10 voice notes/day per actor
- All limits fail-closed (deny on Redis failure for anonymous users)

### Portion Sizing Matrix (Gemini R3 — New Feature)

> "This is the hardest problem in computational nutrition. When someone says 'un plato de macarrones', the AI assumes X grams. Without a robust translation matrix, your macros will be garbage."

**Standard Spanish portions table:**

| Concept | Typical Weight | Context |
|---|---|---|
| "un plato de" (primer plato) | 250-300g | Sopas, legumbres, pasta |
| "un plato de" (segundo plato) | 150-200g | Carne, pescado + guarnición |
| "una ración" (bar/tapas) | 200-250g | Shared tapa at a bar |
| "media ración" | 100-125g | Half portion |
| "una tapa" | 50-80g | Individual small portion |
| "un pintxo/pincho" | 30-60g | Basque-style single bite |
| "un bocadillo" | 200-250g total | Bread (100g) + filling |
| "un montadito" | 40-60g total | Small bread + filling |
| "una caña" | 200ml | Small draft beer |
| "un tercio" | 330ml | Bottle beer |
| "una copa de vino" | 150ml | Wine glass |
| "un café solo" | 30ml espresso | — |
| "un café con leche" | 200ml | Espresso + milk |

This table feeds into the NL handler and L4 decomposition to set realistic `portionGrams` defaults.

### Realtime Voice Architecture (NEW — R4)

**Founder requirement:** Voice should feel like a real conversation (both async AND realtime).

**Architecture comparison (Gemini R4):**

| Approach | Latency (TTFA) | Cost/mo (1K users) | Control | Recommendation |
|---|---|---|---|---|
| **A) OpenAI Realtime API** | 300-500ms | ~$45,000 | Low | **REJECTED** (cost prohibitive) |
| **B) Pipeline Desacoplado** | 800-1500ms | ~$2,500 | High | **RECOMMENDED** |
| **C) WebSockets custom** | 1000-2000ms | ~$1,500 | Very high | Complex, similar to B |

**Recommended: Pipeline Desacoplado (Option B)**

```
Client (Next.js /hablar)
    │
    │ WebSocket (audio chunks)
    ▼
Fastify WS Server
    │
    ├──► STT Streaming (Deepgram Nova-2, ~$0.004/min)
    │     └──► VAD (Voice Activity Detection → end of speech)
    │
    ├──► ConversationCore (intent → L1-L4 → response)
    │     └──► May include LLM call (gpt-4o-mini, ~$0.001/call)
    │
    └──► TTS Streaming (OpenAI tts-1, ~$0.015/1K chars)
          └──► Audio chunks back to client via WebSocket
```

**Key technical details:**
- **STT:** Deepgram Nova-2 (streaming, ~200ms latency, $0.0043/min) or OpenAI Whisper (batch, ~1s latency, $0.006/min)
- **VAD (Voice Activity Detection):** Client-side (WebAudio API) or server-side (Deepgram built-in). Detects end of speech → triggers processing.
- **TTS:** OpenAI `tts-1` streaming ($0.015/1K chars, ~300ms first chunk) or ElevenLabs (lower latency, higher cost)
- **Barge-in (interruption):** When user starts speaking during TTS playback, client cancels audio → sends new chunks → server aborts current TTS stream
- **Filler audio:** If L3/L4 cascade takes >1.5s, play "Déjame calcular eso..." while processing (Gemini R4 recommendation)

**Cost breakdown at scale (1000 users, 5 conv/day, 2 min each):**

| Component | Volume/month | Unit Cost | Monthly Cost |
|---|---|---|---|
| Deepgram STT | 150K mins | $0.0043/min | ~$645 |
| GPT-4o-mini (LLM) | 150K calls | ~$0.0003/call | ~$50 |
| OpenAI TTS | 150K mins | ~$0.012/min | ~$1,800 |
| **Total voice** | | | **~$2,500** |

**Implementation strategy:**
- **Phase A1:** Async voice in bot (Whisper batch → NL handler). Validates engine latency.
- **Phase C (weeks 11-12):** Realtime voice in web assistant. WebSocket server + STT streaming + TTS streaming.
- **Progressive enhancement:** `/hablar` starts with text → adds async voice → adds realtime voice. Each mode always available as fallback.

**Latency budget for "feels like a conversation":**

| Step | Target | Notes |
|---|---|---|
| VAD → end of speech | 200ms | Client-side, immediate |
| STT finalization | 200ms | Deepgram streaming |
| ConversationCore | 500ms | L1/L2 fast; L4 may need filler |
| TTS first chunk | 300ms | Streaming, not full generation |
| **Total TTFA** | **~1200ms** | Acceptable for conversation |

**ADR-001 compliance:** LLM (via ConversationCore) never calculates nutrition. It identifies/decomposes. The engine calculates. TTS reads the engine's result. The voice pipeline is a presentation layer, not a computation layer.

### OPEN INVESTIGATION: Zero-Cost Browser-Side Voice (R4 Addendum)

**Context:** All cloud-based voice options (OpenAI Realtime $4.5-14K/mo, pipeline desacoplado $2.5-3K/mo) are cost-prohibitive pre-revenue.

**Alternative to investigate in Phase C:**

```
Browser (FREE)                    Backend (only L1-L4 cost)
──────────────                    ─────────────────────────
Mic → Web Speech API (STT)
   → transcribed text
   → pause detection (native)
   → send text via WS/fetch ───►  ConversationCore → L1-L4
                                  text response
   ◄────────────────────────────  JSON response
Web Speech API (TTS)
   → reads response aloud
```

**Candidates to evaluate:**
- **Web Speech API** (native browser): Free STT + TTS. Good quality in Chrome/Edge/Safari. Built-in pause detection. Zero cost.
- **Whisper.cpp / Transformers.js**: Open-source STT models running client-side via WebAssembly/WebGPU.
- **Piper TTS / VITS / Coqui**: Open-source TTS models executable in browser.
- **Hybrid:** Browser STT (free) + server TTS (cheap, higher quality voices) for premium tier.

**Voice cost: $0 for STT+TTS. Only L4/LLM API costs remain (already budgeted).**

**Decision:** Defer to Phase C spike. Build async voice first (Phase A1, Whisper in bot). Evaluate browser-side alternatives before committing to cloud voice architecture. The right approach may be: browser STT → text WebSocket → ConversationCore → text response → browser TTS, achieving near-realtime feel at zero voice cost.

**Risks to validate:**
- Web Speech API quality in Spanish (accent coverage, background noise)
- Browser compatibility (Firefox support is limited for Speech API)
- Latency of browser-side STT vs cloud (may be slower on low-end devices)
- Voice quality of browser TTS vs cloud TTS (may sound robotic)

### Bot vs Web Assistant Strategy (Clarified)

| Aspect | Telegram Bot | Web Assistant (/hablar) |
|---|---|---|
| **Role** | Retention channel | Discovery/conversion channel |
| **Target user** | Power users, daily loggers | New users, curious visitors |
| **Input** | Text, voice notes, photos | Text, live voice, photos |
| **Output** | Markdown messages | Rich UI cards, charts, TTS |
| **Auth** | telegram_chat_id (automatic) | anonymous actor_id (cookie) |
| **Lifetime** | Permanent | Permanent |
| **Phase** | Already built + enhanced in A1 | Built in Phase C |
| **Shared** | ConversationCore (API service) | ConversationCore (API service) |

**Neither is temporary.** Both are thin adapters over the shared ConversationCore.

### Appendix B: Decisions Required Before Phase A (Revised)

1. **Product bet:** Consumer companion first. Infrastructure (B2B API) follows in Phase D once L1/L2 coverage is strong enough for SLA guarantees. *(Partially decided by founder: open product, no auth barriers, value in references and accuracy.)*

2. **BEDCA data access:** Download, evaluate format, licensing, and coverage. This is the first action item.

3. **Mercadona/Hacendado strategy:** Audit OFF coverage first. If gap >40% of top products, evaluate dedicated scraper vs manual entry. Key insight: "same dish" in BEDCA and Mercadona are different objects — model them separately, present them together.

4. **i18n column strategy:** ADR needed. Recommendation: keep `name + name_es` for existing entities, use `translations JSONB` for new entities. Aliases table for regional vocabulary.

5. **Auth provider:** Evaluate Google Identity Platform (free tier, multi-provider) vs Supabase Auth (already in stack) vs Auth0. Decision needed before Phase B but actor_id pattern allows deferral.

6. **Voice UX:** Async voice notes (push-to-talk → transcribe → respond) for MVP. NOT realtime voice assistant (too expensive, socially awkward in restaurants). Realtime only after validating retention.

7. **Naming:** After Phase A-C. Test with real users first.

---

---

## 18. Iteration 4: Founder Corrections & Voice Architecture

### Changes from Iteration 3 → Iteration 4

| Change | Rationale | Source |
|---|---|---|
| **BEDCA-first simplified** | No user disambiguation. BEDCA always wins. Brand only if explicit. | Founder R4 |
| **i18n ADR removed** (F070 repurposed) | ADR-010 already exists and covers evolution path | Founder R4 |
| **OFF/barcodes → Phase D** | Product is conversational-first, not barcode scanner. Yuka does this well. | Founder R4 |
| **Realtime voice added** (F094-F097) | Core differentiator. Pipeline desacoplado via WebSockets. | Founder R4 + Gemini R4 |
| **OpenAI Realtime API rejected** | $45K/mo at scale vs $2,500/mo for pipeline approach | Gemini R4 |
| **Conversation Core → Phase A0** | Must exist before any channel (bot audio, web text, web voice) | Logical dependency |
| **Phase C expanded** to 6 weeks | Web assistant + realtime voice = 10 features | Schedule impact |

### Key Technical Decisions (R4)

1. **Voice architecture:** Pipeline Desacoplado (Deepgram STT + ConversationCore + OpenAI TTS) over WebSockets. NOT OpenAI Realtime API.
2. **BEDCA resolution:** `has_explicit_brand` boolean flag in NLP entity extraction. If false → BEDCA. If true → brand/supermarket lookup.
3. **Progressive voice:** Async voice (Phase A1, bot) → Async voice (Phase C, web) → Realtime voice (Phase C, web). Each mode always available as fallback.
4. **Latency target:** ~1200ms TTFA (Time-To-First-Audio) for realtime. Acceptable for conversational feel. Filler audio for L4 delays.
5. **ADR-001 preserved:** Voice pipeline is presentation layer. LLM identifies, engine calculates, TTS reads.

---

*Document complete. Four full iterations with cross-model review by Claude Opus 4.6, Gemini 2.5 Pro, and GPT-5.4 (Codex).*
*Analysis period: 2026-03-31 to 2026-04-01. Total cross-model tokens: ~150K across 8 reviews.*
*Conversational assistant documentation integrated from /foodXPlorerResources/docs/conversational-assistent/.*
