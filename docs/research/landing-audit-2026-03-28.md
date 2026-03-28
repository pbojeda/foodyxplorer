# Landing Page Audit — nutriXplorer (Consolidated)

**Date:** 2026-03-28
**Auditors:** Claude Opus 4.6, Gemini 2.5, Codex GPT-5.4
**URLs audited:** 8 combinations (4 variants x 2 palettes)
**Domain:** https://nutrixplorer.com

---

## Executive Summary

Three independent AI models audited the live landing page across 8 variant/palette combinations. The landing has a **solid technical foundation** (TypeScript, A/B testing, analytics infrastructure, progressive enhancement, TDD) and a **genuinely impressive SearchSimulator**. However, there are **critical blockers** that must be fixed before driving any traffic: leads aren't being saved, legal pages don't exist, and the OG image is missing.

**Cross-model consensus:** All 3 models independently flagged the same top 5 issues.

---

## CRITICAL Issues (Consensus: flagged by all 3 models)

| # | Issue | Category | Impact | Estimated Fix Time |
|---|-------|----------|--------|-------------------|
| C1 | **Waitlist API doesn't persist data** — `TODO` comments in route.ts, leads are validated but discarded | Tech/Conversion | No leads saved = no business value | 2-4h (Supabase/Upstash integration) |
| C2 | **Legal pages don't exist** — /privacidad, /cookies, /aviso-legal return 404. Footer and CookieBanner link to them | Legal/GDPR | LSSI non-compliance, can't run ads | 2-3h (create placeholder pages with real legal text) |
| C3 | **og-image.jpg missing** — referenced in metadata but doesn't exist in public/ | SEO/Social | All social sharing shows broken preview | 15min (create 1200x630 branded image) |
| C4 | **No canonical URL** — 8 indexable URLs with near-identical content, no rel="canonical" | SEO | Google will index duplicates, diluting authority | 5min (add `alternates.canonical` in layout.tsx) |
| C5 | **Variant D hero is empty** — promises "Busca cualquier plato" but SearchSimulator is not in the hero | UX/Conversion | 100% bounce rate on variant D | 2-3h (embed SearchSimulator in hero) or 5min (remove variant D) |

---

## IMPORTANT Issues (Flagged by 2+ models)

| # | Issue | Flagged by | Fix Time | Fix |
|---|-------|-----------|----------|-----|
| I1 | **#waitlist and #demo anchor links don't work** — SiteHeader points to IDs that don't exist in the DOM | Claude+Codex | 5min | Add `id="waitlist"` and `id="demo"` to sections |
| I2 | **No mobile navigation** — nav links hidden on mobile, only "Acceso" button remains (pointing to broken anchor) | Claude+Codex | 1-2h | Add hamburger menu for mobile |
| I3 | **No rate limiting / anti-spam on waitlist** — endpoint accepts unlimited requests | All 3 | 2-3h | Honeypot field + Upstash rate limit + optional Turnstile |
| I4 | **GA4 not properly initialized** — `dataLayer` never bootstrapped, `gtag()` not called before events | Codex+Claude | 1-2h | Full GA4 initialization sequence in CookieBanner |
| I5 | **Post-simulator CTA visible before interaction** — shows email form before user interacts with SearchSimulator | Codex | 30min | Set `hasInteracted=false`, show CTA only after search |
| I6 | **Phone field friction** — requires `+34` prefix, Spanish users don't type it | Gemini+Claude | 30min | Auto-prepend +34 or accept 9-digit numbers |
| I7 | **No social proof anywhere** — no counter, no testimonials, no press logos | Claude+Gemini | 2-4h | Add waitlist counter (real or threshold) + trust badges |
| I8 | **JSON-LD SearchAction points to non-functional /?q=** | Claude+Codex | 5min | Remove SearchAction from schema |
| I9 | **No-JS form redirect doesn't show feedback** — `?waitlist=success` not read by page.tsx | Codex | 1h | Read searchParam and render server-side banner |
| I10 | **SearchSimulator: no keyboard navigation** — no arrow keys, Enter to select, or ARIA combobox pattern | All 3 | 3-4h | Implement WAI-ARIA combobox pattern |
| I11 | **`suppressHydrationWarning` missing on `<html>`** — palette script causes hydration mismatch | Gemini | 2min | Add `suppressHydrationWarning` to `<html>` tag |
| I12 | **Palette "med" inverts color semantics** — botanical becomes terracotta, breaks visual coherence with confidence badges | Claude | 1-2h | Either keep botanical=green semantics in both palettes, or make badges use CSS vars too |

