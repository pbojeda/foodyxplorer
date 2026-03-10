# PLAN MAESTRO DE DESARROLLO
## NutriTrack _(nombre provisional)_

> **Versión:** 1.0 · **Fecha:** Marzo 2026 · **Estado:** Borrador activo  
> **Metodología:** Spec-Driven Development (SDD) + TDD + Human-in-the-Loop  
> **Herramientas:** [sdd-devflow](https://github.com/pbojeda/sdd-devflow) · Claude Code · GitHub · Railway/Render  
> **Stack base:** Node.js + TypeScript · Fastify · Prisma + Kysely · PostgreSQL + pgvector · Redis · Next.js  
> **Documentos de referencia:** `nutritrack-prd.md` · `nutritrack-db-diagram.md` · `nutritrack-market-research.md`

> ⚠️ El nombre "NutriTrack" se usa como placeholder en todo el documento. El nombre definitivo, branding, modelo de negocio y plan de marketing están **pendientes de definición** y no bloquean el inicio del desarrollo técnico.

---

## Índice

1. [Cómo leer este documento](#1-cómo-leer-este-documento)
2. [Principios y metodología](#2-principios-y-metodología)
3. [Setup inicial — Día 0](#3-setup-inicial--día-0)
4. [Estructura de especificaciones](#4-estructura-de-especificaciones)
5. [Fase 1 — MVP: Bot de Telegram + API + BD](#5-fase-1--mvp-bot-de-telegram--api--bd)
6. [Fase 2 — Web: Aplicación + Web Promocional](#6-fase-2--web-aplicación--web-promocional)
7. [Fase 3 — App Móvil y Escala](#7-fase-3--app-móvil-y-escala)
8. [Pendientes estratégicos](#8-pendientes-estratégicos)
9. [Gestión de riesgos](#9-gestión-de-riesgos)
10. [Criterios de éxito y KPIs](#10-criterios-de-éxito-y-kpis)

---

## 1. Cómo leer este documento

Este plan no es una lista de tareas. Es la hoja de ruta completa que combina estrategia de producto, metodología de desarrollo y secuenciación técnica en un único documento de referencia. Está diseñado para ser leído de arriba a abajo la primera vez y consultado por sección en el día a día.

| # | Sección | Propósito |
|---|---------|-----------|
| 2 | Principios y metodología | El "por qué" y el "cómo" de todo lo que sigue. Leer una vez, interiorizar para siempre. |
| 3 | Setup inicial | Checklist de arranque del proyecto. Se ejecuta una sola vez en el día 0. |
| 4 | Estructura de especificaciones | Cómo se organizan los docs de specs. Base de todo el SDD. |
| 5 | Fase 1 — Bot MVP | Plan detallado de la Fase 1. Épicas, features, tickets, dependencias, riesgos. |
| 6 | Fase 2 — Web | Plan de Fase 2 con pre-lanzamiento incluido. |
| 7 | Fase 3 — Móvil | Plan de Fase 3 y preparación para escala. |
| 8 | Pendientes estratégicos | Decisiones abiertas que necesitan definición antes de avanzar. |
| 9 | Gestión de riesgos | Mapa de riesgos por categoría con mitigación concreta. |
| 10 | Criterios de éxito | KPIs por fase con targets y métodos de medición. |

---

## 2. Principios y metodología

### 2.1 Por qué Spec-Driven Development para este proyecto

SDD no es una preferencia estética — es la respuesta correcta a tres problemas concretos de este proyecto:

| Problema sin SDD | Solución con SDD |
|-----------------|-----------------|
| El motor de estimación es el corazón del producto. Si se implementa sin spec, la lógica queda en la cabeza del desarrollador, no en la BD ni en los tests. | Cada nivel del motor (oficial / estimado / extrapolado) tiene su propia spec con criterios de aceptación medibles antes de escribir una línea de código. |
| El schema de BD es la decisión más cara de cambiar. Sin spec de datos validada primero, se descubren errores en producción. | La spec de datos (schema + migraciones + seeds) se aprueba como Fase 0 de cada épica. Ningún código de aplicación se escribe sin schema aprobado. |
| Un solo desarrollador con IA genera mucho código rápido. Sin metodología, la deuda técnica acumulada en semana 4 bloquea el proyecto en semana 8. | Los agentes de SDD (spec-creator, planner, developer, validator, reviewer) actúan como el equipo de revisión que un solo fundador no tiene. |

### 2.2 La metodología SDD DevFlow

[sdd-devflow](https://github.com/pbojeda/sdd-devflow) implementa el flujo SDD con 9 agentes especializados, 3 skills y 4 niveles de autonomía.

#### El flujo de 7 pasos para cada feature

| Step | Agente | Qué hace |
|------|--------|----------|
| **0** | `spec-creator` | Redacta la especificación de la feature. Criterios de aceptación, edge cases, contrato de API, impacto en BD. Output: `docs/specs/features/FXX-nombre.md` |
| **1** | (Fundador) | Setup: crea branch, ticket en product-tracker, referencias cruzadas. **Aprobación humana de la spec.** |
| **2** | `backend-planner` / `frontend-planner` | Plan de implementación: archivos a crear/modificar, orden de tests, dependencias. **Aprobación humana del plan.** |
| **3** | `backend-developer` / `frontend-developer` | Implementación TDD: test rojo → código mínimo → test verde → refactor. Ciclo por cada criterio de aceptación. |
| **4** | `production-code-validator` + quick-scan hook | Tests + lint + build + scan automático (debug code, secrets, TODOs). **Aprobación humana del commit.** |
| **5** | `code-review-specialist` + `qa-engineer` | PR review completo + verificación de spec + edge cases. **Aprobación humana del merge.** |
| **6** | (Automático) | Cleanup: cierra ticket, actualiza product-tracker, registra decisiones en `decisions.md`. |

**Por complejidad:**
- **Simple** (bug fixes, pequeños ajustes): 1 → 3 → 4 → 5 → 6
- **Standard** (features): 0 → 1 → 2 → 3 → 4 → 5 (+QA) → 6
- **Complejo** (cambios arquitectónicos): 0 → 1 (+ADR) → 2 → 3 → 4 → 5 (+QA) → 6

#### Cómo iniciar una tarea en Claude Code

```
/add-feature "descripción de la feature"
/start-task F001
/show-progress
/next-task
```

### 2.3 Nivel de autonomía recomendado

> **Recomendación: L2 (Trusted)** — el fundador aprueba el plan y el merge. Todo lo demás corre autónomamente.

| Nivel | Nombre | Checkpoints humanos | Cuándo usar |
|-------|--------|---------------------|-------------|
| L1 | Full Control | Todos (5 pasos) | Primera feature, aprendiendo SDD |
| **L2 ★** | **Trusted** | **Plan + Merge (2 pasos)** | **Desarrollo normal — RECOMENDADO** |
| L3 | Autopilot | Solo Merge | Tasks bien definidas y repetitivas |
| L4 | Full Auto | Solo CI/CD gates | Bulk tasks simples |

> Los quality gates (tests, lint, build, validators) **siempre se ejecutan** independientemente del nivel.

### 2.4 Los 6 principios inmutables (Constitución SDD)

Estos principios aplican a **TODOS** los agentes, **TODAS** las tasks, **TODOS** los niveles de complejidad.

| # | Principio | Implicación concreta para este proyecto |
|---|-----------|----------------------------------------|
| 1 | **Spec First** | No se escribe código del motor de estimación sin spec aprobada. No se crea una migración sin spec de schema aprobada. |
| 2 | **Small Tasks** | Una feature = un PR. Una migración de schema = su propio PR. El motor de estimación son 3 features separadas (Nivel 1, 2, 3). |
| 3 | **TDD** | El cálculo nutricional se testea primero con datos conocidos (USDA ground truth). Red → Green → Refactor sin excepciones. |
| 4 | **Type Safety** | TypeScript strict mode. Schemas Zod en todos los boundaries de API. Sin `any` en el motor de cálculo nutricional. |
| 5 | **English Only** | Todo el código, commits, specs, tickets y comentarios de código en inglés. Los documentos de producto en español. |
| 6 | **Reuse Over Recreate** | Antes de crear un nuevo endpoint, verificar si existe. Antes de crear una nueva tabla, verificar si encaja en el schema. El `database-architect` agent revisa antes de cada ADR. |

### 2.5 Memoria del proyecto — el quinto pilar

sdd-devflow mantiene 4 archivos de memoria institucional en `docs/project_notes/`. En un proyecto de un solo fundador, estos archivos son el "equipo" que no olvida:

| Archivo | Propósito | Qué registrar en este proyecto |
|---------|-----------|-------------------------------|
| `product-tracker.md` | Backlog + sesión activa | Estado de cada épica y feature. Contexto de la sesión actual (recuperación tras compaction de contexto). |
| `decisions.md` | ADRs (Architectural Decision Records) | Cada decisión técnica con alternativas descartadas y razonamiento. Ejemplo: `ADR-001: Prisma para CRUD + Kysely para pgvector`. |
| `bugs.md` | Log de bugs + soluciones | Bugs resueltos con su causa raíz y solución. Previene repetir los mismos errores en sesiones futuras. |
| `key_facts.md` | Config, URLs, puertos, branching | Puertos de desarrollo (API: 3000, Redis: 6379, PG: 5432), variables de entorno, convenciones de naming, estrategia de branches. |

---

## 3. Setup inicial — Día 0

Este checklist se ejecuta una única vez antes de escribir cualquier línea de código del producto.

> ⏱️ **Tiempo estimado:** 4-6 horas. Al final del día 0, Claude Code está configurado, el repo está en marcha y el primer ticket está creado.

### 3.1 Repositorio y entorno

- [ ] Crear repositorio GitHub — nombre definitivo pendiente, usar `nutritrack` como placeholder. Repo público con LICENSE (MIT o Apache 2.0).
- [ ] Configurar branching strategy: `main` (producción) + `develop` (integración) + `feature/*` (trabajo). Branch develop creada, protección en main configurada.
- [ ] Inicializar proyecto Node.js + TypeScript con estructura de monorepo (`packages/api`, `packages/bot`). npm init + tsconfig.json + eslint + prettier configurados.
- [ ] Configurar Docker Compose con PostgreSQL 16 + pgvector extension + Redis. `docker compose up` levanta BD + Redis sin errores.
- [ ] Variables de entorno: crear `.env.example` y documentar en `key_facts.md`. `.env.example` completo; `.env` local funcional.

### 3.2 Instalación de sdd-devflow

```bash
# En la raíz del repo
npx create-sdd-project --init
# Wizard: Node.js + TypeScript, Backend + Frontend, Claude Code, L2 Autonomy

# Verificar instalación
npx create-sdd-project --doctor
# Esperado: HEALTHY. 8/8 agentes presentes, hooks ejecutables.

# Instalar dependencia del quick-scan hook
brew install jq  # macOS
# apt install jq  # Linux
```

- [ ] `npx create-sdd-project --init` completado con las opciones correctas.
- [ ] `npx create-sdd-project --doctor` retorna `HEALTHY`.
- [ ] `jq` instalado (`which jq` retorna path válido).
- [ ] Personalizar `AGENTS.md` con contexto del proyecto: stack, convenciones, rutas de specs. Sección `Project Context` específica de NutriTrack añadida.
- [ ] Personalizar `ai-specs/specs/backend-standards.mdc` con patrones de este proyecto (Prisma/Kysely, Fastify, Zod). Standards reflejan las decisiones del PRD.

### 3.3 CI/CD y calidad

- [ ] Revisar y personalizar `.github/workflows/ci.yml` generado por sdd-devflow para PostgreSQL + pgvector. CI pasa en rama main con BD de test y extensión pgvector habilitada.
- [ ] Configurar Railway o Render: entorno staging (`develop` branch) + producción (`main` branch). Deploy automático en staging funciona tras push a `develop`.
- [ ] Configurar Sentry para error tracking desde el primer día (plan gratuito suficiente). Primer error de test capturado en Sentry dashboard.
- [ ] Configurar uptime monitoring básico (Better Uptime o UptimeRobot gratuito). Alerta configurada para el endpoint `/health` de la API.

### 3.4 Memoria institucional — inicialización

```
# En Claude Code:
"set up project memory"
```

- [ ] Ejecutar `"set up project memory"` (project-memory skill). 4 archivos creados en `docs/project_notes/` con contexto inicial del proyecto.
- [ ] Poblar `key_facts.md`: puertos, convenciones, branching, URLs de staging/prod, API keys de entorno.
- [ ] Registrar `ADR-000` en `decisions.md`: "Stack inicial y razonamiento" (documentar las decisiones del PRD).
- [ ] Poblar `product-tracker.md` con las 4 épicas de Fase 1 y sus features de primer nivel.

---

## 4. Estructura de especificaciones

Las specs son el contrato entre planificación e implementación. En SDD, ningún código existe sin spec aprobada.

> **Regla:** Los documentos de mayor nivel son prerrequisito para los de menor nivel. No se crea una spec de feature sin que su épica esté aprobada.

### 4.1 Jerarquía de documentos

| Nivel | Ubicación | Contenido |
|-------|-----------|-----------|
| ✅ **PRD** (ya existe) | `nutritrack-prd.md` | Visión, usuarios, casos de uso, fases, criterios de éxito. Fuente de verdad del producto. |
| ✅ **Schema BD** (ya existe) | `nutritrack-db-diagram.md` | Modelo de datos completo con diagramas Mermaid. Prerrequisito para cualquier migración. |
| **Spec de Épica** | `docs/specs/epics/EXXX-nombre.md` | Alcance de la épica, features incluidas, criterios de completado, dependencias. |
| **Spec de Feature** | `docs/specs/features/FXXX-nombre.md` | Criterios de aceptación, contrato de API, impacto en schema, edge cases. |
| **Spec de Schema** | `docs/specs/schema/SXXX-tabla.md` | Spec de migración de BD: campos, tipos, constraints, índices, seeds, rollback plan. |
| **Ticket** | `docs/tickets/TXXX-nombre.md` | Generado por sdd-devflow en Step 1. Enlaza feature → branch → PR. Registro de ejecución. |
| **ADR** | `docs/project_notes/decisions.md` | Registra cada decisión de arquitectura con contexto, alternativas y consecuencias. |

### 4.2 Template de Spec de Feature

```markdown
# FXXX — [Nombre de la feature]

**Épica:** EXXX  
**Estimación:** [horas o puntos]  
**Dependencias:** [FXXX, SXXX]

## Contexto

Breve descripción del problema que resuelve esta feature.

## Criterios de aceptación

- [ ] AC-1: [descripción testeable y verificable]
- [ ] AC-2: [descripción testeable y verificable]
- [ ] AC-N: ...

## Contrato de API

### `METHOD /ruta`

**Request:**
```json
{ "campo": "tipo" }
```

**Response 200:**
```json
{ "campo": "tipo" }
```

**Errores:** `400`, `404`, `422` con descripción de cada uno.

## Impacto en schema

Tablas afectadas. Referencia a `SXXX-nombre.md` si hay migración nueva.

## Edge cases

- Caso límite 1 y comportamiento esperado.
- Caso límite 2 y comportamiento esperado.

## Fuera de scope

- Qué NO hace esta feature (previene scope creep).
```

### 4.3 Convenciones de naming

| Prefijo | Tipo | Ejemplo |
|---------|------|---------|
| `EXXX` | Épica | `E001-infrastructure-setup`, `E002-estimation-engine` |
| `FXXX` | Feature | `F001-prisma-schema-migration`, `F020-level1-official-data-lookup` |
| `SXXX` | Schema / Migración | `S001-foods-table`, `S003-pgvector-indexes` |
| `TXXX` | Ticket (auto-generado) | `T001-prisma-schema-migration` |
| `ADR-XXX` | Decision Record | `ADR-000-initial-stack`, `ADR-001-prisma-vs-kysely` |
| `BUG-XXX` | Bug (auto-generado) | `BUG-001-pgvector-cosine-normalization` |

---

## 5. Fase 1 — MVP: Bot de Telegram + API + BD

| Duración | Resultado | Stack activo | Criterio de salida |
|----------|-----------|--------------|-------------------|
| **6 semanas** | API funcional + Bot Telegram + BD con datos de 10 cadenas | Fastify · Prisma · Kysely · PG · pgvector · Redis · Telegram | 100 usuarios activos · 10 cadenas cubiertas · <3s respuesta · <0.05€/consulta tokens |

> ⚠️ **Principio clave de Fase 1:** LA BD ES EL PRODUCTO. Antes de escribir un solo endpoint, el schema completo debe estar migrado, seeded y validado. La API y el bot son consumidores de la BD, no al revés.

### 5.1 Épicas de Fase 1

Las épicas E001 y E002 son **bloqueantes** para E003 y E004.

| Épica | Nombre | Qué entrega | Semanas | Dependencias |
|-------|--------|-------------|---------|--------------|
| **E001** | Infrastructure & Schema | BD completa migrada. Docker. CI. sdd-devflow configurado. Prisma schema + seeds. | 1-2 | Setup día 0 completado |
| **E002** | Data Ingestion Pipeline | 10 cadenas españolas con datos nutricionales verificados en BD. Scraper + parser + importador. | 2-4 | E001 completa |
| **E003** | Estimation Engine | Motor de 3 niveles funcional con tests de precisión. API interna documentada. | 3-5 | E001 completa. E002 parcial (mínimo Nivel 1) |
| **E004** | Telegram Bot + Public API | Bot funcional en producción. API pública v0 con rate limiting y caché Redis. | 4-6 | E002 + E003 completas |

---

### 5.2 Épica E001 — Infrastructure & Schema

| Feature | Nombre | Criterio de aceptación principal |
|---------|--------|----------------------------------|
| F001 | Prisma Schema Migration — Core tables | Tablas `data_sources`, `foods`, `food_nutrients`, `standard_portions` migradas. Tests de seed pasan. |
| F002 | Prisma Schema Migration — Dishes & Restaurants | Tablas `cooking_methods`, `dish_categories`, `restaurants`, `dishes`, `dish_nutrients`, `dish_ingredients` migradas. |
| F003 | pgvector Extension & Indexes | pgvector habilitado. Índices IVFFlat en `foods.embedding` y `dishes.embedding`. Query de similitud retorna resultados en <100ms con dataset de test. |
| F004 | Fastify API Scaffold | Fastify arranca en port 3000. `/health` responde 200. OpenAPI autogenerado. Zod validation configurado. |
| F005 | Redis Connection & Cache Layer | Redis conectado. Cache helper con TTL configurable. Rate limiting middleware funcional con test de 100 req/min. |
| F006 | Seed Script — USDA/FEN Base Foods | Script importa mínimo 500 alimentos base con valores nutricionales por 100g. Tests de integridad pasan (sin nulos en columnas required). |

> 🚫 **BLOQUEANTE:** No avanzar a E002 o E003 sin que F001-F006 estén en producción (rama main, CI verde, deploy staging funcionando).

---

### 5.3 Épica E002 — Data Ingestion Pipeline

**Las 10 cadenas objetivo (en orden de prioridad por volumen de búsquedas en España):**

| # | Cadena | Fuente de datos | Método de ingesta |
|---|--------|-----------------|-------------------|
| 1 | McDonald's España | Web + PDF información nutricional | Scraper Crawlee + Playwright. Datos estructurados disponibles. |
| 2 | Burger King España | Web burgerking.es | Scraper + parser HTML. |
| 3 | KFC España | Web kfc.es | Scraper. Algunos datos disponibles en JSON-LD. |
| 4 | Telepizza | Web telepizza.es | Scraper. Verificar disponibilidad de valores nutricionales. |
| 5 | Domino's España | Web dominos.es | Scraper. Comparar con datos Domino's global para validación. |
| 6 | Subway España | Web subway.com/es-es | Scraper. Calculadora nutricional disponible en web. |
| 7 | Five Guys España | Web fiveguys.es | Scraper. Datos nutricionales PDF disponibles. |
| 8 | VIPS / TGI Fridays | Web vips.es | Scraper. Verificar cobertura de carta. |
| 9 | Pans & Company | Web pansandcompany.com | Scraper + verificación manual de valores. |
| 10 | 100 Montaditos | Web 100montaditos.com | Scraper. Carta extensa — priorizar montaditos más populares. |

| Feature | Nombre | Criterio de aceptación |
|---------|--------|------------------------|
| F007 | Scraper base: Crawlee + Playwright scaffold | Framework configurado con rate limiting, rotación de user agent, manejo de errores y logging. |
| F008–F017 | Scraper por cadena (10 features) | Cada scraper: extrae datos nutricionales, normaliza al schema de BD, importa con `source_id` trazable. Test de integridad: 0 nulos en calorías/proteínas/carbohidratos/grasas. |
| F018 | Data Quality Monitor | Script que verifica: duplicados, valores implausibles (>5000 kcal/100g), platos sin nutrients. |
| F019 | Embedding Generation Pipeline | Script que genera embeddings (OpenAI `text-embedding-3-small`) para `foods` y `dishes` y los almacena en columnas vector. Batch processing para rate limiting. |

> ⚠️ **RIESGO E002:** Los sitios web cambian su estructura. El scraper de cada cadena es una feature independiente (F008-F017). Si una cadena bloquea el scraping, se implementa primero con datos manuales desde PDF y el scraper se añade como mejora posterior.

---

### 5.4 Épica E003 — Estimation Engine

> El motor de estimación es el activo técnico más importante de Fase 1. Se implementa en este orden estricto: **Nivel 1 → Nivel 2 → Nivel 3.** Cada nivel tiene sus propios tests de precisión.

| Feature | Nombre | Criterio de aceptación |
|---------|--------|------------------------|
| F020 | Level 1 — Official Data Lookup | Query a BD retorna datos exactos de fuente oficial. `confidence_level = HIGH`. Tiempo <50ms. Tests: 20 platos de cadenas con datos conocidos retornan valores dentro de ±5% de la web oficial. |
| F021 | Level 2 — Ingredient-Based Estimation | Motor calcula calorías/macros desde lista de ingredientes + gramajes estándar USDA/FEN + factor de cocción. `confidence_level = MEDIUM`. Tests: 10 platos con ingredientes conocidos dentro de ±20% de valor real. LLM solo para parsing de ingredientes en lenguaje natural. |
| F022 | Level 3 — Similarity Extrapolation (pgvector) | Búsqueda coseno en pgvector devuelve N platos similares dentro de misma categoría. Media ponderada por similitud. `confidence_level = LOW`. Tests: platos extrapolados dentro de ±35% con categorías correctas. |
| F023 | Engine Router & Confidence API | Función central que aplica Nivel 1 → 2 → 3 en cascade. Retorna `{nutrients, confidence_level, estimation_method, sources[]}`. Este contrato es la interfaz para el bot y la API pública. |
| F024 | LLM Integration Layer | Wrapper sobre OpenAI/Anthropic para: parsing de queries en lenguaje natural, parsing de ingredientes, generación de respuestas naturales. Cache Redis con TTL 24h por hash de query normalizada. Tests: coste simulado <0.05€/consulta con caché al 70%. |

> 🚫 **PRINCIPIO CRÍTICO:** El motor (F020-F023) no llama nunca a la LLM para calcular. La LLM solo interpreta texto de entrada (F024) y formatea texto de salida. El cálculo es siempre **determinístico y auditable.**

---

### 5.5 Épica E004 — Telegram Bot + Public API

| Feature | Nombre | Criterio de aceptación |
|---------|--------|------------------------|
| F025 | Fastify Routes — Core Endpoints | `GET /search?q=` · `POST /calculate` · `GET /restaurants/:id/dishes` · `GET /dishes/:id/nutrients` · `GET /health`. Zod validation en todos. OpenAPI spec generada. Tests de integración pasan. |
| F026 | API Rate Limiting + Auth (API Key) | 100 req/día para tier free, 1000 req/día para tier dev (API key). Redis rate limiter. Headers `X-RateLimit-*` en respuestas. |
| F027 | Telegram Bot — Command Handler | Bot responde a `/start`, `/help`, `/buscar [plato]`, `/restaurante [nombre]`. Integra con Engine Router (F023). Tests con Telegram Bot API mock. |
| F028 | Telegram Bot — Natural Language Handler | Mensajes de texto libre procesados por LLM layer (F024). Bot interpreta "¿cuántas calorías tiene una hamburguesa de McDonald's?" y retorna respuesta estructurada con nivel de confianza. |
| F029 | Query Log & Analytics | Cada consulta logueada en `query_log` con timestamp, tipo, confianza y tiempo de respuesta. Script de analytics muestra top 20 consultas más frecuentes. |
| F030 | Monitoring & Alerting | Sentry configurado para errores de motor. Alerta automática si P95 latencia > 3s en últimas 5 min. |

---

### 5.6 Cronograma detallado — Fase 1

| Semana | Épica | Trabajo concreto |
|--------|-------|-----------------|
| **1** | E001 | F001 + F002: Schema migration core + dishes. F003: pgvector + índices. F004: Fastify scaffold. CI verde en rama develop. |
| **2** | E001 + E002 | F005: Redis + cache layer. F006: Seed USDA/FEN. F007: Scraper scaffold. Inicio F008 (McDonald's). ADR-001 registrado. |
| **3** | E002 + E003 | F008-F012: Scrapers 5 cadenas. F019: Embeddings pipeline. F020: Level 1 engine (bloqueante para bot). Tests de precisión Nivel 1 passing. |
| **4** | E002 + E003 + E004 | F013-F017: Scrapers 5 cadenas restantes. F021: Level 2 engine. F018: Quality monitor. F025: API routes. Checkpoint de calidad de datos. |
| **5** | E003 + E004 | F022: Level 3 pgvector engine. F023: Engine router. F024: LLM layer + cache. F026: Rate limiting. F027: Bot commands. |
| **6** | E004 + QA | F028: Bot lenguaje natural. F029: Query logging. F030: Monitoring. Pruebas end-to-end completas. Deploy producción. Primeros usuarios externos. |

---

## 6. Fase 2 — Web: Aplicación + Web Promocional

| Duración | Resultado | Stack añadido | Criterio de salida |
|----------|-----------|---------------|-------------------|
| **Meses 3-5** | Web app + mapa + cuentas + foto + portal restaurantes beta | Next.js · Mapbox/Google Maps · NextAuth | 1K usuarios · 50 restaurantes verificados · 10 devs con API key · NPS ≥40 |

### 6.1 Pre-lanzamiento — Web promocional _(antes de la app)_

> La web promocional se lanza **4-6 semanas ANTES** de la app. Su función principal: captar lista de espera y construir audiencia antes del lanzamiento.

| Feature | Nombre | Contenido / Criterio |
|---------|--------|----------------------|
| F031 | Landing page de presentación | Propuesta de valor clara. Demo animada o screenshots. CTA principal: suscripción a newsletter. SEO básico con meta tags. |
| F032 | Newsletter / Lista de espera | Formulario de email conectado a Mailchimp/Brevo/Resend. Email de confirmación automático. **Objetivo: 500 suscriptores antes del lanzamiento de la app.** |
| F033 | Páginas legales obligatorias | Política de privacidad (RGPD compliant) · Términos y condiciones · Política de cookies. Banner de consentimiento de cookies (RGPD). |
| F034 | Página de contacto | Formulario de contacto. Direcciones de email por tipo (soporte, prensa, restaurantes). |
| F035 | Página para restaurantes | Propuesta de valor B2B. Formulario de interés para restaurantes. **Objetivo: 20 restaurantes en lista de espera B2B antes del lanzamiento.** |
| F036 | Blog / Changelog público | Al menos 3 posts pre-lanzamiento (qué es el producto, cómo funciona el motor de estimación, por qué open source). |

### 6.2 Épicas de la aplicación web

| Épica | Nombre | Qué entrega | Mes | Dependencias |
|-------|--------|-------------|-----|--------------|
| **E005** | Next.js App Shell | Scaffold Next.js. Búsqueda de platos. Ficha de plato con macros y nivel de confianza visible. | 3 | E001-E004 completas |
| **E006** | Map & Discovery | Mapa de restaurantes con Mapbox. Filtros por restricción dietética. Geolocalización del usuario. | 4 | E005 |
| **E007** | User Accounts | Registro + login (NextAuth). Historial de consultas. Preferencias y restricciones dietéticas. | 4 | E005 |
| **E008** | Photo Recognition (básico) | Upload de foto. Vision API para identificar plato. Respuesta con datos nutricionales estimados y `confidence = LOW`. | 4-5 | E005 + E003 |
| **E009** | Restaurant Portal (beta) | Login para restaurantes. CRUD de carta. Validación de datos. Panel de estado de verificación. | 5 | E005 + E007 |
| **E010** | Public API v1 | Documentación pública (Swagger UI). API keys con dashboard. Rate limiting por tier. Changelog. | 5 | E004 + E005 |

### 6.3 Decisiones técnicas de Fase 2 — pendientes de validar

| Decisión | Propuesta inicial | Validar antes de implementar |
|----------|-------------------|------------------------------|
| Proveedor de mapas | Mapbox GL JS | Comparar coste Mapbox vs Google Maps API al volumen esperado. Decidir en inicio de E006. |
| Auth provider | NextAuth.js (self-hosted) | Si se anticipa OAuth con Google/GitHub, evaluar Auth.js v5 o Clerk. Decidir antes de E007. |
| Vision API (foto) | OpenAI GPT-4o Vision | Evaluar coste por imagen. Alternativa: Google Vision API. Decidir antes de E008. |
| Web promo CMS | MDX en Next.js (blog) | Si el blog necesita gestión por non-devs, evaluar Contentlayer o Sanity. Decidir antes de F036. |

---

## 7. Fase 3 — App Móvil y Escala

| Duración | Resultado | Stack añadido | Criterio de salida |
|----------|-----------|---------------|-------------------|
| **Meses 6-9** | App iOS + Android + tracking diario + 200 restaurantes | React Native · Expo · HealthKit / Google Fit | 10K MAU · 200 restaurantes · rating ≥4.2 · 1 cadena B2B de pago |

### 7.1 Épicas de Fase 3

| Épica | Nombre | Qué entrega |
|-------|--------|-------------|
| **E011** | React Native App Shell | App iOS + Android con navegación. Toda la funcionalidad del bot y la web en app nativa. Push notifications. |
| **E012** | Camera & Advanced Photo | Cámara nativa en tiempo real para identificación de platos. Mejora sobre el modelo de Fase 2. |
| **E013** | Daily Intake Tracking | Registro diario de ingesta. Totales acumulados por macro. Historial semanal/mensual. Integración básica con HealthKit (iOS) y Google Fit (Android). |
| **E014** | Restaurant Partner Program | Portal B2B completo con dashboard de analytics. Widget embebible para webs de restaurantes. Sello "NutriTrack Verified". Primera cadena de pago. |
| **E015** | Infrastructure Scale | Evaluación de infraestructura. Migración si Railway/Render no aguanta los volúmenes. CDN para la web. |

### 7.2 Prerrequisitos para iniciar Fase 3

Fase 3 **NO comienza** sin que estos criterios estén cumplidos:

- [ ] Fase 2 completada con criterios de éxito cumplidos (1K usuarios, 50 restaurantes, NPS ≥40)
- [ ] Branding definitivo aprobado e implementado en la web
- [ ] Modelo de negocio definido y al menos un tier de pago activo
- [ ] Plan de marketing documentado con presupuesto para campaña de lanzamiento de la app
- [ ] Al menos 1 restaurante o cadena comprometida con el programa B2B de Fase 3

### 7.3 La decisión de infra en Fase 3

> Railway/Render son suficientes para Fase 1 y Fase 2. Para Fase 3 (10K MAU) evaluar si es necesario migrar. **No migrar antes de necesitarlo.**

| Señal | Acción | Timing |
|-------|--------|--------|
| P95 latencia > 2s de forma sostenida | Evaluar upgrade de plan Railway/Render o migración a VPS dedicado | Cuando se detecte, no antes |
| Coste infra > 20% de ingresos | Evaluar opciones más económicas (Hetzner, Railway Pro) | Revisión mensual de unit economics |
| pgvector con > 500K platos en índice | Evaluar migración de IVFFlat a HNSW o particionado por categoría | Cuando se cruce el umbral |
| > 50K MAU | Evaluar migración seria a AWS RDS + EC2/ECS | Como ejercicio de planificación al llegar a 10K MAU |

---

## 8. Pendientes estratégicos

Estas decisiones están **ABIERTAS**. Algunas bloquean partes del desarrollo; otras son independientes del timeline técnico.

| Decisión | Bloqueante para | Opciones / criterios | Fecha límite máxima |
|----------|----------------|----------------------|---------------------|
| **Nombre definitivo del producto** | Dominio, deploy, branding, documentación pública | Criterios: disponibilidad de dominio .com/.es, no conflicto de marca registrada, pronunciable en español. Proceso: brainstorm → shortlist → búsqueda de marcas → decisión. | Antes de iniciar Fase 2 (mes 3). **No bloquea Fase 1.** |
| **Branding (identidad visual)** | Web promocional, app, materiales de marketing | Requiere nombre definitivo. Opciones: diseñador freelance (Behance/Upwork), herramientas AI (Looka, Brandmark), diseño propio en Figma. | Mes 2-3. **No bloquea Fase 1.** |
| **Modelo de negocio definitivo** | Implementación de pagos, pricing de API, portal B2B | Validar con primeros usuarios si el freemium funciona. Hablar con 5-10 restaurantes antes de decidir B2B pricing. ¿B2B primero o B2C primero? ¿Open Core o SaaS hosted? | Antes de Fase 2 completa (mes 5). **No bloquea Fase 1 ni Fase 2 inicial.** |
| **Plan de marketing** | Campaña de lanzamiento web, crecimiento de usuarios | Requiere branding y modelo de negocio. Incluye: canales de adquisición, presupuesto, SEO, comunidades (Reddit nutrición, grupos Telegram fitness España). | Mes 4 (4-6 semanas antes del lanzamiento de la app web). |
| **Licencia open source** | Publicación del repo público, contribuidores | MIT (más permisiva) vs Apache 2.0 (protección de patentes) vs AGPL (obliga a open source los forks hosted). Para Open Core: AGPL core + licencia comercial para features premium. | Antes de hacer el repo público (fin de Fase 1 o inicio de Fase 2). |

---

## 9. Gestión de riesgos

> Este mapa se revisa al inicio de cada fase.

### 9.1 Riesgos críticos (Alta probabilidad × Alto impacto)

| Riesgo | Prob | Imp | Mitigación concreta |
|--------|------|-----|---------------------|
| Los scrapers de cadenas fallan o son bloqueados por anti-bot | ALTA | ALTO | Plan B para cada cadena: entrada manual de datos desde PDF. El scraper es una mejora, no el único método. Comenzar con cadenas que tienen datos en PDF descargable (McDonald's, Subway, Five Guys). |
| Motor de estimación Nivel 2 produce errores > ±30% de forma sistemática | MEDIA | ALTO | El nivel de confianza MEDIUM siempre visible. Ground truth: 30 platos con valores reales como benchmark de regresión en CI. Si precisión < umbral → `confidence_level` baja a `LOW` automáticamente. |
| Coste de tokens LLM escala con el volumen y supera presupuesto | MEDIA | ALTO | Cache Redis con TTL 24h desde el primer día (F024). Monitorizar coste/consulta semanalmente. Cap de gasto mensual en OpenAI/Anthropic configurado desde el día 1. |

### 9.2 Riesgos importantes

| Riesgo | Prob | Imp | Mitigación concreta |
|--------|------|-----|---------------------|
| Schema de BD requiere cambio estructural costoso en Fase 2+ | BAJA | ALTO | El schema de E001 se revisa con el `database-architect` agent antes de hacer merge. ADR-001 documenta las decisiones de diseño. Campos JSONB (`extra`) para flexibilidad sin migrations. |
| Competidor (MyFitnessPal, Fitia) pivota hacia restaurantes España | MEDIA | ALTO | Velocidad de construcción de la BD como ventaja defensiva: cada mes de datos es un moat. Open source como foso: si el código es público, la comunidad construye sobre él. |
| Los restaurantes no quieren gestionar sus propios datos | BAJA | MEDIO | Empezar con cadenas que ya publican sus datos. El portal B2B es para Fase 2. La propuesta de valor B2B se valida con entrevistas antes de construir el portal. |
| Deuda técnica acumulada bloquea velocidad en Fase 2 | MEDIA | MEDIO | SDD y TDD son la mitigación principal. El quick-scan hook detecta code smells antes de cada commit. Regla: si el PR tiene > 500 líneas de cambio, dividirlo. |

---

## 10. Criterios de éxito y KPIs

Los criterios de éxito son la definición operacional de "el proyecto avanza bien". Se miden al final de cada fase y sirven de **go/no-go** para avanzar a la siguiente.

### 10.1 Fase 1 — Bot MVP (semana 6)

| KPI | Target | Fuente de medición | Notas |
|-----|--------|--------------------|-------|
| Usuarios activos en Telegram (≥1 consulta en 7 días) | **≥ 100** | `query_log` (F029) | Captación orgánica: comunidades fitness, Twitter/X, grupos Telegram |
| Cadenas con datos nutricionales verificados | **≥ 10** | `BD: count(restaurant_chains)` | Las 10 cadenas del plan E002 |
| Latencia P95 de respuesta del bot | **< 3s** | `query_log.response_ms` | Incluye llamada LLM + BD + caché |
| Coste promedio de tokens LLM por consulta | **< 0.05€** | Facturación API / nº consultas | Caché Redis reduciendo llamadas al 70%+ |
| Errores críticos (confidence HIGH con valor incorrecto) | **0** | Sentry + revisión manual semanal | Revisión manual de 50 consultas/semana |
| Test coverage del motor de estimación | **≥ 80%** | Jest coverage report | Especialmente Nivel 1 y Nivel 2 |

### 10.2 Fase 2 — Web (mes 5)

| KPI | Target | Fuente de medición | Notas |
|-----|--------|--------------------|-------|
| Suscriptores newsletter pre-lanzamiento | **≥ 500** | Mailchimp/Brevo dashboard | Antes de lanzar la app |
| Usuarios registrados en la app web | **≥ 1.000** | `BD: count(users)` | |
| Restaurantes con datos verificados | **≥ 50** | `BD: count(restaurants WHERE verified=true)` | Al menos 5 no pertenecientes a cadenas nacionales |
| Desarrolladores con API key activa (≥1 llamada en 30 días) | **≥ 10** | `query_log.source=api` | |
| Posición Google "valores nutricionales + [cadena]" | **Top 3 en ≥5 cadenas** | Google Search Console | McDonald's ES, BK ES, KFC ES, Subway ES, Telepizza |
| Net Promoter Score (encuesta in-app) | **≥ 40** | Typeform/Tally | Muestra: ≥50 respuestas |

### 10.3 Fase 3 — Móvil (mes 9)

| KPI | Target | Fuente de medición | Notas |
|-----|--------|--------------------|-------|
| Monthly Active Users (MAU) | **≥ 10.000** | Analytics (Mixpanel o simple) | Combinado web + app + bot |
| Restaurantes con datos verificados | **≥ 200** | BD | |
| App store rating (iOS + Android) | **≥ 4.2 ★** | App Store Connect / Google Play | Con ≥50 valoraciones |
| Retención a 30 días | **≥ 25%** | Analytics: cohort analysis | Indicador clave de product-market fit |
| Cadenas / restaurantes con programa B2B de pago | **≥ 1** | CRM / facturación | Validación del modelo B2B |
| Desarrolladores con API key activa | **≥ 50** | `query_log.source=api` | |

### 10.4 Indicadores de salud del desarrollo (seguimiento semanal)

- **Velocidad de features:** ¿cuántas features pasan de spec aprobada a merge en la semana? Target: ≥2/semana en Fase 1.
- **Tasa de bugs post-merge:** bugs encontrados después del merge. Deberían ser 0 si el `qa-engineer` hace su trabajo.
- **Tiempo medio de ciclo:** desde `/start-task` hasta merge. Si supera 3 días en features simples, revisar el tamaño de las tasks.
- **ADRs registrados:** cada decisión arquitectónica importante debe tener su ADR. Si hay code reviews donde se discute arquitectura sin ADR → señal de que falta documentar.
- **Coste de tokens vs proyección:** revisar semanalmente si el caché está funcionando según lo esperado.

### 10.5 Indicadores objetivo para una adquisición (largo plazo)

| Indicador | Por qué es relevante |
|-----------|---------------------|
| BD con > 500 cadenas / 50K platos verificados | El dato es el activo. Una BD verificada a esa escala no se replica en 2 años. Es el moat real. |
| Contratos B2B con cadenas nacionales reconocidas | Valida el modelo de negocio y proporciona ingresos recurrentes que justifican una valoración. |
| MAU > 100K con retención > 30% | Audiencia fidelizada en nutrición es valiosa para apps de salud, seguros, hospitales, distribuidores alimentarios. |
| API activa en > 200 aplicaciones de terceros | Infraestructura de datos que otros ya dependen de ella. Desincentiva la replicación. |
| Presencia en > 3 países hispanohablantes | Cobertura geográfica con datos verificados amplía el mercado potencial para el comprador. |

---

> **Este plan es un documento vivo.** Se revisa al inicio de cada fase y se actualiza cuando cambian las condiciones del mercado, las decisiones técnicas o los criterios de éxito. La memoria institucional del proyecto vive en `docs/project_notes/`. Este documento vive junto al PRD (`nutritrack-prd.md`) y el schema de BD (`nutritrack-db-diagram.md`) como la triada de referencia del proyecto.

---

_Versión 1.0 · Marzo 2026 · NutriTrack (nombre provisional) · Spec-Driven Development + SDD DevFlow_
