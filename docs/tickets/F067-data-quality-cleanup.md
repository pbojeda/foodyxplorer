# F067: Data Quality Cleanup

**Feature:** F067 | **Type:** Bug (data quality) | **Priority:** Low
**Status:** Backlog | **Branch:** —
**Created:** 2026-03-30 | **Dependencies:** F065 (slug migration)
**Audit Source:** Comprehensive Validation Phase 2 — API real testing, Gemini 2.5 Pro review

---

## Spec

### Description

Two data quality issues discovered during comprehensive API validation testing against the dev environment (885 dishes, 14 chains).

### D3 — Leading slashes in Burger King dish names

Some BK dish names have leading slashes from the PDF scraping pipeline:

```
/ Brownie & Ice Cream
/ Whopper® Gluten Free
/ Wings Snack Box
```

**Root cause:** The Burger King PDF preprocessor (`chainTextPreprocessor`) doesn't strip leading `/` characters. These likely come from PDF line breaks or table separators that the parser interprets as part of the dish name.

**Impact:** Cosmetic — affects display in bot responses and search results. Could also affect FTS ranking since the `/` adds noise to the indexed text.

**Fix:**
1. Add a sanitization step in the BK preprocessor or the generic normalization pipeline to strip leading non-alphanumeric characters from dish names.
2. Run a one-time UPDATE to clean existing data:
   ```sql
   UPDATE dishes SET name = LTRIM(name, '/ '), name_es = LTRIM(name_es, '/ ')
   WHERE name LIKE '/%' OR name_es LIKE '/%';
   ```

### D2 — FTS ranking prefers longer matches over exact matches

Searching for "whopper" returns "Whopper® Spicy Vegetal" (longer name) before "Whopper®" (exact match).

**Root cause:** PostgreSQL `ts_rank` doesn't penalize longer strings. Both match the search term equally, and the longer name may rank higher due to document structure.

**Impact:** Medium UX — users searching for a common dish get a variant instead of the base version.

**Possible fixes (evaluate trade-offs):**
1. Combine `ts_rank` with `length(name)` penalty: `ORDER BY ts_rank(...) - (length(name) * 0.001) DESC`
2. Use `ts_rank_cd` (cover density) which favors terms appearing closer together
3. Add a secondary sort: `ORDER BY ts_rank(...) DESC, length(name) ASC`
4. Use pg_trgm `similarity()` as a tiebreaker for equal ts_rank scores

Option 3 is simplest and lowest risk.

### Acceptance Criteria

- [ ] No dish names start with `/` or other non-alphanumeric characters
- [ ] Searching "whopper" returns "Whopper®" before "Whopper® Spicy Vegetal"
- [ ] Scraper pipeline prevents future leading-slash names

---

## Test Plan

- [ ] Query `SELECT name FROM dishes WHERE name LIKE '/%'` returns 0 rows
- [ ] `/dishes/search?q=whopper` returns "Whopper®" as first result
- [ ] `/estimate?query=whopper&chainSlug=burger-king-es` returns plain Whopper®
- [ ] Existing tests pass
