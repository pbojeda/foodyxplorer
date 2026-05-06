# Telemetry & Logging Audit — /hablar (Consolidated)

**Date:** 2026-04-29
**Auditor:** Claude Opus 4.7 (1M context)
**Scope:** `packages/web` + `packages/api` + `packages/landing`
**Branch at audit time:** `develop` @ `c335262` (post pm-h6plus3 closure)
**Trigger:** downstream agent designing a new telemetry feature; this audit precedes their ticket creation
**Status:** research only — no tickets created yet, no code changes

---

## Methodology

Read-only audit. For each finding the source-of-truth is a `file:line` citation that the reader can verify. When evidence was absent, the finding is marked **❌ No existe** with the grep patterns used. No claim is asserted from reasoning alone.

Six rounds of exploration:
1. Silent inventory (glob + grep across the 3 packages)
2. Schema first (`packages/api/prisma/schema.prisma` + migrations)
3. F069 queryLogger module + call sites
4. Web app structure (layout, hablar page, apiClient, metrics)
5. Onboarding / consent / banners (web + landing)
6. Bot crossref + synthesis

---

## Executive Summary

- **`query_logs`** (F029) — per-query log server-side with full text (≤255 chars), `level_hit`, `cache_hit`, `response_time_ms`, `actor_id`, `api_key_id`, `source`, `queried_at`. Fire-and-forget from `conversation.ts` (12 call sites) and `estimate.ts`.
- **`actors`** (F069) — stable anonymous identity per device: web uses UUID in `localStorage` key `nxi_actor_id`; bot uses `telegram:<chatId>`. No sessions, no timeouts, no auth.
- **`web_metrics_events`** (F113) — opt-in aggregated metrics (gated by `NEXT_PUBLIC_METRICS_ENDPOINT` env var, **empty** in `.env.local.example`); no PII.
- **Landing** has full GDPR cookie banner and legal pages. **Web does not.**

**Most urgent gaps:**
1. **GDPR/LSSI**: `/hablar` loads GA4 without consent gate; broken `/privacidad` links from VoiceOverlay; server-side full-text logging without user information. Individual entity + LSSI compliance gap.
2. **Misleading `source` enum**: web → `source='api'` (mixed with third-party API). Any "web vs bot" dashboard is incorrect unless joined with `actors.type`.
3. **Silent truncation `query_text` 255 chars**: code in `conversation.ts:215,247` uses `.slice(0,500)` — DB column is VARCHAR(255). Verify empirically.
4. **No user-context tagging**: to evolve UX (e.g. card layouts by `at_home` vs `in_restaurant`) requires migration described in §5.2.

---

## 1. Sistema de logging de consultas

### 1.1 ¿Existe un sistema que persiste cada consulta del usuario en la DB?

**Respuesta**: Sí. Dos tablas distintas con propósitos diferentes:
- `query_logs` (F029) — per-query logging server-side, una fila por consulta procesada por la API.
- `web_metrics_events` (F113) — métricas **agregadas** por sesión cliente (counts, intents, no per-query), enviadas vía `sendBeacon` desde la web.

**Evidencia**:
- `packages/api/prisma/schema.prisma:479-500` — modelo `QueryLog` (mapeo `query_logs`).
- `packages/api/prisma/migrations/20260321160000_query_logs_f029/migration.sql:6-29` — DDL F029.
- `packages/api/prisma/schema.prisma:549-564` — modelo `WebMetricsEvent` (mapeo `web_metrics_events`).
- `packages/api/src/routes/webMetrics.ts:78-150` — endpoint POST `/analytics/web-events`.

**Estado**: ✅ Confirmado.

### 1.2 ¿Qué campos se guardan? Lista exacta con tipos.

**Tabla `query_logs`** (`schema.prisma:479-500`):

| Campo | Tipo SQL | Nullable | Notas |
|---|---|---|---|
| `id` | UUID | NO | PK, default `gen_random_uuid()` |
| `query_text` | VARCHAR(255) | NO | **Truncación silenciosa a 255 chars** |
| `chain_slug` | VARCHAR(100) | YES | ej. `mcdonalds`, `vips` |
| `restaurant_id` | UUID | YES | sin FK (audit inmutable) |
| `level_hit` | enum `query_log_level_hit` (`l1`/`l2`/`l3`/`l4`) | YES | ver §1.4 |
| `cache_hit` | BOOLEAN | NO | |
| `response_time_ms` | INTEGER | NO | |
| `api_key_id` | UUID | YES | sin FK |
| `actor_id` | UUID | YES | añadido por F069 |
| `source` | enum `query_log_source` (`api`/`bot`) | NO | default `api` |
| `queried_at` | TIMESTAMPTZ | NO | default `now()` |

