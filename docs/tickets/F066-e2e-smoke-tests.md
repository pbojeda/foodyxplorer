# F066: E2E Smoke Tests

**Feature:** F066 | **Type:** Test | **Priority:** Low
**Status:** Backlog | **Branch:** —
**Created:** 2026-03-30 | **Dependencies:** None
**Audit Source:** Comprehensive Validation Phase 3 — Integration/E2E test assessment

---

## Spec

### Description

The current test suite (~4000+ tests) uses Fastify's `app.inject()` for route testing — in-process HTTP simulation that never binds a port. While this is fast and effective for unit/route testing, it cannot catch issues in:

- Middleware/plugin registration order (only exercised at `app.listen()` time)
- Real HTTP header parsing (Content-Type negotiation, CORS preflight)
- Network-level timeouts and connection handling
- Rate limiting behavior with real Redis counters

This ticket adds a minimal E2E smoke test suite that starts a real HTTP server and makes real `fetch()` requests.

### Scope

Minimal smoke suite — NOT full API coverage. Goal: validate that the server starts, routes are reachable, and auth works end-to-end.

### Proposed Tests (~10 tests)

1. **Server starts** — `app.listen()` binds successfully
2. **GET /health** — returns 200 with `{status: "ok"}`
3. **GET /estimate?query=big+mac** — returns 200 with result (anonymous)
4. **GET /estimate** — returns 400 VALIDATION_ERROR (missing query)
5. **GET /estimate with invalid API key** — returns 401 UNAUTHORIZED
6. **GET /chains** — returns 200 with array
7. **GET /quality/report with admin key** — returns 200
8. **GET /quality/report without admin key** — returns 401
9. **CORS preflight** — OPTIONS request returns correct headers
10. **Rate limit headers present** — X-RateLimit-Limit, X-RateLimit-Remaining

### Infrastructure

- Test database: `foodxplorer_test` (already exists)
- Redis: `localhost:6380` (already exists)
- Server: bind on random available port (`:0`)
- Vitest config: separate `vitest.config.e2e.ts` or tagged with `@e2e`
- Run separately from unit tests: `npm run test:e2e`

### Non-Goals

- Full endpoint coverage (already handled by inject-based tests)
- Performance testing
- Load testing
- Bot-to-API integration testing

---

## Test Plan

- [ ] All 10 smoke tests pass
- [ ] Tests clean up after themselves (server.close())
- [ ] Tests don't interfere with unit test suite
- [ ] CI-compatible (no external dependencies beyond Docker services)
