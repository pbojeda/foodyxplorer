# Manual QA Plan — post BUG-PROD-007

> Plan de pruebas manuales exhaustivo tras la merge de BUG-PROD-007 a develop (`aab85f0`).
> Cubre todas las features desde BUG-PROD-001 hasta BUG-PROD-007 que el usuario no ha verificado manualmente.
> Última actualización: 2026-04-14
> **Version:** v2 (cross-model reviewed — Gemini REVISE + Codex REVISE, 1 CRITICAL + 7 IMPORTANT + 3 SUGGESTIONS arbitrados)

## Gaps de documentación detectados durante el cross-model review (follow-ups, NO bloquean el QA)

1. **`docs/api-manual.md` no documenta `portionAssumption`** (solo `portionSizing`). Gemini lo marcó como CRITICAL en el review. Follow-up: añadir la sección correspondiente post-QA.
2. **`docs/user-manual-web.md` L689 sobreestima la cobertura de Tier 1** ("cubren los 30 platos de tapas más populares"). En realidad solo hay 2 platos seedeados (croquetas + bravas) en `standard-portions.csv`. Follow-up: alinear el manual con la realidad tras este QA. Si durante las pruebas algún plato distinto de croquetas/bravas devuelve Tier 1, es porque alguien seedeó más filas manualmente — verificar con el usuario.

Ambos hallazgos son documentation drift, NO bugs en el código. El QA se ejecuta contra el comportamiento real del código, no contra el manual.

---

## 0. Meta

**Scope:** validar en un navegador real (desktop + iPhone) que las features mergeadas desde 2026-04-12 se comportan como esperamos.

**Environments:**
- **Primary:** `packages/web` lanzado en local (`http://localhost:3002`) apuntando a `api-dev.nutrixplorer.com` (Render staging, branch `develop`)
- **Mobile:** iPhone Safari contra la URL staging o production de Vercel (BUG-PROD-001/002 requieren el entorno real, no un dev server local)

**Rama durante QA:** `develop` (no se crea rama de QA; los hallazgos se documentan en este doc + bugs.md si procede).

**Deliverables esperados:**
- Este doc actualizado con Actual / Evidence / Status por cada escenario
- Entradas nuevas en `docs/project_notes/bugs.md` para cada bug confirmado (con severidad)
- Screenshots en `docs/manual-qa/screenshots/YYYY-MM-DD-SXX-descriptor.png`

---

## 1. Prerequisites — ANTES de ejecutar CUALQUIER escenario

### 1.1. Seed de `StandardPortion` en dev DB — BLOCKER

**Estado actual:** NO ejecutado en dev ni en prod (confirmado con el usuario el 2026-04-14).

Sin este paso, **F-UX-B Tier 1 (per_dish lookup) nunca dispara** y todas las consultas con `tapa`/`ración`/`media ración` caerán a Tier 3 (F085 generic range) — lo cual se vería como "bug" pero en realidad sería dev DB sin seed.

**Comandos (correr en local contra dev DB):**

```bash
# 1) Apuntar DATABASE_URL a dev
export DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/<db>?sslmode=require"
# Obtener el string de conexión desde Render dashboard → foodxplorer-api-dev → Environment

# 2) Verificar que la migración de F-UX-B está aplicada
cd /Users/pb/Developer/FiveGuays/foodXPlorer
npx prisma migrate status --schema=packages/api/prisma/schema.prisma
# Debe mostrar: '20260413180000_standard_portions_f-ux-b' como applied

# 3) Correr el seed CSV
npm run seed:standard-portions -w @foodxplorer/api
# Debe reportar:
#  - 3 rows upserted (croquetas tapa/racion + bravas tapa)
#  - 1 row skipped (bravas racion — reviewed_by empty)
#  - 0 failures
```

**Verificación post-seed (read-only query contra dev DB):**

```bash
# Abrir Prisma Studio contra dev DB (read-only recomendado)
DATABASE_URL="<dev>" npx prisma studio --schema=packages/api/prisma/schema.prisma
# Navegar a StandardPortion → debe haber 3 filas:
#   croquetas tapa (50g, 2pc), croquetas racion (200g, 8pc), bravas tapa (80g)
```

O vía SQL directo:

```sql
SELECT dish_id, term, grams, pieces, piece_name, reviewed_by
FROM "StandardPortion"
ORDER BY dish_id, term;
-- Expected: 3 rows
```

**Nota para prod:** el mismo seed hay que correrlo contra `DATABASE_URL` de prod **antes** de que los usuarios vean F-UX-B activo. El usuario confirmó que se hará en una sesión aparte. Para este QA plan, alcanza con que dev esté seedeado.

### 1.2. CORS — verificar que `api-dev.nutrixplorer.com` acepta `http://localhost:3002`

**Estado actual:** no verificado. El API corre con `NODE_ENV=production` en Render, por lo que el allowlist viene de `CORS_ORIGINS` env var (no de la lista hardcodeada de development).

**Verificación:**

```bash
curl -i -X OPTIONS https://api-dev.nutrixplorer.com/health \
  -H 'Origin: http://localhost:3002' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type,X-Actor-Id'
```

**Outcomes:**

- ✅ Si devuelve `Access-Control-Allow-Origin: http://localhost:3002` → **Path A (local web → api-dev) viable**
- ❌ Si devuelve `Access-Control-Allow-Origin` vacío o diferente → **Path A bloqueado.** Dos fallbacks:
  - **Fallback A1:** añadir `http://localhost:3002` a `CORS_ORIGINS` en Render dashboard (foodxplorer-api-dev → Environment). Redeploy.
  - **Fallback A2:** correr también `packages/api` en local (`npm run dev -w @foodxplorer/api`) contra una base de datos local o contra dev DB directamente. Este path pierde la componente "api real" pero tiene CORS limpio.

