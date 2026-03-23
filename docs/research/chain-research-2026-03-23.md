# Investigación de Cadenas de Restaurantes — nutriXplorer

**Fecha:** 2026-03-23
**Objetivo:** Catálogo completo de cadenas con información nutricional, alérgenos e ingredientes para integración en nutriXplorer.

---

## Contexto del Proyecto

nutriXplorer es una plataforma open source que proporciona información nutricional de platos de restaurantes de comida rápida y casual. Monorepo TypeScript con API REST (Fastify + PostgreSQL + pgvector) y bot de Telegram.

### Niveles de confianza de datos
- **L1:** Datos oficiales (match exacto desde la BD)
- **L2:** Estimación por ingredientes (base USDA de 514 alimentos)
- **L3:** Extrapolación por similaridad vectorial (pgvector cosine distance)
- **L4:** LLM (identificación y descomposición con OpenAI)

### Cadenas ya onboarded (~399 platos reales)
| Cadena | Platos | Estado |
|--------|--------|--------|
| Burger King | 161 | ✅ Ingestado desde PDF |
| KFC | 167 | ✅ Ingestado desde PDF |
| Telepizza | 69 | ✅ Ingestado desde PDF |
| McDonald's | 2 (seed) | ⏳ Pendiente scraper web Playwright |
| Subway | pendiente | ⏳ PDF existe, formato diferente, necesita preprocessor |
| Domino's | pendiente | ⏳ URL de imagen OCR redirige a HTML |
| Pans & Company | pendiente | ❌ Solo PDF de alérgenos, no nutricional |
| Five Guys | deshabilitado | ⚠️ **VER HALLAZGO IMPORTANTE ABAJO** |

---

## HALLAZGO CRÍTICO: Five Guys tiene datos nutricionales

Five Guys estaba deshabilitado en el proyecto con la nota: "PDF contains allergen/ingredient list only — no calorie or macro data." **Esto ya NO es correcto.**

### Five Guys España
- **Nombre:** Five Guys
- **Web ES:** https://fiveguys.es
- **Web US:** https://www.fiveguys.com
- **Tipo:** PDF_TABLE
- **¿Info nutricional?** SÍ
- **¿Lista ingredientes?** SÍ (detallados, con alérgenos en negrita)
- **URLs verificadas (HTTP 200):**

| URL | Contenido | Fecha | Tamaño |
|-----|-----------|-------|--------|
| `https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf` | **Alérgenos + ingredientes + nutrición (COMBINADO)** | Feb 2026 | 211KB |
| `https://fiveguys.es/app/uploads/sites/6/2024/10/FGES-Nutritional_SPANISH_221024.pdf` | Solo datos nutricionales | Oct 2024 | 79KB |
| `https://www.fiveguys.com/wp-content/uploads/2025/07/five-guys-us-nutrition-allergen-guide-english-1-final.pdf` | US: nutrición + alérgenos + ingredientes | Jul 2025 | 167KB |
| `https://www.fiveguys.co.uk/wp-content/uploads/sites/30/2026/03/FGUK_FOH_allergen_ingredient_nutrition_ice-coffee_pistachio_digital_A4_20260324.pdf` | UK: nutrición + alérgenos + ingredientes | Mar 2026 | 251KB |

- **Cobertura nutricional (ES):** Energía (kJ), Energía (kcal), Grasas totales (g), Saturadas (g), Carbohidratos (g), Azúcares (g), Fibra (g), Proteínas (g), Sal (g) — **9 campos, por porción Y por 100g**
- **Cobertura nutricional (US):** Serving Size (g), Calories, Cal from Fat, Total Fat, Sat Fat, Trans Fat, Cholesterol, Sodium, Carbs, Fiber, Sugars, Protein — **12 campos, por porción**
- **Ingredientes:** SÍ — Listado completo por producto con sub-ingredientes para ítems compuestos. Alérgenos en **NEGRITA**.
- **Idioma:** Español (ES), Inglés (US/UK)
- **Platos:** ~50 ítems (3 carnes, 2 panes, 6 patatas, ~18 toppings, ~14 batidos/mix-ins, ~6 sándwiches/otros)
- **Notas técnicas:**
  - PDFs descargables directamente, sin JavaScript
  - Sin anti-bot
  - Patrón URL ES: `fiveguys.es/app/uploads/sites/6/YYYY/MM/FGES_*.pdf`
  - Patrón URL US: `fiveguys.com/wp-content/uploads/YYYY/MM/*.pdf`
  - CDN: Cloudflare
  - URLs cambian al actualizar documentos (nombres con fecha)
  - **ACCIÓN: Re-habilitar Five Guys en chain-pdf-registry.ts con el PDF combinado de Feb 2026**

