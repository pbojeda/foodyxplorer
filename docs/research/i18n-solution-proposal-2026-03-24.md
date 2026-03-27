# Propuesta de Solución: Problema de Idioma en Nombres de Platos

**Fecha:** 2026-03-24
**Autor:** Claude Opus 4.6 + usuario
**Basado en:** `docs/research/informe-nombres-ingles-2026-03-24.md`
**Estado:** APROBADA — Enfoque A (Populate name_es). Enfoque B+ descartado tras revisiones externas.
**Revisión:** v3 — Decisión final: Enfoque A. Revisiones externas: Codex GPT-5.4 (REVISE) + Gemini 2.5 Pro (REVISE) sobre B+. ADR-010 escrito. F038 añadido al tracker.

---

## 1. Resumen Ejecutivo

El 99.8% de los platos (883/885) no tienen `name_es` poblado. Los nombres se almacenan en el idioma del PDF fuente (mayoritariamente inglés), causando fallos de búsqueda para usuarios que buscan en español. El problema afecta a L1 (FTS) y L3 (embeddings), pero NO a L2 (foods USDA ya tienen `name_es`) ni a L4 (LLM entiende multiidioma).

Se evalúan 3 enfoques arquitectónicos con visión a medio/largo plazo.

---

## 2. Análisis del Código Actual

### 2.1 Por qué `name_es` nunca se puebla

La cadena de ingestion es:

```
PDF → extractText() → preprocessChainText() → parseNutritionTable() → normalizeDish() → Prisma upsert
```

En `normalizeDish()` (`packages/scraper/src/utils/normalize.ts:258`):
```typescript
nameEs: raw.nameEs,  // ← Viene de RawDishData, NUNCA se setea por el parser
```

`parseNutritionTable()` extrae el nombre tal como aparece en el PDF y lo asigna a `name`. No tiene lógica de detección de idioma. El campo `nameEs` de `RawDishData` queda `undefined`.

### 2.2 Impacto real por nivel de estimación

| Nivel | Impacto | Detalle |
|-------|---------|---------|
| **L1 Exact** | PARCIAL | `LOWER(name) = LOWER(query)` — Solo funciona si el usuario busca exactamente en el idioma del PDF |
| **L1 FTS** | ALTO | `COALESCE(name_es, name)` con parser `spanish` — tokeniza mal el inglés. OR con parser `english` solo ayuda si la query es en inglés |
| **L2** | NINGUNO | Foods USDA tienen `name_es` correctamente poblado (514/514) |
| **L3** | ALTO | Embeddings generados solo con nombre del PDF. Query en otro idioma → distancia coseno > threshold |
| **L4** | BAJO | LLM entiende multiidioma, pero es último recurso y tiene coste |

### 2.3 Flujo de query actual (puntos de inyección)

```
GET /estimate?query=<raw>&chainSlug=...&restaurantId=...
    ↓
[Route: estimate.ts] → Zod validation
    ↓
[Redis cache] → key: fxp:estimate:<normalized>:<chain>:<rest>  (TTL 300s)
    ↓ (cache miss)
[engineRouter.ts] → runEstimationCascade()
    ↓                                          ← PUNTO DE INYECCIÓN: traducir query aquí
L1 → L2 → L3 → L4 cascade
    ↓
Response: { query, result: { name, nameEs, nutrients, ... } }
    ↓                                          ← PUNTO DE INYECCIÓN: traducir nombre aquí
[Fire-and-forget log] → query_logs
```

**Hallazgo clave:** El response ya devuelve `name` Y `nameEs`. La respuesta tiene soporte nativo para mostrar el nombre en el idioma del usuario.

### 2.4 Capacidad cross-lingual del modelo de embeddings actual

`text-embedding-3-small` de OpenAI tiene capacidad multilingüe limitada:
- Funciona para conceptos comunes (hamburguesa ↔ hamburger), con ~0.10-0.20 de degradación en similitud coseno
- Falla para terminología específica, nombres de marca y platos regionales
- **No es suficiente como solución única**

