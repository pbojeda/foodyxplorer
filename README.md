# foodXPlorer

> **La base de datos nutricional abierta de restaurantes** — para restaurantes lo que Open Food Facts es para productos envasados.

[![Estado](https://img.shields.io/badge/estado-Fase%20A1%20completa-brightgreen)](https://github.com)
[![Bot](https://img.shields.io/badge/bot-Telegram-blue)](https://t.me/foodXPlorerBot)
[![Metodologia](https://img.shields.io/badge/metodologia-Spec--Driven%20Development-teal)](https://github.com/pbojeda/sdd-devflow)

---

## Que es foodXPlorer

foodXPlorer es una plataforma open source para consultar informacion nutricional de platos de restaurantes y cadenas. Resuelve un problema concreto: **cuando comes fuera de casa, estas ciego nutricionalmente**.

Las apps de nutricion (MyFitnessPal, Fitia) estan pensadas para tracking en casa. Las apps de restaurantes (TheFork, TripAdvisor) no tienen informacion nutricional. foodXPlorer cubre ese hueco.

**Como funciona:** un motor de estimacion de cuatro niveles devuelve valores nutricionales con nivel de confianza explicito — siempre sabes si estas viendo datos oficiales, una estimacion por ingredientes, una extrapolacion por similitud o una aproximacion por LLM. El bot de Telegram es la interfaz principal. Tambien acepta mensajes de voz.

---

## Estado actual

Fase 1 + Fase A0/A1 completadas. Bot de Telegram funcional con voz, menus, cocina espanola y 250 platos canonicos.

| Componente | Estado | Notas |
|------------|--------|-------|
| API REST | Funcionando | Fastify + PostgreSQL + pgvector + Redis. 21 migraciones |
| Bot Telegram | Funcionando | 13 comandos + NL + voz + analisis de menus |
| Motor de estimacion | Funcionando | 4 niveles + cooking yield + alias matching |
| Pipeline de ingestion | Funcionando | 14 cadenas + 1 restaurante virtual (cocina-espanola) |
| Base de datos BEDCA | Importada | Base espanola de composicion de alimentos (Tier 1) |
| Landing page | Funcionando | nutriXplorer.com (Next.js) |
| Tests | ~5188 passing | 5 workspaces, build y lint clean |

---

## Funcionalidades del bot

### Comandos principales

| Comando | Descripcion |
|---------|-------------|
| `/estimar <plato> [en <cadena>]` | Estima nutrientes de un plato |
| `/comparar <plato_a> vs <plato_b>` | Compara dos platos lado a lado |
| `/menu <plato1, plato2, ...>` | Estima un menu completo (varios platos) |
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
menu: ensalada, filete, flan     (estima un menu completo)
```

### Mensajes de voz

Envia un mensaje de voz y el bot lo transcribe automaticamente (Whisper) y procesa como texto. Soporta estimaciones, comparaciones y menus:

```
[audio] "dos pinchos de tortilla"     -> estimacion con porcion x2
[audio] "menu: ensalada y un filete"  -> estimacion de menu
```

Limite: 30 segundos por mensaje, 50 mensajes de voz al dia.

### Contexto conversacional

Cuando dices "estoy en mcdonalds" o usas `/contexto mcdonalds`, el bot recuerda la cadena durante 2 horas. Las consultas siguientes se filtran automaticamente por esa cadena sin necesidad de especificarla cada vez.

### Modificadores de porcion

```
doble big mac           (x2)
media racion de pollo   (x0.5)
big mac xl              (x1.5)
tapa de calamares       (prefijo de formato eliminado)
```

### Cocina espanola

250 platos canonicos espanoles disponibles sin necesidad de seleccionar cadena. Aliases regionales reconocidos automaticamente:

```
bravas                      -> Patatas bravas
bocata de jamon             -> Bocadillo de jamon serrano
tortilla espanola           -> Tortilla de patatas
cana                        -> Cerveza (cana)
tapa de calamares           -> Calamares a la romana
```

### Menu del dia

Estima varios platos a la vez y muestra el total nutricional:

```
/menu ensalada mixta, filete de pollo, flan
menu: sopa, merluza a la plancha, fruta
```

Muestra cada plato individual + totales agregados (15 nutrientes).

### Soporte de alcohol

Bebidas alcoholicas se estiman con el nutriente alcohol (7 kcal/g). Se muestra con el indicador de cerveza cuando el alcohol es > 0.

### Analisis de menus (foto/PDF)

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
  api/        Fastify REST API (estimacion, busqueda, ingestion, recetas, conversacion)
  bot/        Telegram bot (node-telegram-bot-api, voz, menus)
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
ORM         Prisma (21 migraciones) + Kysely (queries complejas)
Bot         node-telegram-bot-api
Landing     Next.js 14 + Tailwind + Framer Motion
LLM         OpenAI API (interpretacion, recetas, voz via Whisper)
Scraping    Crawlee + Playwright
Infra       Render + Supabase + Upstash + Cloudflare
```

### Motor de estimacion

| Nivel | Cuando aplica | Confianza |
|-------|---------------|-----------|
| **L1** — Dato oficial | El plato existe en BD con datos del restaurante | Alta |
| **L2** — Estimacion por ingredientes | Se conocen los ingredientes y sus pesos | Media |
| **L3** — Extrapolacion por similitud (pgvector) | Solo existe el nombre del plato | Baja |
| **L4** — Aproximacion LLM | Sin coincidencia en BD. Incluye yield por estado de coccion | Muy baja |

El nivel de confianza siempre es visible para el usuario. Los datos de prioridad mas alta (BEDCA > restaurante > USDA > estimado) se muestran primero.

### Datos disponibles

| Fuente | Tipo | Platos/Alimentos |
|--------|------|------------------|
| Cadenas espanolas (14) | Datos oficiales | ~1400 platos |
| Cocina espanola (virtual) | BEDCA + estimacion | 250 platos canonicos |
| BEDCA | Base nacional | 20 alimentos (placeholder, pendiente autorizacion AESAN) |
| USDA SR Legacy | Base internacional | 514 alimentos |

### Nutrientes rastreados (15)

Calorias, proteinas, carbohidratos, azucares, grasas, grasas saturadas, fibra, sal, sodio, grasas trans, colesterol, potasio, grasas monoinsaturadas, grasas poliinsaturadas, alcohol.

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
npm test                          # todos los workspaces
cd packages/api && npx vitest run # solo API (~2710 tests)
cd packages/bot && npx vitest run # solo bot (~1143 tests)
```

### Metodologia

Este proyecto usa **Spec-Driven Development** con [sdd-devflow](https://github.com/pbojeda/sdd-devflow) v0.13.2:

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
| [`docs/research/product-evolution-analysis-2026-03-31.md`](./docs/research/product-evolution-analysis-2026-03-31.md) | Analisis de evolucion del producto (Fase 2) |

---

## Roadmap

### Fase 1 — Bot + API (completada)

- [x] E001: Infrastructure & Schema
- [x] E002: Data Ingestion Pipeline (14 cadenas espanolas)
- [x] E003: Estimation Engine (4 niveles)
- [x] E004: Telegram Bot + API publica
- [x] E005: Advanced Analysis & UX (recetas, comparacion, contexto, OCR)

### Fase A0 — Fundaciones (completada)

- [x] F068: Provenance Graph (prioridad de fuentes de datos)
- [x] F069: Anonymous Identity (actor table)
- [x] F070: Conversation Core (NL compartido API + bot)

### Fase A1 — Cobertura espanola (completada)

- [x] F071: Import BEDCA (base espanola de alimentos)
- [x] F072: Cooking Profiles + Yield Factors
- [x] F073: 250 platos canonicos espanoles
- [x] F074: Extraccion de estado de coccion (L4)
- [x] F075: Input de voz (Whisper)
- [x] F076: Modo Menu del Dia
- [x] F077: Soporte de alcohol
- [x] F078: Aliases regionales
- [x] F079: Pipeline de expansion por demanda

### Fase B — Features de valor sin auth (pendiente)

- [ ] F080: Open Food Facts (11K productos)
- [ ] F081-F089: Sustituciones, alergenos, porciones, busqueda inversa, tapeo compartido

### Fase C — Asistente web conversacional (pendiente)

- [ ] F090-F097: Web assistant (/hablar), voz en tiempo real

### Fase D — Escala y monetizacion (pendiente)

- [ ] F098-F109: Perfiles, tracking, API B2B, app movil

---

## Licencia

Licencia pendiente de definicion.

---

_Fase A1 completada - Abril 2026 - [Spec-Driven Development](https://github.com/pbojeda/sdd-devflow)_
