# Análisis estratégico post-auth — nutriXplorer

**Fecha:** 2026-05-25
**Autor:** PM session (cross-model reviewed: Gemini + Codex, 2 rondas)
**Estado:** APROBADO con decisiones del owner (ver §A). Alimenta los tickets de la nueva tanda.

> Decide en qué invertir el esfuerzo tras shipear auth magic-link (F107a). Reemplaza a F099-lite como siguiente trabajo del PM session `pm-profiles`. Validado por dos rondas de cross-model review que destaparon un bug en producción (BUG-PROD-013).

---

## A. Decisiones del owner (2026-05-25)

1. **BUG-PROD-013** (500 en queries autenticadas): confirmar con prueba manual + **hotfix inmediato (P0a)**.
2. **Beta:** **signup abierto**; la waitlist queda como captación de marketing. **No** se construye flujo de invitación (se elimina como bloqueante).
3. **Orden de valor:** Tier + CTA primero (que el registro valga), luego el histórico.
4. **F099 (perfil salud + logging): diferido** indefinidamente. Auth → monetización suscripción, más adelante.

---

## B. Tesis

nutriXplorer es pre-beta cerrada, ~0 usuarios reales, solo-dev. El core (`/hablar`: consulta nutricional conversacional texto/foto sobre catálogo español de 319 platos) está vivo en prod. Auth recién shipeada (enabler, user value bajo). **Invertir el payoff de auth en:** arreglar la identidad autenticada (rota hoy), hacer que registrarse aporte valor (tier + CTA), y arreglar el dolor diario del histórico; voz realtime después. Diferir F099 (alta fricción + retención sin validar + gate RGPD Art.9). Ambos modelos confirman la dirección.

**Contra-argumento asumido (Gemini/Codex):** sin objetivo a largo plazo (tracking F099), el app es una utilidad *one-shot* con retención frágil; el histórico es QoL, no necesariamente razón de volver a diario. Mitigación: histórico **local primero** (mide uso) + lo decide la beta.

---

## C. Hallazgos empíricos (verificados file:line)

| # | Hallazgo | Implicación |
|---|---|---|
| **H0** 🔴 | **Queries autenticadas → HTTP 500.** `actorResolver` path bearer fija `accountId` y hace early-return **sin** `request.actorId` (único setter es l.119, path anónimo); `conversation.ts` l.83-89 (texto) y l.430-436 (voz) hacen `if(!actorId) return 500`. Front adjunta bearer (apiClient l.118/350). Front **nunca llama a `/me`** → linking actor↔cuenta de F107a muerto desde web. | Bug real (BUG-PROD-013); fundación rota |
| H1 | `HablarShell` guarda 1 resultado (`results`/`photoResults` useState) y lo **reemplaza** (l.253/364); sin persistencia | Histórico requiere refactor a feed |
| H2 | `query_logs` guarda **solo metadata** (sin payload nutricional) | Histórico requiere **tabla nueva** |
| H3 | Tier sale solo de `apiKeyContext` (API key), nunca del bearer web. **Foto:** proxy `/api/analyze` reenvía `X-Actor-Id` + `X-API-Key` de servidor **compartida** → límites/costes de foto **acoplados entre usuarios**, no por cuenta | "Registrarse sube de tier" no existe; foto siempre tratada como anónima |
| H4 | Tier-web e histórico necesitan lo mismo: un **principal** estable por cuenta | Identidad = fundación compartida |
| H5 | **Ya existe** instrumentación de uso (`trackEvent('query_sent'/'query_success')` en HablarShell); falta auth/historial/invitación + **segmentación anónimo/logueado** | Funnel a medias (extender, no greenfield) |

**Dato clave para el fix (auth.ts l.194-270):** `/me` **ya contiene** el patrón para materializar identidad en bearer: `request.actorId` → si no, `X-Actor-Id` (upsert actor) → si no, `provisionFallbackActor(auth_user_id)` (actor-ancla) + UPDATE de link seguro (predicado anti-hijack de F107a-FU2). El hotfix reutiliza esto.

---

## D. Plan secuenciado