### 2.5 Investigación de APIs de traducción

| Proveedor | Coste/1M chars | Latencia (texto corto) | Free tier |
|-----------|---------------|------------------------|-----------|
| Microsoft Translator | $10 | 90-200ms | 2M chars/mes |
| Google Cloud Translation | $20 | 200-420ms | 500K chars/mes |
| DeepL | $25 + $5.49/mes | 500-1000ms | 500K chars/mes |
| OpenAI (gpt-4o-mini) | ~$0.75 | 800-2000ms | — |
| LibreTranslate (self-hosted) | $0 | 100-500ms | Ilimitado |

**Con caching Redis (TTL 7-30 días):** El vocabulario de comida es finito (~10K-50K queries únicas). Tras warm-up, cache hit rate > 95%. **Coste real estimado: <$1/mes incluso a escala.**

### 2.6 Precedente en la industria

- **MyFitnessPal:** Bases de datos separadas por locale. Traducción profesional + comunidad. Búsqueda léxica por locale.
- **FatSecret:** Bases por región, API con parámetro `region`. Keyword search per locale.
- **Open Food Facts:** Campos separados por idioma (`product_name_en`, `product_name_es`). Indexa todos.

**Conclusión:** La industria resuelve en la **capa de datos** (nombres traducidos por locale). Ninguna app grande usa embeddings cross-lingual como solución primaria.

---

## 3. Tres Enfoques Arquitectónicos

### Enfoque A: Poblar `name_es` (propuesta original v1)

**Qué:** Poblar `name_es` para todos los platos existentes (batch LLM) y en futuras ingestas. Regenerar embeddings. Sin cambios de schema.

**Cómo funciona:**
1. Script batch: LLM traduce 883 nombres EN→ES, actualiza `name_es`
2. Ingestión: si nombre ya es español, copiar a `name_es`
3. Regenerar embeddings: `buildDishText()` ya incluye `nameEs` si existe
4. L1 FTS ya busca en `COALESCE(name_es, name)` — funciona sin cambios

### Enfoque B: Canonical English + traducción en boundaries (propuesta del usuario)

**Qué:** `name` siempre en inglés (idioma canónico de búsqueda). Traducir queries de entrada a inglés antes de buscar. Traducir nombres de platos al idioma del usuario en la respuesta.

**Cómo funciona:**
1. **Ingestión:** Si PDF está en español → traducir nombre a inglés para `name`. Guardar original en `name_es`
2. **Query:** Detectar idioma → si no es inglés, traducir a inglés (cacheado) → buscar en `name`
3. **Response:** Devolver `nameEs` para usuarios ES, o traducir `name` al idioma del usuario
4. **Embeddings:** Solo inglés (consistentes, un solo idioma)
5. **L1 FTS:** Simplificado — solo parser `english` necesario sobre `name`

### Enfoque C: Híbrido (datos bilingües + traducción query-time)

**Qué:** Mantener `name` (original del PDF) + poblar `name_es`. ADEMÁS, añadir traducción de query a inglés como capa de búsqueda adicional.

**Cómo funciona:**
1. **Datos:** Poblar `name_es` como Enfoque A
2. **Query:** Traducir query a inglés (cacheado) Y buscar también en `name_es` directamente
3. **Búsqueda dual:** L1 busca en español (name_es) + inglés (name) + query traducida
4. **Embeddings:** Bilingües (incluyen ambos nombres)

---

## 4. Análisis Comparativo Detallado

### 4.1 Escalabilidad a medio/largo plazo

| Escenario | Enfoque A (name_es) | Enfoque B (canonical EN) | Enfoque C (híbrido) |
|-----------|--------------------|-----------------------|-------------------|
| **ES+EN (ahora)** | ✅ Funciona | ✅ Funciona | ✅ Funciona |
| **+FR (6 meses)** | ❌ Necesita `name_fr` + migración + nuevos JOINs | ✅ Solo añadir FR→EN en el traductor | ✅ Necesita `name_fr` O usa traducción query-time |
| **+IT+DE+PT (1 año)** | ❌ 5 campos name_XX o tabla translations | ✅ Sin cambios de datos | ⚠️ Mixto: datos + query-time |
| **10 idiomas (2 años)** | ❌ Inviable sin tabla translations | ✅ Sin cambios de datos | ❌ Inviable sin tabla translations |

