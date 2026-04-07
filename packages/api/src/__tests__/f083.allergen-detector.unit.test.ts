import { describe, it, expect } from 'vitest';
import { detectAllergens, enrichWithAllergens } from '../estimation/allergenDetector.js';

// ---------------------------------------------------------------------------
// detectAllergens — core detection
// ---------------------------------------------------------------------------

describe('detectAllergens', () => {
  // --- 14 EU allergen categories ---

  it('detects gluten from "pan blanco"', () => {
    const result = detectAllergens('Pan blanco');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Gluten' })]),
    );
  });

  it('detects gluten from "pasta carbonara"', () => {
    const result = detectAllergens('Pasta carbonara');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Gluten' })]),
    );
  });

  it('detects gluten from "croqueta de jamón"', () => {
    const result = detectAllergens('Croqueta de jamón');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Gluten' })]),
    );
  });

  it('detects crustaceans from "gambas al ajillo"', () => {
    const result = detectAllergens('Gambas al ajillo');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Crustáceos' })]),
    );
  });

  it('detects crustaceans from "langostinos a la plancha"', () => {
    const result = detectAllergens('Langostinos a la plancha');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Crustáceos' })]),
    );
  });

  it('detects egg from "tortilla de patatas"', () => {
    const result = detectAllergens('Tortilla de patatas');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Huevo' })]),
    );
  });

  it('detects egg from "huevos rotos"', () => {
    const result = detectAllergens('Huevos rotos');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Huevo' })]),
    );
  });

  it('detects fish from "merluza a la romana"', () => {
    const result = detectAllergens('Merluza a la romana');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Pescado' })]),
    );
  });

  it('detects fish from "atún en conserva"', () => {
    const result = detectAllergens('Atún en conserva');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Pescado' })]),
    );
  });

  it('detects peanuts from "salsa de cacahuete"', () => {
    const result = detectAllergens('Salsa de cacahuete');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Cacahuete' })]),
    );
  });

  it('detects soy from "tofu salteado"', () => {
    const result = detectAllergens('Tofu salteado');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Soja' })]),
    );
  });

  it('detects dairy from "queso manchego"', () => {
    const result = detectAllergens('Queso manchego');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Lácteos' })]),
    );
  });

  it('detects dairy from "leche entera"', () => {
    const result = detectAllergens('Leche entera');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Lácteos' })]),
    );
  });

  it('detects tree nuts from "tarta de almendras"', () => {
    const result = detectAllergens('Tarta de almendras');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Frutos de cáscara' })]),
    );
  });

  it('detects tree nuts from "salsa de nueces"', () => {
    const result = detectAllergens('Salsa de nueces');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Frutos de cáscara' })]),
    );
  });

  it('detects celery from "crema de apio"', () => {
    const result = detectAllergens('Crema de apio');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Apio');
  });

  it('detects mustard from "salchicha con mostaza"', () => {
    const result = detectAllergens('Salchicha con mostaza');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Mostaza' })]),
    );
  });

  it('detects sesame from "pan con sésamo"', () => {
    const result = detectAllergens('Pan con sésamo');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Sésamo');
    expect(allergenNames).toContain('Gluten'); // "pan " also matches
  });

  it('detects lupin from "harina de altramuz"', () => {
    const result = detectAllergens('Harina de altramuz');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Altramuces');
    expect(allergenNames).toContain('Gluten'); // "harina" matches
  });

  it('detects molluscs from "calamares a la romana"', () => {
    const result = detectAllergens('Calamares a la romana');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Moluscos' })]),
    );
  });

  it('detects molluscs from "pulpo a la gallega"', () => {
    const result = detectAllergens('Pulpo a la gallega');
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ allergen: 'Moluscos' })]),
    );
  });

  // --- Multiple allergens in a single dish ---

  it('detects multiple allergens from "pizza con gambas y queso"', () => {
    const result = detectAllergens('Pizza con gambas y queso');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Gluten');      // pizza
    expect(allergenNames).toContain('Crustáceos');   // gambas
    expect(allergenNames).toContain('Lácteos');      // queso
    expect(result.length).toBe(3);
  });

  it('detects egg + dairy from "tortilla con queso"', () => {
    const result = detectAllergens('Tortilla con queso');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Huevo');
    expect(allergenNames).toContain('Lácteos');
  });

  // --- Edge cases ---

  it('returns empty array for unknown food', () => {
    expect(detectAllergens('Ensalada de tomate y lechuga')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(detectAllergens('')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const upper = detectAllergens('PIZZA CON QUESO');
    const lower = detectAllergens('pizza con queso');
    expect(upper.length).toBe(lower.length);
    expect(upper.map((a) => a.allergen).sort()).toEqual(lower.map((a) => a.allergen).sort());
  });

  it('includes the matched keyword', () => {
    const result = detectAllergens('Gambas al ajillo');
    const crustacean = result.find((a) => a.allergen === 'Crustáceos');
    expect(crustacean?.keyword).toBe('gamba');
  });

  it('matches only one keyword per allergen category', () => {
    // "queso manchego" has both "queso" and "manchego" patterns for dairy
    const result = detectAllergens('Queso manchego');
    const dairyCount = result.filter((a) => a.allergen === 'Lácteos').length;
    expect(dairyCount).toBe(1);
  });

  // --- English keywords ---

  it('detects allergens from English names', () => {
    const result = detectAllergens('Grilled shrimp with cheese bread');
    const allergenNames = result.map((a) => a.allergen);
    expect(allergenNames).toContain('Crustáceos');   // shrimp
    expect(allergenNames).toContain('Lácteos');       // cheese
    expect(allergenNames).toContain('Gluten');        // bread
  });

  // --- False positive prevention ---

  it('does not flag "patatas fritas" (no allergens)', () => {
    expect(detectAllergens('Patatas fritas')).toEqual([]);
  });

  it('does not flag "arroz blanco" (no allergens)', () => {
    expect(detectAllergens('Arroz blanco')).toEqual([]);
  });

  it('does not flag "pollo a la plancha" (no allergens)', () => {
    expect(detectAllergens('Pollo a la plancha')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// enrichWithAllergens — DRY helper
// ---------------------------------------------------------------------------

describe('enrichWithAllergens', () => {
  it('returns allergens object when allergens detected', () => {
    const result = enrichWithAllergens({
      nameEs: 'Pizza con queso',
      name: 'Cheese Pizza',
    });
    expect(result.allergens).toBeDefined();
    expect(result.allergens?.length).toBeGreaterThan(0);
  });

  it('returns empty object when no allergens detected', () => {
    const result = enrichWithAllergens({
      nameEs: 'Ensalada de tomate',
      name: 'Tomato Salad',
    });
    expect(result).toEqual({});
  });

  it('returns empty object for null result', () => {
    expect(enrichWithAllergens(null)).toEqual({});
  });

  it('prefers nameEs over name', () => {
    const result = enrichWithAllergens({
      nameEs: 'Gambas al ajillo',
      name: 'Garlic Shrimp',
    });
    // Should match on "gamba" from nameEs
    const crustacean = result.allergens?.find((a) => a.allergen === 'Crustáceos');
    expect(crustacean?.keyword).toBe('gamba');
  });

  it('falls back to name when nameEs is null', () => {
    const result = enrichWithAllergens({
      nameEs: null,
      name: 'Cheese Pizza',
    });
    const allergenNames = result.allergens?.map((a) => a.allergen) ?? [];
    expect(allergenNames).toContain('Lácteos');
    expect(allergenNames).toContain('Gluten');
  });
});
