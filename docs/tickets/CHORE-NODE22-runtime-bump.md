# CHORE-NODE22 — Bump runtime from Node 20 (EOL) to Node 22 LTS

**Status:** Backlog (not started — awaiting user go-ahead)
**Type:** Chore / maintenance (infra)
**Priority:** Medium — Node 20 is EOL; no functional regression today (BUG-PROD-012 is mitigated by the `ws` transport)
**Affects:** Render (`nutrixplorer-api-dev`, `-prod`), local dev, `engines.node`. CI already runs Node 22.

---

## Context

- Node 20 reached **EOL on 2026-04-30**. Render + local dev run Node 20; CI already runs Node 22 (`.github/workflows/ci.yml`). The runtime is behind CI and unsupported.
- This was surfaced by **BUG-PROD-012**: `@supabase/supabase-js` `createClient` throws on Node < 22 (no global `WebSocket`). Mitigated there with `realtime: { transport: ws }`. Node 22 provides a global `WebSocket`, which makes that transport workaround **removable**.

## Goal

Align the runtime to Node 22 LTS across Render + local + `engines.node`, validated locally before touching production.

## Plan (validate-first — do NOT touch Render until local is green)

1. Local: `nvm install 22 && nvm use 22`, then `npm ci` from a clean tree.
2. Run **all** suites + builds on Node 22 locally:
   - `npm test` (all workspaces) — api, shared, bot, scraper, landing, web.
   - `npm run build` for each package (esp. api `tsc`, web/landing Next builds).
   - Spot-check native/heavy deps: Prisma engine, sharp (if used), tesseract.js (OCR), playwright, ioredis. All support Node 22, but confirm empirically.
3. If green: bump `engines.node` to `>=22`, add `.node-version` (`22`) so Render + nvm pick it up.
4. Set Node version on Render `nutrixplorer-api-dev` (then `-prod`). Watch the rolling deploy; verify `/health?db=true` + a login smoke.
5. **Remove the `ws` transport workaround** in `packages/api/src/lib/supabaseAdmin.ts` (and optionally drop `ws`/`@types/ws` if not used elsewhere) — guarded by the `supabaseAdmin.test.ts` regression test, which deletes `globalThis.WebSocket` and will FAIL if the client can't construct without a global WebSocket. Decide whether to keep `ws` as belt-and-suspenders or remove it.
6. Consider whether to also pin CI to a specific Node 22 minor for reproducibility.

## Acceptance Criteria

- [ ] All suites + builds pass on Node 22 locally before any Render change.
- [ ] `engines.node` = `>=22`, `.node-version` = `22` committed.
- [ ] Render api-dev (then api-prod) on Node 22; `/health?db=true` green; login smoke green.
- [ ] Decision recorded on removing the `ws` transport workaround (BUG-PROD-012).

## Notes

Decoupled from BUG-PROD-012 on purpose: the user is risk-averse to a runtime change mid-release, and login needed an immediate, low-blast-radius fix. Pick this up after the F107a operator action + release bundle settle.