---

## SUGGESTIONS (Non-blocking improvements)

| # | Issue | Source | Fix Time |
|---|-------|--------|----------|
| S1 | SearchSimulator: Enter key doesn't submit search | Gemini | 15min |
| S2 | Duplicate keyframes in globals.css + tailwind.config | Claude | 10min |
| S3 | PostSimulatorCTA animation class misspelled (`animate-fadeIn` vs `animate-fade-in`) | Codex | 2min |
| S4 | CTA copy "Únete a la waitlist" is generic — should communicate benefit | Claude+Gemini | 15min |
| S5 | Comparison section missing ChatGPT as competitor (the real 2026 alternative) | Claude | 30min |
| S6 | AI-generated images may reduce trust for a product selling "data trust" | Gemini | Ongoing (replace with real photos as available) |
| S7 | Too many waitlist forms (up to 4 per page) — causes conversion fatigue | Claude | 30min |
| S8 | "Plazas limitadas" urgency claim without backing (no number/deadline) | Claude | 15min |
| S9 | SecurityHeaders missing (CSP, X-Frame-Options, HSTS) | Gemini+Claude | 1h |
| S10 | Cookie missing `Secure` flag | Claude | 1min |
| S11 | `text-slate-400` fails WCAG AA on white backgrounds | Claude | 10min |
| S12 | Open source positioning underutilized as trust signal | Claude | 15min |
| S13 | Consider FAQ schema for SEO rich snippets | Claude+Gemini | 2-3h |
| S14 | Framer-motion adds ~40KB to bundle; most animations could be CSS | Claude | 4-6h |
| S15 | localStorage for consent has no try/catch fallback | Claude | 5min |

---

## Variant Ranking (Cross-model consensus)

| Rank | Variant | Botanical | Mediterranean | Best Audience | Consensus |
|------|---------|-----------|---------------|---------------|-----------|
| **1** | **F** | **32/40** | 28/40 | Celíacos, familias con alergias | All 3 agree: clearest niche, strongest emotional hook |
| **2** | **A** | **30/40** | 24/40 | General health-conscious | Solid baseline, needs more specificity in hero |
| **3** | **C** | **27/40** | 23/40 | Pain-aware audience via ads | Great storytelling, but delays CTA too much |
| **4** | **D** | **22/40** | 20/40 | Product-led / data nerds | **BROKEN** — hero empty, do not use until fixed |

**Palette consensus:** Botanical wins unanimously. Mediterranean is warmer but dilutes the "health/trust/verification" positioning. Use Mediterranean for lifestyle/restaurant campaigns only.

**Recommended default:** `F + Botanical` for targeted campaigns, `A + Botanical` for broad traffic.

---

## Action Plan: Prioritized Sprints

### Sprint 0: Blockers (before ANY traffic) — ~8-10h

| Task | Time | Priority |
|------|------|----------|
| Create /privacidad, /cookies, /aviso-legal pages with GDPR-compliant text | 3h | P0 |
| Connect waitlist to Supabase (persist email + phone + variant + utm) | 3h | P0 |
| Create og-image.jpg (1200x630 branded) | 15min | P0 |
| Add canonical URL | 5min | P0 |
| Fix #waitlist and #demo anchor IDs | 5min | P0 |
| Add `suppressHydrationWarning` to `<html>` | 2min | P0 |
| Remove JSON-LD SearchAction | 5min | P0 |
| Fix PostSimulatorCTA animation class name | 2min | P0 |
| Add `Secure` flag to cookie | 1min | P0 |
| Fix or disable Variant D (empty hero) | 5min | P0 |