---

## TABLA RESUMEN MAESTRA

### Leyenda de columnas
- **Tipo:** PDF_TABLE | PDF_PER_PRODUCT | WEB_TABLE | WEB_PER_PRODUCT | API_JSON | IMAGE | ALLERGEN_ONLY | NONE
- **Nutri:** ¿Tiene datos nutricionales (kcal, macros)?
- **Ingred:** ¿Lista ingredientes por producto?
- **Alérg:** ¿Tiene información de alérgenos?
- **Viable:** ✅ Ingestable hoy | ⚠️ Necesita desarrollo | ❌ No viable ahora

---

### A. Cadenas con datos nutricionales completos (ESPAÑA)

| # | Cadena | Tipo | Nutri | Ingred | Alérg | Platos | Formato | Viable |
|---|--------|------|-------|--------|-------|--------|---------|--------|
| 1 | **Five Guys ES** | PDF_TABLE | ✅ | ✅ | ✅ | ~50 | Porción + 100g | ✅ |
| 2 | **Popeyes ES** | PDF_TABLE | ✅ | ❌ | ✅ | ~90 | Porción | ✅ |
| 3 | **Papa John's ES** | PDF_TABLE | ✅ | ❌ | ✅ (separado) | ~150+ | 100g | ✅ |
| 4 | **Pizza Hut ES** | PDF_TABLE | ✅ | Probable | ✅ (separado) | ~80-100 | TBD | ✅ |
| 5 | **Starbucks ES** | PDF_TABLE | ✅ | ❌ | ✅ (Grupo VIPS) | ~100+ | 100g / 100ml | ✅ |
| 6 | **Tim Hortons ES** | PDF_TABLE | ✅ | ❌ | TBD | ~50-70 | TBD | ✅ |
| 7 | **UDON** | PDF_TABLE | ⚠️ %CDR | ❌ | ❌ | ~55 | %CDR (2014) | ⚠️ |
| 8 | **Taco Bell ES** | WEB_TABLE | ✅ | ❌ | ❌ | ~50-70 | TBD | ⚠️ SPA/Playwright |
| 9 | **Wok to Walk** | WEB_TABLE | ✅ | ❌ | ✅ (PDFs por local) | ~30 ingred. | Por ingrediente | ⚠️ Dominio .is |

---

### B. Cadenas solo alérgenos CON ingredientes listados (ESPAÑA) — candidatas para L2

| # | Cadena | Tipo | Nutri | Ingred | Detalle ingredientes | Platos | Viable L2 |
|---|--------|------|-------|--------|---------------------|--------|-----------|
| 1 | **Rodilla** | ALLERGEN_ONLY | ❌ | ✅ (en nombre) | PDF dice "alergenos-ingredientes" — necesita verificación con navegador (Imperva CDN) | ~70 | ⚠️ Verificar |
| 2 | **100 Montaditos** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Tabla de alérgenos POR INGREDIENTE individual (Aceites, Bacon, Pan 100M, Salsa César, etc.) — no recetas completas pero cada componente listado individualmente con peso en algunos casos | ~130 | ⚠️ Moderado-Alto |
| 3 | **The Good Burger** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Mismo formato Restalia: ingredientes individuales con pesos ("Carne hamburguesa 120g/140g", "Queso mezcla cheddar Monterrey Jack") | ~40 | ⚠️ Moderado-Alto |
| 4 | **Muerde la Pasta** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Alérgenos por ingrediente individual de buffet (IT→ES: "CUBETTI DI FORMAGGIO" = "MOZZARELLA, GOUDA, CHEDDAR"). Útil pero sin porciones (buffet libre) | ~150 | ⚠️ Moderado |
| 5 | **Grosso Napoletano** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Sección "INGREDIENTES" lista toppings individuales con alérgenos (Salsa Tomate, Prosciutto Cotto, Mozzarella Fior di latte, etc.) | menú completo | ⚠️ Moderado |
| 6 | **VICIO** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Descripciones con ingredientes principales ("doble smash burger, lechuga francesa, tomate pera, cheddar, pepinillo y salsa VICIO") pero no desglose completo | ~20-30 | ⚠️ Bajo |
| 7 | **Tasty Poké Bar** | ALLERGEN_ONLY | ❌ | ⚠️ Parcial | Carta de alérgenos muestra composición por producto | ~40-50 | ⚠️ Bajo |
| 8 | **Foster's Hollywood** | ALLERGEN_ONLY | ❌ | ⚠️ Posible | Template variables `{{ingredientes}}` en el HTML sugieren que hay datos server-side — necesita scraping con headless browser | ~100 | ⚠️ Investigar |