**Tabla `web_metrics_events`** (`schema.prisma:549-564`):

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `query_count`, `success_count`, `error_count`, `retry_count` | UUID + 4 × INT | counts agregados |
| `intents`, `errors` | JSONB | distribuciones por categoría |
| `avg_response_time_ms` | INT | |
| `session_started_at`, `received_at` | TIMESTAMPTZ | sesión cliente, no servidor |
| `ip_hash` | VARCHAR(64) nullable | hash, no IP plana |

**Evidencia**: `packages/api/prisma/schema.prisma:479-500`, `:549-564`; `migrations/20260321160000_query_logs_f029/migration.sql:10-23`; `migrations/20260402120000_anonymous_identity_f069/migration.sql:25`; `migrations/20260408140000_add_web_metrics_events/migration.sql:1-15`.

**Estado**: ✅ Confirmado.

**Notas**: `query_text` está limitado a 255 chars — código no trunca explícitamente en todos los call sites (en `conversation.ts:215,247` hay `.slice(0,500)` que **excede** el límite SQL → trunca silenciosamente Postgres en runtime o lanza). Posible fuente de bug — verificar empíricamente.

### 1.3 ¿Se persiste el contenido de la consulta? ¿Anonimizado o íntegro?

**Respuesta**:
- **Texto**: íntegro hasta 255 chars en `query_logs.query_text` (sin redacción/hash).
- **Voz**: la transcripción de Whisper se persiste como texto íntegro (entra al pipeline como `text` tras transcribir; se loguea `est.query` no la transcripción raw).
- **Foto**: NO se persiste URL ni binario ni nombre de fichero. Solo se loguea el resultado de la identificación (un texto tipo `est.query` derivado del dish identificado, con prefijo `'menú: '` para `menu_estimation`).
- En `web_metrics_events`: 0 contenido — solo counts y enums (`intents`, `errors`).

**Evidencia**:
- `packages/api/src/routes/conversation.ts:152-166` (estimation), `:178-208` (comparison), `:209-226` (menu_estimation con `'menú: ' + items.map(i => i.query).join(', ')`), `:227-242` (context_set: persiste `body.text` literal), `:243-258` (text_too_long: `body.text.slice(0,500)`).
- `packages/api/src/routes/estimate.ts:139` — `queryText: query` literal.
- `packages/web/src/lib/metrics.ts:5` — comment "Privacy-first: no PII, no query text — only aggregate counts and timings".

**Estado**: ✅ Confirmado.

**Notas**: Ojo conflicto — `text_too_long` y `context_set` persisten **lo que el usuario escribió literalmente** sin redacción. Si la consulta L4-cascade falla o si es un context_set tipo "estoy en mcdonalds", el texto del usuario va íntegro a DB.

### 1.4 ¿Se persiste el nivel del motor (L1/L2/L3/L4)?

**Respuesta**: Sí. Campo `level_hit` enum `query_log_level_hit` con valores `l1`/`l2`/`l3`/`l4` (nullable cuando no aplica, ej. context_set, comparison cache failure, menu).

**Evidencia**:
- `packages/api/prisma/schema.prisma:101-108` (enum), `:484` (campo).
- `packages/api/src/routes/conversation.ts:146-150` (derivación desde `level1Hit/level2Hit/level3Hit/level4Hit` flags).
- `packages/api/src/routes/estimate.ts:158-168` (mismo patrón).

**Estado**: ✅ Confirmado.

---

## 2. Concepto de sesión

### 2.1 ¿Existe el concepto de "sesión" en la web app?

**Respuesta**: NO existe sesión server-side. Existen DOS conceptos parciales:
1. **"Actor"** server-side (F069): identidad estable persistida — NO es sesión, es identificador de dispositivo/cliente que vive indefinidamente.
2. **"Session" client-side** (en `metrics.ts`): solo timestamp `sessionStartedAt` que se inicializa la primera vez que se carga `metrics.ts` y persiste en `localStorage` bajo clave `fxp_metrics`. NO se invalida por timeout, NO se rota — solo se resetea cuando `flushMetrics()` envía exitosamente al backend (que requiere env var no configurada).

**Evidencia**:
- `packages/api/src/plugins/actorResolver.ts:1-83` — actor middleware (sin concepto de sesión, persiste `last_seen_at` solamente).
- `packages/api/prisma/schema.prisma:463-472` — `Actor` table sin campos de sesión.
- `packages/web/src/lib/metrics.ts:62-72` — `createEmptyState()` setea `sessionStartedAt: new Date().toISOString()`.
- `packages/web/src/lib/metrics.ts:212-221` — `resetMetrics()` solo se llama tras flush exitoso (`:234`).

**Estado**: ✅ Confirmado.