**Veredicto escalabilidad:** Enfoque B es el único que escala indefinidamente sin cambios de schema ni datos.

### 4.2 Costes

| Concepto | Enfoque A | Enfoque B | Enfoque C |
|----------|-----------|-----------|-----------|
| Setup (one-time) | ~$0.20 (LLM batch) | ~$0.20 (LLM batch) + API key setup | ~$0.40 (ambos) |
| Por query (runtime) | $0 | ~$0.0001 (con cache 95%) | ~$0.0001 |
| Por nuevo idioma | ~$0.20 batch + dev time | $0 (solo config) | ~$0.20 batch + dev time |
| Regenerar embeddings | ~$0.03 | ~$0.03 (solo primera vez) | ~$0.03 |

**Veredicto costes:** Enfoque B es marginalmente más caro por query pero MUCHO más barato por nuevo idioma.

### 4.3 Complejidad de desarrollo

| Componente | Enfoque A | Enfoque B | Enfoque C |
|------------|-----------|-----------|-----------|
| Batch translation script | ✅ Necesario | ✅ Necesario (EN canonical + name_es) | ✅ Necesario |
| Fix ingest pipeline | Detectar ES → copiar a `name_es` | Detectar idioma → traducir a EN + guardar original | Ambos |
| Translation service layer | No | Sí (nuevo módulo) | Sí |
| Cambios en L1/L3 queries | No | Simplificar (solo EN parser) | Expandir (dual search) |
| Cambios en API response | No | Añadir traducción de salida | Añadir traducción de salida |
| Redis translation cache | No | Sí (nuevo key pattern) | Sí |
| Regenerar embeddings | Sí | Sí (pero solo EN, más consistente) | Sí |

**Veredicto complejidad:** Enfoque A es el más simple ahora. Enfoque B tiene más setup inicial pero menos mantenimiento futuro.

### 4.4 Edge Cases

#### EC-1: Nombres de marca
- "Whopper®", "Big Mac", "McChicken"
- **A:** No traducir → `name_es` = "Whopper®" ✅
- **B:** Ya están en "inglés" → `name` = "Whopper®" ✅
- **C:** ✅

#### EC-2: Nombres ya en español en PDF
- KFC: "Ensalada de pollo", Telepizza: "Masa fina cuatro quesos"
- **A:** Copiar `name` → `name_es` ✅
- **B:** Traducir a inglés "Chicken salad" para `name`, guardar original en `name_es` ✅ (pero el "nombre oficial" del restaurante se pierde de `name`)
- **C:** Copiar a `name_es` + buscar en ambos ✅

#### EC-3: Nombres mixtos (EN+ES)
- "Big King® Bacon Chicken", "Cubo de Patatas Supreme / Supreme Fries Snack Box"
- **A:** LLM intenta traducir parte genérica → "Big King® Bacon Pollo" ⚠️ Calidad variable
- **B:** LLM normaliza a inglés → "Big King® Bacon Chicken" ✅ (ya es inglés en este caso)
- **C:** Ambas traducciones ⚠️

#### EC-4: Platos regionales sin equivalente claro
- "Croquetas de jamón ibérico", "Patatas bravas", "Tortilla española"
- **A:** `name_es` = original ✅
- **B:** `name` = "Iberian ham croquettes" (traducción aceptable pero pierde el nombre cultural). Sin embargo, es solo la KEY de búsqueda — el display usa `name_es` = "Croquetas de jamón ibérico" ✅
- **C:** Ambos disponibles ✅