**Bloqueante para arrancar QA.** Si no se resuelve, no se puede ejecutar Path A.

### 1.3. Confirmación visual — dev DB tiene platos

```bash
# Vía API directo (anónimo, sin X-API-Key — usa rate limit anónimo)
curl -s 'https://api-dev.nutrixplorer.com/estimate?query=croquetas' | jq '.data.result.name, .data.level1Hit, .data.matchType'
# Esperado: "Croquetas de jamón", true, "exact_dish" o "fts_dish"

curl -s 'https://api-dev.nutrixplorer.com/estimate?query=big+mac&chainSlug=mcdonalds-es' | jq '.data.result.name, .data.level1Hit'
# Esperado: "Big Mac", true
```

Si estas dos queries fallan, dev DB está en un estado inesperado — STOP y diagnosticar antes de seguir.

---

## 2. Environment setup

### 2.1. Local web dev server

Crear `packages/web/.env.local`:

```
NEXT_PUBLIC_API_URL=https://api-dev.nutrixplorer.com
API_KEY=fxp_<32-hex-chars-from-render-env-vars>
NEXT_PUBLIC_METRICS_ENDPOINT=
NEXT_PUBLIC_GA_MEASUREMENT_ID=
```

> `API_KEY` es opcional — solo se usa para el proxy `/api/analyze` de fotos. Si no lo configuras, las pruebas de foto (sección 5) fallarán con 500 antes de llegar al API. Obtener el valor del dashboard de Render (`foodxplorer-api-dev` → Environment → `API_KEY`).

Lanzar:

```bash
cd /Users/pb/Developer/FiveGuays/foodXPlorer
npm run dev -w @foodxplorer/web
# → Starts Next.js on http://localhost:3002
# → Automatic redirect to /hablar
```

**Verificación post-arranque (browser devtools):**

1. Abrir `http://localhost:3002` — debe redirigir a `/hablar`
2. Network tab → recargar la página → verificar que **no hay errores CORS** (si los hay, vuelve a 1.2)
3. Escribir `big mac` y enviar → debe llegar un POST a `api-dev.nutrixplorer.com/conversation/message` con status 200
4. Si el request falla → revisar `NEXT_PUBLIC_API_URL` y CORS

### 2.2. iPhone — Safari contra staging/prod

Para BUG-PROD-001 y BUG-PROD-002, **NO usar el dev server local** (no reproduce el entorno de Vercel Serverless). Usar directamente:

- **Staging:** el URL de preview de Vercel generado para la última merge a develop (lo puede confirmar el usuario en el dashboard de Vercel)
- **Prod:** `https://app.nutrixplorer.com` (o el equivalente — confirmar URL real)

Es la versión real desplegada en Vercel con el artifact de producción.

### 2.3. Safari Remote Web Inspector — OBLIGATORIO para BUG-PROD-001 (sección 10.2)

Para inspeccionar el request body de las subidas de foto (verificar que el resize cliente se aplica y el payload cabe en los 4.5 MB de Vercel), hay que habilitar Safari Remote Web Inspector:

**En el iPhone:**
1. Settings → Safari → Advanced → Web Inspector → ON

**En el Mac:**
1. Safari → Preferences → Advanced → "Show Develop menu in menu bar" → checked
2. Conectar el iPhone al Mac con cable (primera vez: "Trust This Computer" en el iPhone)
3. Safari Mac → menú Develop → seleccionar el iPhone por nombre → elegir la pestaña abierta en el iPhone
4. Se abre una ventana de DevTools sobre la pestaña del iPhone — Network tab funciona igual que en desktop

**Sin esto, S59/S61 no son verificables.** Si no tienes acceso al Mac durante las pruebas móviles, sáltalas y documéntalo como "pendiente — Web Inspector no disponible".

---

## 3. Evidence capture format

Cada escenario en las secciones 4-11 tiene cuatro campos a rellenar en-sitio:

- **Actual:** qué ha pasado, descrito textualmente
- **Evidence:** referencia a screenshot (ej. `screenshots/2026-04-14-S12-bravas-tier1.png`) o excerpt JSON del Network tab
- **Status:** ✓ (pasa) / ✗ (falla) / ⚠ (funciona pero con observación / comportamiento inesperado)
- **Notes:** cualquier observación adicional, links a bugs.md, etc.

**Cómo capturar el JSON del response** (DevTools):
1. DevTools → Network → filter `conversation/message` o `estimate`
2. Click en la request → Response tab → copy entire JSON
3. Pegar en el campo Evidence, recortando a los campos relevantes (`data.estimation.portionSizing`, `data.estimation.portionAssumption`, `data.comparison.dishA.portionAssumption`, etc.)

**Cómo capturar screenshot:**
- macOS: `Cmd+Shift+4` → área rectangular → guardar en `docs/manual-qa/screenshots/`
- iPhone: botón lateral + botón volumen arriba → editar → AirDrop al Mac → guardar en la misma carpeta
- Formato de nombre: `YYYY-MM-DD-SXX-descriptor.png` (ej. `2026-04-14-S03-bravas-tier1-tapa.png`)

---

## 4. BUG-PROD-003 — Disambiguation (vino / cerveza / agua)

**Fix merged:** PR #107, `a23fd3f` (2026-04-12). Alias entries añadidos a `spanish-dishes.json`.

**Expected root cause fix:** `vino` devuelve "Copa de vino tinto" (alias añadido), `cerveza` devuelve "Cerveza lata" (alias añadido), `agua` ya funcionaba (aliased en `Agua mineral`).

### 4.1. Escenarios

