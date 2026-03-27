# Informe: Nombres de platos en inglés — Impacto en búsqueda

**Fecha:** 2026-03-24
**Severidad:** ALTA — Afecta directamente la experiencia de usuario
**Descubierto durante:** Prueba de L3 (similaridad vectorial) en entornos desplegados

---

## 1. Descripción del problema

De los 885 platos en la base de datos, **883 tienen `name_es = NULL`** (99.8%). Solo los 2 platos del seed de McDonald's (Big Mac, McPollo) tienen nombre en español. Esto significa que:

- Un usuario buscando "hamburguesa con queso" no encuentra "Cheeseburger" (Burger King)
- Un usuario buscando "pollo frito" no encuentra "Crispy Chicken" (Burger King)
- Un usuario buscando "ensalada césar" no encuentra "Caesar Salad Dressing" (Burger King)

---

## 2. Datos cuantitativos

### 2.1 Cobertura de `name_es` por cadena

| Cadena | Total platos | Con `name_es` | Sin `name_es` | % sin ES |
|--------|-------------|---------------|----------------|----------|
| Tim Hortons | 217 | 0 | 217 | 100% |
| KFC | 154 | 0 | 154 | 100% |
| Starbucks | 138 | 0 | 138 | 100% |
| Burger King | 138 | 0 | 138 | 100% |
| Telepizza | 69 | 0 | 69 | 100% |
| Pizza Hut | 65 | 0 | 65 | 100% |
| Popeyes | 53 | 0 | 53 | 100% |
| Five Guys | 41 | 0 | 41 | 100% |
| Papa John's | 8 | 0 | 8 | 100% |
| McDonald's | 2 | 2 | 0 | 0% |
| **TOTAL** | **885** | **2** | **883** | **99.8%** |

### 2.2 Análisis de idioma de los nombres (`name`)

La mayoría de los PDFs nutricionales de cadenas americanas/internacionales en España usan una mezcla de inglés, español y nombres de marca:

| Cadena | EN puro | ES puro | Mixto/Marca | Observación |
|--------|---------|---------|-------------|-------------|
| Burger King | 87 (63%) | 3 (2%) | 48 (35%) | Predomina inglés |
| KFC | 21 (14%) | 69 (45%) | 64 (42%) | Mezcla, bastante español |
| Popeyes | 22 (42%) | 5 (9%) | 26 (49%) | Predomina inglés |
| Tim Hortons | 18 (8%) | 28 (13%) | 171 (79%) | Muchos nombres de marca |
| Starbucks | 5 (4%) | 37 (27%) | 96 (70%) | Nombres de marca + español |
| Telepizza | 4 (6%) | 31 (45%) | 34 (49%) | Bastante español |
| Pizza Hut | 6 (9%) | 28 (43%) | 31 (48%) | Bastante español |
| Five Guys | 0 (0%) | 17 (41%) | 24 (59%) | Nombres de marca |

### 2.3 Ejemplos concretos del problema

| Lo que busca el usuario (ES) | Lo que hay en BD (name) | ¿Match L1? | ¿Match L3? |
|------------------------------|------------------------|------------|------------|
| "hamburguesa con queso" | "Cheeseburger" | ❌ No | ❌ Threshold alto |
| "pollo frito" | "Crispy Chicken®" | ❌ No | ❌ Threshold alto |
| "alitas de pollo" | "Chicken Wings (x" | ❌ No | ❌ Probable miss |
| "patatas fritas" | "Cubo de Patatas Supreme / Supreme Fries Snack Box" | ❌ No | ⚠️ Posible |
| "ensalada" | "Caesar Salad Dressing" | ❌ No | ❌ No |
| "helado de chocolate" | "/ Brownie & Ice Cream" | ❌ No | ❌ No |
| "tiras de pollo" | "Chicken Fries x" | ❌ No | ❌ No |

---

## 3. Impacto por nivel de búsqueda

### 3.1 L1 — Match exacto / FTS

El código FTS (`level1Lookup.ts`) ya busca en AMBOS campos:
```sql
to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', query)
OR to_tsvector('english', d.name) @@ plainto_tsquery('english', query)
```