---

### C. Cadenas solo alérgenos SIN ingredientes (ESPAÑA)

| # | Cadena | Web | URL alérgenos (HTTP 200) | Platos | Notas |
|---|--------|-----|--------------------------|--------|-------|
| 1 | Goiko | goiko.com | `goiko.com/es/alergenos/` | ~100 | Filtro web interactivo, sin PDF |
| 2 | Carl's Jr | carlsjr.es | `carlsjr.es/wp-content/uploads/2025/01/Alergenos-CJ-ENERO-2025.pdf` | ~65 | Excel→PDF |
| 3 | Ginos | ginos.es | `alergenos.grupovips.com/app/allergens/pdf.php?brand=ginos&country=es&lang=es_ES` | ~100 | Infraestructura Grupo VIPS |
| 4 | La Tagliatella | latagliatella.es | `latagliatella.es/dam/jcr:f1bf868f-48f6-419c-b2ec-85f2723fa6b6` | ~100 | Adobe Experience Manager, trilingüe ES/CA/EN |
| 5 | VIPS | vips.es | `alergenos.grupovips.com/app/allergens/pdf.php?brand=vips&country=es&lang=es_ES` | ~130 | Tienen datos nutri internamente (confirmado vía Twitter 2018) |
| 6 | TGI Fridays | tgifridays.es | `alergenos.grupovips.com/app/allergens/pdf.php?brand=fridays&country=es&lang=es_ES` | ~150 | US publica PDF nutricional pero menú ES es diferente |
| 7 | La Mafia | lamafia.es | `lamafia.es/informacion-nutricional` (sirve PDF directo) | ~90 | URL engañosa — solo alérgenos. Trilingüe ES/PT/CA |
| 8 | La Sureña | lasurena.es | (incluida en PDF de 100 Montaditos, dominio propio tiene SSL roto) | ~80 | Grupo Restalia |
| 9 | Pret A Manger | pret.com/es-ES | PDF alérgenos HTTP 403 sin referrer | ~35 | Muy nuevo en España (aeropuertos BCN/AGP) |
| 10 | Aloha Poké | healthylifehappylife.es | `healthylifehappylife.es/s/Tabla-de-alergenos-Aloha-poke-Abril-2025-xbe2.pdf` (302→200) | ~120 | Preparado por lab externo Quimicral S.L. |
| 11 | Poke House | poke-house.com/es-es | `poke-house.com/es-es/allergens/` (web table) | menú completo | Cadena italiana |
| 12 | Dunkin' ES | dunkin.es | Múltiples PDFs: permanentes (rev.11 oct 2019), bebidas, veganos (2023) | ~40-50 | PDFs desactualizados (2019-2023) |
| 13 | Honest Greens | honestgreens.com | `hnst-files.s3.eu-west-1.amazonaws.com/cms/hg_Alergenos_Spring_2025_ES_EN_*.pdf` | ~40-60 | Seasonal, S3-hosted, bilingüe ES/EN |
| 14 | Sushi Shop | sushishop.eu/es/ | `sushishop.eu/USER/PDF/Allergenes_ES.pdf` | ~120 | AmRest group |
| 15 | Healthy Poke | healthypoke.com | `healthypoke.com/storage/2024/01/ALERGENOS.pdf` | ~30-40 | 32+ locales |
| 16 | Miss Sushi | misssushi.es | `carta.misssushi.es/allergens/es` (web app) | ~80-100 | 32 locales, web app interactiva |
| 17 | GO! Sushing | gosushing.com | `gosushing.com/assets/files/catalogo-2024pdf.pdf` | ~60-80 | Primer delivery sushi Madrid |

---

### D. Cadenas sin datos (NONE)

| Cadena | Estado |
|--------|--------|
| Tommy Mel's | Web en mantenimiento, allergen page → 404. Grupo Avanza Food |
| Oven Mozzarella Bar | Nada publicado online |
| TKO Tacos | Nada publicado online, ~25 locales |
| Flax & Kale | Web Canva, sin datos estructurados. 3 locales BCN |
| GreenVita | Sin documentos publicados. 9 locales |
| FrescCo | Buffet, sin datos publicados. Grupo Ibersol |

---

### E. Cadenas NO presentes en España

| Cadena | Estado |
|--------|--------|
| Wagamama | **Cerrado** — tuvo locales en Madrid vía Grupo VIPS, ahora todos cerrados |
| Nando's | No opera en España |
| Leon | No opera en España |
| itsu | Solo productos grocery en El Corte Inglés, sin restaurantes |
| EAT | No opera en España |

---