| # | Environment | Query | Expected | Actual | Evidence | Status |
|---|-------------|-------|----------|--------|----------|--------|
| S01 | local web | `vino` | `result.name === 'Copa de vino tinto'`, `matchType === 'exact_dish'` o similar via alias | | | |
| S02 | local web | `vino tinto` | `result.name === 'Copa de vino tinto'` (mismo) | | | |
| S03 | local web | `vino blanco` | `result.name === 'Copa de vino blanco'` (ya funcionaba antes) | | | |
| S04 | local web | `cerveza` | `result.name === 'Cerveza lata'` | | | |
| S05 | local web | `tercio` | `result.name === 'Cerveza lata'` (alias añadido) | | | |
| S06 | local web | `caña` | `result.name === 'Cerveza de barril'` o similar (alias pre-existente) | | | |
| S07 | local web | `agua` | `result.name === 'Agua mineral'` (no regresión) | | | |
| S08 | local web | `manzanilla` | **Observar qué devuelve** — existe colisión documentada entre `Infusión de manzanilla` y `Copa de fino`. Este es un follow-up backlog conocido, no un bug crítico. | | | ⚠ |
| S09 | local web | `arroz con verduras` | **Observar qué devuelve** — existe colisión entre `Paella de verduras` y `Arroz con verduras y huevo` (también follow-up backlog) | | | ⚠ |

### 4.2. Regression sweep (opcional)

Si hay tiempo, probar los terms single-token flagados por Codex como candidatos a futuro alias audit (follow-up backlog BUG-PROD-003):

`pan`, `leche`, `manzana`, `arroz`, `cafe`, `chocolate`, `jamon`, `queso`, `tostada`, `pollo`, `pescado`, `marisco`, `refresco`, `zumo`, `cava`

Para cada uno: observar el top result y anotar si parece una variante especialty o un canonical razonable. No bloquea QA; alimenta el follow-up.

---

## 5. F-UX-A — Size modifier display (`grande`, `doble`, `media`, etc.)

**Fix merged:** PR #109, `ecb78c5` (2026-04-12). Render del pill amber `PORCIÓN GRANDE ×1.5` + subtitle `base: N kcal` en NutritionCard.

**Expected visual:**
- Pill amber `PORCIÓN <MODIFIER>` bajo el nombre del plato (el componente usa `PORCIÓN ${portionLabel.toUpperCase()}`)
- Subtitle `base: N kcal` bajo las calorías grandes, mostrando el valor pre-escalado
- `data.estimation.baseNutrients` y `data.estimation.basePortionGrams` presentes en el JSON cuando `portionMultiplier !== 1`

**IMPORTANTE (hallazgo de cross-model review):** `baseNutrients` y `basePortionGrams` están en el **top level de `EstimateData`** (`data.estimation.baseNutrients`), NO dentro de `result` (`data.estimation.result.baseNutrients`). Codex verificó esto empíricamente contra `packages/shared/src/schemas/estimate.ts:303` y `packages/web/src/components/NutritionCard.tsx:83`.

### 5.1. Escenarios (local web + devtools abierto)

| # | Query | Expected pill (display) | Expected multiplier | Expected JSON structure | Actual | Evidence | Status |
|---|-------|-------------------------|---------------------|-------------------------|--------|----------|--------|
| S10 | `ración grande de paella` | `PORCIÓN GRANDE` | 1.5 | `data.estimation.portionMultiplier === 1.5`, `data.estimation.baseNutrients` present, `data.estimation.basePortionGrams` present, `data.estimation.result.nutrients.calories ≈ data.estimation.baseNutrients.calories * 1.5` | | | |
| S11 | `paella` | (none — no pill) | 1 | `data.estimation.portionMultiplier === 1`, `data.estimation.baseNutrients === undefined` | | | |
| S12 | `media ración de paella` | `PORCIÓN MEDIA RACIÓN` o `PORCIÓN MEDIA` (verificar display real) | 0.5 | `data.estimation.baseNutrients` present; `result.nutrients.calories ≈ base.calories * 0.5` | | | |
| S13 | `doble whopper en burger-king-es` | `PORCIÓN DOBLE` | 2 | baseNutrients present; `result.nutrients.calories ≈ base.calories * 2` | | | |
| S14 | `big mac pequeño` | `PORCIÓN PEQUEÑA` (o `PORCIÓN PEQUEÑO`) | 0.7 | baseNutrients present; `result.nutrients.calories ≈ base.calories * 0.7` | | | |
| S15 | `triple hamburguesa` | `PORCIÓN TRIPLE` | 3 | baseNutrients present; `result.nutrients.calories ≈ base.calories * 3` | | | |

**Qué verificar en cada caso (paths corregidos):**
1. Pill amber visible en la UI bajo el nombre del plato
2. Texto del pill coincide con `PORCIÓN ${modifier.toUpperCase()}`
3. Texto `base: N kcal` visible bajo las calorías principales (solo si `portionMultiplier !== 1`)
4. DevTools → Network → response JSON tiene `data.estimation.baseNutrients` y `data.estimation.basePortionGrams` (top level, no dentro de `result`)
5. `data.estimation.result.nutrients.calories !== data.estimation.baseNutrients.calories` (una escalada, otra base)
6. `data.estimation.result.nutrients.calories ≈ data.estimation.baseNutrients.calories * data.estimation.portionMultiplier` (dentro del margen de redondeo)

### 5.2. Regression — plato sin modifier

Query: `paella`
- **NO** debe haber pill
- **NO** debe haber `baseNutrients` en el JSON
- `portionMultiplier === 1`

---

## 6. F-UX-B — Per-dish portion assumption (Spanish portion terms)

