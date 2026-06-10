# F-DOCS-WEB-MANUAL-refresh — Refresh user-manual-web.md to current prod state

**Type:** Docs-only (SDD Simple / Path A) · **Branch:** `docs/web-manual-refresh` (off `develop`)
**Date:** 2026-06-10 · **Owner:** pbojeda

---

## 1. Problem

`docs/user-manual-web.md` is stamped **2026-04-11** ("includes F090, F092, F093, F112, F113"). Since then ~2 months of major web features shipped and are **live in prod** as of 2026-06-10 (release `ca4eb04`, PR #324/#325). The manual now **contradicts** what a user sees in `/hablar`. Four critical desyncs + several minor ones.

## 2. Goal

Rewrite/extend `user-manual-web.md` so it matches current live behavior, end-user oriented, Spanish, same voice/format as today. **No code changes. Only this one file.**

## 3. Verified ground-truth facts (from source, file:line)

> All numbers below verified directly in source on 2026-06-10. Reviewers: please flag any I should re-check.

### Tiers + límites (`packages/api/src/plugins/actorRateLimit.ts:41-44`) — buckets are SEPARATE (not shared)

| Tier | queries/día | photos/día | voice/día |
|------|-------------|------------|-----------|
| **anónimo** (sin login) | 50 | 10 | 30 |
| **free** (registrado) | 100 | 20 | 30 |
| **pro** (futuro) | 500 | 100 | 120 |
| **admin** | ∞ | ∞ | ∞ |

- Endpoint→bucket: `/estimate`+`/conversation/message`→queries; `/analyze/menu`→photos; `/conversation/audio`→voice.
- Tier enum `free|pro|admin`, default `free`; client reads `account.tier ?? 'free'` (`packages/shared/src/schemas/auth.ts:38,55`).
- UsageMeter copy (`UsageMeter.tsx:226,229,235,238`): "Usadas hoy: X de Y", "Te quedan: Z", "Se reinicia: mañana", "Plan gratuito · 100 consultas, 20 fotos, 30 voz por día". Admin → meter oculto. Fetch fallido → meter no se muestra (degradación elegante).
- RateLimitNudge (anónimo al tocar tope): "Regístrate gratis y obtén el doble de consultas diarias (100 en lugar de 50)." + CTA "Crear cuenta gratis" → `/login`. Solo para anónimos.

### Login / Auth (F107a, magic-link, OPCIONAL)

- Anónimo ve botón "Iniciar sesión" en cabecera (`LoginCta.tsx`). → `/login`.
- `/login`: campo Email (placeholder `tu@email.com`) + botón "Entrar con email" → "Revisa tu correo — te hemos enviado un enlace de acceso…" (`LoginForm.tsx`).
- Click en enlace del email → callback verifyOtp → redirige a `/hablar` logueado.
- UserMenu: avatar → email + "Cerrar sesión".
- Login desbloquea: historial persistente + tier `free` (100 q/día vs 50 anónimo).

### Historial (F-WEB-HISTORY) — el cambio conceptual más grande

- Las consultas **se acumulan** en un feed append-only (`TranscriptFeed`). YA NO "cada consulta reemplaza la anterior".
- **Logueado** → persistido en BD (cross-device, permanente). **Anónimo** → solo sesión del navegador (se pierde al cerrar).
- Persiste: texto + voz (voz sin transcripción → "Consulta por voz"). **Foto NO se persiste** (solo sesión).
- Borrar una entrada: papelera + confirm inline "¿Eliminar? [Cancelar] [Eliminar]" (auto-revert ~5 s); badge "Guardado" en entradas persistidas.
- Borrar todo: link "Borrar todo el historial" → modal "Vas a eliminar todo tu historial de búsqueda. Esta acción no se puede deshacer." [Cancelar]/[Borrar todo].
- Estado vacío logueado: "Aún no tienes historial. Tus consultas de texto y voz se guardarán aquí automáticamente."
- Nudge anónimo (≥2 entradas): "Guarda tu historial entre sesiones. Regístrate para no perder tus consultas." + "Crear cuenta gratis".
- Retención: prune-on-write ~500 entradas / 12 meses (ADR-028); DELETE en CASCADE; no datos Art. 9.

### Voz (F091) — LIVE, ya no "próximamente"

- Botón micro activo; solo se deshabilita mientras procesa (`MicButton.tsx:76`).
- Tap (<200 ms) → overlay a pantalla completa; Hold (≥200 ms) → grabar mientras mantienes; arrastrar izq. >80 px cancela.
- Gate de consentimiento 1ª vez: "¿Podemos escucharte?" + explicación Whisper + "Permitir micrófono" (`hablar_mic_consented`).
- Estados: "Toca para hablar" / "Habla ahora" / "Procesando…" / "Respondiendo…".
- TTS (lectura en voz alta) **activado por defecto**; selector de voz (solo voces españolas del dispositivo), toggle "Respuesta hablada", nota "Las voces disponibles dependen de tu dispositivo.", link "Cómo procesamos tu voz →" `/privacidad#voz`.
- Límites: 120 s máx por grabación (auto-stop por silencio ~2 s). Cap 30 voz/día (anon+free), 120 (pro). Badge de presupuesto (punto ámbar) si la voz está temporalmente desactivada → aria "Buscar por voz — temporalmente desactivada".

### Foto: toggle de modo (F-WEB-MENU-VISION-001)

- Toggle bajo el campo de texto: "Solo este plato" (modo `identify`, **DEFAULT**) vs "Menú/carta" (modo `auto`).
- Carta/menú multi-plato → "Se han encontrado N platos" + lista scrollable; badge "Lista incompleta" si parcial; tap en plato → consulta de seguimiento.
- Formatos JPEG/PNG/WebP; máx 10 MB (reescalado cliente >1,5 MB). Sin atributo `capture` (móvil muestra selector cámara/galería).

### Composer / input bar (ADR-030/FU7)

- Campo texto (textarea 1–3 líneas, placeholder "¿Qué quieres saber?") + cámara + micro + enviar (naranja, solo con texto). Enter envía, Shift+Enter salto. Límite 500 chars (server: intent `text_too_long` → "Demasiado largo. Máx. 500 caracteres.").

## 4. Edit plan by manual section

| Sección | Acción |
|---------|--------|
| Header (fecha/provenance) | Actualizar a 2026-06-10 + lista de features (F107a, F-WEB-TIER, F-WEB-HISTORY/FU7, F091, F-WEB-MENU-VISION) |
| TOC | Reordenar/añadir: Cuenta e inicio de sesión, Historial, Voz (live), Límites por plan |
| §1 Qué es /hablar | QUITAR "no es un chat con historial / cada consulta reemplaza". Describir feed acumulativo + historial. |
| §3 Pantalla principal | Input bar: micro **activo**; añadir toggle de foto; describir feed + cabecera (login/medidor/menú usuario). |
| §5 Tipos de respuesta | Mantener (follow-ups 30 min ya correctos). Ajuste menor de redacción. |
| §6 Foto | Añadir toggle "Solo este plato"/"Menú/carta" + lista multi-plato. |
| **NUEVA** Cuenta e inicio de sesión | Magic-link opcional, qué desbloquea, cerrar sesión. |
| **NUEVA** Historial | Feed acumulativo (todos) + persistencia (logueado) + borrar entrada/todo + nudge. |
| §11 Límites | Reescribir: 3 buckets separados (consultas/fotos/voz) × tier + medidor de uso + nudge. |
| §12 Privacidad | Añadir: email de cuenta, retención de historial, audio→Whisper (descartado). |
| §15 Accesibilidad | Micro ya no "próximamente"; añadir a11y de voz, historial (papelera/modal focus-trap). |
| §16 Voz | Reescribir entera de "próximamente" → feature completa. |
| §17 Config técnica | Añadir auth/bearer, `/me`, `/me/usage`, `/history`; env vars Supabase. |
| §18 FAQ | "¿Necesito cuenta?" → matizar (no obligatorio, recomendable). Añadir FAQs voz/historial/login/límites. |
| §19 Referencia rápida | Tabla límites por plan; atajos; añadir voz/foto-modos. |
| Footer | Mantener nota "generado contra código fuente". |

## 5. Non-goals

- No tocar `api-manual.md` ni `user-manual-bot.md`.
- No cambiar código ni specs.
- No documentar internals admin más allá de §17.
- No prometer features no enviadas (p. ej. realtime voice F095, foto persistida).

## 6. Risks / edge cases (for cross-model review)

1. ¿Las cifras de tier son las correctas y vigentes? (verificadas en `actorRateLimit.ts:41-44`).
2. ¿Anónimo realmente pierde el historial al cerrar? (sí, solo memoria de sesión).
3. No sobre-prometer: foto NO persiste en historial.
4. Voz puede estar "temporalmente desactivada" por presupuesto → el manual debe avisar.
5. Consistencia interna de anclas del TOC tras añadir secciones.
6. Tono: usuario final, no developer (salvo §17).

## 7. Acceptance

- [ ] Las 4 desyncs críticas (historial, login, tiers, voz) corregidas.
- [ ] Cifras de límites = source of truth (solo anónimo + gratuito en el doc).
- [ ] TOC y anclas coherentes.
- [ ] Copy citado coincide con el de la app (citado con moderación).
- [ ] Solo se modifica `docs/user-manual-web.md` (+ este ticket).
- [ ] Cross-model review aplicada antes de implementar.

## 8. Cross-model review R1 — resolutions (Gemini + Codex, ambos REVISE, alta convergencia)

Aplico todos los must-fix. Decisiones:

1. **NO leak de internals al cuerpo del manual.** Sin `ADR-NNN`, PR#, commits, F-codes, endpoints, schemas, enums ni nombres de componente en el texto visible. Header usa lista en lenguaje llano (inicio de sesión, historial, voz, planes de uso). El **§17 (administradores) ya existe** en el manual y es admin-scoped → se mantiene casi igual; **NO** se inyectan bearer/JWT/endpoints. (Corrige mi plan original de §17.)
2. **Historial NO "permanente".** Reformular a "se guarda en tu cuenta"; mención llana de que historiales muy largos o antiguos pueden recortarse para proteger privacidad. Sin cifras internas de poda/CASCADE/Art.9.
3. **Tiers: solo anónimo + gratuito.** Tabla de límites documenta esos dos. `pro`/`admin` NO se publican; una línea de "podríamos ofrecer planes mayores en el futuro".
4. **Privacidad audio preciso:** audio → OpenAI Whisper para transcribir, se procesa y **no se almacena** (espejo del texto de fotos).
5. **Estados al agotar cupo** (anónimo y gratuito): texto/foto/voz se bloquean, mensaje + reinicio diario. Documentar por bucket.
6. **Errores de voz:** permiso de micro denegado, navegador/dispositivo sin soporte, cancelación manual, sin voz detectada, fallo de red durante "Procesando…", voz "temporalmente desactivada" (no depende del usuario).
7. **Errores/limitaciones de foto:** formato no soportado, demasiado grande, borrosa/sin platos, resultado parcial, selector cámara/galería en móvil.
8. **Anónimo vs logueado (escenarios reales):** lo hecho sin sesión NO se guarda en la cuenta al iniciar sesión; "Borrar todo" afecta a toda la cuenta; historial guardado visible en cualquier dispositivo donde inicies sesión. (No sobre-especificar logout multidispositivo — sin dato sólido.)
9. **Foto NO se guarda en historial:** aviso explícito y destacado en Historial y en Foto.
10. **Accesibilidad:** describir el resultado accesible (diálogos manejables por teclado, anuncios a lector de pantalla), no el mecanismo (`focus-trap`).
11. **Acceso/soporte:** FAQ "no me llega el enlace / enlace caducado" (copy real "El enlace de acceso ha expirado o ha sido cancelado. Solicita uno nuevo.").
12. **Estructura:** "Cuenta e inicio de sesión" pronto (tras §2). Revisar anclas con tildes/`/`. No insinuar que "enviar" es la única forma de consultar (voz/foto también).
13. **Offline / estados vacíos:** documentar sin conexión, sin resultados, sin historial, sin platos detectados.

Verdict tras aplicar: proceder a implementación (no se requiere R2 — convergencia total, sin desacuerdos).
