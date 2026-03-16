# F013 — Subway Spain Data Research

**Type:** Research (no code)
**Status:** Done
**Completed:** 2026-03-16

## Spec

Investigate whether Subway Spain has publicly available nutritional data. The original assumption was that Subway had no .es website and no Spain-specific PDF.

## Findings

### Primary Source: subwayspain.com (Official)

Subway Spain operates at `subwayspain.com` (not subway.es). The site has a dedicated nutritional information page:

- **Landing page:** `https://subwayspain.com/es/menu/informacion-nutricional`
- **PDF (English):** `https://subwayspain.com/images/pdfs/nutricional/MED_Nutritional_Information_C4_2025_FINAL_English.pdf`
- **PDF (Castellano):** Available from the same page
- **PDF (Catalan):** Available from the same page

**Nutrients included:** Energy (kJ/kcal), Fat (g), Saturates (g), Carbohydrates (g), Sugars (g), Fiber (g), Protein (g), Salt (g) — per serving AND per 100g.

**Update cycle:** Quarterly (C1, C2, C3, C4 naming convention). Current: C4 2025.

**"MED" prefix** = Mediterranean region. Same document family as Portugal (`med_nutritional_information_c1_2025_final_portugal.pdf`).

### Allergen Charts (also official)

- English: `https://subwayspain.com/images/pdfs/nutricional/alergenos_ingles_espana.pdf`
- Spanish: `https://subwayspain.com/pdf/Allergen%20Chart_ES-ES.pdf`
- Catalan: `https://subwayspain.com/images/pdfs/nutricional/alergenos_catalan.pdf`

### Alternative European Sources (reference only)

| Region | URL pattern | Notes |
|--------|------------|-------|
| Germany | subway.com/-/media/Austria/Documents/Nutrition/2025/... | English, C2 March 2025 |
| UK | subway.com/en-gb/-/media/emea/europe/uk/nutrition/... | English, June 2025 |
| Portugal | subwaypt.com/pdf/med_nutritional_information_c1_2025_final_portugal.pdf | Same MED family |

## Conclusion

**Subway Spain IS viable for onboarding.** The official PDF is:
- Directly downloadable (compatible with `POST /ingest/pdf-url`)
- Tabular format with standard EU nutrients
- Updated quarterly
- Available in multiple languages

**Action:** Subway Spain onboarding moved to F014 (Chain Onboarding — Subway Spain).

## Completion Log

| Date | Event |
|------|-------|
| 2026-03-16 | Research completed via web search. subwayspain.com confirmed as official source with full nutritional PDFs |