**Fix merged:** PR #113, `d8167d0` (2026-04-13). Tres tiers:
- **Tier 1** — DB lookup en `StandardPortion` (solo croquetas y bravas tras seed)
- **Tier 2** — `media ración` × 0.5 arithmetic contra Tier 1 racion row del mismo plato
- **Tier 3** — F085 generic range fallback (para todo lo demás)

**Expected visual (verificado empíricamente contra `NutritionCard.tsx:196-224`):**
- Tier 1 completo (con pieces): `{Término} ≈ ~N unidades (≈ G g)` — ej. `Tapa ≈ ~2 croquetas (≈ 50 g)`
- Tier 1 gram-only (sin pieces): `{Término} ≈ G g` — ej. `Tapa ≈ 80 g`
- Tier 3 genérico: `{Término} estándar: min–max g (estimado genérico)` — ej. `Tapa estándar: 50–80 g (estimado genérico)`

El `{Término}` es el display label derivado de `formatPortionDisplayLabel(pa.termDisplay, pa.term)` — capitalizado en web, ej. `Tapa`, `Ración`, `Pintxo`, `Media ración`.

**Expected JSON (paths y enum canónicos verificados):**
```json
"portionAssumption": {
  "source": "per_dish" | "generic",
  "term": "tapa" | "racion" | "pintxo" | "media_racion",   // CANONICAL enum — NO "media ración" con espacio
  "termDisplay": "tapa" | "ración" | "pintxo" | "media ración",  // display variant
  "grams": 50,
  "pieces": 2 | null,
  "pieceName": "croquetas" | null,
  "gramsRange": null | [50, 80],    // solo presente cuando source='generic'
  "fallbackReason": null | "dish_not_found" | "term_not_in_db" | ...   // null en per_dish, string en generic
}
```

Nota: `portionAssumption.term` solo toma los 4 valores canónicos `{tapa, racion, pintxo, media_racion}`. Términos F085 fuera de este enum (bocadillo, montadito, plato, caña, ración para compartir, etc.) producen `portionAssumption` **ausente** — la feature F-UX-B solo cubre estos 4 terms.

### 6.1. Tier 1 exact match — solo croquetas + bravas

| # | Query | Expected visible line | Expected JSON `portionAssumption` | Actual | Evidence | Status |
|---|-------|------------------------|------------------------------------|--------|----------|--------|
| S16 | `tapa de croquetas` | `Tapa ≈ ~2 croquetas (≈ 50 g)` | `{source:'per_dish', term:'tapa', grams:50, pieces:2, pieceName:'croquetas', fallbackReason:null}` | | | |
| S17 | `ración de croquetas` | `Ración ≈ ~8 croquetas (≈ 200 g)` | `{source:'per_dish', term:'racion', grams:200, pieces:8, pieceName:'croquetas', fallbackReason:null}` | | | |
| S18 | `tapa de bravas` | `Tapa ≈ 80 g` (gram-only, no pieces) | `{source:'per_dish', term:'tapa', grams:80, pieces:null, pieceName:null, fallbackReason:null}` | | | |
| S19 | `ración de bravas` | **Expected Tier 3 genérico** (fila `bravas racion` NO está reviewed en el CSV → seed la omite). Visible: `Ración estándar: 200–250 g (estimado genérico)` | `{source:'generic', term:'racion', gramsRange:[200,250], fallbackReason:'term_not_in_db' o similar}` | | | ⚠ |

### 6.2. Tier 2 arithmetic — `media ración` contra dish con Tier 1 racion

| # | Query | Expected visible line | Expected JSON | Actual | Evidence | Status |
|---|-------|------------------------|---------------|--------|----------|--------|
| S20 | `media ración de croquetas` | `Media ración ≈ ~4 croquetas (≈ 100 g)` — arithmetic = racion.grams × 0.5 + pieces × 0.5 | `{source:'per_dish', term:'media_racion', grams:100, pieces:4, pieceName:'croquetas', fallbackReason:null}` | | | |
| S21 | `media ración de bravas` | **Expected Tier 3 genérico** (bravas no tiene fila `racion` seeded → Tier 2 lookup falla → fallback). Visible: `Media ración estándar: 100–125 g (estimado genérico)` (rango F085 para `media ración`) | `{source:'generic', term:'media_racion', gramsRange:[100,125], fallbackReason:'...'}` | | | ⚠ |

### 6.3. Tier 3 F085 generic fallback — resto de platos

**CRÍTICO:** rangos F085 verificados empíricamente contra `packages/api/src/estimation/portionSizing.ts:39-105`.

| # | Query | Expected visible line | Expected JSON | Actual | Evidence | Status |
|---|-------|------------------------|---------------|--------|----------|--------|
| S22 | `tapa de tortilla` | `Tapa estándar: 50–80 g (estimado genérico)` | `portionSizing.term='tapa'` (F085 PORTION_RULES), `portionAssumption:{source:'generic', term:'tapa', gramsRange:[50,80]}` | | | |
| S23 | `ración de paella` | `Ración estándar: 200–250 g (estimado genérico)` (NOT 200-300; verificado en `portionSizing.ts:59-61`) | `portionSizing.term='ración'`, `portionAssumption:{source:'generic', term:'racion', gramsRange:[200,250]}` | | | |
| S24 | `pincho de tortilla` | `Pintxo estándar: 30–60 g (estimado genérico)` (NOT 30-50; verificado en `portionSizing.ts:66-68`) | `portionSizing.term='pintxo'`, `portionAssumption:{source:'generic', term:'pintxo', gramsRange:[30,60]}` | | | |

### 6.4. Pintxo / pincho canonicalization

