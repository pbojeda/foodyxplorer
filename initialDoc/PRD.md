# [Nombre por definir] — Product Requirements Document (PRD)
**Versión:** 1.0  
**Fecha:** Marzo 2026  
**Estado:** Borrador  
**Autor:** Fundador

> **Nota sobre este documento:** A lo largo del PRD se usa el nombre provisional **NutriTrack** como placeholder. El nombre definitivo del producto está pendiente de definición junto con el branding completo. Igualmente, el modelo de negocio, la arquitectura técnica y el modelo de datos son decisiones iniciales sujetas a revisión durante la fase de planificación detallada.

### Pendiente de definir
- [ ] Nombre definitivo del producto
- [ ] Branding (identidad visual, logotipo, paleta, tipografía, tono de voz)
- [ ] Plan de marketing
- [ ] Modelo de negocio (estructura freemium, precios, modelo open source/open core)
- [ ] Validación final de arquitectura técnica (puede cambiar en fase de planificación)
- [ ] Validación final de modelo de datos (puede cambiar en fase de planificación)

---

## Índice

1. [Visión y problema que resuelve](#1-visión-y-problema-que-resuelve)
2. [Contexto de mercado](#2-contexto-de-mercado)
3. [Usuarios objetivo](#3-usuarios-objetivo)
4. [Casos de uso y escenarios](#4-casos-de-uso-y-escenarios)
5. [Funcionalidades por fase](#5-funcionalidades-por-fase)
6. [Fuera de scope](#6-fuera-de-scope)
7. [Motor de estimación nutricional](#7-motor-de-estimación-nutricional)
8. [Modelo de datos — propuesta inicial](#8-modelo-de-datos--propuesta-inicial)
9. [Arquitectura técnica — propuesta inicial](#9-arquitectura-técnica--propuesta-inicial)
10. [Modelo de negocio](#10-modelo-de-negocio)
11. [Criterios de éxito por fase](#11-criterios-de-éxito-por-fase)
12. [Decisiones técnicas clave — propuesta inicial](#12-decisiones-técnicas-clave--propuesta-inicial)
13. [Riesgos identificados](#13-riesgos-identificados)
14. [Principios de diseño del producto](#14-principios-de-diseño-del-producto)
15. [Branding — pendiente de definición](#15-branding--pendiente-de-definición)
16. [Plan de marketing — pendiente de definición](#16-plan-de-marketing--pendiente-de-definición)

---

## 1. Visión y problema que resuelve

### Visión

El producto *(nombre provisional: NutriTrack)* será la plataforma open source de referencia para conocer la información nutricional de cualquier plato, en cualquier restaurante, en cualquier contexto — desde una consulta rápida sobre un plato casero hasta la carta completa de un restaurante concreto con sus valores verificados.

### El problema

Las personas que cuidan su alimentación se enfrentan a un problema sin resolver cuando comen fuera de casa: **no existe ninguna fuente centralizada, fiable y accesible que les diga qué están comiendo en un restaurante real**.

Las apps de nutrición actuales (MyFitnessPal, FatSecret, Fitia) están diseñadas para el tracking en casa. Cuando el usuario sale a comer, la cobertura de restaurantes es parcial, los datos son no verificados o directamente inexistentes para el mercado español. Un audit publicado en el Journal of the Academy of Nutrition and Dietetics (2023) encontró que el 41% de las recetas más buscadas en MyFitnessPal tenían errores superiores al ±25% en calorías o proteínas.

Las apps de restaurantes (TheFork, TripAdvisor) ofrecen reseñas y reservas, pero ninguna información nutricional.

El resultado: **el usuario que come fuera está ciego nutricionalmente**, independientemente de cuánto cuide su dieta en casa.

### La solución

Una plataforma híbrida que combina:

- **Base de datos nutricional verificada** de restaurantes y cadenas, construida de forma progresiva con datos oficiales donde existen y con estimaciones documentadas y transparentes donde no.
- **Motor de estimación inteligente** de tres niveles que cubre cualquier plato, aunque no esté en la base de datos, con nivel de confianza explícito siempre visible.
- **Interfaces accesibles** — bot de Telegram, web con mapa, app móvil — que hacen la información disponible en el momento de la decisión.
- **Modelo colaborativo** similar a Open Food Facts, donde los restaurantes gestionan sus propios datos y la comunidad contribuye a mejorar la base de datos.
- **API pública** que permite a otros desarrolladores construir sobre esta infraestructura.

### Posicionamiento

> [Nombre del producto] es para restaurantes lo que Open Food Facts es para productos envasados: la base de datos abierta, colaborativa y verificada de referencia.

*El posicionamiento está definido. El nombre y el branding que lo sustenten están pendientes de definición.*

---

## 2. Contexto de mercado

### Tamaño de mercado

- El mercado global de apps de dieta y nutrición proyecta **6.060 millones de dólares en 2025**, con crecimiento anual del 10,79% hasta 2030.
- El mercado español de nutrición y dietética supera los **6.600 millones de euros en 2025**, con CAGR del 9,9%.
- Las descargas de apps de nutrición crecieron un **34% en 2024**.

### Hueco de mercado identificado

No existe actualmente ningún producto que cubra la intersección de:

- Datos nutricionales verificados de restaurantes españoles
- Motor de estimación cuando no hay datos oficiales
- Mapa de restaurantes con filtros nutricionales
- Modelo open source con API pública
- Posibilidad de que los restaurantes gestionen sus propios datos

Este hueco coincide tanto en el espacio comercial como en el open source: ningún proyecto open source existente (wger, PANTS, Open Food Facts, Grocy) cubre esta combinación.

### Competidores principales

| Competidor | Fortaleza | Debilidad crítica para nuestro mercado |
|---|---|---|
| **MyFitnessPal** | BD más grande (20M+ alimentos), comunidad | 41% de errores en datos de recetas; cobertura de restaurantes españoles muy parcial; datos no verificados |
| **Nutritionix** | 800K items de restaurantes verificados, 25K restaurantes gestionan sus datos | Foco exclusivo en EEUU; no disponible en español; sin app de usuario final con mapa |
| **FatSecret** | 2.3M alimentos verificados, API robusta | Cobertura de restaurantes españoles mínima |
| **Fitia** | Mejor app para hispanohablantes, datos verificados para España/LATAM | Sin información de restaurantes concretos; solo tracking personal |
| **MyRealFood** | App española con comunidad activa, detecta ultraprocesados | Sin información de restaurantes; foco en productos envasados |
| **TheFork / TripAdvisor** | Descubrimiento de restaurantes, reservas | Cero información nutricional |

### Referente estratégico

**Nutritionix** valida el modelo B2B antes de construirlo: 25.000 localizaciones de restaurantes ya pagan por gestionar y publicar sus datos. El modelo funciona en EEUU. España es territorio libre.

**Open Food Facts** valida el modelo colaborativo: 25.000 contribuidores han construido una BD de 4 millones de productos en 150 países con datos abiertos y API pública. Es el modelo a replicar para restaurantes.

---

## 3. Usuarios objetivo

### Segmento primario — Usuario final

**Perfil:** Persona de 25-45 años, urbana, con conciencia nutricional activa. Come fuera de casa con frecuencia (trabajo, ocio, viajes). Tiene un objetivo nutricional concreto (perder peso, ganar músculo, controlar glucemia, seguir una dieta específica) o una restricción dietética (celiaquía, intolerancia a la lactosa, diabetes, hipertensión).

**Pain points principales:**
- No sabe qué está comiendo cuando sale a un restaurante
- Las apps que usa para tracking en casa no tienen datos de restaurantes locales
- Tiene que buscar en múltiples webs fragmentadas (cuando existen)
- No puede comparar opciones antes de decidir dónde comer
- Las personas con patologías (diabetes, hipertensión) asumen riesgos por falta de información

**Jobs to be done:**
- "Quiero saber cuántas calorías tiene este plato antes de pedirlo"
- "Quiero encontrar restaurantes cercanos donde pueda comer sin gluten"
- "Quiero registrar lo que he comido hoy aunque haya sido en un restaurante"
- "Quiero decidir entre dos restaurantes eligiendo el más saludable"

### Segmento secundario — Restaurante / Cadena

**Perfil A — Cadena nacional o internacional** con más de 20 locales. Tiene o quiere tener información nutricional publicada. Necesita herramientas para gestionar esa información de forma centralizada y publicarla.

**Perfil B — Restaurante mediano independiente** con 1-5 locales. No tiene información nutricional publicada. Puede conocer sus ingredientes pero no los valores calculados. Motivación: diferenciación, cumplimiento de tendencias de transparencia, captación de clientes con necesidades especiales.

**Pain points:**
- Sin herramienta accesible para calcular y publicar info nutricional
- La regulación europea de alérgenos (EU 1169/2011) ya obliga a informar; la nutricional es el siguiente paso
- Los competidores que publican la información captan más clientes con necesidades especiales

### Segmento terciario — Desarrollador

**Perfil:** Desarrollador o empresa que construye apps de fitness, salud, delivery, o restauración y necesita datos nutricionales de restaurantes españoles sin construir la infraestructura desde cero.

**Jobs to be done:**
- Integrar datos de restaurantes españoles en su app de fitness
- Mostrar información nutricional en una app de delivery
- Construir funcionalidades de tracking nutricional sin mantener una BD propia

---

## 4. Casos de uso y escenarios

### CU-01 — Consulta genérica de alimento simple
**Actor:** Usuario final  
**Descripción:** El usuario quiere conocer los valores nutricionales de un alimento o plato genérico sin especificar restaurante ni gramaje exacto.  
**Ejemplo:** "¿Cuántas calorías tiene un plato de lentejas?"  
**Respuesta esperada:** Valores por ración estándar (estimada desde tablas FEN/USDA), con indicación de que es una ración estándar y nivel de confianza ALTO para los nutrientes base.

### CU-02 — Consulta con ingredientes y gramajes detallados
**Actor:** Usuario final  
**Descripción:** El usuario especifica los ingredientes exactos y sus cantidades.  
**Ejemplo:** "150g de lentejas cocidas, 20g de chorizo, 100g de zanahoria, 10ml de aceite de oliva"  
**Respuesta esperada:** Cálculo nutricional preciso por ingrediente con suma total. Nivel de confianza ALTO. Desglose visible por ingrediente.

### CU-03 — Fotografía de un plato
**Actor:** Usuario final  
**Descripción:** El usuario fotografía un plato (en casa, en restaurante sin datos, en un menú físico) y solicita el análisis nutricional.  
**Respuesta esperada:** IA identifica componentes visibles del plato, estima gramajes, calcula valores nutricionales. Nivel de confianza MEDIO-BAJO con posibilidad de ajuste manual por el usuario.

### CU-04 — Consulta de plato en restaurante concreto
**Actor:** Usuario final  
**Descripción:** El usuario pregunta por un plato específico de un restaurante o cadena específica.  
**Ejemplo:** "Valores nutricionales de una Big Mac de McDonald's"  
**Respuesta esperada:** Datos oficiales publicados por la cadena con nivel de confianza ALTO y fuente citada. Si no existen datos oficiales, estimación con nivel indicado.

### CU-05 — Exploración de carta con mapa
**Actor:** Usuario final  
**Descripción:** El usuario abre el mapa, localiza un restaurante cercano y quiere ver la carta completa con valores nutricionales para decidir qué pedir o si ir.  
**Respuesta esperada:** Carta completa del restaurante con filtros por calorías, macronutrientes, alérgenos. Indicación clara del nivel de confianza de cada plato (oficial / estimado / extrapolado).

### CU-06 — Filtrado por restricción dietética
**Actor:** Usuario final con patología o preferencia  
**Descripción:** El usuario aplica un filtro ("sin gluten", "menos de 500 kcal", "apto para diabéticos") y quiere ver restaurantes o platos que cumplan el criterio.  
**Respuesta esperada:** Lista de restaurantes en mapa y listado con platos que cumplen el filtro, con nivel de confianza del dato que sustenta el filtro.

### CU-07 — Comparación cross-restaurante
**Actor:** Usuario final  
**Descripción:** El usuario quiere comparar la oferta nutricional de dos o más restaurantes antes de decidir dónde comer.  
**Ejemplo:** "¿Dónde como más sano cerca de aquí?"  
**Respuesta esperada:** Comparativa de opciones disponibles en restaurantes cercanos con filtros y ranking por criterio nutricional elegido.

### CU-08 — Gestión de carta por restaurante
**Actor:** Propietario de restaurante  
**Descripción:** El restaurante sube o actualiza su carta, introduce ingredientes y gramajes por plato, y el sistema calcula automáticamente los valores nutricionales para su publicación.  
**Resultado:** Datos verificados por el restaurante, marcados con sello "datos oficiales del restaurante".

### CU-09 — Consumo de API por desarrollador
**Actor:** Desarrollador externo  
**Descripción:** Un desarrollador llama a la API con una query ("Big Mac", "restaurante_id=X", "plato_id=Y") y recibe los datos nutricionales en JSON con nivel de confianza y metadatos de fuente.  
**Resultado:** Respuesta estructurada lista para integrar en cualquier app.

### CU-10 — Escaneo de menú físico en papel
**Actor:** Usuario final  
**Descripción:** El usuario está en un restaurante sin presencia digital y fotografía la carta impresa.  
**Respuesta esperada:** IA extrae nombres de platos de la imagen, busca en BD o estima valores para cada plato identificado.

### CU-11 — Registro de ingesta diaria acumulada
**Actor:** Usuario final con cuenta  
**Descripción:** El usuario registra todas las comidas del día (en casa, en restaurante, consultadas por foto) y ve el acumulado nutricional del día frente a sus objetivos.

---

## 5. Funcionalidades por fase

### Fase 1 — MVP funcional: Bot de Telegram + API + BD inicial *(semanas 1-6)*

**Objetivo:** Primer producto real con usuarios reales. Esta es la fase de arranque del proyecto — no hay fase de validación previa con GPT personalizado. Se construye directamente la infraestructura base que todo lo demás consumirá.

> **Decisión:** Se descarta una fase 0 de validación con GPT personalizado de ChatGPT. Se empieza directamente construyendo infraestructura propia, que es la base real del producto.

#### 1A — Infraestructura de datos (semanas 1-3)
- Ingesta de alimentos base: FEN (España), USDA FoodData Central, BEDCA
- Scraping inicial de cadenas con datos publicados: McDonald's, Burger King, KFC, Telepizza, Domino's, Subway, Five Guys (España)
- Scraping de Fankal.com (listado de marcas y restaurantes con datos nutricionales en España)
- Pipeline de normalización: unificar unidades, tamaño de porción estándar, esquema común
- BD PostgreSQL con esquema completo desde el día 1 (ver sección 8)
- Raciones estándar por tipo de alimento (fuente: USDA/FEN) como tabla base

#### 1B — Motor de estimación (semanas 2-4)
- **Nivel 1:** Dato oficial — retorna directamente desde BD con confianza ALTA
- **Nivel 2:** Estimación por ingredientes — descomposición, gramajes desde tabla estándar o LLM para edge cases, factores de cocción por método (fase global: frito/hervido/horneado/crudo)
- **Nivel 3:** Extrapolación por similitud — embeddings con pgvector, filtro por categoría, validación por perfil nutricional
- LLM como capa de interpretación de lenguaje natural → query estructurada → motor → respuesta formateada
- Caché Redis para respuestas LLM idénticas (reducción de coste de tokens)

#### 1C — API Fastify (semanas 3-4)
- `GET /search` — búsqueda de platos/alimentos por texto libre
- `GET /calculate` — cálculo nutricional con ingredientes y gramajes
- `GET /restaurants/:id/dishes` — carta completa de un restaurante
- `GET /dishes/:id/nutrients` — valores nutricionales de un plato concreto
- Rate limiting por IP (Redis)
- Documentación OpenAPI autogenerada

#### 1D — Bot de Telegram (semanas 4-5)
- Interpreta mensajes de texto libre → llama a la API
- Responde con valores nutricionales formateados + nivel de confianza
- Cubre CU-01, CU-02, CU-04
- Sin autenticación en esta fase; sin registro de usuario

#### 1E — Monitorización y calidad (semana 6)
- Logging de queries para identificar patrones de uso reales
- Dashboard interno de calidad de datos (cobertura por cadena, distribución de niveles de confianza)
- Proceso manual de revisión de estimaciones con confianza BAJA más consultadas

**Criterio de salida Fase 1:** 100 usuarios activos en el bot de Telegram. Cobertura verificada de las 10 cadenas más consultadas en España. Tiempo de respuesta < 3 segundos en el 95% de las consultas.

---

### Fase 2 — Aplicación web *(meses 3-5)*

**Objetivo:** Interfaz completa con mapa, búsqueda avanzada y primeras cuentas de usuario.

#### 2A — Web promocional y de producto

Antes del lanzamiento de la aplicación web completa se construirá una web de presentación del producto que incluye:

- Landing page de presentación del producto (propuesta de valor, capturas, roadmap público)
- Formulario de suscripción a newsletter (lista de espera / early access)
- Página de contacto
- Blog / changelog público
- Política de privacidad
- Términos y condiciones de uso
- Política de cookies + banner de consentimiento (RGPD)
- Página para restaurantes interesados en colaborar

> Esta web es independiente de la aplicación. Se puede construir con un generador estático (Astro, Next.js, o similar) y lanzarse antes de que la app esté terminada para comenzar a captar lista de espera.

#### 2B — Web Next.js (aplicación)
- Búsqueda de platos y alimentos con resultados enriquecidos
- Página de restaurante con carta completa y valores nutricionales
- Página de plato con desglose nutricional completo, fuente y nivel de confianza
- SEO optimizado — páginas de platos indexables por Google (activo de tráfico orgánico a largo plazo)

#### 2C — Mapa de restaurantes
- Mapa interactivo (Mapbox o Google Maps) con restaurantes de la BD
- Filtros por tipo de cocina, nivel de confianza de datos, restricciones dietéticas
- Vista de carta al hacer clic en un restaurante
- Cubre CU-05, CU-06, CU-07

#### 2D — Cuentas de usuario (básico)
- Registro/login (email + OAuth Google/Apple)
- Historial de consultas
- Guardado de platos y restaurantes favoritos

#### 2E — Reconocimiento por foto (básico)
- Upload de foto de plato → análisis con Vision API (GPT-4V o similar)
- Estimación nutricional del plato fotografiado
- Cubre CU-03 (versión básica)

#### 2F — Portal de restaurantes (beta privada)
- Formulario para que restaurantes soliciten reclamar/crear su perfil
- Panel básico para introducir carta e ingredientes
- Sistema de verificación manual del equipo
- Primeros datos "verificados por restaurante"

#### 2G — API pública v1 (acceso externo)
- API keys por usuario/desarrollador
- Plans: free (100 req/día), pro (10K req/día), business (ilimitado)
- Documentación pública completa
- Cubre CU-09

**Criterio de salida Fase 2:** 1.000 usuarios registrados. 50 restaurantes con datos verificados. 10 desarrolladores usando la API. Posición en top 3 de Google para "valores nutricionales [cadena española]".

---

### Fase 3 — Aplicación móvil *(meses 6-9)*

**Objetivo:** Presencia móvil nativa con capacidades de cámara avanzadas.

#### 3A — App React Native (iOS + Android)
- Mismas funcionalidades que la web adaptadas a móvil
- Mapa nativo con GPS para restaurantes cercanos
- Integración con Apple Health y Google Fit

#### 3B — Reconocimiento por foto avanzado (móvil)
- Cámara integrada en la app para fotografiar platos
- Escaneo de menú físico en papel (extrae platos, estima valores)
- Cubre CU-03 y CU-10 completos

#### 3C — Tracking de ingesta diaria
- Log diario de comidas con acumulado nutricional
- Objetivos personalizados (calorías, macros)
- Historial y tendencias semanales
- Cubre CU-11

#### 3D — Notificaciones y contexto
- Sugerencias proactivas según ubicación ("estás cerca de X, tiene opciones sin gluten")
- Alertas de alérgenos si el usuario los tiene configurados

#### 3E — Panel de restaurante (móvil)
- App de gestión para propietarios de restaurantes
- Actualización rápida de carta y valores desde el móvil

**Criterio de salida Fase 3:** 10.000 usuarios activos mensuales. 200 restaurantes con datos verificados. App store rating ≥ 4.2.

---

### Fase 4 — Escala y ecosistema *(mes 10 en adelante)*

- Widget embebible para webs de restaurantes
- Integraciones con apps de delivery (API)
- Programa de partners con cadenas nacionales
- Crowdsourcing avanzado con sistema de reputación de contribuidores
- Certificación de datos (sello NutriTrack Verified)
- Dashboard analytics para restaurantes (qué platos consultan más sus clientes, qué filtros aplican)

---

## 6. Fuera de scope

Las siguientes funcionalidades quedan explícitamente fuera del alcance del producto en sus fases iniciales para mantener el foco en el MVP:

- **Planes de dieta personalizados y coaching nutricional** — fuera de scope hasta Fase 3+. No es un sustituto de un nutricionista.
- **Recetas de cocina** — el foco es restaurantes y alimentos, no guías de cocina.
- **Tracking de ejercicio físico** — no es una app de fitness general. Solo nutrición.
- **E-commerce / pedidos de comida** — no competimos con Glovo, Just Eat ni delivery.
- **Reservas en restaurantes** — no competimos con TheFork.
- **Información nutricional de productos envasados (barcode)** — Open Food Facts ya lo resuelve bien. Integración por API, no construcción propia.
- **Asesoramiento médico** — el producto siempre incluirá el disclaimer de que no es un sustituto de atención médica profesional.
- **Gamificación y retos sociales** — fuera de scope en fases iniciales.
- **Mercados fuera de España en Fase 1** — el foco inicial es España. La expansión a LATAM y otros mercados hispanohablantes es Fase 4+.
- **Aplicación de escritorio** — web y móvil son suficientes.

---

## 7. Motor de estimación nutricional

El motor es el componente central del producto. El LLM no calcula — el motor calcula. El LLM interpreta la consulta del usuario y presenta el resultado.

### Nivel 1 — Dato oficial (confianza: ALTA)

El dato existe en la BD procedente de fuente oficial (web del restaurante, publicación verificada). Se retorna directamente sin transformación. El único procesamiento es la normalización al ingestar (unificar unidades, tamaño de porción estándar).

### Nivel 2 — Estimación por ingredientes (confianza: MEDIA)

Se aplica cuando el restaurante tiene platos con ingredientes listados pero sin valores nutricionales calculados.

**Proceso:**
1. Identificar ingredientes del plato
2. Obtener gramaje de cada ingrediente: tabla de raciones estándar (fuente USDA/FEN) como base; LLM solo para edge cases no cubiertos por la tabla
3. Obtener valores nutricionales por 100g de cada ingrediente desde `food_nutrients`
4. Aplicar factor de cocción global por método del plato (frito × 1.15, hervido × 0.97, horneado × 1.05, crudo × 1.0) — refinable a nivel de ingrediente en v2
5. Calcular suma: `Σ (nutriente_por_100g × gramos / 100 × cooking_factor)`

### Nivel 3 — Extrapolación por similitud (confianza: BAJA)

Se aplica cuando solo existe el nombre del plato sin ingredientes ni valores publicados.

**Proceso:**
1. Generar embedding del nombre del plato
2. Filtrar por categoría de plato (`dish_categories`) para acotar el espacio de búsqueda a platos nutricionalmente comparables
3. Buscar los N platos más similares dentro de esa categoría usando `pgvector` (similitud coseno)
4. Validar coherencia: verificar que el perfil nutricional de los platos seleccionados tiene sentido para el tipo de plato
5. Ponderar valores por similitud coseno y calcular media ponderada
6. Ajustar por tipo de restaurante si es relevante (fast food vs. restaurante de carta)

### Reglas generales del motor
- El nivel de confianza siempre es visible para el usuario — nunca se oculta
- La fuente del dato siempre es trazable y auditable en la BD
- Un mismo plato puede tener actualizaciones del dato: el histórico se conserva en `nutrient_change_log`
- Los valores se almacenan siempre por 100g y se presentan por porción (con la porción visible)

---

## 8. Modelo de datos — propuesta inicial

> ⚠️ **Propuesta inicial sujeta a revisión.** El esquema descrito a continuación es el resultado del análisis realizado durante la elaboración del PRD y está bien razonado, pero se considera una decisión inicial que podrá ajustarse durante la fase de planificación técnica detallada. El esquema completo con diagramas Mermaid está documentado en `nutritrack-db-diagram.md`.

### Bloques del esquema

| Bloque | Tablas principales | Propósito |
|---|---|---|
| Fuentes | `data_sources` | Trazabilidad de todo dato — origen, tipo, URL, fecha |
| Alimentos base | `foods`, `food_nutrients`, `standard_portions` | Ingredientes individuales con valores por 100g y raciones estándar |
| Cocción | `cooking_methods`, `food_cooking_factors` | Factores de corrección por método de cocción (global en v1, por ingrediente en v2) |
| Taxonomía | `dish_categories` | Jerarquía de categorías de platos con embeddings para el Nivel 3 |
| Restaurantes | `restaurant_chains`, `restaurants` | Cadenas y locales con geolocalización y metadata |
| Platos | `dishes`, `dish_nutrients`, `dish_ingredients` | Platos con valores, ingredientes, nivel de confianza y método de estimación |
| Usuarios | `users`, `restaurant_owners`, `nutrient_change_log` | Cuentas, gestión de restaurantes y auditoría completa de cambios |
| Caché/Analytics | `query_log` | Registro de consultas para alimentar Redis y detectar patrones |

### Decisiones de diseño clave

- **Los valores nutricionales se almacenan siempre por 100g** — la conversión a porción se hace en la capa de presentación
- **Nivel de confianza y método de estimación son campos obligatorios** en `dish_nutrients` — nunca un dato sin esta metadata
- **pgvector integrado en PostgreSQL** para búsqueda semántica del Nivel 3 — sin vector store separado
- **JSONB para micronutrientes** (`extra`) — flexibilidad para vitaminas y minerales sin alterar el schema principal
- **Auto-referencia en `dish_categories`** para jerarquía (pasta > pasta/carbonara > pasta/carbonara/italiana)
- **Relación polimórfica en `restaurant_owners`** mediante dos FK opcionales (`chain_id`, `restaurant_id`) con validación en capa de aplicación
- **`nutrient_change_log`** como tabla de auditoría completa — quién cambió qué y cuándo, con datos anteriores y nuevos en JSONB

---

## 9. Arquitectura técnica — propuesta inicial

> ⚠️ **Propuesta inicial sujeta a revisión.** El stack y las decisiones de arquitectura descritos aquí son el resultado del análisis realizado durante la elaboración del PRD. Se consideran una propuesta sólida y bien evaluada, pero podrán ajustarse durante la fase de planificación técnica detallada antes de empezar a escribir código.

### Stack tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Runtime | Node.js + TypeScript | 20+ años de experiencia del equipo; ecosistema maduro para este caso |
| API Framework | Fastify | Rendimiento, async nativo, OpenAPI spec autogenerada |
| ORM / Migraciones | Prisma | Migraciones robustas, type safety en CRUD, Prisma Studio |
| Query Builder | Kysely | Type safety completa en queries complejas, soporte nativo pgvector |
| Base de datos | PostgreSQL + pgvector + JSONB | Relacional (necesario por complejidad de relaciones), semántico (pgvector), flexible (JSONB) |
| Caché | Redis | Rate limiting de API pública + caché de respuestas LLM idénticas |
| Scraping | Crawlee + Playwright | Scraping recursivo con JS rendering para webs de restaurantes |
| LLM | OpenAI / Anthropic API | Capa de interpretación NL → query estructurada; NO calcula, interpreta |
| Bot | node-telegram-bot-api | Consume la misma API de Fastify |
| Web | Next.js | SSR para SEO (páginas de platos indexables), consume la API |
| App móvil | React Native (Fase 3) | Compartir lógica con web; iOS + Android en un solo codebase |
| Mapas | Mapbox o Google Maps API | Geolocalización de restaurantes |
| Infra | Docker + Railway/Render (early stage) | Sin fricción inicial; migración a AWS/GCP cuando el volumen lo justifique |

### Regla de uso Prisma vs Kysely

```
PRISMA para:
- Todas las migraciones de schema (única fuente de verdad)
- CRUD simple (create, findUnique, update, delete)
- Relaciones simples con include
- Prisma Studio para inspección de datos en desarrollo

KYSELY para:
- Cálculos nutricionales agregados (sumas con joins múltiples)
- Búsquedas semánticas con pgvector
- Queries con 3+ joins
- Full-text search en español
- Cualquier query donde se necesite SQL preciso y predecible
```

### Estrategia de caché (Redis)

```
Caché de respuestas LLM:
- Key: hash(query_normalizada)
- TTL: 24 horas
- Justificación: "valores nutricionales big mac" siempre devuelve lo mismo
- Impacto: reducción significativa de coste de tokens a escala

Rate limiting API pública:
- Por API key
- Por endpoint
- Por ventana temporal (sliding window)

NO en Fase 1:
- Caché general de queries BD (PostgreSQL con índices aguanta sin Redis)
- Sesiones de usuario (JWT stateless)
```

### Pipeline de ingesta de datos

```
Fuentes externas (webs de restaurantes, PDFs, CSVs)
  → Crawlee + Playwright (scraping recursivo)
  → Pipeline de normalización (TypeScript)
    - Unificar unidades (g, mg, kcal)
    - Estandarizar porciones
    - Detectar nivel de confianza de la fuente
    - Deduplicación
  → Validación contra rangos típicos (dish_categories.typical_calories_min/max)
  → Inserción en PostgreSQL con source_id y confidence_level
```

---

## 10. Modelo de negocio

> ⚠️ **Pendiente de definición.** Las estructuras de precios, planes y modelo open source/open core descritos a continuación son una propuesta inicial de trabajo, no decisiones cerradas. El modelo de negocio definitivo se definirá como parte de la fase de planificación, idealmente con validación de mercado antes de comprometerse con una estructura concreta.

### Hipótesis de trabajo — Modelo freemium (usuario final)

| Plan | Precio | Incluye |
|---|---|---|
| **Free** | 0€ | Consultas ilimitadas básicas, bot Telegram, web sin cuenta |
| **Pro** | ~4,99€/mes | Historial completo, tracking diario, foto de plato, sin límites |
| **Family** | ~9,99€/mes | Hasta 6 usuarios bajo una cuenta |

### Hipótesis de trabajo — API pública (desarrolladores)

| Plan | Precio | Límite |
|---|---|---|
| **Free** | 0€ | 100 req/día |
| **Starter** | ~29€/mes | 10.000 req/día |
| **Business** | ~149€/mes | Ilimitado + SLA |
| **Enterprise** | Custom | Datos privados + soporte dedicado |

### Hipótesis de trabajo — B2B restaurantes

| Servicio | Modelo | Descripción |
|---|---|---|
| **Panel de gestión** | SaaS mensual | Restaurante gestiona su carta e ingredientes; sistema calcula y publica automáticamente |
| **Widget embebible** | SaaS mensual | El restaurante pone un iframe en su web con sus datos servidos por NutriTrack |
| **Sello NutriTrack Verified** | Incluido en plan de gestión | Diferenciación visible en la plataforma y en la web del restaurante |
| **Analytics** | Add-on | Dashboard con qué platos consultan más sus clientes, qué filtros aplican |

### Estrategia de crecimiento

El objetivo de largo plazo es alcanzar una masa crítica de usuarios que haga el producto atractivo para adquisición por una empresa grande del sector (app de fitness, plataforma de delivery, cadena de restauración, empresa de salud). Los activos de valor para una adquisición son:

1. **La base de datos** — el dataset de restaurantes españoles con valores nutricionales verificados es el activo más valioso e irreplicable a corto plazo
2. **Los usuarios** — masa de usuarios con engagement demostrado (consultas por semana, retención)
3. **Los restaurantes** — número de restaurantes que gestionan activamente sus datos en la plataforma
4. **La API** — desarrolladores integrando la API como indicador de valor técnico del dataset

El modelo B2B con restaurantes no es solo una fuente de ingresos — es la estrategia para enriquecer la base de datos que es el activo central.

### Open source y monetización

El producto es open source (licencia a definir: MIT o Apache 2.0 para el código; licencia de datos separada para la BD). Esto no contradice la monetización:

- El **código** es open source (cualquiera puede instalarlo)
- La **base de datos pública** es open data (como Open Food Facts)
- La **instancia hosted** (nutritrack.app) es el producto SaaS que se monetiza
- Los **datos verificados por restaurantes** bajo contrato son privados hasta que el restaurante autoriza su publicación

---

## 11. Criterios de éxito por fase

### Fase 1 — Bot MVP
- [ ] 100 usuarios activos en Telegram (al menos 1 consulta en los últimos 7 días)
- [ ] Cobertura verificada de las 10 cadenas más consultadas en España
- [ ] Tiempo de respuesta < 3s en el 95% de las consultas
- [ ] Coste de tokens LLM < 0,05€ por consulta en promedio (caché funcionando)
- [ ] 0 errores críticos (respuesta incorrecta con confianza ALTA) en consultas monitorizadas

### Fase 2 — Web
- [ ] Web promocional publicada antes del lanzamiento de la app con suscripción a newsletter activa
- [ ] Lista de espera con al menos 500 suscriptores antes del lanzamiento de la app
- [ ] 1.000 usuarios registrados en la app
- [ ] 50 restaurantes con datos verificados (al menos 5 no cadenas nacionales)
- [ ] 10 desarrolladores con API key activa
- [ ] Top 3 en Google para "valores nutricionales + [nombre de cadena española]" en al menos 5 cadenas
- [ ] NPS ≥ 40

### Fase 3 — Móvil
- [ ] 10.000 usuarios activos mensuales
- [ ] 200 restaurantes con datos verificados
- [ ] 50 desarrolladores con API key activa
- [ ] App store rating ≥ 4.2 (iOS y Android)
- [ ] Al menos 1 restaurante o cadena usando el panel B2B de pago
- [ ] Retención a 30 días ≥ 25%

---

## 12. Decisiones técnicas clave — propuesta inicial

> ⚠️ **Propuesta inicial sujeta a revisión.** Las decisiones recogidas aquí son el resultado del análisis realizado durante la elaboración del PRD. Están bien razonadas y evaluadas, pero se consideran decisiones iniciales que podrán ajustarse durante la fase de planificación técnica detallada. Cualquier cambio debe ir acompañado de justificación documentada.

Las siguientes decisiones han sido evaluadas con sus alternativas:

| Decisión | Elección | Alternativas descartadas |
|---|---|---|
| Runtime | Node.js + TypeScript | Python (descartado por experiencia del equipo) |
| Base de datos principal | PostgreSQL + pgvector | MongoDB (descartado: relaciones complejas requieren SQL; flexibilidad cubierta con JSONB) |
| ORM | Prisma (migraciones + CRUD) + Kysely (queries complejas) | Solo Prisma (pgvector limitado), Solo Kysely (migraciones menos robustas), SQL puro (sin migraciones gestionadas) |
| Caché | Redis | Sin caché (coste de tokens inasumible a escala) |
| Scraping | Crawlee + Playwright | Scrapy/Python (descartado por stack Node) |
| API Framework | Fastify | Express (menor rendimiento), NestJS (overhead excesivo para MVP) |
| Motor de estimación | 3 niveles propios + LLM solo como interfaz | LLM como motor de cálculo (inconsistente, costoso, no auditable) |
| Gramajes sin publicar | Tabla estándar USDA/FEN + LLM para edge cases | Solo LLM (inconsistente), Solo tabla (inflexible) |
| Factor de cocción v1 | Factor global por método de plato | Por ingrediente (v2), Sin factor (error sistemático alto) |
| Extrapolación (Nivel 3) | Categorías + pgvector + validación por perfil nutricional | Solo embeddings (cruza categorías incompatibles), Solo reglas (no escala) |
| Frontend web | Next.js | Vite/SPA (sin SSR, malo para SEO), Remix (menor ecosistema) |
| Infra early stage | Railway/Render | AWS desde el día 1 (overhead innecesario en MVP) |

---

## 13. Riesgos identificados

### Riesgos de datos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Los restaurantes cambian su carta con frecuencia y los datos quedan desactualizados | ALTA | ALTO | TTL por fuente en BD; alertas de scraping cuando una URL 404; panel de restaurante para que ellos actualicen |
| Los datos estimados (Nivel 2 y 3) tienen errores sistemáticos que dañan la credibilidad | MEDIA | ALTO | Nivel de confianza siempre visible; proceso de validación manual de estimaciones más consultadas; sistema de reporte de errores por usuarios |
| Las webs de restaurantes bloquean el scraping (anti-bot) | MEDIA | MEDIO | Crawlee con rate limiting y rotación de proxies; fuentes alternativas (PDF de menús, APIs públicas) |
| Cambios legales en regulación de información nutricional en hostelería | BAJA | ALTO | Seguimiento de normativa EU; el producto facilita el cumplimiento, no lo complica |

### Riesgos técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Coste de API LLM escala desproporcionadamente con el volumen | MEDIA | ALTO | Redis caché de respuestas idénticas desde Fase 1; migración a modelo propio fine-tuned si el volumen lo justifica |
| El schema de BD requiere cambios estructurales costosos en Fase 2+ | BAJA | ALTO | Diseño exhaustivo del schema antes de escribir código; Prisma migrations; campos JSONB para flexibilidad |
| pgvector no escala bien con millones de platos sin optimización | BAJA | MEDIO | Índices IVFFlat desde el inicio; HNSW si el volumen lo requiere; particionado por categoría |

### Riesgos de producto

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Competidor grande (MyFitnessPal, Fitia) pivota hacia restaurantes españoles | MEDIA | ALTO | Velocidad de construcción de la BD como ventaja defensiva; open source como foso competitivo (comunidad contribuidora) |
| Los restaurantes no están dispuestos a gestionar sus datos | BAJA | MEDIO | Nutritionix ya validó que 25K restaurantes lo hacen en EEUU; empezar con cadenas que ya tienen la info publicada |
| La estimación de foto (CU-03) tiene precisión insuficiente para usuarios exigentes | ALTA | MEDIO | Nivel de confianza explícito; ajuste manual siempre disponible; mejora progresiva con más datos |

### Riesgos de negocio

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| El modelo freemium no genera suficiente conversión a pago | MEDIA | ALTO | Valor real en el free tier para crecer; premium con features genuinamente valiosas (tracking, foto, sin límites); B2B como fuente primaria de ingresos |
| Proyecto open source dificultad para monetizar la instancia hosted | MEDIA | MEDIO | Modelo Open Core (código open source, datos y hosted premium); referencia: Metabase, Sentry, GitLab |

---

## 14. Principios de diseño del producto

Estos principios guían cada decisión de producto cuando hay trade-offs o ambigüedad.

**1. La confianza se gana con transparencia, no con precisión falsa.**
Es mejor mostrar un dato con confianza BAJA claramente marcado que ocultar la incertidumbre. El usuario que sabe que una estimación es aproximada puede decidir informadamente. El usuario engañado con una precisión falsa pierde confianza en el producto para siempre.

**2. El motor calcula. El LLM comunica.**
El LLM nunca es la fuente de verdad nutricional. Interpreta la intención del usuario, estructura la query y presenta el resultado. El cálculo es siempre del motor determinístico con datos trazables.

**3. La base de datos es el producto, las interfaces son canales.**
El activo real es la base de datos nutricional. El bot de Telegram, la web y la app móvil son formas de acceder a ella. Una nueva interfaz no requiere reconstruir nada — consume la misma API.

**4. Open source no significa gratuito para siempre.**
El código es abierto para ganar comunidad, contribuciones y credibilidad. La monetización viene del servicio hosted, los datos premium y el B2B. El modelo es Open Core, no donaciones.

**5. Construir de menos a más, pero con el schema correcto desde el principio.**
El schema de base de datos es la decisión más cara de cambiar. Todo lo demás (interfaces, LLM provider, framework de scraping) es sustituible. El MVP puede ser pequeño, pero el schema debe estar diseñado para soportar el producto completo.

**6. El restaurante es aliado, no solo fuente de datos.**
Los restaurantes que gestionan sus propios datos producen los datos de mayor calidad. Tratarlos como partners — dándoles visibilidad, herramientas y un sello de verificación — es mejor estrategia que tratarlos como fuentes a las que hacer scraping.

**7. España primero, LATAM segundo, global después.**
El foco geográfico inicial es España. La cobertura profunda de un mercado vale más que la cobertura superficial de muchos. La expansión a LATAM y otros mercados hispanohablantes se produce cuando el modelo está validado en España.

## 15. Branding — pendiente de definición

El branding completo del producto está pendiente de definición. Incluirá como mínimo:

- Nombre definitivo del producto
- Logotipo y variantes (positivo, negativo, favicon, icono de app)
- Paleta de colores primaria y secundaria
- Tipografía (display y body)
- Tono de voz y guía de estilo de comunicación
- Estilo visual de la interfaz (guidelines de diseño)
- Dominio definitivo

El posicionamiento estratégico ya está definido (ver sección 1) y servirá como base para las decisiones de branding.

---

## 16. Plan de marketing — pendiente de definición

El plan de marketing está pendiente de elaboración. Se abordará como documento independiente una vez cerrado el branding. Incluirá como mínimo:

- Estrategia de lanzamiento (pre-lanzamiento, lanzamiento, post-lanzamiento)
- Canales de adquisición prioritarios (SEO, redes sociales, comunidades de nutrición y fitness, prensa especializada)
- Estrategia de contenido (blog, newsletter, redes sociales)
- Estrategia de comunidad open source (GitHub, foros, contribuidores)
- Estrategia de relaciones con restaurantes (cómo conseguir los primeros 50 restaurantes con datos verificados)
- KPIs de marketing por fase
- Presupuesto estimado por canal

---  
*Documento generado en Marzo 2026. Revisión prevista al cierre de cada fase.*  
*Para consultar el modelo de datos completo ver: `nutritrack-db-diagram.md`*  
*Para consultar la investigación de mercado completa ver: `nutritrack-market-research.md`*  
*Nombre "NutriTrack" usado como placeholder provisional en todo el documento.*