**Problema:** Si `name_es` es NULL, `COALESCE` usa `name` (inglés) con el parser `spanish`. Un parser español no tokeniza "Cheeseburger" correctamente. La línea OR con parser `english` ayuda si el usuario busca en inglés, pero NO si busca en español.

**Impacto:** L1 FTS falla para la mayoría de queries en español. Solo funciona con match exacto (`LOWER(name) = LOWER(query)`) para palabras que son iguales en ambos idiomas (ej: "Whopper", "Big Mac").

### 3.2 L2 — Estimación por ingredientes

L2 busca alimentos en la tabla `foods` (514 USDA base). Estos SÍ tienen `name_es` (todos los alimentos USDA tienen traducción). L2 no se ve afectado por el problema de dishes.

**Impacto:** Ninguno directo, pero L2 solo se activa si L1 falla y hay un match de ingrediente. No busca en la tabla de dishes.

### 3.3 L3 — Similaridad vectorial (pgvector)

El embedding de cada dish se genera con `buildDishText()`:
```
Dish: Cheeseburger. Restaurant chain: burger-king-es.
Nutrition per serving: 267 kcal, ...
```

Si `name_es` es NULL, no se incluye en el texto del embedding. El embedding solo captura la semántica del nombre en inglés.

Cuando el usuario busca "hamburguesa con queso", se genera un embedding del query en español. La distancia coseno entre el embedding de "hamburguesa con queso" y "Dish: Cheeseburger" es > 0.5 (threshold), por lo que NO hay match.

**Impacto:** L3 falla para queries en español → platos con nombre solo en inglés.

### 3.4 L4 — LLM (identificación)

L4 usa un LLM (gpt-4o) que SÍ entiende multiidioma. Si la query llega a L4, el LLM puede identificar que "hamburguesa con queso" = "Cheeseburger". Pero L4 tiene costes más altos y solo se activa como último recurso.

**Impacto:** L4 podría compensar parcialmente, pero depende de la configuración de `OPENAI_CHAT_MODEL` y tiene coste por query.

---

## 4. Root cause

El pipeline de ingestión de PDFs (`POST /ingest/pdf-url`) extrae nombres de platos del PDF tal como aparecen. Los PDFs nutricionales de cadenas internacionales en España usan predominantemente inglés o mezcla EN/ES. El pipeline NO traduce ni mapea los nombres.

El campo `name_es` existe en el schema (`dishes.name_es`) pero NUNCA se popula durante la ingestión de PDFs. Solo se popula en el seed manual de McDonald's.

---

## 5. Soluciones propuestas

### Solución A: Traducción automática post-ingestión con LLM

**Qué:** Script post-ingestión que usa LLM para generar `name_es` para platos sin traducción.

**Pros:** Completa, mejora L1 y L3 inmediatamente, coste bajo (~$0.10 one-time).
**Contras:**
- Es un **parche**, no una solución estructural — cada nueva ingestión requiere re-ejecutar
- Calidad de traducciones: nombres de marca no se deben traducir, mixtos son ambiguos
- No escala a otros idiomas (FR, IT, DE) — habría que re-traducir a cada idioma
- Dependencia de LLM para un dato que debería venir de la fuente

### Solución B: Tabla de nombres multiidioma (i18n estructural)

**Qué:** Crear tabla `dish_translations` con esquema `(dish_id, locale, name)`. Una fila por idioma. El pipeline de ingestión popula el locale original del PDF. Un proceso posterior puede añadir traducciones.

**Schema:**
```sql
CREATE TABLE dish_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id     UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  locale      VARCHAR(5) NOT NULL,  -- es, en, fr, it, de, pt, ca
  name        TEXT NOT NULL,
  source      VARCHAR(20) NOT NULL, -- 'pdf_original', 'llm_translated', 'manual', 'community'
  confidence  DECIMAL(3,2) DEFAULT 1.0,  -- 1.0 for original, 0.8 for LLM, etc.
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dish_id, locale)
);
```