| # | Query | Expected canonical term | Actual | Evidence | Status |
|---|-------|-------------------------|--------|----------|--------|
| S25 | `pintxo de croquetas` | `portionAssumption.term === 'pintxo'` (Tier 1 or Tier 3) | | | |
| S26 | `pincho de croquetas` | `portionAssumption.term === 'pintxo'` (alias → canonical) | | | |

### 6.5. Interaction with F-UX-A — size modifier + portion term

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S27 | `ración grande de croquetas` | F-UX-A pill `PORCIÓN GRANDE` (multiplier=1.5) AND F-UX-B line `Ración ≈ ~12 croquetas (≈ 300 g)` (200g × 1.5 Tier 1). JSON: `portionMultiplier:1.5`, `portionAssumption:{term:'racion', grams:300, pieces:12, pieceName:'croquetas'}` | | | |
| S28 | `media ración grande de croquetas` | F042 compound `media ración` matches first → multiplier=0.5, `grande` dropped silently → `grams=100` (accepted behavior per QA de BUG-PROD-006/007, tracked en backlog como `BUG-F042-COMPOSE-SIZE-MODIFIERS` — NOT a bug). Visible: `Media ración ≈ ~4 croquetas (≈ 100 g)` | | | ⚠ |

### 6.6. Terms no portion / fuera del enum F-UX-B

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S29 | `croquetas` (sin término de ración) | `portionSizing` y `portionAssumption` **ambos ausentes** — ningún term detectado en `originalQuery` | | | |
| S30 | `bocadillo de jamón` | `portionSizing.term === 'bocadillo'` (F085 match), **`portionAssumption` deterministicamente ausente** — `bocadillo` NO está en el enum canónico `{tapa, racion, pintxo, media_racion}` de F-UX-B, el normalizador devuelve `null` → F-UX-B returns `{}`. Verificado en `portionAssumption.ts:40-45`. | | | |

---

## 7. BUG-PROD-006 — Solo-dish conversation wiring (the 7 canonical queries)

**Fix merged:** PR #116, `ca9a488` / `6b117c9` (2026-04-13). Fix 3 bugs: (1) `prisma` no threaded en `ConversationRequest`, (2) F078-stripped query usado para detección → `originalQuery: trimmed` añadido, (3) Tier 2 media_racion double-count.

**Expected post-fix:** `portionSizing` y `portionAssumption` presentes en `data.estimation` para solo-dish queries via `POST /conversation/message` (= via `/hablar`).

### 7.1. Las 7 queries canónicas (del context prompt original)

| # | Query | F078 strips to | Expected `portionSizing` | Expected `portionAssumption` | Actual | Evidence | Status |
|---|-------|----------------|--------------------------|------------------------------|--------|----------|--------|
| S31 | `tapa de croquetas` | `croquetas` | `{term:'tapa', gramsMin:50, gramsMax:80}` | `{source:'per_dish', term:'tapa', grams:50, pieces:2}` (Tier 1) | | | |
| S32 | `TAPA DE CROQUETAS` | `croquetas` | mismo que S31 (case-insensitive) | mismo | | | |
| S33 | `Tapa De Croquetas` | `croquetas` | mismo | mismo | | | |
| S34 | `  tapa   de   croquetas  ` (whitespace) | `croquetas` | mismo | mismo | | | |
| S35 | `tapa croquetas` (sin 'de') | no se strippea (no match F078) | `{term:'tapa'}` (F085 match directo) | absent o Tier 3 (no dish match directo) | | | ⚠ |
| S36 | `croquetas tapa` (reversed) | no se strippea | `{term:'tapa'}` | absent o Tier 3 | | | ⚠ |
| S37 | `ración grande de croquetas` | `croquetas` (F042 extrae `grande`=×1.5) | `{term:'ración'}` | `{source:'per_dish', term:'racion', grams:300}` (200 × 1.5 Tier 1 × F-UX-A multiplier) | | | |

### 7.2. Tier 2 media_racion double-count guard (BUG-PROD-006 Bug 3)

**La fix resolvió:** pre-fix `media ración de croquetas` devolvía `grams=50` (Tier 2 × F042 ambos aplicaban ×0.5 → double-count). Post-fix: `grams=100`.

Ya cubierto por S20 arriba. Re-verificar explícitamente el valor `grams=100` y NO `50`.

---

## 8. BUG-PROD-007 — Comparison + menu conversation wiring

**Fix merged:** PR #120, `aab85f0` (2026-04-14). Extends BUG-PROD-006 a los 2 call sites de `estimate()` que faltaban: comparison (`Promise.allSettled`) y menu (`menuItems.map()`).

**CRÍTICO:** el intent comparison **requiere prefijo** (`compara`, `qué engorda más`, `qué es más sano`, `qué tiene más X`, `qué tiene menos X`). Bare `'X vs Y'` NO dispara el intent — cae a solo-dish. Ver `entityExtractor.ts:216-231`.

### 8.1. Comparison — ambos lados con portion data

| # | Query | Expected intent | Expected `dishA` / `dishB` | Actual | Evidence | Status |
|---|-------|-----------------|----------------------------|--------|----------|--------|
| S38 | `compara tapa de croquetas vs tapa de bravas` | `comparison` | dishA Tier 1 croquetas (grams=50), dishB Tier 1 bravas (grams=80) — ambos `portionSizing.term='tapa'` + `portionAssumption.source='per_dish'` | | | |
| S39 | `qué engorda más, una tapa de croquetas o una tapa de bravas` | `comparison` con `nutrientFocus='calorías'` | ambos lados tienen portion data | | | |
| S40 | `qué tiene más proteínas, ración de croquetas vs ración de bravas` | `comparison` con `nutrientFocus='proteínas'` | dishA Tier 1 (200g/8pc), dishB Tier 3 (bravas racion NO seeded) | | | ⚠ |
| S41 | `compara tapa de croquetas vs tapa de tortilla` | `comparison` | dishA Tier 1, dishB Tier 3 genérico — ambos tienen `portionSizing.term='tapa'` pero solo dishA tiene `portionAssumption.source='per_dish'` | | | |

