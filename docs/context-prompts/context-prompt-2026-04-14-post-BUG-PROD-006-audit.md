# Context Prompt — 2026-04-14 post-BUG-PROD-006 audit

> Pega este prompt al principio de una nueva sesión de Claude Code para arrancar con
> full visibility. El agente debe leerlo COMPLETO antes de hacer nada.

---

## A) Estado actual del repositorio

**Fecha:** 2026-04-14
**Rama:** `develop`
**HEAD:** `ca9a488` — "fix(BUG-PROD-006): F085+F-UX-B conversation wiring — prisma threading + originalQuery + media_racion Tier 2 (#116)"
**Push status:** sincronizado con `origin/develop`. PR #116 mergeado y cerrado.

**SDD DevFlow:** v0.16.9 en foodXPlorer (library está en v0.17.0 — upgrade pendiente, ver tarea 7 abajo).

**Tests baseline:** 5445 tests (3270 api + 596 shared + 1221 bot + 358 web), 0 regressions.

**Lint baseline:** 109 errores pre-existentes en `@foodxplorer/api` (F116 pendientes), 27 en scraper. No introducidos por BUG-PROD-006. No bloquean CI.

---

## B) Pipeline — estado de las 7+1 issues originales

| # | Issue | Estado |
|---|-------|--------|
| 1 | BUG-PROD-001 mobile camera error | **DONE** — PR #103, `a750f5e` |
| 2 | BUG-PROD-002 mobile gallery picker | **DONE** — PR #105, `24e6d23` |
| 3 | BUG-PROD-003 vino/vinagre disambiguation | **DONE** — PR #107, `a23fd3f` |
| 4 | F-UX-A size modifier display | **DONE** — PR #109, `ecb78c5` |
| 5 | BUG-PROD-004 deploy-web redundante | **DONE** — PR #111, `88952d9` |
| 6 | F-UX-B spanish portion terms | **DONE** — PR #113, `d8167d0` |
| 7 | BUG-PROD-005 Render excess minutes | **PENDING** — pendiente investigación/decisión de tier |
| 8 | BUG-PROD-006 F085+F-UX-B wiring | **DONE** — PR #116, `ca9a488` |

---

## C) Próximas tareas en el orden aprobado por el usuario

### Tarea 0 (usuario): Manual smoke testing en /hablar

**El agente espera** a que el usuario haga smoke testing manual antes de arrancar
BUG-PROD-007, para evitar conflictos si el testing encuentra algo que requiera hotfix.

Queries a probar en `POST /conversation/message` o en la UI `/hablar`:

| Query | Resultado esperado |
|-------|-------------------|
| `'tapa de croquetas'` | `portionAssumption.term='tapa'`, `grams=50`, `pieces=2` |
| `'media ración de croquetas'` | `portionAssumption.term='media_racion'`, `grams=100` |
| `'TAPA DE CROQUETAS'` | mismo resultado que lowercase |
| `'ración grande de croquetas'` | `portionAssumption.grams=300`, `portionMultiplier=1.5` |
| `'bocadillo de jamón'` | `portionAssumption` ausente, `portionSizing.term='bocadillo'` |
| `'croquetas'` | `portionAssumption` ausente, `portionSizing` ausente |
| `'tapa de croquetas vs tapa de tortilla'` | comparison path — `portionAssumption` AUSENTE (expected, roto hasta BUG-PROD-007) |

Si manual testing o CI encuentran issues → hotfix antes de BUG-PROD-007.
Si todo clean → arrancar BUG-PROD-007.

### Tarea 1 — BUG-PROD-007 (Standard tier, ~1h)

**Contexto:** code-review-specialist identificó que los paths de comparison
(`conversationCore.ts` líneas 197–217) y menu (líneas 268–282) no pasan `prisma`
ni `originalQuery` a sus llamadas a `estimate()`. Exactamente la misma clase de
Bug 1+2 que BUG-PROD-006, pero para queries tipo "A vs B" y "menú del día".

**Root cause verificado por inspección:**
- `packages/api/src/conversation/conversationCore.ts`
  - ~línea 200: `estimate({ query: ..., chainSlug: ..., db, redis, openAiApiKey, ... })` — SIN `prisma` ni `originalQuery`
  - ~línea 270: idem para menu path

**Fix:** añadir `prisma` y deducir `originalQuery` del texto de cada dish en ambos call sites.

**Rama:** `bugfix/BUG-PROD-007-comparison-menu-wiring` desde `develop`.

**TDD (siguiendo ADR-021):**
- `f-ux-b.comparisonCore.integration.test.ts` — UUID prefix `fe000000-00fe-...`
- `f085.comparisonCore.integration.test.ts` — UUID prefix `ff000000-00ff-...`

**Scope ampliado (qa-engineer minor gaps de BUG-PROD-006 — cerrar de una):**
- Integration test `processMessage('media ración grande de croquetas')` → grams=100 (F042 compound, 'grande' dropped — comportamiento aceptado)
- Integration tests `processMessage('pintxo de croquetas')` y `processMessage('pincho de croquetas')` → `portionSizing.term='pintxo'`
- Assertion explícita cache key `'tapa de croquetas'` ≠ `'croquetas'`