### F. Cadenas nuevas en España (potencial futuro)

| Cadena | Estado | Notas |
|--------|--------|-------|
| Krispy Kreme ES | Primer local oct 2025 Madrid. Expansión a 50+ en 4 años. Datos nutricionales inciertos en .es | MX tiene tabla completa |

---

## CADENAS USA CON DATOS NUTRICIONALES EXCELENTES

Estas cadenas no operan en España pero tienen datos nutricionales de alta calidad que podrían integrarse para usuarios internacionales o como referencia.

### Tier 1 — PDFs excelentes, directamente parseables

| # | Cadena | URL recurso (HTTP 200) | Campos | Ingredientes | Platos | Formato |
|---|--------|------------------------|--------|-------------|--------|---------|
| 1 | **Panera Bread** | `panerabread.com/content/dam/panerabread/integrated-web-content/documents/Panera-Nutrition.pdf` | 12 campos (kcal, cal from fat, fat, sat, trans, chol, sodium, carbs, fiber, sugars, protein + serving size) | ❌ | ~150+ | Porción |
| 2 | **Arby's** | `assets.ctfassets.net/30q5w5l98nbx/.../Arbys_Nutritional_and_Allergen_FEB_2026.pdf` | 12 campos + alérgenos inline en rojo | ✅ (allergen Contains + PDF separado de ingredientes completo) | ~80+ | Porción |
| 3 | **Whataburger** | `wbimageserver.whataburger.com/Nutrition.pdf` | 11 campos | ❌ | ~120+ | Porción |
| 4 | **CAVA** | `assets.ctfassets.net/kugm9fp9ib18/.../CAVA_1223_REC_GID_NUTR_ALL_REG.pdf` | 11 campos | ❌ | ~100+ componentes | Porción |
| 5 | **Shake Shack** | `shakeshack.com/sites/default/files/2023-12/Allergen_1.pdf` | 10 campos + allergen Contains | ✅ (Contains por producto) | ~40-50 | Porción |
| 6 | **Wingstop** | `s3.amazonaws.com/wingstop.com/assets/static/WSR18-0009-Corporate-NutritionalGuide-JumboWings-HR_OFFICAL.pdf` | **16 campos** (incluye Vit D, Calcium, Iron, Potassium) | ❌ | ~50+ | Porción (por ala) |

### Tier 2 — PDFs buenos con limitaciones

| # | Cadena | URL recurso | Campos | Ingredientes | Platos | Notas |
|---|--------|-------------|--------|-------------|--------|-------|
| 7 | **Wendy's** | `wendys.com/sites/default/files/2025-02/Core%20Menu.pdf` | 9 campos EU-format | ❌ | ~70 | PDF Excel-convertido |
| 8 | **In-N-Out** | `in-n-out.com/docs/default-source/downloads/nutrition_info.pdf?sfvrsn=332aab37_36` | 12 campos | ❌ | ~20-25 | Imperva WAF bloquea fetch directo, PDF válido |
| 9 | **Chipotle** | `chipotle.com/content/dam/chipotle/menu/nutrition/US-Nutrition-Facts-Paper-Menu-3-2025.pdf` | Calorías por componente + por oz | ✅ (descripciones de ingredientes inline) | ~40 componentes | Paper menu format, no data table |
| 10 | **Chili's** | `cdn-assets.saveon.com/pdfs/1378920080-Chilis%20Nutrition%20Menu%20Generic.pdf` (mirror) | 6 campos (kcal, fat, sodium, carbs, sugar, protein) | ❌ | ~150+ | No en chilis.com, solo mirrors |
| 11 | **Sweetgreen** | Google Drive PDF + web inline (kcal, prot, carbs, fat) | 4 campos web / más en PDF | ✅ | ~40+ | Incluye emisiones CO2 |

### Tier 3 — Geo-restringidos o solo web

| # | Cadena | Tipo | Notas |
|---|--------|------|-------|
| 12 | **Chick-fil-A** | WEB_TABLE (JS) | Sin PDF oficial, tabla interactiva WordPress, necesita headless browser |
| 13 | **Dunkin' US** | PDF_TABLE | `dunkindonuts.com/content/dam/dd/pdf/nutrition.pdf` — geo-bloqueado fuera de US |
| 14 | **Panda Express** | WEB_PER_PRODUCT | Geo-restringido (403 desde España), ~88 ítems |
| 15 | **Dairy Queen** | WEB_PER_PRODUCT | Geo-restringido (403 desde España), sin PDF |

---

## FICHAS DETALLADAS — CADENAS ESPAÑA CON DATOS NUTRICIONALES

---

### 1. Popeyes España

