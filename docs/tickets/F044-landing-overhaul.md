# F044 — Landing Page Overhaul

| Field | Value |
|-------|-------|
| **Feature** | F044 |
| **Type** | Frontend-Feature |
| **Priority** | High |
| **Status** | In Progress |
| **Branch** | feature/F044-landing-overhaul |
| **Created** | 2026-03-26 |
| **Dependencies** | F039 (done — previous landing iteration) |

---

## Spec

### Description

Overhaul the nutriXplorer landing page from scratch in `packages/landing/`, adopting the v5 reference design. This is a green-field creation since the landing package does not currently exist in the monorepo.

**Major changes:**

1. **Visual style**: Adopt v5 glass-card aesthetic (`card-surface`), softer palette (`paper`, `mist`), compact spacing. Remove aggressive dark full-width sections. Everything feels "designed product" not "AI template".

2. **ProductDemo component**: "Más producto real, menos promesa" — shows a real query flow (User → Motor → Response) with mockup showing calories, macros, confidence level, allergen guardrail.

3. **SearchSimulator component**: Fake autocomplete input that suggests 10 pre-loaded dishes. User selects from dropdown. Each dish has pre-defined nutritional data with different confidence levels (L1, L2, L3). Shows animated result card with macros grid + allergen guardrail. Prepared to connect to real `/estimate` API in the future.

4. **10 pre-loaded dishes**:
   - Big Mac (L1, official)
   - Pulpo a feira (L2, estimated)
   - Poke salmón (L3, similarity)
   - Tortilla española (L2)
   - Lentejas con chorizo (L1, chain)
   - Huevos rotos con jamón (L2)
   - Ensalada César (L2)
   - Paella valenciana (L3)
   - Croquetas de jamón (L2)
   - Pizza Margarita Telepizza (L1, official)

5. **Sticky header**: Logo + nav links (Demo, Cómo funciona, Para quién) + CTA button

6. **Copy overhaul**: Adopt v5 pragmatic copy — "Lo entiendes en 10 segundos", "Más producto real, menos promesa", "Volver a disfrutar de comer fuera". Less generic, more specific. All NutriTrack references changed to nutriXplorer.

7. **Restaurants section**: Minimal — one subtle card, not a full section

8. **Waitlist form upgrade**: Capture email + phone number (optional). Add phone field with country code prefix (+34 default). Form validates both fields.

9. **Next.js 15**: New package created directly with Next.js 15.

10. **Section order**: Header → Hero → ProductDemo → HowItWorks + SearchSimulator → EmotionalBlock → TrustPillars → AudienceGrid → Comparison → Restaurants (minimal) → Waitlist CTA → Footer

**Preserve / build fresh with same patterns from F039 spec:**
- Analytics infrastructure (ScrollTracker, SectionObserver, trackEvent, CookieBanner)
- A/B testing (resolveVariant)
- SEO (JSON-LD, sitemap, robots)
- i18n dictionary pattern
- Progressive enhancement
- Test infrastructure

### Edge Cases

- SearchSimulator: typing text that doesn't match any pre-loaded dish → show "No encontrado. Prueba con uno de los ejemplos." with suggestion pills
- Phone field: optional, validates Spanish format (+34 6XX XXX XXX or +34 7XX XXX XXX)
- Phone field: international format accepted (+XX XXXXXXXX)
- Empty phone + valid email → submit succeeds
- Both empty → validation error on email only (phone is optional)

---

## Acceptance Criteria

- [ ] `packages/landing/` package created and integrated in monorepo
- [ ] Visual style matches v5 reference (glass cards, softer palette, no dark full-width sections)
- [ ] ProductDemo renders query flow timeline + app mockup
- [ ] SearchSimulator with 10 pre-loaded dishes, autocomplete dropdown, animated results
- [ ] SearchSimulator shows different confidence levels per dish (L1/L2/L3)
- [ ] Sticky header with navigation and CTA
- [ ] Copy updated to v5 pragmatic style throughout, all "NutriTrack" → "nutriXplorer"
- [ ] Restaurants section present but minimal
- [ ] WaitlistForm captures email + optional phone
- [ ] Phone validation (Spanish + international formats)
- [ ] Next.js 15.x used
- [ ] Analytics events (trackEvent) fire for key interactions
- [ ] A/B testing (variant param) works
- [ ] CookieBanner/GDPR functional
- [ ] SEO metadata, JSON-LD, sitemap, robots present
- [ ] i18n dictionaries with all copy in Spanish
- [ ] All tests pass (SearchSimulator, ProductDemo, WaitlistForm including phone validation)
- [ ] Build succeeds, lint clean, TypeScript strict

---

## Implementation Plan

### Phase 0: Package Scaffold + Design System

**Step 0.1: Create `packages/landing` Next.js 15 package**
- Files: `packages/landing/package.json`, `packages/landing/tsconfig.json`, `packages/landing/next.config.ts`, `packages/landing/postcss.config.js`
- Update root `package.json` workspaces to include `packages/landing`
- Dependencies: next@15, react@19, react-dom@19, framer-motion, lucide-react

**Step 0.2: Tailwind config with v5 design tokens**
- Files: `packages/landing/tailwind.config.ts`
- Tokens: botanical, energy, paper, mist, shadow-soft, shadow-lift, borderRadius xl2/xl3, bg-grid

**Step 0.3: globals.css with card-surface, section-shell, accent-ring**
- Files: `packages/landing/src/app/globals.css`

