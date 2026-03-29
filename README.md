# foodXPlorer

> **La base de datos nutricional abierta de restaurantes** — para restaurantes lo que Open Food Facts es para productos envasados.

[![Estado](https://img.shields.io/badge/estado-Fase%201%20completa-brightgreen)](https://github.com)
[![Bot](https://img.shields.io/badge/bot-Telegram-blue)](https://t.me/foodXPlorerBot)
[![Metodologia](https://img.shields.io/badge/metodologia-Spec--Driven%20Development-teal)](https://github.com/pbojeda/sdd-devflow)

---

## Que es foodXPlorer

foodXPlorer es una plataforma open source para consultar informacion nutricional de platos de restaurantes y cadenas. Resuelve un problema concreto: **cuando comes fuera de casa, estas ciego nutricionalmente**.

Las apps de nutricion (MyFitnessPal, Fitia) estan pensadas para tracking en casa. Las apps de restaurantes (TheFork, TripAdvisor) no tienen informacion nutricional. foodXPlorer cubre ese hueco.

**Como funciona:** un motor de estimacion de cuatro niveles devuelve valores nutricionales con nivel de confianza explicito — siempre sabes si estas viendo datos oficiales, una estimacion por ingredientes, una extrapolacion por similitud o una aproximacion por LLM. El bot de Telegram es la interfaz principal.

---

## Estado actual

Fase 1 completada. El bot de Telegram es funcional con todas las features del MVP.

| Componente | Estado | Notas |
|------------|--------|-------|
| API REST | Funcionando | Fastify + PostgreSQL + pgvector + Redis |
| Bot Telegram | Funcionando | 12 comandos + lenguaje natural |
| Motor de estimacion | Funcionando | 4 niveles de confianza |
| Pipeline de ingestion | Funcionando | 10 cadenas espanolas scrapeadas |
| Landing page | Funcionando | nutriXplorer.com (Next.js) |
| Tests | 1055 passing | Build y lint clean |

---

## Funcionalidades del bot

### Comandos principales

| Comando | Descripcion |
|---------|-------------|
| `/estimar <plato> [en <cadena>]` | Estima nutrientes de un plato |
| `/comparar <plato_a> vs <plato_b>` | Compara dos platos lado a lado |
| `/contexto [<cadena>\|borrar]` | Establece/ve/borra el contexto de cadena activo |
| `/receta <texto libre>` | Calcula nutrientes de una receta completa |
| `/buscar <texto>` | Busca platos en la base de datos |
| `/restaurantes [cadena]` | Lista restaurantes |
| `/restaurante <nombre>` | Busca/crea restaurante con teclado inline |
| `/platos <restaurante_id>` | Lista platos de un restaurante |
| `/cadenas` | Lista cadenas disponibles |
| `/info` | Estado del sistema y version |
| `/start` `/help` | Ayuda y lista de comandos |

### Lenguaje natural

El bot entiende espanol sin necesidad de comandos:

```
cuantas calorias tiene un big mac
que engorda mas, big mac o whopper
estoy en mcdonalds              (establece contexto)
big mac                          (usa el contexto activo)
```

### Contexto conversacional

Cuando dices "estoy en mcdonalds" o usas `/contexto mcdonalds`, el bot recuerda la cadena durante 2 horas. Las consultas siguientes se filtran automaticamente por esa cadena sin necesidad de especificarla cada vez.

### Modificadores de porcion

```
doble big mac           (x2)
media racion de pollo   (x0.5)
big mac xl              (x1.5)
```

### Analisis de menus

Envia una foto o PDF de un menu y el bot lo analiza usando OCR + Vision AI, estimando los nutrientes de cada plato detectado.

### Comparacion de platos

```
/comparar big mac vs whopper
/comparar big mac en mcdonalds-es vs whopper en burger-king-es
que engorda mas, big mac o whopper
```

Muestra una tabla comparativa con calorias, proteinas, grasas, carbohidratos y fibra, con indicador del "ganador" en cada nutriente.

Ver [`docs/user-manual-bot.md`](./docs/user-manual-bot.md) para el manual completo con ejemplos.

---

## Arquitectura

```
packages/
  api/        Fastify REST API (estimacion, busqueda, ingestion, recetas)
  bot/        Telegram bot (node-telegram-bot-api)
  shared/     Tipos y schemas compartidos (Zod)
  scraper/    Pipeline de scraping (Crawlee + Playwright)
  landing/    Landing page (Next.js 14 + Tailwind)
```

### Stack tecnico

```
Runtime     Node.js + TypeScript (strict)
API         Fastify + OpenAPI + Zod validation
Database    PostgreSQL 16 + pgvector + pg_trgm
Cache       Redis (rate limiting, bot state, estimaciones)
ORM         Prisma (migraciones) + Kysely (queries complejas)
Bot         node-telegram-bot-api
Landing     Next.js 14 + Tailwind + Framer Motion
LLM         OpenAI API (solo interpretacion + recetas)
Scraping    Crawlee + Playwright
Infra       Render + Supabase + Upstash + Cloudflare
```

### Motor de estimacion

| Nivel | Cuando aplica | Confianza |
|-------|---------------|-----------|
| **L1** — Dato oficial | El plato existe en BD con datos del restaurante | Alta |
| **L2** — Estimacion por ingredientes | Se conocen los ingredientes | Media |
| **L3** — Extrapolacion por similitud (pgvector) | Solo existe el nombre del plato | Baja |
| **L4** — Aproximacion LLM | Sin coincidencia en BD | Muy baja |

El nivel de confianza siempre es visible para el usuario.

---

## Desarrollo

### Requisitos

- Node.js 20+
- PostgreSQL 16 con pgvector
- Redis
- Variables de entorno (ver `.env.example`)

### Setup

```bash
npm install
npx prisma migrate deploy --schema packages/api/prisma/schema.prisma
npm run build
```

### Tests

```bash
npm test                        # todos los workspaces
npm run -w @foodxplorer/bot test   # solo bot (1055 tests)
npm run -w @foodxplorer/api test   # solo API
```

### Metodologia

Este proyecto usa **Spec-Driven Development** con [sdd-devflow](https://github.com/pbojeda/sdd-devflow):

```
Spec -> Plan -> Implementacion TDD -> Validacion -> Code Review + QA -> Merge
```

Cada feature pasa por reviews cruzados con multiples modelos AI (Gemini, Codex, Claude) para spec, plan y codigo.

---

## Documentacion

| Documento | Descripcion |
|-----------|-------------|
| [`docs/user-manual-bot.md`](./docs/user-manual-bot.md) | Manual completo del bot con ejemplos |
| [`docs/specs/api-spec.yaml`](./docs/specs/api-spec.yaml) | Especificacion OpenAPI de la API REST |
| [`docs/project_notes/`](./docs/project_notes/) | Memoria del proyecto (tracker, decisiones, bugs) |
| [`docs/tickets/`](./docs/tickets/) | Tickets de cada feature con spec + plan + log |
| [`PRD.md`](./PRD.md) | Product Requirements Document |
| [`PLAN_MAESTRO.md`](./PLAN_MAESTRO.md) | Plan de desarrollo por fases |

---

## Roadmap

### Fase 1 — Bot + API (completada)

- [x] E001: Infrastructure & Schema
- [x] E002: Data Ingestion Pipeline (10 cadenas espanolas)
- [x] E003: Estimation Engine (4 niveles)
- [x] E004: Telegram Bot + API publica
- [x] E005: Advanced Analysis & UX (recetas, comparacion, contexto, OCR)

### Fase 1.5 — Landing & Growth (en progreso)

- [x] F039: Landing page (nutriXplorer.com)
- [x] F044: Landing overhaul (v5 design, A/B variants)
- [x] F045: Critical bug fixes
- [ ] F046: Waitlist + anti-spam
- [ ] F047: Conversion optimization
- [ ] F048: Performance & accessibility

### Fase 2 — Web app (planificada)

- [ ] Next.js app con busqueda y mapa
- [ ] Cuentas de usuario
- [ ] API publica v1 con documentacion

### Fase 3 — App movil (planificada)

- [ ] React Native (iOS + Android)
- [ ] Tracking de ingesta diaria

---

## Licencia

Licencia pendiente de definicion.

---

_Fase 1 completada - Marzo 2026 - [Spec-Driven Development](https://github.com/pbojeda/sdd-devflow)_