| Campo | Valor |
|-------|-------|
| **Nombre** | Popeyes Louisiana Kitchen España |
| **Web** | https://www.popeyes.es |
| **Tipo** | PDF_TABLE |
| **URL nutricional** | `https://popeyes-prod.s3.eu-west-1.amazonaws.com/Nutricional_alergenos_Ed_00_Octubre_2021.pdf` |
| **HTTP** | 200 OK, application/pdf, 242KB |
| **Campos** | Peso (g), kcal, kJ, proteínas, carbohidratos, azúcar, fibra, grasas, grasas saturadas, sodio (mg), sal (g) — **11 campos** |
| **Ingredientes** | ❌ No |
| **Alérgenos** | ✅ En el mismo PDF |
| **Formato** | Por porción (peso en gramos por ítem) |
| **Idioma** | Español |
| **Platos** | ~85-90 (pollo clásico/picante, tiras, sándwiches, grilled, alitas, nuggets, complementos, ensaladas, postres, salsas, bebidas) |
| **Edición** | Ed. 02 — 16 marzo 2023 |
| **Notas** | PDF en AWS S3, acceso directo sin auth. Nutricional + alérgenos en un solo documento. Grupo Restaurant Brands Iberia (mismo que Burger King ES). |

---

### 2. Papa John's España

| Campo | Valor |
|-------|-------|
| **Nombre** | Papa John's España (PJ España Pizzerías S.L.U.) |
| **Web** | https://www.papajohns.es |
| **Tipo** | PDF_TABLE |
| **URL nutricional** | `https://cdn.new.papajohns.es/Alergenos+Espa%C3%B1a/Inf_NutricionalEspa%C3%B1a+Ed+27.pdf` |
| **URL alérgenos** | `https://cdn.new.papajohns.es/Alergenos+Espa%C3%B1a/TablaAlergenos+ED+44.pdf` |
| **HTTP** | 200 OK ambos, application/pdf, 433KB nutri / 348KB alérgenos |
| **Campos** | Energía (kJ/kcal), grasas, saturadas, carbohidratos, azúcares, proteínas, sal, sodio — **9 campos** |
| **Ingredientes** | ❌ No |
| **Alérgenos** | ✅ PDF separado (incluye columnas vegetariano/vegano) |
| **Formato** | Por 100g |
| **Idioma** | Español |
| **Platos** | ~150+ entries en 4 páginas. Pizzas × tamaño (Mediana/Familiar/XXL) × masa (Original/Fina/Borde mozzarella/cheddar) + entrantes (~18) + postres (4) + menú infantil (4) + menú individual (4) |
| **Edición** | ED52 — 17 marzo 2026 |
| **Notas** | CDN estable. Valores orientativos. Web es SPA pero PDFs directos. |

---

### 3. Pizza Hut España

| Campo | Valor |
|-------|-------|
| **Nombre** | Pizza Hut España |
| **Web** | https://www.pizzahut.es |
| **Tipo** | PDF_TABLE |
| **URL nutricional** | `https://s4d-mth-prd-01-ph-es-ecom-cms-cdne.azureedge.net/ecom-cms/assets/nutricion_ph26_89a1ae2af8.pdf` |
| **URL alérgenos** | `https://s4d-mth-prd-01-ph-es-ecom-cms-cdne.azureedge.net/ecom-cms/assets/alergenos_ph26_3e8b6a84eb.pdf` |
| **HTTP** | 200 OK ambos |
| **Campos** | Calorías y macros completos (pendiente verificar campos exactos del PDF) |
| **Ingredientes** | Probable (documento de alérgenos suele incluir referencias a ingredientes) |
| **Alérgenos** | ✅ PDF separado |
| **Formato** | TBD |
| **Idioma** | Español |
| **Platos** | ~80-100 (pizzas con múltiples combinaciones base/tamaño + sides + postres + bebidas) |
| **Edición** | ph26 (revisión 2026) |
| **Notas** | Azure CDN. También tiene páginas /info/alimentos-sin-gluten, /info/calidad-alimentaria, /info/masa. URL anterior: `pizzahut.es/media/docs/nutricionph_feb.pdf` |

---

### 4. Starbucks España