#### EC-5: "Tortilla" (ambigüedad cultural)
- En España = tortilla española (omelette). En México = tortilla de maíz.
- **A:** N/A (no traduce queries)
- **B:** Traducción genérica podría devolver "tortilla" (sin cambio) → match correcto por contexto de cadena española ⚠️ O podría traducir mal a "omelette" ⚠️
- **C:** Busca directamente en español → match directo en `name_es` ✅

#### EC-6: Usuario busca en francés (futuro)
- "hamburger au fromage"
- **A:** ❌ No hay `name_fr`, no hay traducción
- **B:** Traducir FR→EN = "cheeseburger" → match ✅ Sin cambios de código
- **C:** Traducir FR→EN → match ✅ Pero también busca en `name_es` sin resultado

#### EC-7: Ingesta de menú de restaurante independiente en español
- Menú con "Pollo al ajillo", "Gazpacho", "Fabada asturiana"
- **A:** name = "Pollo al ajillo", name_es = "Pollo al ajillo" ✅
- **B:** name = "Garlic chicken" (traducido), name_es = "Pollo al ajillo" ✅ Pero pierde el nombre original que el restaurante usa
- **C:** Ambos ✅

#### EC-8: Misma query en distintos idiomas debe devolver el mismo plato
- "cheeseburger" (EN) = "hamburguesa con queso" (ES) = "hamburger au fromage" (FR)
- **A:** Solo funciona para EN+ES ⚠️
- **B:** Todos traducen a "cheeseburger" → mismo match ✅
- **C:** EN+ES funciona, FR no ⚠️

### 4.5 Integridad de datos (ADR-001: trazabilidad)

| Aspecto | Enfoque A | Enfoque B | Enfoque C |
|---------|-----------|-----------|-----------|
| `name` preserva nombre original del PDF | ✅ | ❌ Se modifica a inglés | ✅ |
| Trazabilidad al PDF fuente | ✅ Directo | ⚠️ Nombre transformado | ✅ Directo |
| Reversibilidad | ✅ | ⚠️ Se pierde el original si no se guarda | ✅ |

**Preocupación con Enfoque B:** Si `name` pasa a ser "siempre inglés", el nombre original del PDF se pierde a menos que se guarde en otro campo. Esto afecta la trazabilidad de ADR-001.

**Mitigación:** Guardar nombre original en `name_es` (si español) o en un campo `name_original`. Pero esto complica la semántica de `name_es` (ya no sería "nombre en español" sino "nombre original del fuente").

---

## 5. Evaluación de Riesgos a Medio/Largo Plazo

### 5.1 ¿Qué pasa si NO pensamos a largo plazo? (Enfoque A)

Si elegimos Enfoque A y luego necesitamos FR/IT/DE:
1. Opción 1: Añadir `name_fr`, `name_it`, `name_de` → schema crece, JOINs se complican
2. Opción 2: Migrar a tabla `dish_translations` → refactor significativo de L1/L3/embeddings
3. Opción 3: Añadir traducción query-time → acabamos implementando Enfoque B/C igualmente

**Deuda técnica estimada:** 2-3 días de refactor cuando se necesite el 3er idioma.

### 5.2 ¿Qué pasa si elegimos Enfoque B ahora?

1. Setup inicial más costoso (~1 día extra vs Enfoque A)
2. Pero cada nuevo idioma es configuración, no código
3. El sistema ya está preparado para internacionalización desde el día 1
4. La semántica de `name` cambia (de "original" a "canonical English") — requiere actualizar documentación y mental model del equipo

### 5.3 ¿Qué pasa si elegimos Enfoque C?

1. Lo mejor de ambos mundos, pero también la complejidad de ambos
2. Búsqueda dual (español directo + inglés traducido) es más robusta pero más lenta
3. Mantenimiento: dos estrategias de búsqueda que pueden divergir

---

## 6. Propuesta Refinada: Enfoque B+ (Canonical English con salvaguardas)

Tras el análisis de edge cases, **el Enfoque B del usuario es arquitectónicamente superior a largo plazo**, pero necesita dos salvaguardas para preservar integridad de datos:

### Diseño