**Step 0.4: Root layout and metadata**
- Files: `packages/landing/src/app/layout.tsx`
- SEO metadata, JSON-LD, CookieBanner integration

**Step 0.5: i18n dictionary**
- Files: `packages/landing/src/lib/i18n/es.ts`
- All Spanish copy for the page

**Step 0.6: Content types and data**
- Files: `packages/landing/src/lib/content.ts`
- DISHES constant for SearchSimulator, all section copy

### Phase 1: New Components (TDD each)

**Step 1.1: SiteHeader**
- Files: `packages/landing/src/components/SiteHeader.tsx`, `SiteHeader.test.tsx`
- Sticky header, nav links, CTA button, mobile collapsed CTA

**Step 1.2: Reveal animation**
- Files: `packages/landing/src/components/Reveal.tsx`, `Reveal.test.tsx`
- Framer Motion whileInView wrapper with delay prop

**Step 1.3: ProductDemo**
- Files: `packages/landing/src/components/ProductDemo.tsx`, `ProductDemo.test.tsx`
- Timeline (3 steps) + app mockup card

**Step 1.4: SearchSimulator** (star component)
- Files: `packages/landing/src/components/SearchSimulator.tsx`, `SearchSimulator.test.tsx`
- 10 pre-loaded dishes, autocomplete dropdown, animated result card
- Loading state (850ms), macros grid, confidence badge, allergen guardrail
- "No encontrado" state with suggestion pills

**Step 1.5: AudienceGrid**
- Files: `packages/landing/src/components/AudienceGrid.tsx`, `AudienceGrid.test.tsx`
- 4 audience cards from content data

**Step 1.6: WaitlistForm** (with phone field)
- Files: `packages/landing/src/components/WaitlistForm.tsx`, `WaitlistForm.test.tsx`
- Email (required) + Phone (optional, +34 prefix default)
- Validation: email format, phone regex `/^\+\d{1,3}\s?\d{6,12}$/`
- Submit payload: `{ email, phone?, variant, source }`

**Step 1.7: CookieBanner**
- Files: `packages/landing/src/components/CookieBanner.tsx`, `CookieBanner.test.tsx`
- GDPR minimal, localStorage consent

**Step 1.8: SiteFooter**
- Files: `packages/landing/src/components/SiteFooter.tsx`, `SiteFooter.test.tsx`
- Links, legal, waitlist anchor, GitHub

### Phase 2: Analytics + A/B Infrastructure

**Step 2.1: Analytics utils**
- Files: `packages/landing/src/lib/analytics.ts`
- `trackEvent(name, props)` — window.gtag wrapper with noop fallback

**Step 2.2: A/B variant resolver**
- Files: `packages/landing/src/lib/variant.ts`
- `resolveVariant(searchParams): HeroVariant`

**Step 2.3: ScrollTracker + SectionObserver**
- Files: `packages/landing/src/components/ScrollTracker.tsx`
- IntersectionObserver-based section visibility events

### Phase 3: Page Assembly

**Step 3.1: page.tsx**
- Files: `packages/landing/src/app/page.tsx`
- Full section composition in order: Header → Hero → ProductDemo → HowItWorks + SearchSimulator → EmotionalBlock → TrustPillars → AudienceGrid → Comparison → Restaurants → Waitlist → Footer
- A/B variant in hero (searchParams)
- All sections wrapped in Reveal

**Step 3.2: SEO assets**
- Files: `packages/landing/src/app/sitemap.ts`, `packages/landing/src/app/robots.ts`

### Phase 4: Polish + Verification

**Step 4.1: Update docs/specs/ui-components.md** with new components
**Step 4.2: Run full test suite, lint, build**
**Step 4.3: Fix any failures**

---

## Test Plan

| Component | Key Test Cases |
|-----------|----------------|
| SiteHeader | renders logo, nav links visible on desktop, CTA button present, sticky class applied |
| SearchSimulator | renders input, autocomplete dropdown on type, dish selection shows result, loading state during animation, "no encontrado" for unknown query, L1/L2/L3 confidence shown |
| ProductDemo | renders 3-step timeline, app mockup visible, dish name and calories visible |
| WaitlistForm | email required validation, phone optional (empty phone passes), phone format validation, submit payload includes phone when provided |
| CookieBanner | shows on first visit, dismiss hides it, consent stored in localStorage |
| AudienceGrid | renders 4 cards, each has name + body + CTA |
| Reveal | renders children, applies motion |

---

## Technical Notes

- **framer-motion**: Used for Reveal wrapper, SearchSimulator loading animation, ProductDemo entrance animation
- **lucide-react**: All icons (Search, AlertTriangle, ShieldCheck, Sparkles, etc.)
- **DISHES data structure**: Each dish has query (match key), dish (display name), level (L1/L2/L3), confidence (Alta/Media/Baja), kcal, protein, carbs, fat, note, allergen
- **Phone regex**: `/^\+\d{1,3}\s?\d{6,12}$/` — covers +34 612345678, +1 2125550100
- **card-surface CSS class**: `rounded-xl2 border border-white/70 bg-white/[0.88] shadow-soft backdrop-blur`
- **A/B variant**: searchParams `?variant=b` → variant B hero copy, default is variant A

---

## Merge Checklist Evidence

| Check | Status | Notes |
|-------|--------|-------|
| All acceptance criteria met | Pending | |
| Tests pass | Pending | |
| Lint clean | Pending | |
| Build succeeds | Pending | |
| ui-components.md updated | Pending | |
| No changes outside scope | Pending | |