**Pros:**
- Solución **estructural** — el dato multiidioma está modelado correctamente
- Escala a cualquier idioma sin cambiar schema ni código
- Cada traducción tiene `source` y `confidence` — sabemos de dónde viene y cuánto confiar
- La búsqueda L1/L3 puede indexar TODOS los locales
- Compatible con futuro frontend multiidioma y expansión internacional (IT, FR, DE)
- Los PDFs en español (Telepizza, KFC parcial) pueden poblar `locale=es` directamente desde la ingestión

**Contras:**
- Más desarrollo (nueva tabla, migración, adaptar L1/L3)
- Necesita decidir cómo poblar traducciones (LLM, manual, community, o combinación)

### Solución C: Arreglar la ingestión en origen

**Qué:** Muchos PDFs ya contienen nombres en español (KFC 45%, Telepizza 45%, Pizza Hut 43%, Starbucks 27%). El parser extrae el nombre tal cual, pero podría detectar el idioma y poblar `name_es` durante la ingestión.

**Pros:**
- Los datos ya están en el PDF, solo hay que extraerlos correctamente
- Sin coste de API
- Dato de mayor calidad (el propio restaurante lo nombra así)

**Contras:**
- Solo resuelve parcialmente — los PDFs de BK (63% inglés) y Popeyes (42% inglés) seguirían sin nombre español
- Requiere heurísticas de detección de idioma

### Solución D: Búsqueda multiidioma en query-time

**Qué:** Modificar L1/L3 para buscar en múltiples idiomas sin cambiar datos. Opciones:
- L1: Expandir FTS para buscar con parsers `spanish`, `english`, `simple` simultáneamente
- L3: Generar embeddings bilingües (incluir traducción en el texto del embedding) o bajar threshold
- Pre-L1: Traducir la query del usuario al inglés antes de buscar

**Pros:** No necesita cambiar datos ni schema.
**Contras:**
- Añade complejidad/latencia a cada query
- Bajar threshold de L3 aumenta falsos positivos
- Traducir query pre-L1 añade coste por request
- No escala a más idiomas elegantemente

### Solución E: Embeddings multilingües con modelo cross-lingual

**Qué:** Usar un modelo de embeddings multilingüe (ej: `multilingual-e5-large`, `cohere-multilingual-v3`) en vez de `text-embedding-3-small`. Estos modelos mapean "hamburguesa con queso" y "cheeseburger" al mismo vector.

**Pros:**
- Resuelve L3 completamente sin traducir nada
- Funciona para cualquier idioma de query (ES, FR, IT, EN)
- text-embedding-3-small de OpenAI ya tiene capacidad multilingüe (pero limitada)

**Contras:**
- No resuelve L1 (FTS sigue necesitando texto en el idioma correcto)
- Cambiar modelo de embeddings requiere regenerar TODOS los embeddings
- Modelos multilingües pueden ser menos precisos en inglés puro

---

## 6. Análisis comparativo

| Criterio | A (LLM post) | B (i18n table) | C (Fix ingest) | D (Query-time) | E (Cross-lingual) |
|----------|-------------|----------------|-----------------|----------------|-------------------|
| Resuelve L1 | ✅ | ✅ | ⚠️ Parcial | ⚠️ Parcial | ❌ |
| Resuelve L3 | ✅ | ✅ | ⚠️ Parcial | ✅ | ✅ |
| Escala a FR/IT/DE | ❌ Re-traducir | ✅ Nativo | ❌ | ⚠️ | ✅ |
| Calidad datos | ⚠️ LLM | ✅ Trazable | ✅ Original | N/A | N/A |
| Esfuerzo dev | Bajo | Medio | Medio | Bajo | Bajo |
| Coste runtime | One-time | One-time | Zero | Por query | Zero |
| Estructural | ❌ Parche | ✅ | ✅ | ❌ | ⚠️ |

---

## 7. Recomendación revisada

**Solución combinada: B + C + A (en ese orden)**

La solución óptima combina tres approaches en fases:

### Fase 1: Tabla i18n + Fix ingestión (Solución B + C)
- Crear tabla `dish_translations` con soporte multilocale
- Modificar pipeline de ingestión para detectar idioma y poblar `locale=es` cuando el nombre ya es español
- Adaptar L1 (FTS) y L3 (embeddings) para buscar en `dish_translations`
- **Resultado:** Los ~45% de platos que ya tienen nombre español en el PDF funcionan en L1/L3