| Campo | Valor |
|-------|-------|
| **Nombre** | Starbucks Coffee España |
| **Web** | https://www.starbucks.es |
| **Tipo** | PDF_TABLE |
| **URL nutricional (food)** | `https://www.starbucks.es/sites/starbucks-es-pwa/files/2025-03/250306%20FOOD%20Info%20nutricional%20x%20100g%20%20Spring%20-ESP%20V1.pdf` |
| **Página nutrición** | https://www.starbucks.es/informacion-nutricional |
| **HTTP** | 200 OK |
| **Campos** | kJ, kcal, grasas, saturadas, carbohidratos, azúcares, proteínas, sal — **8 campos** |
| **Ingredientes** | ❌ No |
| **Alérgenos** | ✅ En alergenos.grupovips.com (sistema separado) |
| **Formato** | Por 100g (food) / Por 100ml (bebidas) |
| **Idioma** | Español |
| **Platos** | ~100+ food items (6 páginas) + PDF separado de bebidas |
| **Edición** | Spring 2025 V1 |
| **Notas** | Actualizado por temporada (Spring/Summer). Gestionado por Grupo VIPS. |

---

### 5. Tim Hortons España

| Campo | Valor |
|-------|-------|
| **Nombre** | Tim Hortons España (RB Iberia) |
| **Web** | https://tim-hortons.es |
| **Tipo** | PDF_TABLE |
| **URL nutricional** | `https://www.tim-hortons.es/docs/Nutricionales.TH.ES.pdf` |
| **HTTP** | 200 OK |
| **Campos** | Energía, grasas, carbohidratos, azúcar, fibra, proteínas, sodio |
| **Ingredientes** | ❌ No |
| **Alérgenos** | TBD |
| **Formato** | TBD (7 páginas) |
| **Idioma** | Español |
| **Platos** | ~50-70 (café, bebidas especiales, bollería, smoothies) |
| **Edición** | Oct 2025 |
| **Notas** | Grupo Restaurant Brands Iberia (mismo que BK/Popeyes ES). Leche semidesnatada por defecto. |

---

### 6. Taco Bell España

| Campo | Valor |
|-------|-------|
| **Nombre** | Taco Bell España |
| **Web** | https://tacobell.es |
| **Tipo** | WEB_TABLE (SPA JavaScript) |
| **URL** | `https://tacobell.es/es/informacion-nutricional` |
| **HTTP** | 200 OK pero requiere JS para renderizar contenido |
| **Campos** | Campos estándar EU (kcal, grasa, sat, carbs, azúcares, prot, sal) |
| **Ingredientes** | ❌ No |
| **Alérgenos** | ❌ No separado |
| **Formato** | TBD |
| **Idioma** | Español (también catalán en /ca/) |
| **Platos** | ~50-70 |
| **Notas** | **Toda la web es SPA** — devuelve "Necesitas activar JavaScript". Requiere Playwright. URL `.../nutricional.pdf` es engañosa (devuelve HTML). Probablemente carga datos desde API interna. |

---

### 7. UDON Noodle Bar

| Campo | Valor |
|-------|-------|
| **Nombre** | UDON Noodle Bar & Restaurant |
| **Web** | https://www.udon.es |
| **Tipo** | PDF_TABLE (formato especial) |
| **URL** | `https://www.udon.es/press/files/Carta_nutricional_2014__CAST.pdf` |
| **HTTP** | 200 OK |
| **Campos** | kcal (%CDR), lípidos (%CDR), proteínas (%CDR), carbohidratos (%CDR) — **4 campos en %** |
| **Ingredientes** | ❌ No |
| **Formato** | %CDR (basado en CDR 2000 kcal, 55g grasa, 75g prot, 300g carbs) |
| **Idioma** | Español |
| **Platos** | ~55 (izakayas, tempuras, yakitori, gyozas, noodle rolls, ensaladas, noodles, arroces, postres) |
| **Edición** | 2014 (probablemente desactualizado) |
| **Notas** | Necesita preprocessor para convertir %CDR → gramos absolutos. Preparado por Cesnut Nutrición S.L. Sin fibra ni sal. |

---

### 8. Wok to Walk

| Campo | Valor |
|-------|-------|
| **Nombre** | Wok to Walk |
| **Web ES** | https://www.woktowalk.com/es/ |
| **Tipo** | WEB_TABLE (calculador en dominio .is) |
| **URL calculador** | `https://woktowalk.is/en/nutrition-calculator` |
| **URL alérgenos ES** | `https://www.woktowalk.com/es/alergenos/` (PDFs por localización BCN/MAD/PAM) |
| **HTTP** | 200 OK |
| **Campos** | kcal, carbohidratos, proteínas, fibra, grasas — **5 campos** |
| **Ingredientes** | ❌ No |
| **Formato** | Por ingrediente individual (build-your-own) |
| **Idioma** | Inglés (calculador), Español (alérgenos) |
| **Platos** | ~30+ ingredientes en 5 categorías (base, proteína, verduras, salsa, toppings) |
| **Notas** | Calculador en dominio Islandia. Datos globales estandarizados. Necesitaría lógica de combinación. |