### 8.2. Comparison — bare query discrepancy: docs vs code mismatch — INVESTIGATE

**Contexto:** `docs/user-manual-web.md` L338 dice *"Escribe dos platos para compararlos"* y el ejemplo del manual usa formas como `big mac vs whopper` / `pizza o hamburguesa` sin prefijo. Pero `packages/api/src/conversation/entityExtractor.ts:216-231` requiere uno de los `PREFIX_PATTERNS_COMP` (`qué tiene más/menos X`, `qué engorda más`, `qué es más sano`, `compara[r]`). Hay un mismatch documentation-vs-code.

**Este escenario NO tiene expected fijo — es una investigación**. Captura lo que devuelve y decide de qué lado está el bug.

| # | Query | Observation | Actual | Evidence | Status / Decisión |
|---|-------|-------------|--------|----------|-------------------|
| S42 | `tapa de croquetas vs tapa de tortilla` (bare, sin `compara`) | Determinar si `intent='comparison'` (código OK, manual OK) o `intent='estimation'` (falls through a solo-dish — en ese caso el manual web miente). Si es el segundo, **abrir ticket de doc fix** para user-manual-web.md L338. | | | |
| S42b | `pizza vs hamburguesa` (otro ejemplo del manual L342) | Mismo caso | | | |
| S42c | `big mac o whopper` (ejemplo del manual L346) | Mismo — con `o` como separador | | | |

**Si estos devuelven `intent='estimation'` (solo-dish):** el user manual está desactualizado. Registrar la discrepancia en bugs.md y crear un follow-up de docs. **NO reabrir el código** — el código es el contrato oficial.

### 8.3. Comparison con un lado sin match (fulfilled-miss branch)

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S43 | `compara tapa de croquetas vs tapa de xxyyzz-desconocido` | `comparison` con `dishA.result` poblado y `dishB.result === null`. **Importante:** `dishB.portionSizing` puede estar **presente** (F085 detecta `'tapa'` en `originalQuery` antes del lookup) o ausente, dependiendo de si el cascade resolvió fulfilled-miss vs rejected. Anotar lo que pasa. | | | ⚠ |

### 8.4. Menu — multi-dish

**CRÍTICO:** usar `'menú del día: X, Y'` (colon + comma) en vez de `'menú del día con X y Y'`. La segunda deja `con ` como prefijo del item[0]. Ver `menuDetector.ts`.

| # | Query | Expected items | Actual | Evidence | Status |
|---|-------|----------------|--------|----------|--------|
| S44 | `menú del día: tapa de croquetas, ración de bravas` | 2 items; item[0] Tier 1 croquetas (50g/2pc), item[1] Tier 3 genérico bravas racion | | | |
| S45 | `menú del día: tapa de croquetas, media ración de croquetas` | 2 items; item[0] Tier 1 (50g/2pc), item[1] Tier 2 arithmetic (100g/4pc) | | | |
| S46 | `menú del día: ensalada, filete con patatas, flan` (ejemplo del manual web L129) | 3 items, cada uno con estimation válida; ninguno tiene portion data específica (ningún término de ración en los items) | | | |
| S47 | `he comido lentejas con chorizo, filete con patatas, flan` (F076 alternate pattern) | 3 items, `matchedCount` según cobertura | | | |
| S48 | `menú del día: ensalada, filete, flan para 3 personas` | 3 items + `diners=3` + `perPerson` populated (F089 Modo Tapeo) | | | |

### 8.5. Menu con items inválidos

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S49 | `menú del día: tapa de croquetas, tarta de unicornio` | 2 items; item[0] Tier 1 válido, item[1] `estimation.result === null` (plato no existe) — el resto del menú se muestra normal | | | |

---

## 9. Restaurant context + reverse search (F-UX / F070)

**Nota:** funcionalidades pre-existentes, no modificadas recientemente. Pruebas smoke para confirmar no-regresión.

### 9.1. Context set

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S50 | `estoy en mcdonalds` | `intent='context_set'`, `contextSet.chainSlug='mcdonalds-es'`. UI muestra confirmación verde | | | |
| S51 | `big mac` (tras S50) | `intent='estimation'`, result Big Mac verificado. `activeContext` presente | | | |
| S52 | `estoy en burger king` | context cambia a `burger-king-es` | | | |
| S53 | `whopper` (tras S52) | result Whopper verificado | | | |

### 9.2. Chain-scoped query (no context previo)

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S54 | `big mac en mcdonalds` | result Big Mac sin necesidad de context_set previo | | | |

### 9.3. Reverse search (requires context)

| # | Query | Expected | Actual | Evidence | Status |
|---|-------|----------|--------|----------|--------|
| S55 | `estoy en mcdonalds` → `qué como con 600 kcal` | `intent='reverse_search'`, `reverseSearch.results` con al menos 1 match | | | |
| S56 | `platos con más de 30g de proteína en mcdonalds` | `intent='reverse_search'`, results con protein > 30 | | | |
| S57 | `qué como con 600 kcal` (sin context previo) | **INVESTIGATE — docs vs code mismatch.** `docs/user-manual-web.md` L312-316 dice *"La búsqueda inversa funciona mejor cuando especificas una cadena... Sin contexto, busca en la base de datos genérica y los resultados pueden ser limitados"*. Pero el manual API L635 y `packages/api/src/conversation/entityExtractor.ts` dicen que reverse_search **requiere** chain context (sin él, `reverseSearch` absent). Determinar cuál es el comportamiento real y registrar la discrepancia en el bando que pierda. | | | ⚠ |