### Fase 2: Traducción asistida para el resto (Solución A como complemento)
- Para platos sin `locale=es`, usar LLM para generar traducciones con `source=llm_translated`, `confidence=0.8`
- Review workflow: traducciones LLM se marcan como "pendiente de revisión"
- **Resultado:** 100% de platos con nombre español, con trazabilidad del origen

### Fase 3: Internacionalización (futuro)
- Añadir traducciones FR, IT, DE, PT a `dish_translations`
- Frontend multiidioma consume los locales disponibles
- Considerar modelo de embeddings cross-lingual (Solución E) si el volumen de idiomas lo justifica

### Por qué esta combinación:
1. **Estructural** — el schema i18n es la base correcta para cualquier solución posterior
2. **Aprovecha datos existentes** — muchos PDFs ya tienen español, solo falta extraerlo
3. **Trazabilidad** — sabemos si un nombre viene del PDF original, de LLM, o de revisión manual
4. **Escala** — añadir un idioma es añadir filas, no cambiar código
5. **Calidad** — el campo `confidence` permite priorizar datos originales sobre traducciones

---

## 8. Consideraciones de internacionalización (i18n)

### Mercados potenciales
La plataforma puede expandirse a:
- **Italia** — muchas cadenas compartidas (BK, KFC, McDonald's, Domino's, Papa John's)
- **Francia** — ídem + cadenas locales (Quick, Paul, Flunch)
- **Portugal** — mercado cercano, cadenas compartidas
- **UK** — Five Guys, KFC, BK, Nando's, etc.
- **Alemania** — gran mercado, cadenas americanas + locales

### Implicaciones para el schema
- `dish_translations.locale` usando códigos BCP 47 (`es`, `en`, `fr`, `it`, `de`, `pt`, `ca`)
- Posibilidad de variantes regionales (`es-ES` vs `es-MX`) en el futuro
- Nombres de marca son universales — no necesitan traducción (reduce coste significativamente)
- Los PDFs nutricionales suelen estar en el idioma local del país — la ingestión ya tiene el dato

### Implicaciones para búsqueda
- L1 FTS: índice por locale en `dish_translations`
- L3 embeddings: generar embedding por locale (o uno multilingüe)
- Frontend: detectar idioma del usuario → priorizar locale en búsqueda

---

## 9. Métricas de éxito propuestas

| Métrica | Actual | Post-Fase 1 | Post-Fase 2 |
|---------|--------|-------------|-------------|
| Platos con nombre ES | 2 (0.2%) | ~400 (45%) | 885 (100%) |
| L1 match rate para queries ES | ~5% | ~40% | ~80% |
| L3 match rate para queries ES | ~0% | ~30% | ~70% |
| Idiomas soportados | 1 (EN parcial) | 2 (ES + EN) | N (extensible) |

---

## 7. Datos adicionales para la implementación

### Nombres que NO se deben traducir (marcas)
- Whopper®, Big Mac, McChicken, Big King®, Crispy®
- Sandy™, King Nuggets®, Rodeo
- Nombres propios de producto (BK Sandy, Tim Hortons Berlitim)

### Nombres que SÍ se deben traducir
- "Cheeseburger" → "Hamburguesa con queso"
- "Chicken Wings" → "Alitas de pollo"
- "French Fries" → "Patatas fritas"
- "Onion Rings" → "Aros de cebolla"
- "Caesar Salad" → "Ensalada César"
- "Ice Cream" → "Helado"

### Nombres mixtos (traducción parcial)
- "Big King® Bacon Chicken" → "Big King® Bacon Pollo" (solo traducir "Chicken")
- "Crispy Chicken®" → mantener tal cual (es marca)
- "Chicken Fries" → "Tiras de Pollo" o mantener

### Embeddings actuales
- 885 dishes con embedding generado sobre `name` (inglés/mixto)
- 519 foods con embedding generado sobre `name` + `name_es` (bilingüe)
- Después de traducir, hay que regenerar los 885 embeddings de dishes
