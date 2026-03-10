# 🥦 NutriTrack _(nombre provisional)_

> **La base de datos nutricional abierta de restaurantes** — para restaurantes lo que Open Food Facts es para productos envasados.

[![Estado](https://img.shields.io/badge/estado-en%20desarrollo-orange)](https://github.com)
[![Fase](https://img.shields.io/badge/fase-1%20MVP-blue)](./PLAN_MAESTRO.md)
[![Licencia](https://img.shields.io/badge/licencia-por%20definir-lightgrey)](./LICENSE)
[![Metodología](https://img.shields.io/badge/metodología-Spec--Driven%20Development-teal)](https://github.com/pbojeda/sdd-devflow)

---

## ¿Qué es esto?

NutriTrack es una plataforma open source para consultar información nutricional de platos y restaurantes. Resuelve un problema concreto: **cuando comes fuera de casa, estás ciego nutricionalmente**.

Las apps de nutrición (MyFitnessPal, Fitia) están pensadas para el tracking en casa. Las apps de restaurantes (TheFork, TripAdvisor) no tienen información nutricional. NutriTrack cubre ese hueco.

**Cómo funciona:** un motor de estimación de tres niveles devuelve valores nutricionales con nivel de confianza explícito — siempre sabes si estás viendo datos oficiales, una estimación o una extrapolación. El LLM interpreta tu consulta y presenta el resultado. El motor calcula.

---

## Estado actual

> ⚠️ **Proyecto en fase inicial de desarrollo.** El nombre, branding y modelo de negocio están pendientes de definición. El stack técnico y el modelo de datos son propuestas iniciales sujetas a revisión.

| Componente | Estado |
|------------|--------|
| PRD | ✅ Completo (v1.0) |
| Modelo de datos | ✅ Propuesta inicial documentada |
| Plan de desarrollo | ✅ Completo (v1.0) |
| Nombre definitivo | 🔲 Pendiente |
| Branding | 🔲 Pendiente |
| Modelo de negocio | 🔲 Pendiente |
| Repositorio / código | 🔲 En arranque (Fase 1) |

---

## Documentación del proyecto

| Documento | Descripción |
|-----------|-------------|
| [`PRD.md`](./PRD.md) | Product Requirements Document — visión, usuarios, casos de uso, arquitectura, modelo de negocio |
| [`PLAN_MAESTRO.md`](./PLAN_MAESTRO.md) | Plan de desarrollo completo — metodología SDD, épicas, features, cronograma, KPIs |
| [`nutritrack-db-diagram.md`](./nutritrack-db-diagram.md) | Modelo de datos completo con diagramas Mermaid |
| [`nutritrack-market-research.md`](./nutritrack-market-research.md) | Investigación de mercado — competidores, tamaño de mercado, oportunidad |
| [`docs/project_notes/`](./docs/project_notes/) | Memoria institucional del proyecto (sdd-devflow) |
| [`docs/specs/`](./docs/specs/) | Especificaciones de épicas y features |

---

## Stack técnico _(propuesta inicial)_

```
Backend     Node.js + TypeScript · Fastify · Prisma + Kysely
Base datos  PostgreSQL + pgvector + JSONB
Caché       Redis
Scraping    Crawlee + Playwright
LLM         OpenAI / Anthropic API (solo capa de interpretación)
Bot         node-telegram-bot-api
Web         Next.js (SSR para SEO)
App móvil   React Native (Fase 3)
Infra       Docker · Railway / Render
```

---

## Roadmap

### Fase 1 — Bot de Telegram + API (semanas 1-6)
- [ ] Infrastructure & Schema (E001)
- [ ] Data Ingestion Pipeline — 10 cadenas españolas (E002)
- [ ] Estimation Engine — 3 niveles (E003)
- [ ] Telegram Bot + API pública v0 (E004)

### Fase 2 — Web (meses 3-5)
- [ ] Web promocional + newsletter (pre-lanzamiento)
- [ ] Next.js app con búsqueda y mapa
- [ ] Cuentas de usuario + reconocimiento por foto
- [ ] Portal de restaurantes (beta)
- [ ] API pública v1 con documentación

### Fase 3 — App Móvil (meses 6-9)
- [ ] React Native (iOS + Android)
- [ ] Tracking de ingesta diaria
- [ ] Programa de partners con restaurantes

Ver [`PLAN_MAESTRO.md`](./PLAN_MAESTRO.md) para el detalle completo.

---

## Motor de estimación

El producto incluye un motor determinístico de tres niveles que cubre cualquier plato:

| Nivel | Cuándo aplica | Confianza |
|-------|---------------|-----------|
| **Nivel 1** — Dato oficial | El plato existe en BD con datos del restaurante | 🟢 ALTA |
| **Nivel 2** — Estimación por ingredientes | Se conocen los ingredientes pero no los valores calculados | 🟡 MEDIA |
| **Nivel 3** — Extrapolación por similitud (pgvector) | Solo existe el nombre del plato | 🔴 BAJA |

> El nivel de confianza siempre es visible para el usuario. Nunca se presenta una estimación como un dato oficial.

---

## Metodología de desarrollo

Este proyecto usa **Spec-Driven Development** con [sdd-devflow](https://github.com/pbojeda/sdd-devflow):

```
Spec aprobada → Plan aprobado → Implementación TDD → Validación → Review → Merge
```

**Principios inmutables:**
1. **Spec First** — ningún código sin spec aprobada
2. **Small Tasks** — una feature, un PR
3. **TDD** — test rojo → código mínimo → test verde
4. **Type Safety** — TypeScript strict, Zod en todos los boundaries
5. **English Only** — código, commits y specs en inglés
6. **Reuse Over Recreate** — comprobar antes de crear

---

## Posicionamiento

> _"[Nombre del producto] es para restaurantes lo que Open Food Facts es para productos envasados: la base de datos abierta, colaborativa y verificada de referencia."_

**Mercado objetivo:** España primero · LATAM segundo · Global después

**Referentes estratégicos:**
- **Nutritionix** — valida el modelo B2B: 25K restaurantes ya pagan por gestionar sus datos en EEUU. España es territorio libre.
- **Open Food Facts** — valida el modelo colaborativo: 4M productos en 150 países con datos abiertos y API pública.

---

## Pendiente de definir

- [ ] Nombre definitivo del producto
- [ ] Branding (logotipo, paleta, tipografía, tono de voz)
- [ ] Modelo de negocio (freemium, precios, open core vs SaaS)
- [ ] Plan de marketing
- [ ] Licencia open source (MIT / Apache 2.0 / AGPL)

---

## Contribuir

El proyecto está en fase inicial de arranque. Las contribuciones estarán abiertas una vez se publique la primera versión funcional del bot (Fase 1). Mientras tanto, puedes:

- ⭐ Dejar una estrella si el proyecto te parece interesante
- 📬 Contactar si eres un restaurante interesado en colaborar
- 🐛 Abrir un issue si encuentras algún problema en la documentación

---

## Licencia

Licencia pendiente de definición. Ver [`PRD.md § 8`](./PRD.md#8-pendientes-estratégicos) para el análisis de opciones (MIT / Apache 2.0 / AGPL).

---

_Versión 1.0 · Marzo 2026 · Spec-Driven Development + [sdd-devflow](https://github.com/pbojeda/sdd-devflow)_