1. **`name` = nombre canónico en inglés** (para búsqueda). Si el PDF ya está en inglés, se usa tal cual. Si está en español, se traduce a inglés.
2. **`name_es` = nombre en español** (para display). Si el PDF está en español, se copia del original. Si está en inglés, se traduce a español.
3. **Nuevo campo `name_original`** (para trazabilidad ADR-001). Preserva el nombre exacto del PDF fuente sin transformar. Nullable para dishes existentes (se puede llenar retroactivamente).

Wait — ¿realmente necesitamos `name_original`? El nombre original ya está en `name` (para PDFs ingleses) o en `name_es` (para PDFs españoles). No se pierde información si:
- PDF inglés: `name` = original (EN), `name_es` = traducción (ES)
- PDF español: `name` = traducción (EN), `name_es` = original (ES)

Pero ¿cómo sabemos cuál es el original? Añadir un campo `name_source_locale` (2 chars: 'en', 'es') resuelve esto sin un tercer campo de nombre.

### Diseño Final

```
dishes table:
  name          VARCHAR(255)  -- Siempre en inglés (canonical search key)
  name_es       VARCHAR(255)  -- Siempre en español (display para usuarios ES)
  name_source_locale  VARCHAR(5)  -- Idioma del nombre original del PDF ('en', 'es', 'mixed')
```

**Nota:** `name_source_locale` es un nuevo campo (migración simple, nullable, default 'en' para existentes).

### Flujo de ingestion

```
PDF → extract name → detect language
  ├─ EN: name = as-is, name_es = translate(EN→ES), name_source_locale = 'en'
  ├─ ES: name = translate(ES→EN), name_es = as-is, name_source_locale = 'es'
  └─ mixed/brand: name = normalize to EN, name_es = normalize to ES, name_source_locale = 'mixed'
```

### Flujo de query

```
User query → detect language
  ├─ EN: search directly on `name` (L1 exact + FTS english parser)
  └─ non-EN: translate to EN (cached) → search on `name`
```

### Flujo de response

```
Result found → get user locale
  ├─ ES: return name_es (already in DB)
  ├─ EN: return name (already in DB)
  └─ FR/IT/DE: translate name to target locale (cached, on-the-fly)
```

### Embeddings

```
buildDishText() → "Dish: {name}. Spanish name: {name_es}. Chain: {chainSlug}."
```
Bilingüe — captura semántica en ambos idiomas. Queries en ES o EN ambas tienen buena similitud coseno.

### Cambios en L1/L3

**L1 Strategy 1 (exact):** `LOWER(name) = LOWER(translatedQuery)` — funciona porque query y name están en inglés
**L1 Strategy 2 (FTS):** Simplificar a un solo parser inglés sobre `name`. Opcionalmente mantener parser español sobre `name_es` como fallback.
**L3:** Embeddings bilingües + query traducida a inglés → mejor similitud coseno

### Translation Service

Nuevo módulo `packages/api/src/lib/translationService.ts`:
- `detectLanguage(text: string): Promise<string>` — detecta idioma (EN, ES, etc.)
- `translateToEnglish(text: string, sourceLang?: string): Promise<string>` — traduce a EN
- `translateFromEnglish(text: string, targetLang: string): Promise<string>` — traduce de EN
- Cache Redis: `fxp:translate:{from}:{to}:{hash}` con TTL 30 días
- Proveedor: Microsoft Translator (mejor free tier: 2M chars/mes, más barato, rápido)
- Fallback: si API falla → usar query sin traducir (graceful degradation)

### Coste estimado

| Concepto | Coste |
|----------|-------|
| Batch translation (883 dishes × 2 traducciones) | ~$0.40 one-time |
| Runtime (con 95% cache hit, 1M queries/mes) | <$1/mes |
| Regenerar embeddings | ~$0.03 one-time |
| Microsoft Translator free tier | 2M chars/mes gratis |
| **Total Year 1** | **<$15** |

---

## 7. Feature F038 — Scope Propuesto