---

## 10. BUG-PROD-001/002 — iPhone only

**Fix merged BUG-PROD-001:** PR #103, `a750f5e` (2026-04-12). Client-side resize (1600px, q=0.82), proxy error normalization, `AbortSignal.timeout(65s)`, 413 mapping.

**Fix merged BUG-PROD-002:** PR #105, `24e6d23` (2026-04-12). Removed `capture="environment"` from PhotoButton → iOS shows native chooser (Hacer Foto / Biblioteca).

**IMPORTANTE:** estas pruebas solo tienen sentido en **iPhone real** contra URL Vercel desplegada (staging o prod), NO contra local web server.

### 10.1. BUG-PROD-002 — gallery chooser

| # | Action | Expected | Actual | Evidence | Status |
|---|--------|----------|--------|----------|--------|
| S58 | Abrir `/hablar` en iPhone Safari → tap botón cámara verde | Native iOS chooser aparece con opciones "Hacer Foto" + "Biblioteca" + "Elegir Archivo" (NO va directo a la cámara) | | | |

### 10.2. BUG-PROD-001 — photo upload con resize client-side

**IMPORTANTE:** requiere Safari Remote Web Inspector (ver 2.3) para inspeccionar el request body en el Network tab del DevTools del Mac conectado al iPhone. Sin eso, S59/S61 no son verificables directamente — solo se puede inferir por ausencia de 413.

**Fix real:** `packages/web/src/lib/imageResize.ts` reescala candidatos con tamaño >1.5 MB a lado máximo 1600px / JPEG q=0.82. **NO garantiza** que el body final sea < 1.5 MB — solo garantiza que el blob reescalado sea más pequeño que el original.

| # | Action | Expected | Actual | Evidence | Status |
|---|--------|----------|--------|----------|--------|
| S59 | Elegir "Biblioteca" → seleccionar una foto grande (>4 MB) de un plato | Request pasa (200 OK, no 413 PAYLOAD_TOO_LARGE). Con Web Inspector: `Content-Length` del request body es **menor que la foto original** (verificar que `imageResize.ts` se ejecutó) y además `< 4.5 MB` (límite de Vercel Serverless Function) | | | |
| S60 | "Hacer Foto" → fotografiar un plato real (la cámara del iPhone tira fotos de 4-8 MB) | Similar a S59 — resize cliente, upload, response 200 con `dishes[]`. Body enviado < foto original | | | |
| S61 | Subir una imagen pequeña (ej. 500 KB, por debajo del threshold de 1.5 MB) | El código NO la reescala (threshold no se supera). Con Web Inspector: body = archivo original byte-for-byte. Response 200 con dishes. | | | |
| S62 | Subir una foto que el sistema no pueda analizar (ej. un gato, un paisaje) | Response con error amigable — mensaje "No he podido identificar el plato. Intenta con otra foto" o similar. NO 500 raw. | | | |
| S63 | Subir un archivo no-imagen (ej. PDF renombrado a `.jpg`) | Error `INVALID_IMAGE` (422), mensaje amigable, NO 500 | | | |

**Fallback si Safari Web Inspector no está disponible:** ejecutar solo S59/S60/S62/S63 verificando que no hay 413 / 500 — eso demuestra que el resize funciona lo suficiente aunque no podamos medir el body exacto. Marcar S61 como "pendiente — Web Inspector no disponible".

### 10.3. Fotos — tiempos

Anotar tiempos aproximados para S59/S60 (desde tap hasta ver tarjetas). Expected: 5-15s para el análisis. Máximo 65s antes del timeout.

### 10.4. Nota sobre modo de análisis de foto

El endpoint `POST /analyze/menu` (al que llega el request desde el proxy `/api/analyze` de Vercel) acepta 4 modos: `ocr` (Tesseract), `vision` (OpenAI Vision), `auto` (Vision con OCR fallback), `identify` (single dish). El web client usa por defecto un modo específico — verificar en el Network tab de Safari qué modo envía y si coincide con lo esperado. Esto NO es una feature bajo test (ya existía antes de BUG-PROD-001), pero si el modo por defecto ha cambiado en refactors recientes, los tiempos y la calidad de resultados pueden variar. Solo flaggear si algo se ve anómalo.

---

## 11. Cross-cutting — rate limit + error handling

Opcional, solo si queda tiempo.

| # | Action | Expected | Actual | Evidence | Status |
|---|--------|----------|--------|----------|--------|
| S64 | Enviar 51 queries seguidas (texto) | La 51 falla con `ACTOR_RATE_LIMIT_EXCEEDED` (429), mensaje "Has alcanzado el límite diario de 50 consultas" | | | |
| S65 | Enviar query con > 500 caracteres | 200 OK con `intent='text_too_long'` (domain-level rejection, NOT HTTP error) | | | |
| S66 | Query con texto vacío `""` | Error de validación sin pasar rate limit (bueno) / ACTOR_RATE_LIMIT_EXCEEDED si se consume cuota antes de validar (malo — conocido, ver manual API L145) | | | ⚠ |
| S67 | `Shift+Enter` en el textbox | `Shift+Enter`: newline; `Enter` (sin shift): submit. **NO existe `Cmd+Enter` binding** — verificado contra `packages/web/src/components/ConversationInput.tsx:42` y `user-manual-web.md:662`. | | | |
| S68 | Reducir la ventana del navegador a < 768 px (responsive) | Cards pasan a 1-columna (mobile-first). Entry bar permanece fija al fondo | | | |