```
P0a  HOTFIX 500 (BUG-PROD-013) ─── inmediato
P0b  Identidad "principal" + tier por cuenta (texto/voz + FOTO vía proxy)
 ├─ Instrumentación funnel (extender: login/signup/rate_limit/history + segmentación)
 ├─ F-WEB-AUTH-CTA  (signup abierto)
 ├─ F-WEB-TIER       (cuenta ⇒ free)
 ├─ F-WEB-HISTORY F1: transcript LOCAL → mide uso
 │        └─(si se usa)→ F2-3: persistencia + paginación
 └──────────────► 🚦 BETA → medir → F095 spike → voz
```

### Piezas

| Pieza | Qué | Complej. | Beneficio | Legal |
|---|---|---|---|---|
| **P0a** Hotfix 500 | Extraer la resolución de actor de `/me` (X-Actor-Id → `provisionFallbackActor` + link seguro) a un helper compartido y llamarla en el path bearer del `actorResolver`. Arregla el 500 **y** hace el linking resolver-side (elimina dependencia de que el front llame a `/me` — refinamiento Gemini). | Simple-Std | Crítico (desbloquea todo + bug) | — |
| **P0b** Principal + tier | Cuenta autenticada ⇒ tier `free` (50→100 queries, 10→20 fotos). Columna `accounts.tier` default `free` (D1). **Incluye identidad de cuenta a través del proxy `/api/analyze`** para que la foto suba de tier (gap Gemini: si no, medio producto no premia el registro). | Standard | Alto (valor registro) | — |
| Instrumentación | **Extender** sistema actual: `login_cta_*`, `signup_completed`, `rate_limit_hit`, `history_*` + breakdown anónimo/logueado | Simple-Std | Alto (beta enseña) | — |
| **F-WEB-AUTH-CTA** | Botón login/registro en header de `/hablar` (hoy no hay) + nudge al topar límite. Signup abierto. | Simple | Medio (conversión) | — |
| **F-WEB-TIER** | Mapear cuenta → free en el rate-limiter (sobre P0b) | Standard | Alto | — |
| **F-WEB-HISTORY F1** | Transcript **local** (sesión): refactor `HablarShell`/`ResultsArea` (singleton intent-renderer) a feed. Arregla "se borra" para todos + mide uso | Standard (cambio arquitectura UI) | Alto (dolor real) | — |
| **F-WEB-HISTORY F2-3** | Tabla `search_history(account_id, kind, query_text, result_jsonb, created_at)` + GET paginado cursor + persistencia texto/voz + borrado | Standard | Alto (si F1 valida) | Ligero (no Art.9) |
| F095 voz | Post-beta, sobre identidad fija; precedido de spike de coste | Std+spike | Alto (diferenciador) | — |
| ~~F099~~ | Perfil + logging | Standard | Condicional | **Alto (Art.9)** → diferir |

### Decisiones-fork pendientes (menores)
- **D1:** columna `accounts.tier` default `free` (recomendado) vs hardcode.
- **D3:** foto en histórico fuera de v1 (Fase 4 condicional).
- **D4:** retención histórico: cap blando (~500 entradas / 12 meses).
- **D5:** privacidad histórico: borrado CASCADE + acción "borrar historial" + nota política (no Art.9).

---

## E. Riesgos

1. **P0a/P0b tocan precedencia bearer (ADR-025 R3 §5)** — riesgo de reintroducir el hijack de F107a-FU2; reutilizar el predicado seguro + tests.
2. **Refactor HablarShell→transcript** = cambio de arquitectura UI; mitigar faseando (local primero) + TDD + reusar cards.
3. **Foto acoplada por key compartida (H3)** — abordar en P0b.
4. **Sin instrumentación, la beta no enseña** — extender funnel.
5. **Voz (F095)** — requiere spike de coste; sobre identidad fija.

---

## F. Traza cross-model

| Ronda | Gemini | Codex | Aportes clave |
|---|---|---|---|
| 1 | REVISE | REVISE | **Codex CRITICAL:** descubre BUG-PROD-013. Ambos: falta funnel + invitación; histórico infra-dimensionado; corrección foto H3 |
| 2 | REVISE | REVISE | Sin CRITICAL. Split P0a/P0b (hotfix vs refactor, reusa `/me`); foto-tier para autenticados; funnel = extensión no greenfield; linking resolver-side; secuencia CTA-vs-invite (resuelta: signup abierto) |

Ambos confirman: diferir F099 y voz-tras-transcript = correcto.
