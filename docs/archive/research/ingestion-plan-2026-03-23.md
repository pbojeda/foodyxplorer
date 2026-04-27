# Plan de Ingesta de Nuevas Cadenas — nutriXplorer

**Fecha:** 2026-03-23
**Basado en:** chain-research-2026-03-23.md
**Estado actual:** 399 platos (BK 161, KFC 167, Telepizza 69, McDonald's 2 seed)
**Revisado por:** Gemini (2026-03-23) — 5 issues encontrados, 4 aplicados (1 falso positivo)

---

## Fase 1: Integración Inmediata (PDF_TABLE — sin desarrollo nuevo)

Estas cadenas tienen PDFs con tablas nutricionales parseables por el pipeline existente (`POST /ingest/pdf-url`). Solo requieren:
1. Añadir entrada en `chain-seed-ids.ts` y `chain-pdf-registry.ts`
2. Añadir restaurant + dataSource en `seed.ts`
3. Ejecutar seed + batch-ingest

### Orden de ejecución (por prioridad)

| # | Cadena | URL PDF | Platos est. | Campos | Notas |
|---|--------|---------|-------------|--------|-------|
| 1 | **Five Guys ES** | `https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf` | ~50 | 9 + porción y 100g | Re-habilitar entry existente, usar PDF combinado Feb 2026 |
| 2 | **Popeyes ES** | `https://popeyes-prod.s3.eu-west-1.amazonaws.com/Nutricional_alergenos_Ed_00_Octubre_2021.pdf` | ~90 | 11 campos | ⚠️ PDF de 2021 — buscar versión más reciente antes de ingestar |
| 3 | **Papa John's ES** | `https://cdn.new.papajohns.es/Alergenos+Espa%C3%B1a/Inf_NutricionalEspa%C3%B1a+Ed+27.pdf` | ~150+ | 9 campos | CDN estable, valores por 100g, URL-encoded |
| 4 | **Pizza Hut ES** | `https://s4d-mth-prd-01-ph-es-ecom-cms-cdne.azureedge.net/ecom-cms/assets/nutricion_ph26_89a1ae2af8.pdf` | ~80-100 | Completos | Azure CDN |
| 5 | **Starbucks ES** | `https://www.starbucks.es/sites/starbucks-es-pwa/files/2025-03/250306%20FOOD%20Info%20nutricional%20x%20100g%20%20Spring%20-ESP%20V1.pdf` | ~100+ | 8 campos | Seasonal, por 100g, URL-encoded |
| 6 | **Tim Hortons ES** | `https://www.tim-hortons.es/docs/Nutricionales.TH.ES.pdf` | ~50-70 | 7 campos | Mismo grupo que BK/Popeyes |

**Total estimado Fase 1: ~520-560 platos nuevos**

### Trabajo técnico por cadena

Para cada cadena:
```
1. chain-seed-ids.ts  → Añadir IDs deterministas (RESTAURANT_ID, SOURCE_ID)
2. chain-pdf-registry.ts → Añadir ChainPdfConfig entry
3. seed.ts → Añadir fase de seed (restaurant + dataSource)
4. Ejecutar: npm run db:seed → npm run ingest:batch --chain <slug>
5. Verificar: curl /chains → dishCount > 0
6. Ejecutar: npm run embeddings:generate (para L3)
```

### Riesgos Fase 1

- **Formato PDF**: El parser actual (`nutritionTableParser`) está optimizado para tablas con columnas fijas. PDFs con layouts diferentes (multi-página con categorías, valores por 100g vs por porción) pueden necesitar ajustes menores en el parser.
- **Five Guys**: El PDF combinado (alérgenos+ingredientes+nutrición) puede confundir al parser. Usar el PDF de solo nutrición (Oct 2024) inicialmente.
- **Papa John's**: 150+ entries con pizzas × tamaño × masa → muchas filas. Verificar que el parser maneja bien PDFs de 4+ páginas.
- **Starbucks**: PDF seasonal, URL cambia cada temporada. Documentar patrón.

---

## Fase 2: Cadenas pendientes existentes (necesitan desarrollo)

| # | Cadena | Problema | Solución propuesta | Esfuerzo |
|---|--------|----------|-------------------|----------|
| 1 | **Subway ES** | PDF tiene formato tabla diferente (columnas fijas con categorías) | Crear preprocessor `preprocessSubwayEs()` que normalice el formato | Medio (1-2 días) |
| 2 | **McDonald's ES** | Scraper bloqueado por anti-bot (ERR_HTTP2_PROTOCOL_ERROR) | Opción A: Buscar PDF nutricional alternativo. Opción B: Configurar Playwright con user-agent/proxy. Opción C: Usar datos de McDonald's US y mapear al menú ES | Medio-Alto |
| 3 | **Domino's ES** | URL de imagen redirige a HTML | Buscar nueva URL de tabla nutricional en `alergenos.dominospizza.es` con Playwright | Medio |

**Total estimado Fase 2: ~200-250 platos**

---

## Fase 3: Estimación L2 para cadenas con ingredientes (sin macros)

Estas cadenas publican listas de ingredientes pero no datos nutricionales. Usando la base USDA de 514 alimentos y el motor L2, podemos generar estimaciones.

### Estrategia L2

1. **Parsear PDFs de alérgenos/ingredientes** → extraer lista de ingredientes por plato
2. **Mapear cada ingrediente a un alimento USDA** (match por nombre/embedding)
3. **Estimar porciones** usando pesos cuando están disponibles, o porciones estándar
4. **Calcular macros** sumando los nutrientes de cada ingrediente × porción
5. **Marcar como `confidenceLevel: estimated`** y `estimationMethod: ingredient_decomposition`

### Cadenas candidatas L2

| # | Cadena | Platos | Viabilidad L2 | Ingredientes | Pesos disponibles |
|---|--------|--------|---------------|-------------|-------------------|
| 1 | **100 Montaditos** | ~130 | Alta | Individuales por componente | Algunos |
| 2 | **The Good Burger** | ~40 | Alta | Individuales con pesos ("120g./140g.") | Sí |
| 3 | **Grosso Napoletano** | menú completo | Media | Toppings individuales | No |
| 4 | **Muerde la Pasta** | ~150 | Media-Baja | Buffet, sin porciones | No |

**Total estimado Fase 3: ~320-400 platos con estimación L2**

### Trabajo técnico Fase 3

Esto requiere un nuevo pipeline:
1. **Nuevo endpoint** `POST /ingest/ingredients` — recibe lista de ingredientes por plato, mapea a USDA, calcula macros
2. **Parser de PDFs de ingredientes** — diferente al parser nutricional actual
3. **Matching ingrediente → USDA** — usar embeddings + fuzzy match
4. **Tabla de porciones estándar** — ya existe (`standard_portions` en la BD)

---

## Fase 4: Cadenas con desarrollo específico (futuro)

| Cadena | Tipo | Trabajo |
|--------|------|---------|
| **Taco Bell ES** | SPA JavaScript | Scraper Playwright completo |
| **UDON** | PDF %CDR | Preprocessor %CDR → gramos |
| **Wok to Walk** | Web calculador | Scraper + lógica combinación |
| **Foster's Hollywood** | Web con templates | Investigar con headless browser |

---

## Fase 5: Cadenas USA (opcional, expansión internacional)

Si se decide expandir más allá de España:
- **Panera Bread, Arby's, Whataburger, CAVA, Shake Shack, Wingstop** — todos tienen PDFs excelentes
- Total: ~540-600 platos adicionales
- Requiere: flag de country, UI para seleccionar país

---

## Orden de ejecución recomendado

```
Ahora (hoy):
  → Fase 1: Five Guys, Popeyes, Papa John's, Pizza Hut, Starbucks, Tim Hortons
  → Total: ~520-560 platos nuevos → ~920-960 total

Próxima semana:
  → Fase 2: Subway (preprocessor), investigar McDonald's y Domino's
  → Total: ~200-250 más → ~1,120-1,210 total

Siguiente sprint:
  → Fase 3: 100 Montaditos, TGB con estimación L2
  → Total: ~170 más → ~1,290-1,380 total

Futuro:
  → Fase 4: Taco Bell, UDON, Wok to Walk
  → Fase 5: Cadenas USA
```

## Métricas de éxito

| Métrica | Actual | Post-Fase 1 | Post-Fase 2 | Post-Fase 3 |
|---------|--------|-------------|-------------|-------------|
| Cadenas con datos | 3 (+4 pendiente) | 9 | 12 | 14+ |
| Platos totales | 399 | ~960 | ~1,210 | ~1,380 |
| Cobertura cadenas grandes ES | 30% | 70% | 85% | 90%+ |