---

## 12. Priorización / recomendación de ejecución

El orden dentro del plan es pedagógico (de bug más antiguo a más nuevo). Si el tiempo es limitado, ejecutar en este orden de prioridad por **lo que no ha sido verificado manualmente**:

1. **Sección 4 (BUG-PROD-003)** — poco probado manualmente; quick sanity check
2. **Sección 5 (F-UX-A)** — poco probado manualmente; visual check crítico
3. **Sección 6 (F-UX-B)** — poco probado manualmente; más novedad visual
4. **Sección 7 (BUG-PROD-006)** — las 7 queries canónicas son el core sanity set
5. **Sección 8 (BUG-PROD-007)** — comparison + menu, lo más nuevo
6. **Sección 9 (context + reverse)** — sanity check no-regresión
7. **Sección 10 (001/002)** — requiere iPhone físico; dejar para una sesión dedicada
8. **Sección 11** — opcional, solo si sobra tiempo

Cada sección es independiente — se pueden ejecutar en cualquier orden.

### 12.1. Quick smoke set (10 escenarios, ~10 minutos)

Si el tiempo es **muy** limitado y quieres un sanity check rápido antes de decidir si invertir en el plan completo, ejecuta solo estos 10 escenarios en local web. Si todos pasan, el core está OK y puedes volver al plan completo en una segunda sesión. Si alguno falla, aborta el resto y abre ticket antes de seguir.

| Orden | Scenario | Por qué |
|-------|----------|---------|
| 1 | S01 `vino` | Sanity BUG-PROD-003 |
| 2 | S04 `cerveza` | Sanity BUG-PROD-003 |
| 3 | S11 `paella` (sin modifier) | Sanity F-UX-A control (no-regresión) |
| 4 | S10 `ración grande de paella` | Sanity F-UX-A fix |
| 5 | S16 `tapa de croquetas` | Sanity F-UX-B Tier 1 |
| 6 | S20 `media ración de croquetas` | Sanity F-UX-B Tier 2 + BUG-PROD-006 Bug 3 (no double count) |
| 7 | S22 `tapa de tortilla` | Sanity F-UX-B Tier 3 fallback |
| 8 | S31 `tapa de croquetas` (otra vez, confirmar conversation path) | Sanity BUG-PROD-006 core path |
| 9 | S38 `compara tapa de croquetas vs tapa de bravas` | Sanity BUG-PROD-007 comparison |
| 10 | S44 `menú del día: tapa de croquetas, ración de bravas` | Sanity BUG-PROD-007 menu |

Si los 10 pasan → proceder con el plan completo con confianza. Si alguno falla → investigar ese específicamente y documentar en bugs.md antes de continuar.

---

## 13. Cómo cerrar el QA

Al terminar:

1. **Si ≥ 1 bug crítico confirmado:** crear entrada en `docs/project_notes/bugs.md` con severidad, root cause hipotética, repro steps. Si es P0 / regresión de prod, abrir hotfix branch desde `main`.
2. **Si solo hay observaciones / ⚠:** registrar en este doc (campo Notes) y valorar si alguna merece un ticket de backlog.
3. **Actualizar `docs/project_notes/product-tracker.md` Active Session** con resumen del run ("Manual QA run completed 2026-04-XX: N✓/M✗/K⚠, ...").
4. **Commit + PR del doc actualizado:** `docs(manual-qa): 2026-04-14 post-BUG-PROD-007 manual QA run — N✓/M✗/K⚠`. Branch `docs/manual-qa-2026-04-14`. PR separada a develop.
5. **Screenshots:** commitear en `docs/manual-qa/screenshots/` (misma PR que el doc).

---

## Apéndice A — Cheat sheet de queries (copy-paste)

```
# BUG-PROD-003
vino
vino tinto
cerveza
tercio
agua

# F-UX-A
ración grande de paella
media ración de paella
doble whopper en burger-king-es
big mac pequeño

# F-UX-B Tier 1
tapa de croquetas
ración de croquetas
tapa de bravas

# F-UX-B Tier 2
media ración de croquetas

# F-UX-B Tier 3
tapa de tortilla
ración de paella
pincho de tortilla

# F-UX-B canonicalization
pintxo de croquetas
pincho de croquetas

# F-UX-A + F-UX-B combinado
ración grande de croquetas
media ración grande de croquetas

# BUG-PROD-006 (7 queries canónicas)
tapa de croquetas
TAPA DE CROQUETAS
Tapa De Croquetas
  tapa   de   croquetas  
tapa croquetas
croquetas tapa
ración grande de croquetas

# BUG-PROD-007 comparison
compara tapa de croquetas vs tapa de bravas
qué engorda más, una tapa de croquetas o una tapa de bravas
qué tiene más proteínas, ración de croquetas vs ración de bravas
compara tapa de croquetas vs tapa de tortilla
compara tapa de croquetas vs tapa de xxyyzz-desconocido

# BUG-PROD-007 menu
menú del día: tapa de croquetas, ración de bravas
menú del día: tapa de croquetas, media ración de croquetas
menú del día: ensalada, filete con patatas, flan
menú del día: tapa de croquetas, tarta de unicornio
menú del día: ensalada, filete, flan para 3 personas

# Context + reverse
estoy en mcdonalds
big mac
estoy en burger king
whopper
qué como con 600 kcal
platos con más de 30g de proteína en mcdonalds
```

---

*Plan generado: 2026-04-14. Source: manual web (703 líneas) + api-manual (1160 líneas) + user-manual-bot (parcial) + empirical read de `packages/api/src/conversation/*`, `standard-portions.csv`, `spanish-dishes.json`.*