---

## FICHAS DETALLADAS — CADENAS CON INGREDIENTES RELEVANTES PARA L2

---

### 100 Montaditos (Grupo Restalia)

| Campo | Valor |
|-------|-------|
| **Web** | https://spain.100montaditos.com |
| **URL** | `https://spain.100montaditos.com/assets/web/docs/MLS.Al%C3%A9rgenos.JULIO-2025.pdf` |
| **Tipo ingredientes** | TABLA DE ALÉRGENOS POR INGREDIENTE — lista individual de cada componente con alérgenos |
| **Ejemplo** | "Aceites", "Aceitunas de la abuela", "Alitas de pollo", "Bacon", "Carne hamburguesa", "Carrillera", "Pan 100M", "Pan brioche", "Pan chapata cristal", "Salsa César", "Ensaladilla rusa" |
| **Pesos** | Algunos ingredientes incluyen peso |
| **L2 viable** | MODERADO-ALTO — si se cruza con composición del menú (qué ingredientes lleva cada montadito) y se mapea cada ingrediente a USDA |
| **Platos** | ~100 montaditos + ~30 otros (ensaladas, aperitivos, raciones, menus, hot dogs, hamburguesas, postres, bebidas) |
| **Comparte PDF con** | La Sureña (páginas 4-6 y 15-17 del mismo PDF) |

---

### The Good Burger / TGB (Grupo Restalia)

| Campo | Valor |
|-------|-------|
| **Web** | https://disfruta.thegoodburger.com |
| **URL** | `https://disfruta.thegoodburger.com/wp-content/uploads/2024/05/TGB-Alergenos.-MAYO-2024.pdf` |
| **Tipo ingredientes** | Mismo formato Restalia: TABLA DE ALÉRGENOS POR INGREDIENTE |
| **Ejemplo** | "Carne hamburguesa (120g./140g.)", "Pan hamburguesa TGB", "Pan hamburguesa TGB vegano", "Pan perrito", "Queso mezcla cheddar Monterrey Jack", "Pulled pork", "Salsa César" |
| **Pesos** | ✅ Algunos con peso ("120g./140g.") |
| **L2 viable** | MODERADO-ALTO — ingredientes específicos con pesos. Si se conoce composición de cada hamburguesa, estimación factible |
| **Platos** | ~40 |

---

### Muerde la Pasta

| Campo | Valor |
|-------|-------|
| **Web** | https://muerdelapasta.com |
| **URL** | `https://muerdelapasta.com/wp-content/uploads/2025/12/Listado-Productos-Alergenos-122025-1.pdf` |
| **Tipo ingredientes** | Alérgenos por ingrediente individual de buffet. Columna IT + columna ES |
| **Ejemplo** | "CUBETTI DI FORMAGGIO" = "MOZZARELLA, GOUDA, CHEDDAR"; "INSALATA MISTA" = "ESCAROLA, RADICCHIO, LOLLO ROSSO, BROTES DE ESPINACA"; "PASTA COLORATA" = "PASTA DE COLORES" |
| **L2 viable** | MODERADO — útil porque sabes qué es cada ítem del buffet, pero sin porciones (libre servicio) |
| **Platos** | ~150 recetas en 24 páginas |

---

### Grosso Napoletano

| Campo | Valor |
|-------|-------|
| **Web** | https://grossonapoletano.com |
| **URL** | `https://grossonapoletano.com/cartas/alergenos/grosso-napoletano.pdf` |
| **URL sin gluten** | `https://grossonapoletano.com/cartas/alergenos/senza-glutine.pdf` |
| **Tipo ingredientes** | Sección "INGREDIENTES" lista toppings individuales con alérgenos |
| **Ejemplo** | "Salsa Tomate", "Prosciutto Cotto", "Salame Picante", "Mozzarella Fior di latte", "Gorgonzola", "Ricotta", "Guanciale" |
| **L2 viable** | MODERADO — conoces los toppings pero no las cantidades por pizza |
| **Platos** | Menú completo (5 páginas: antipasti, pizzas, aperitivi, ingredientes, dolci) |
| **Notas** | Locales dedicados sin gluten en Madrid, Barcelona, Sevilla |

---

### Foster's Hollywood (investigar)

| Campo | Valor |
|-------|-------|
| **Web** | https://fostershollywood.es |
| **Portal alérgenos** | https://alergenos.fostershollywood.es/ |
| **Tipo ingredientes** | POSIBLE — template variables `{{ingredientes}}`, `{{tablaingredientes}}` en el HTML sugieren datos server-side |
| **L2 viable** | DESCONOCIDO — necesita scraping con headless browser para verificar si `{{ingredientes}}` se resuelve con texto real |
| **Platos** | ~80-100 |