### 2.2 ¿Las consultas se agrupan por `session_id` en logging?

**Respuesta**: NO. La tabla `query_logs` no tiene `session_id`. Solo `actor_id` (identidad estable, no sesión).

**Evidencia**: `packages/api/prisma/schema.prisma:479-500` — sin columna session_id.

**Estado**: ❌ No existe (grep'd: `session_id`, `sessionId`, `session` en schema.prisma — solo aparece en `web_metrics_events.session_started_at` que es timestamp client-side de la "sesión" agregada).

### 2.3 ¿Qué timeout de inactividad cierra una sesión?

**Respuesta**: NO HAY timeout. El `actor_id` no expira; `last_seen_at` se actualiza en cada request pero no hay lógica de expiración. La "sesión" client-side de `metrics.ts` no tiene timeout — solo se resetea al flushear.

**Evidencia**:
- `packages/api/src/plugins/actorResolver.ts:102-115` — upsert sin TTL.
- Búsqueda de `timeout`, `idle`, `expir` en `metrics.ts` y `actorResolver.ts` → ningún timeout.

**Estado**: ❌ No existe (grep'd: `timeout|idle|expir|TTL`).

---

## 3. Identificación de usuario

### 3.1 ¿Hay sistema de cuentas/auth en la web app?

**Respuesta**: ANÓNIMO. No hay auth/login/cuentas en la web app. Existe el enum `actor_type` con valor `authenticated` reservado para futuro pero NO está en uso.

**Evidencia**:
- `packages/api/prisma/schema.prisma:93-99` — enum `ActorType { anonymous_web, telegram, authenticated }`.
- `packages/api/src/plugins/actorResolver.ts:66-80` — solo dos ramas activas: `telegram:` prefix → `telegram`; UUID válido → `anonymous_web`; nada genera `authenticated`.
- `packages/web/src/components/HablarShell.tsx` — sin imports de auth, sin login/signup UI.

**Estado**: ✅ Confirmado.

### 3.2 ¿Qué se guarda como user_id?

**Respuesta**: N/A — no hay auth.

### 3.3 Si es anónimo, ¿qué identificador estable se usa?

**Respuesta**: UUIDv4 generado en cliente vía `crypto.randomUUID()` y persistido en `localStorage` bajo clave `nxi_actor_id`. El servidor lo upserta en tabla `actors` (`type='anonymous_web'`, `external_id=<uuid>`). Si el cliente envía un UUID inválido o falta el header `X-Actor-Id`, el servidor genera uno nuevo y lo devuelve en el response header `X-Actor-Id`.

Properties:
- **Persistencia**: localStorage (sobrevive cierre de tab; NO sobrevive limpieza de site data, navegación incógnita, cambio de dispositivo).
- **Fallback**: UUID en memoria del JS module si localStorage no disponible (private browsing) — se pierde al recargar.
- **Identificador en DB**: `actors.id` (UUID interno) ≠ `actors.external_id` (el UUID de localStorage). El `query_logs.actor_id` referencia `actors.id` interno.

**Evidencia**:
- `packages/web/src/lib/actorId.ts:1-54` — implementación completa cliente.
- `packages/api/src/plugins/actorResolver.ts:60-84` — header parsing.
- `packages/api/src/plugins/actorResolver.ts:95-152` — upsert/create.

**Estado**: ✅ Confirmado.

**Notas**: NO hay browser fingerprinting, NO hay cookie persistente. Solo localStorage. La "estabilidad" depende de que el usuario no limpie site data.

---

## 4. UI de inicio de sesión

### 4.1 ¿Hay pantalla de bienvenida / onboarding?

**Respuesta**: NO hay pantalla de bienvenida ni onboarding general. La única "pre-permission" UI es el screen de consentimiento de micrófono que aparece la primera vez que el usuario intenta usar voz (`hablar_mic_consented` flag en localStorage). Para texto y foto NO hay nada — el usuario aterriza directamente en el chat con el placeholder `EmptyState` ("¿Qué quieres saber?").

**Evidencia**:
- `packages/web/src/app/page.tsx:1-5` — root `/` redirige a `/hablar` (sin landing intermedio).
- `packages/web/src/app/hablar/page.tsx:11-21` — render directo de `<HablarShell />` + `<HablarAnalytics />`.
- `packages/web/src/components/HablarShell.tsx:426-500` — render directo header + ResultsArea + ConversationInput, sin gate de bienvenida.
- `packages/web/src/components/EmptyState.tsx:4-13` — placeholder estático "¿Qué quieres saber? Escribe, habla o sube una foto…".
- `packages/web/src/components/VoiceOverlay.tsx:5,85-89,133` — única "pre-permission screen" gated por `hablar_mic_consented` (solo voz).

**Estado**: ✅ Confirmado.

### 4.2 ¿Dónde está implementada la pre-permission existente?

**Respuesta**: Inline en `VoiceOverlay.tsx` (componente ya cargado). No hay componente onboarding separado.

### 4.3 ¿Dónde sería el sitio natural para añadir una pregunta inicial al usuario?

**Respuesta**: Tres puntos candidatos, ordenados por menor invasividad:

1. **`HablarShell.tsx`** (primer render) — añadir state `hasOnboarded` leyendo localStorage; si false, renderizar un componente nuevo `<WelcomeOverlay />` antes de `<ResultsArea />`. Patrón ya establecido por VoiceOverlay (overlay condicional).
2. **`EmptyState.tsx`** — sustituir el placeholder estático por un formulario inicial (más intrusivo, cambia UX existente).
3. **`hablar/page.tsx`** — gate server-side via cookie (requeriría infraestructura nueva: cookie tracking que actualmente NO existe).

Opción 1 es la pragmática y consistente con el patrón actual.

---

## 5. Estado de contexto por consulta

### 5.1 ¿Existe campo de "ubicación del usuario" tipo in_restaurant/at_home?

**Respuesta**: NO existe campo de "ubicación del usuario". Lo más cercano es el flujo `intent='context_set'` (F070) — el pipeline detecta cuando el usuario dice "estoy en McDonald's" y lo guarda como **estado de conversación** (probablemente Redis o memoria, NO en `query_logs`). En `query_logs` solo aparece `chain_slug` (ej. `mcdonalds`) cuando la consulta se asoció a una cadena.

**Evidencia**:
- `packages/api/prisma/schema.prisma:479-500` — sin campos `location`, `in_restaurant`, `at_home`, `context_tag`.
- Búsqueda grep `in_restaurant|at_home|location|context_tag|user_context` en `schema.prisma` y `routes/` → 0 hits relevantes.
- `packages/api/src/routes/conversation.ts:227-242` — caso `intent === 'context_set'`: se persiste `body.text` íntegro como `query_text` con `chainSlug=null, restaurantId=null, levelHit=null` — el contexto NO se persiste como campo dedicado.

**Estado**: ❌ No existe.

### 5.2 ¿Qué migración haría falta para añadirlo?

**Propuesta** (research only — sin ADR, sin ticket, sin cross-model review):

```sql
CREATE TYPE "user_context_tag" AS ENUM (
  'unknown',
  'at_home',
  'in_restaurant',
  'on_the_go',
  'planning'
);

ALTER TABLE "query_logs"
  ADD COLUMN "user_context_tag" "user_context_tag" NOT NULL DEFAULT 'unknown';

CREATE INDEX "query_logs_user_context_tag_idx"
  ON "query_logs" ("user_context_tag");
```

**Cambios en código**:
- `packages/api/prisma/schema.prisma:479-500` — añadir field `userContextTag` con enum.
- `packages/api/src/lib/queryLogger.ts:24-34` — extender `QueryLogEntry`.
- `packages/api/src/routes/conversation.ts` — pasar el tag en cada call site (12 call sites + 1 en `estimate.ts:136`).
- `packages/web/src/lib/apiClient.ts:96-105` — añadir header `X-User-Context-Tag` (o body field) al POST.

**Decision pendiente** (requiere review antes de implementar):
- Tag por-sesión (sticky en localStorage / `actors.default_context_tag`) o por-consulta (form before each query, override en `query_logs.user_context_tag`).
- Cardinality del enum: si se expande con fechas/ocasiones (cumpleaños, etc.) explota.
- ¿Es realmente necesario el override por-query o `default` basta? Validar con datos reales tras desplegar.

**Riesgos no evaluados**: cardinality skew del índice; coupling actor mutation if `default_context_tag` lives en `actors`.

**Estado**: ✅ Propuesta — no implementada.

---

## 6. RGPD y consentimiento

### 6.1 ¿Hay banner de consentimiento o política de privacidad activa?

**Respuesta**:
- **Web (`packages/web`)**: NO hay cookie banner, NO hay consent banner general, NO hay rutas `/privacidad`, `/cookies`, `/aviso-legal`. La VoiceOverlay enlaza a `/privacidad` (`VoiceOverlay.tsx:186`, `VoicePickerDrawer.tsx:214`) — esa ruta NO existe en `packages/web/src/app/` (solo existen `page.tsx` y `hablar/page.tsx`). **Enlace roto en la web app actual** (probablemente apunte al dominio landing nutrixplorer.com cross-domain — no verificado).
- **Landing (`packages/landing`)**: SÍ tiene CookieBanner completo, rutas `/privacidad`, `/cookies`, `/aviso-legal`, gestión GA4 cookies, opt-in/opt-out, key `nx-cookie-consent` en localStorage.

**Evidencia**:
- `packages/web/src/app/` — solo `page.tsx`, `hablar/page.tsx`, `api/analyze/route.ts`. SIN páginas legales.
- `packages/web/src/components/VoiceOverlay.tsx:186` — `href="/privacidad"` (ruta inexistente en web).
- `packages/web/src/components/VoicePickerDrawer.tsx:214` — `href="/privacidad#voz"`.
- `packages/landing/src/components/analytics/CookieBanner.tsx:1-60` — implementación completa, key `nx-cookie-consent`.
- `packages/landing/src/app/{privacidad,cookies,aviso-legal}/` — directorios existen.
- `packages/web/src/app/layout.tsx:35-57` — GA4 carga incondicional (sin gate de consent) cuando `NEXT_PUBLIC_GA_MEASUREMENT_ID` está set. **Posible incumplimiento RGPD si la env var está poblada en producción** — verificar.

**Estado**: ⚠️ Parcial — landing OK, web NO. Adicional gap: enlaces `/privacidad` rotos desde web. GA4 sin consent gate en web.

### 6.2 ¿Se pide consentimiento explícito antes de loguear consultas?

**Respuesta**: NO. La web no muestra ningún consent prompt antes de la primera consulta. El servidor escribe a `query_logs` siempre — fire-and-forget en `reply.raw 'finish'`. El único consent UI es para mic (`hablar_mic_consented`), que NO es consent de logging.

**Evidencia**:
- `packages/web/src/components/HablarShell.tsx:197-280` — `executeQuery` no consulta consent.
- `packages/api/src/routes/conversation.ts:108-111` — `reply.raw.once('finish', ...)` siempre dispara `logQueryAfterReply`.
- `packages/web/src/components/VoiceOverlay.tsx:5,133` — `hablar_mic_consented='shown'` (flag de "ya vio el screen", no consent legal).

**Estado**: ❌ No existe.

**Notas**: Para entidad individual (LSSI), el deber de información sobre tratamiento de datos en `query_logs` (texto íntegro de consulta = potencial dato personal) probablemente requiere al menos aviso legal accesible, idealmente consent explícito si se va a usar para fines distintos del servicio. Gap potencial — revisar con criterio legal.

---

## 7. Compartición con bot Telegram

### 7.1 ¿Tabla compartida o sistemas separados?

**Respuesta**: COMPARTIDA — pero con flujo asimétrico. El bot NO escribe directamente a `query_logs`; el bot llama a la API HTTP (`/conversation/message`) y es la API la que escribe a `query_logs`. Solo existe UNA tabla `query_logs`.

**Evidencia**:
- `grep -rn "writeQueryLog\|queryLog\.create" packages/bot/src` → 0 hits no-test. El bot no importa `queryLogger`.
- `packages/bot/src/__tests__/*.test.ts` — múltiples tests con `actorId: '...'` confirman que el bot **envía** actorId pero no maneja logging local.
- `packages/api/src/plugins/actorResolver.ts:35,66-73` — bot identifica via header `X-Actor-Id: telegram:<chatId>`; servidor crea actor `type='telegram'`.
- `packages/api/prisma/schema.prisma:489-499` — única tabla `query_logs`, sin variantes.

**Estado**: ✅ Confirmado.

### 7.2 ¿Cómo se distingue el origen?

**Respuesta**: Dos campos lo distinguen, parcialmente redundantes:

1. **`source`** (enum `query_log_source`: `api` | `bot`) — derivado del header `X-FXP-Source` que envía el cliente (`'web'` o `'bot'`). El parsing es: `firstVal === 'bot' ? 'bot' : 'api'` — es decir, **web se loguea como `source='api'`** porque cualquier valor que NO sea exactamente `'bot'` cae en `'api'`.
2. **`actor_id` → `actors.type`** (`anonymous_web` | `telegram` | `authenticated`) — más fiable que `source` para distinguir web vs bot, ya que `actors.type` se determina del prefix `telegram:` en el header `X-Actor-Id`.

**Evidencia**:
- `packages/api/src/routes/conversation.ts:94-101` — parsing `X-FXP-Source`: `source = firstVal === 'bot' ? 'bot' : 'api'`.
- `packages/api/src/routes/estimate.ts:106-113` — mismo pattern.
- `packages/web/src/lib/apiClient.ts:101` — web envía `'X-FXP-Source': 'web'` → mapea a `source='api'`.
- `packages/api/prisma/schema.prisma:110-115` — enum solo tiene `api` y `bot`, no `web`.

**Estado**: ⚠️ Parcial — el campo existe pero el etiquetado es **engañoso**: `source='api'` mezcla web + clientes API third-party (vía API_KEY). Si quieres segregar web de bot fielmente, usar JOIN con `actors.type` o añadir valor `'web'` al enum. Bug latente para analítica — verificar antes de cualquier dashboard de "uso por canal".

---

## Anexo A — Roadmap auth/tiers/registro

Lo que está **planificado pero no implementado**.

### A.1 Estado actual del sistema de identidad — base sobre la que se construirá auth

El patrón `actor_id` (F069) **ya está diseñado como puente hacia auth** — no es solución temporal. Cuando llegue el registro, los datos históricos se preservan porque referencian `actor_id`, no `user_id`.

**Evidencia**:
- `docs/tickets/F069-anonymous-identity.md:15` — *"The actor pattern provides this without friction, and seamlessly migrates to authenticated accounts in Phase D (F107)."*
- `docs/project_notes/decisions.md:493` (ADR-016) — *"Need a pattern that works without auth today but enables seamless migration to authenticated accounts later without data loss."*
- `packages/api/prisma/schema.prisma:93-99` — el enum `ActorType { anonymous_web, telegram, authenticated }` ya tiene reservado el valor `authenticated`.

### A.2 Roadmap de funcionalidades que dependen de auth

| Phase | Week | ID | Feature | Status | Auth requerido |
|---|---|---|---|---|---|
| **C** | 13 | **F098** | Premium Tier (Feature Gates) | pending | No directamente — gates por API key tier |
| **C** | 13 | **F099** | User Profiles: Goals, BMR, Daily Targets | pending | **SÍ — primer feature que lo requiere** |
| **D** | 15 | **F102** | API B2B Tiers + Documentation | pending | API key (no user auth) |
| **D** | 16 | F103 | Weekly Summary + Charts | pending | Sí (depende F099) |
| **D** | 17-18 | **F107** | **Auth Upgrade: Google Identity Platform** | pending | **Feature de implementación de auth** |
| **D** | 19-20 | F108 | PWA Shell | pending | Sí (depende F099/F107) |
| **D** | 19-20 | F109 | Apple Health / Google Fit Export | pending | Sí (depende F099) |

**Evidencia**: `docs/project_notes/product-tracker.md:386-407`; `docs/research/product-evolution-analysis-2026-03-31.md:781-810`.

### A.3 Solución técnica de registro/login (NO DECIDIDA)

**Decisión pendiente** explícitamente listada en el plan de evolución:

> *"5. **Auth provider:** Evaluate Google Identity Platform (free tier, multi-provider) vs Supabase Auth (already in stack) vs Auth0. Decision needed before Phase B but actor_id pattern allows deferral."*

**Evidencia**: `docs/research/product-evolution-analysis-2026-03-31.md:1441`.

| Opción | Pros (según plan) | Contras |
|---|---|---|
| **Google Identity Platform** | Free tier; multi-provider (Google/email/Apple); recomendado en F107 ticket original | Vendor lock-in Google; no email-magic-link nativo |
| **Supabase Auth** | Ya en el stack; RLS integrado; magic links | Acopla auth a vendor de DB |
| **Auth0** | Madurez, UI prebuilt | Coste, infraestructura adicional |

El plan original (`product-tracker.md:405`) llama al ticket **"F107 — Auth Upgrade: Google Identity Platform"** sugiriendo la inclinación inicial. **ADR explícito de selección NO ha sido tomado.**

### A.4 ADR-016 — Flujo de migración actor → user

Contrato técnico que el agente downstream debe respetar.

**Evidencia**: `docs/project_notes/decisions.md:517-521`.

```
Cuando un usuario autentica vía F107 (Google Identity Platform):

1. Crear fila en tabla `users` (NUEVA, NO existe aún) con datos del proveedor.
2. Ejecutar "ATTACH actor → user":
   - Actualizar actors.type → 'authenticated'
   - Añadir FK actors.user_id → users.id
3. Datos históricos preservados:
   - query_logs.actor_id sigue apuntando al mismo actor
   - favorites.actor_id (TABLA NUEVA, no existe aún), meal_log.actor_id (NUEVA), corrections.actor_id (NUEVA)
4. Multi-device: cada dispositivo crea un actor_id nuevo; todos se linkan al mismo user_id en su primer login.
```

**Tablas nuevas implícitas en ADR-016 que aún NO existen**:
- `users` (cuentas autenticadas)
- `favorites`
- `meal_log` (tracking diario)
- `corrections` (community corrections)

**Evidencia (negativa)**: `grep -nE "^model (User|Favorite|MealLog|Correction)" packages/api/prisma/schema.prisma` → 0 hits.

### A.5 Tiers — taxonomía actual vs futura (¡ojo a la confusión!)

#### A.5.1 Tiers de USUARIO (existe HOY, F-TIER merged 2026-04-21)

Aplican a la app web/bot. Identifican via `api_keys.tier`:

| Tier | Source | queries/day | photos/day | voice/day |
|---|---|---|---|---|
| `anonymous` | Sin API key | 50 | 10 | 30 |
| `free` | API key tier=free | 100 | 20 | 30 |
| `pro` | API key tier=pro | 500 | 100 | 120 |
| `admin` | API key tier=admin | ∞ | ∞ | ∞ |

**Evidencia**: `docs/tickets/F-TIER-rate-limits.md:22-47`. `basic` está **deferred** explícitamente.

#### A.5.2 Tiers de API B2B (futuro F102, Phase D)

Distinta tabla mental — para **clientes externos consumiendo la API**, no usuarios finales:

| Tier | Precio | Quota |
|---|---|---|
| Free | €0 | 100/mes |
| Starter | €49/mes | 5K/mes |
| Business | €199/mes | 50K/mes |

**Evidencia**: `docs/project_notes/product-tracker.md:400`.

⚠️ **Importante para downstream agent**: `Starter`/`Business` son tiers de API B2B (F102), NO tiers de usuario final.

#### A.5.3 F098 Premium Tier (Phase C, Week 13)

Añadirá **feature gates** sobre los tiers actuales (F-TIER ya gestiona rate limits). Lo nuevo: bloqueo de features (no solo throttling) — ej. tracking solo para `pro`.

**Evidencia**: `docs/project_notes/product-tracker.md:390`.

### A.6 Implicaciones directas para el diseño de la nueva feature de telemetría

1. **El "user_context_tag" propuesto en §5.2 debe coexistir con auth futuro.** Si añades el campo en `query_logs.user_context_tag`, el contrato sigue siendo válido tras F107 — el `actor_id` solo cambia su `actors.type` a `authenticated`, no se pierde.

2. **Si la feature implica "primera pregunta al usuario", el sitio natural es `actors.locale` ya existente** o un nuevo campo nullable en `actors` (ej. `default_context_tag`). Persiste cross-session sin requerir registro.

3. **No diseñar consent/registration UI en `packages/web` asumiendo que F107 va a llegar pronto.** Phase D = semanas 17-18 en el plan; hoy estamos en Phase B/C. Cualquier consent UI en web hoy debería ser **anónimo + opt-in**, no acoplado a una cuenta.

4. **Si la feature requiere "session" en sentido estricto (timeout, agrupación), tienes dos opciones**:
   - (a) Crear tabla nueva `actor_sessions` con TTL — no rompe ADR-016.
   - (b) Usar `last_seen_at + threshold` en SQL queries para definir sesión retrospectiva. Más simple, no requiere migración.

5. **Para el banner GDPR/consent en web**, usar el patrón ya validado en `packages/landing/src/components/analytics/CookieBanner.tsx` (key `nx-cookie-consent`, opt-in para GA4). NO duplicar — extraer a `packages/shared` si se va a reusar.

6. **Tier-aware behavior**: si la nueva feature debe comportarse distinto por tier (ej. "solo `pro` ve histórico completo"), F-TIER ya expone `request.apiKeyContext.tier`. Si depende de "estar registrado" (post-F107), `actors.type === 'authenticated'`.

---

## Anexo B — Respuestas a 4 puntos del agente downstream

### B.1 GDPR en /hablar como P0 pre-beta (1-2 días dev)

**No es decisión del auditor** — la priorización P0/P1/timeline es del owner. Lo que sí se afirma empíricamente:

**Lo que está roto/ausente hoy en `packages/web`** (riesgo legal real para entidad individual + LSSI):
- GA4 carga **sin consent gate** cuando `NEXT_PUBLIC_GA_MEASUREMENT_ID` está set (`packages/web/src/app/layout.tsx:35-57`).
- No hay banner, no hay aviso legal, no hay política de privacidad accesible.
- Enlaces a `/privacidad` desde `VoiceOverlay.tsx:186` y `VoicePickerDrawer.tsx:214` apuntan a una ruta que **no existe en el web app**.
- Logging server-side persiste texto íntegro de consultas en `query_logs.query_text` sin información al usuario.

**Lo que existe y es reusable**:
- `packages/landing/src/components/analytics/CookieBanner.tsx` ya tiene la maquinaria completa.
- Páginas `/privacidad`, `/cookies`, `/aviso-legal` ya existen en landing.

**Lo que NO se sabe**:
- Si "1-2 días dev" es realista — depende de extraer a `packages/shared` o duplicar, de cross-domain vs replicar páginas, y de testing.
- Si hay calendario "pre-beta" formal — no aparece en `product-tracker.md` ni en research.

**Recomendación técnica** (no decisión): el riesgo es real (GA sin consent + entidad individual responsable directa), y el coste está acotado por la reusabilidad del CookieBanner del landing. Si la beta abre tráfico real, esto debería bloquearla. Decisión P0/P1 del owner.

### B.2 Patrón `actors.default_context_tag` + `query_logs.user_context_tag` con override

**Confirmado** que es un patrón coherente con la arquitectura, **caveat**: es propuesta del auditor, no decisión validada. **No hay ADR, no hay ticket, no hay revisión cross-model.**

**Por qué encaja**:
- `actors` ya tiene precedente de campo nullable opcional (`locale` — `schema.prisma:467`).
- `query_logs` es audit-only inmutable (`schema.prisma:492-493`). Añadir `user_context_tag` mantiene la inmutabilidad.
- Sobrevive al upgrade de F107 (actor.type → 'authenticated') porque ambos campos viven en el grafo `actor_id`.

**Riesgos no evaluados**:
- Cardinalidad razonable del enum.
- ¿Override por-query realmente necesario o `default` basta?
- Cardinality del índice `query_logs_user_context_tag_idx` — high skew puede inutilizarlo.

**Recomendación**: cross-model review (Codex + Gemini) antes de comprometerlo a un ticket.

### B.3 Sync plan técnico ↔ master — ¿product-tracker vivo?

**`product-tracker.md` está VIVO y operativo**, no snapshot histórico. Evidencia empírica:

- Última modificación: **2026-04-29 19:06:10** — commit `a49c0e3` *"docs(F-H7-FU1): Step 6 housekeeping — close ticket + bugs.md RESOLVED + tracker sync"*.
- Patrón consistente: cada PR cierre incluye "tracker sync" en housekeeping Step 6 del SDD-DevFlow.

**Sobre F099 / Phase C / week 13**: el tracker lo tiene listado como `pending` (`product-tracker.md:391`), pero **no se afirma empíricamente que F099 siga planificado para "week 13"** — la numeración viene de `product-evolution-analysis-2026-03-31.md` (commit del 2026-04-02, no modificado desde entonces) y son **semanas indicativas relativas** del plan original, no fechas absolutas.

**Sobre `master §14.6`**: el auditor **NO sabe qué es** "master §14.6". Grep en `docs/project_notes/`, `docs/research/` no devuelve referencias. Si "master" es un documento fuera del repo, no se puede opinar sobre sincronizarlo sin verlo.

### B.4 Auth provider decision (F107) — ¿tomada / en curso / diferida?

**DIFERIDA. No tomada, no en curso.**

Evidencia empírica:

- **No hay ADR de auth provider** en `decisions.md`. ADR-016 menciona Google Identity Platform como ejemplo del flujo de migración (`decisions.md:517`), pero el ADR mismo es sobre identidad anónima, no sobre selección de provider.
- **No existe ticket F107** en `docs/tickets/` (`ls docs/tickets/ | grep F107` → 0 hits). Solo está listado como pending en el tracker (`product-tracker.md:405`).
- **Decisión explícitamente diferida** en el plan: *"Decision needed before Phase B but actor_id pattern allows deferral"* (`product-evolution-analysis-2026-03-31.md:1441`). El patrón `actor_id` se construyó para poder posponer.
- **Phase target**: weeks 17-18 (`product-evolution-analysis-2026-03-31.md:805`).

**Caveat de alcance**: solo se ha buscado en este repo. Si hay un trello/notion/linear externo donde se llevan decisiones de producto, no hay visibilidad y la respuesta podría cambiar.

---

## Status & next actions

**Este documento**: research only. No tickets creados, no código modificado.

**Decisiones pendientes del owner** (necesarias antes de tickets):
1. GDPR /hablar — P0 pre-beta vs deferred? (§6, §B.1)
2. `default_context_tag` patrón — pasar a cross-model review antes de ADR? (§5.2, §B.2)
3. F107 auth provider — adelantar decisión o mantener diferido a Phase D? (§A.3, §B.4)

**Hilos donde el auditor NO sabe** (preguntar antes de actuar):
- Calendario beta concreto — no en docs.
- "master §14.6" — referencia externa no visible en el repo.
- Si la operator action post pm-h6plus3 (redeploy + reseed dev) ya se ejecutó.

**Cómo este doc va a ser usado**: el agente downstream que diseña la feature de telemetría leerá esto y creará tickets cuando vaya a implementar. Tickets NO se han pre-creado — siguiendo YAGNI y para no generar churn antes de decisiones.

---

*Documento generado durante sesión de research el 2026-04-29. Verificación de citas: cada `file:line` debe revalidarse antes de implementar — el código puede haber cambiado. Para auditoría de auth/tiers/registro futuros, ver §A.*