**Nombre:** Multilingual Dish Name Resolution
**Complejidad:** Standard
**Prioridad:** ANTES de F031/F034

### Componentes

1. **Translation service module** — detect language, translate EN↔ES, Redis cache, graceful fallback
2. **Batch migration script** — traducir 883 dishes (EN→ES para `name_es`, ES→EN para `name`)
3. **Migración schema** — nuevo campo `name_source_locale` (nullable, default 'en')
4. **Fix ingest pipeline** — detectar idioma del nombre extraído, traducir a EN/ES según corresponda
5. **Query-time translation** — inyectar traducción EN en `engineRouter.ts` antes de la cascada
6. **Regenerar embeddings** — re-ejecutar pipeline con ambos nombres
7. **Tests** — unit tests para translation service, integration tests para flujo completo ES→EN→result

### Lo que NO incluye (diferido)

- Traducción de respuestas a FR/IT/DE (futuro, cuando haya demanda)
- Tabla `dish_translations` (solo si se necesitan 3+ idiomas activos)
- Cambio de modelo de embeddings (no necesario)
- Traducción de nombres de foods USDA (ya tienen `name_es`)

---

## 8. Impacto en el Roadmap

### Orden actualizado

```
F038 (Multilingual Dish Names)  ← NUEVO, CRÍTICO, antes de field testing
F031 (Bot File Upload)           ← depende de F032 (done)
F034 (Menu Analysis)             ← independiente
F035 (Recipe Calculation)        ← depende de F033 (done)
F037 (Context Manager)           ← diferido Phase 3
```

### ADR necesario

Se necesita un **ADR-010** documentando:
- Decisión: English como idioma canónico de búsqueda
- Traducción en los boundaries (input y output)
- Microsoft Translator como proveedor con cache Redis
- `name_source_locale` para preservar trazabilidad

---

## 9. Riesgos y Mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Traducción API no disponible | Baja | Medio | Graceful fallback: buscar con query original sin traducir |
| Traducción incorrecta de plato regional | Media | Bajo | Es solo la search key, display usa nombre original. Cache permite corrección manual |
| "Tortilla" ambigüedad cultural | Media | Bajo | Contexto de cadena/restaurante resuelve (Spain = omelette). Microsoft Translator con hint 'es-ES' |
| Latencia primera query (sin cache) | Media | Bajo | ~100-200ms (Microsoft Translator). Aceptable. Cache elimina para queries repetidas |
| Nombres de marca traducidos incorrectamente | Media | Medio | Prompt/reglas de no-traducir marcas. Lista de brand names a preservar |
| Cambio semántica de `name` afecta código existente | Baja | Medio | Batch migration actualiza todo atómicamente. Tests de regresión verifican |
| Coste se dispara | Muy baja | Bajo | Free tier 2M chars/mes. Con cache, probablemente nunca se supere |

---

## 10. Comparativa Final de los 3 Enfoques

| Criterio | A (name_es) | B+ (canonical EN) | C (híbrido) |
|----------|------------|-------------------|-------------|
| Resuelve ES+EN ahora | ✅ | ✅ | ✅ |
| Escala a N idiomas sin código | ❌ | ✅ | ⚠️ |
| Complejidad inicial | Baja | Media | Alta |
| Complejidad por nuevo idioma | Alta | Nula | Media |
| Preserva nombre original | ✅ | ✅ (con name_source_locale) | ✅ |
| Embeddings consistentes | ⚠️ Bilingües | ✅ Bilingües | ⚠️ Bilingües |
| Dependencia externa | No | Sí (translation API) | Sí |
| Coste runtime | $0 | <$1/mes | <$1/mes |
| Deuda técnica futura | Alta | Baja | Media |
| Alineado con industria | ⚠️ Parcial | ✅ Sí (MyFitnessPal pattern + boundary translation) | ⚠️ |

**Recomendación:** Enfoque B+ (Canonical English con salvaguardas de trazabilidad). Más trabajo inicial, pero resuelve el problema de forma definitiva y escala sin límite de idiomas.