**Docs:** entrada en `bugs.md`, tracker sync.
**Merge:** PR a develop (branch protection activo).

### Tarea 2 — Follow-up BUG-PROD-004 (1): delete deploy-landing.yml (Simple, ~15 min)

`rm .github/workflows/deploy-landing.yml` — mismo patrón que deploy-web en BUG-PROD-004.
Vercel GitHub App ya maneja el deploy de landing de forma nativa.

### Tarea 3 — BUG-PROD-005: Render excess minutes (pendiente decisión de approach)

**Contexto:** "Build Filters empty in Render dashboard → services were created manually,
not via Blueprint → `render.yaml` `buildFilter` config is not being applied."

El `render.yaml` tiene `buildFilter` configurado pero Render lo ignora en servicios
creados manualmente. Cada push (incluso solo docs) dispara rebuild completo en Docker.

**Opciones:**
1. Recrear servicios desde Blueprint (risky — posible downtime)
2. Configurar build filters via Render API o dashboard manualmente
3. Aceptar el comportamiento actual

**El agente NO debe arrancar este ticket sin confirmación del usuario sobre el enfoque.**

### Tarea 4 — sdd-devflow-pb upgrade a v0.17.0 (cuando pipeline esté estable)

Comando: `npx create-sdd-project@0.17.0 --upgrade --force --yes`

v0.17.0 ships provenance tracking (`.sdd-meta.json`). Primera vez en este proyecto →
fallback path (no existe `.sdd-meta.json` previo). Tener `--force-template` a mano.

---

## D) Backlog de follow-ups (no urgentes)

| ID | Descripción | Fuente |
|----|-------------|--------|
| BUG-F042-COMPOSE-SIZE-MODIFIERS | `'media ración grande de croquetas'` → F042 extrae solo el compound `'media ración'` (multiplier=0.5), drop silencioso de `'grande'` → 100g donde user intent era 150g. Investigar si F042 debe componer modificadores o documentar 100g como aceptado. | Audit post-BUG-PROD-006, LOW |
| logger.warn downgrade | `conversationCore.ts:353` warn sobre absent prisma → downgrade a debug level post-deploy | code-review nit |
| F116 lint cleanup | 109 errores `@typescript-eslint/no-non-null-assertion` en api + 27 en scraper | Pre-existing debt |

---

## E) Contexto histórico relevante

### BUG-PROD-006 (cerrado — PR #116, `ca9a488`)
- Ticket: `docs/tickets/BUG-PROD-006-f085-fux-b-conversation-wiring.md`
- 3 bugs: prisma no threaded (Bug 1) + stripped query para detección (Bug 2) + media_racion Tier 2 double-count (Bug 3)
- ADR-021 en `docs/project_notes/decisions.md` — "Full-flow integration tests MUST call processMessage() directly"
- F-UX-B postscript: `docs/tickets/F-UX-B-spanish-portion-terms.md` (final del archivo)

### F-UX-B (cerrado — PR #113, `d8167d0`)
- 3-tier portionAssumption: Tier1=DB lookup, Tier2=media_racion×0.5, Tier3=F085 generic
- StandardPortion table activa. CSV seed pipeline: `npm run seed:standard-portions -w @foodxplorer/api`

### SDD DevFlow versions
- foodXPlorer: v0.16.9 | Library sdd-devflow-pb: v0.17.0

### Cross-model review pattern
- Codex = bug-finder agentic (verifica empíricamente contra el código)
- Gemini = standards-compliance checker (cita base-standards.mdc, convenciones)

---

## F) Convenciones del proyecto

| Convención | Detalle |
|-----------|---------|
| Branching | gitflow: `bugfix/*` desde `develop`; `hotfix/*` desde `main` |
| Branch protection | `develop` y `main` — PR obligatorio + `ci-success` requerido |
| Commit format | `fix(BUG-PROD-XXX):` / `test(BUG-PROD-XXX):` / `docs(BUG-PROD-XXX):` |
| TDD obligatorio | Commit RED primero (tests fallando), luego commit GREEN (fix). ADR-021. |
| Integration tests | `{feature-id}.conversationCore.integration.test.ts` para tests via `processMessage()` |
| UUID prefixes ocupados | `fa`=F-UX-B general, `fb`=estimateRoute, `fc`=f085 conversation, `fd`=f-ux-b conversation |
| UUID prefix libre | **`fe`** para el siguiente test file |
| Mock strategy | Mockear solo: `contextManager` + `lib/cache` + `engineRouter`. Todo lo demás real. |
| Merge a develop | Via PR (branch protection). No push directo. |
| Test command | `npx vitest run packages/api` (unit + integration) |
| DB test | `postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test` |

---

## G) Cómo debe arrancar la siguiente sesión

1. Leer `docs/project_notes/product-tracker.md` (Active Session)
2. Verificar estado de PR #116 en GitHub → ya mergeado (`ca9a488`)
3. Leer este context prompt completo
4. Preguntar al usuario si ya hizo el manual smoke testing en `/hablar`
5. Si smoke testing OK → preguntar "¿arrancamos BUG-PROD-007?"
6. **NO empezar código hasta confirmación explícita del usuario**

---

*Context prompt generado: 2026-04-14. PR #116 mergeado a develop en `ca9a488`.*