### Sprint 1: Conversion Optimization — ~10-15h

| Task | Time | Priority |
|------|------|----------|
| Add honeypot + rate limiting to waitlist API | 2h | P1 |
| Fix GA4 initialization (dataLayer + gtag bootstrap) | 2h | P1 |
| Add mobile hamburger menu | 2h | P1 |
| Post-simulator CTA: show only after interaction | 30min | P1 |
| Auto-prepend +34 on phone field | 30min | P1 |
| Read ?waitlist=success server-side for no-JS feedback | 1h | P1 |
| Reduce waitlist forms to 2 max (hero + final CTA) | 30min | P1 |
| Add waitlist counter or social proof element | 2h | P1 |
| Benefit-oriented CTA copy ("Quiero saber qué como") | 15min | P1 |
| Fix `text-slate-400` contrast to slate-500 | 10min | P1 |

### Sprint 2: Polish & Performance — ~12-20h

| Task | Time | Priority |
|------|------|----------|
| SearchSimulator: keyboard navigation + ARIA combobox | 4h | P2 |
| Embed SearchSimulator in Variant D hero (if keeping variant) | 3h | P2 |
| Add security headers (CSP, X-Frame-Options, HSTS) in next.config | 1h | P2 |
| Replace framer-motion with CSS animations (save ~40KB) | 6h | P2 |
| Add FAQ section with schema markup | 3h | P2 |
| Add ChatGPT as competitor in Comparison section | 30min | P2 |
| Improve "no match" UX in SearchSimulator | 1h | P2 |
| Add prefers-reduced-motion to Reveal and ProductDemo | 30min | P2 |

### Future: Strategic Improvements

| Task | Estimated Time | Notes |
|------|---------------|-------|
| Replace AI images with real photography | Ongoing | As product matures and real screenshots available |
| Connect SearchSimulator to real /estimate API | 4-8h | When API is public-ready |
| Add English language route (/en) | 4-6h | i18n infrastructure already exists |
| Implement Google Analytics 4 funnel dashboard | 2-3h | After GA4 is properly initialized |
| A/B testing with server-side random assignment + cookie | 2h | Current URL-param approach is fine for now |

---

## Cost Estimate

| Sprint | Hours | Cost (@75EUR/h freelancer) | Timeline |
|--------|-------|---------------------------|----------|
| Sprint 0 (Blockers) | 8-10h | 600-750 EUR | 1-2 days |
| Sprint 1 (Conversion) | 10-15h | 750-1125 EUR | 2-3 days |
| Sprint 2 (Polish) | 12-20h | 900-1500 EUR | 3-5 days |
| **Total** | **30-45h** | **2250-3375 EUR** | **1-2 weeks** |

With AI-assisted development (as in this project): ~60-70% time reduction, so **10-15h actual effort** for all three sprints.

---

## What's Working Well (quick recognition)

- SearchSimulator with 10 real Spanish dishes — genuinely impressive demo
- 3-level confidence system (Verified/Estimated/Inferred) — true differentiator
- Allergen guardrail messaging — emotionally powerful
- A/B variant infrastructure — clean, testable, URL-based
- Progressive enhancement — form works without JS
- i18n dictionary pattern — pragmatic, no over-engineering
- TypeScript strict + 286 tests — solid foundation
- Copy in natural Spanish — not machine-translated
- Heading hierarchy — perfect across all variants

---

*Audit consolidated from: Claude Opus 4.6 (code + live HTML analysis), Gemini 2.5 (code review + UX), Codex GPT-5.4 (code review + security + conversion)*