---

## RESUMEN EJECUTIVO

### 1. Integración inmediata (PDF_TABLE con URL funcional)

| Cadena | Platos nuevos | Campos | Ingredientes | Prioridad |
|--------|---------------|--------|-------------|-----------|
| **Five Guys ES** ⭐ | ~50 | 9 + porción y 100g | ✅ SÍ | **CRÍTICA** (re-habilitar) |
| **Popeyes ES** | ~90 | 11 (la más completa) | ❌ | Alta |
| **Papa John's ES** | ~150+ | 9 | ❌ | Alta |
| **Pizza Hut ES** | ~80-100 | Completos | Probable | Alta |
| **Starbucks ES** | ~100+ | 8 | ❌ | Alta |
| **Tim Hortons ES** | ~50-70 | 7 | ❌ | Alta |
| **Subtotal** | **~520-560** | | | |

### 2. Integración con desarrollo

| Cadena | Platos | Trabajo necesario |
|--------|--------|-------------------|
| **Taco Bell ES** | ~60 | Scraper Playwright (SPA completa) |
| **UDON** | ~55 | Preprocessor %CDR→gramos + verificar datos 2014 |
| **Wok to Walk** | ~30 ingredientes | Scraper calculador + lógica combinación |
| **Subtotal** | **~145** | |

### 3. Candidatas para estimación L2 (ingredientes sin macros)

| Cadena | Platos | Viabilidad L2 |
|--------|--------|---------------|
| **100 Montaditos** | ~130 | Alta (ingredientes individuales con pesos) |
| **The Good Burger** | ~40 | Alta (ingredientes con pesos) |
| **Muerde la Pasta** | ~150 | Media (buffet, sin porciones) |
| **Grosso Napoletano** | menú completo | Media (toppings individuales) |
| **Foster's Hollywood** | ~100 | Pendiente investigación headless |
| **Subtotal potencial** | **~420+** | |

### 4. No viable actualmente

- **17 cadenas** solo publican alérgenos sin macronutrientes ni ingredientes
- **6 cadenas** no publican absolutamente nada
- **5 cadenas** no operan en España

### 5. Cadenas USA con datos excelentes (top 6)

| Cadena | Platos | Campos | Ingredientes |
|--------|--------|--------|-------------|
| Panera Bread | ~150+ | 12 | ❌ |
| Arby's | ~80+ | 12 + ingredientes separado | ✅ |
| Whataburger | ~120+ | 11 | ❌ |
| CAVA | ~100+ | 11 | ❌ |
| Shake Shack | ~40-50 | 10 | ✅ |
| Wingstop | ~50+ | 16 (incluye micronutrientes) | ❌ |

### 6. Números totales

| Categoría | Platos estimados |
|-----------|-----------------|
| Ya onboarded en nutriXplorer | ~399 |
| Integración inmediata (España) | ~520-560 |
| Con desarrollo (España) | ~145 |
| Estimación L2 (España) | ~420+ |
| **Total potencial España** | **~1,484-1,524 platos** |
| Cadenas USA (si se integran) | ~540-600+ |
| **Total combinado máximo** | **~2,024-2,124 platos** |

### Observaciones clave

1. **Five Guys debe re-habilitarse inmediatamente** — el PDF combinado de Feb 2026 tiene nutrición completa + ingredientes + alérgenos. Es la única cadena en España con las 3 cosas.

2. **La regulación EU solo obliga a publicar alérgenos**, no macronutrientes — por eso la mayoría de cadenas españolas no publican datos nutricionales.

3. **Las cadenas americanas** (Popeyes, Papa John's, Taco Bell, Five Guys, Pizza Hut) tienden a publicar datos nutricionales por costumbre regulatoria de EEUU.

4. **Grupo Restaurant Brands Iberia** (BK, Popeyes, Tim Hortons) es el grupo con más datos nutricionales publicados en España.

5. **Grupo VIPS** (Ginos, VIPS, TGI Fridays, Starbucks) comparte infraestructura de alérgenos en `alergenos.grupovips.com` — solo Starbucks publica nutrición.

6. **Grupo Restalia** (100 Montaditos, La Sureña, TGB) tiene el formato de ingredientes individuales más útil para estimación L2.

7. **Las cadenas healthy** (Honest Greens, Flax & Kale, GreenVita) paradójicamente no publican datos nutricionales.

8. **Patrón Glovo:** Muchas cadenas tienen PDFs de alérgenos en `glovo-allergy-info-prod.s3.eu-west-1.amazonaws.com` — útil para descubrir más cadenas.
