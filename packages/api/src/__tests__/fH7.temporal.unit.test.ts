// F-H7 — Unit tests for H7-P1 through H7-P4 pattern extensions to CONVERSATIONAL_WRAPPER_PATTERNS.
//
// Tests extractFoodQuery() stripping behaviour for temporal, activity-reference,
// standalone eat-verb, and leading conversational-filler patterns.
//
// Pure function calls — no DB, no mocks needed.
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect } from 'vitest';
import { extractFoodQuery } from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// Phase 1 — H7-P1: Pure Temporal Prefix (compound regex, index 13)
// ---------------------------------------------------------------------------

describe('H7-P1 — Pure Temporal Prefix (compound regex)', () => {
  it('Q631: "ayer por la noche cené salmón con verduras al horno" → "salmón con verduras al horno"', () => {
    const result = extractFoodQuery('ayer por la noche cené salmón con verduras al horno');
    expect(result.query).toBe('salmón con verduras al horno');
  });

  it('Q632: "el domingo me comí un plato de migas con huevo" → "un plato de migas con huevo"', () => {
    const result = extractFoodQuery('el domingo me comí un plato de migas con huevo');
    expect(result.query).toBe('un plato de migas con huevo');
  });

  it('Q637: "anoche después del cine compartí nachos con queso" → "nachos con queso"', () => {
    const result = extractFoodQuery('anoche después del cine compartí nachos con queso');
    expect(result.query).toBe('nachos con queso');
  });

  it('Q638: "el viernes en la oficina pedí noodles con pollo y verduras" → "noodles con pollo y verduras"', () => {
    const result = extractFoodQuery('el viernes en la oficina pedí noodles con pollo y verduras');
    expect(result.query).toBe('noodles con pollo y verduras');
  });

  it('Q646: "el lunes después de clase comí una empanadilla de carne" → "una empanadilla de carne"', () => {
    const result = extractFoodQuery('el lunes después de clase comí una empanadilla de carne');
    expect(result.query).toBe('una empanadilla de carne');
  });

  it('Q647: "ayer tarde me bebí un smoothie de mango con yogur" → "un smoothie de mango con yogur"', () => {
    const result = extractFoodQuery('ayer tarde me bebí un smoothie de mango con yogur');
    expect(result.query).toBe('un smoothie de mango con yogur');
  });

  it('Q650: "a medianoche me hice una tortilla francesa con champiñones" → "una tortilla francesa con champiñones"', () => {
    const result = extractFoodQuery('a medianoche me hice una tortilla francesa con champiñones');
    expect(result.query).toBe('una tortilla francesa con champiñones');
  });

  it('Q636: "esta mañana antes de trabajar tomé un croissant de mantequilla" → "un croissant de mantequilla"', () => {
    const result = extractFoodQuery('esta mañana antes de trabajar tomé un croissant de mantequilla');
    expect(result.query).toBe('un croissant de mantequilla');
  });

  it('Negative regression — Pattern 3 still fires: "anoche cené paella" → "paella"', () => {
    // Pattern 3 (index 2) fires before H7-P1 (index 13) — both produce "paella",
    // but Pattern 3 must own these forms to preserve existing behavior.
    const result = extractFoodQuery('anoche cené paella');
    expect(result.query).toBe('paella');
  });

  it('Negative regression — Pattern 2 still fires: "anoche me cené paella" → "paella"', () => {
    // Pattern 2 (index 1) fires first.
    const result = extractFoodQuery('anoche me cené paella');
    expect(result.query).toBe('paella');
  });

  it('Empty-remainder guard: "el lunes" (no eat-verb) → H7-P1 must NOT match, returns "el lunes"', () => {
    const result = extractFoodQuery('el lunes');
    expect(result.query).toBe('el lunes');
  });

  it('ReDoS timing bound: 200-char compound temporal input resolves in < 50 ms', () => {
    // Construct an adversarial string with repeated temporal bridges to test ReDoS safety.
    // The [^,]{1,N}? bounded quantifier in H7-P1 prevents catastrophic backtracking.
    const adversarial = 'el lunes después de clase '.repeat(8) + 'comí tortilla';
    const start = Date.now();
    extractFoodQuery(adversarial);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — H7-P2: Activity Reference Prefix (compound regex, index 14)
// ---------------------------------------------------------------------------

describe('H7-P2 — Activity Reference Prefix (compound regex)', () => {
  it('Q633: "después del gimnasio me tomé un batido de chocolate con avena" → "un batido de chocolate con avena"', () => {
    const result = extractFoodQuery('después del gimnasio me tomé un batido de chocolate con avena');
    expect(result.query).toBe('un batido de chocolate con avena');
  });

  it('Q634: "antes de dormir cené una crema de puerros con picatostes" → "una crema de puerros con picatostes"', () => {
    const result = extractFoodQuery('antes de dormir cené una crema de puerros con picatostes');
    expect(result.query).toBe('una crema de puerros con picatostes');
  });

  it('Q635: "en el desayuno de hoy comí tostadas con aguacate y huevo" → "tostadas con aguacate y huevo"', () => {
    const result = extractFoodQuery('en el desayuno de hoy comí tostadas con aguacate y huevo');
    expect(result.query).toBe('tostadas con aguacate y huevo');
  });

  it('Q639: "para merendar ayer tomé un yogur con granola" → "un yogur con granola"', () => {
    const result = extractFoodQuery('para merendar ayer tomé un yogur con granola');
    expect(result.query).toBe('un yogur con granola');
  });

  it('Q640: "después de correr me comí una barrita energética de frutos secos" → "una barrita energética de frutos secos"', () => {
    const result = extractFoodQuery('después de correr me comí una barrita energética de frutos secos');
    expect(result.query).toBe('una barrita energética de frutos secos');
  });

  it('Q641: "en la cena familiar del sábado probé cochinillo asado con ensalada" → "cochinillo asado con ensalada"', () => {
    const result = extractFoodQuery('en la cena familiar del sábado probé cochinillo asado con ensalada');
    expect(result.query).toBe('cochinillo asado con ensalada');
  });

  it('Q643: "durante el viaje me tomé un bocata de pavo con queso" → "un bocata de pavo con queso"', () => {
    const result = extractFoodQuery('durante el viaje me tomé un bocata de pavo con queso');
    expect(result.query).toBe('un bocata de pavo con queso');
  });

  it('Q644: "esta tarde en la cafetería pedí una porción de brownie" → "una porción de brownie" (H7-P1 fires first)', () => {
    // Q644 is handled by H7-P1 (esta tarde en [lugar] branch). H7-P2 is documented here for completeness.
    // H7-P1 is at index 13, H7-P2 at 14; H7-P1 fires first.
    const result = extractFoodQuery('esta tarde en la cafetería pedí una porción de brownie');
    expect(result.query).toBe('una porción de brownie');
  });

  it('Q645: "antes del partido cené arroz con atún y maíz" → "arroz con atún y maíz"', () => {
    const result = extractFoodQuery('antes del partido cené arroz con atún y maíz');
    expect(result.query).toBe('arroz con atún y maíz');
  });

  it('Q648: "en la comida de empresa tomé ternera guisada con patatas" → "ternera guisada con patatas"', () => {
    const result = extractFoodQuery('en la comida de empresa tomé ternera guisada con patatas');
    expect(result.query).toBe('ternera guisada con patatas');
  });

  it('Q649: "después de la siesta piqué queso fresco con membrillo" → "queso fresco con membrillo"', () => {
    const result = extractFoodQuery('después de la siesta piqué queso fresco con membrillo');
    expect(result.query).toBe('queso fresco con membrillo');
  });

  it('Empty-remainder guard: "para merendar" (no eat-verb following) → must NOT match, returns "para merendar"', () => {
    const result = extractFoodQuery('para merendar');
    expect(result.query).toBe('para merendar');
  });

  it('ReDoS timing bound: 200-char activity-frame input resolves in < 50 ms', () => {
    const adversarial = 'después de correr y entrenar '.repeat(7) + 'comí tortilla';
    const start = Date.now();
    extractFoodQuery(adversarial);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('Q642 cross-check: "hoy al mediodía comí garbanzos con espinacas" → H7-P1 fires (index 13), query "garbanzos con espinacas"', () => {
    // Q642 has temporal head "hoy al mediodía" — H7-P1 covers this, H7-P2 is not reached.
    const result = extractFoodQuery('hoy al mediodía comí garbanzos con espinacas');
    expect(result.query).toBe('garbanzos con espinacas');
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — H7-P3: Standalone Bare Eat-Verb Fallback (index 15)
// ---------------------------------------------------------------------------

describe('H7-P3 — Standalone eat-verb fallback', () => {
  it('"comí garbanzos con espinacas" → "garbanzos con espinacas"', () => {
    const result = extractFoodQuery('comí garbanzos con espinacas');
    expect(result.query).toBe('garbanzos con espinacas');
  });

  it('"cené pollo asado" → "pollo asado"', () => {
    const result = extractFoodQuery('cené pollo asado');
    expect(result.query).toBe('pollo asado');
  });

  it('"me comí una tortilla de patatas" → "tortilla de patatas" (article stripped after wrapper)', () => {
    const result = extractFoodQuery('me comí una tortilla de patatas');
    expect(result.query).toBe('tortilla de patatas');
  });

  it('"pedí arroz con leche" → "arroz con leche"', () => {
    const result = extractFoodQuery('pedí arroz con leche');
    expect(result.query).toBe('arroz con leche');
  });

  it('"probé el gazpacho andaluz" → "gazpacho andaluz" (article stripped after wrapper)', () => {
    const result = extractFoodQuery('probé el gazpacho andaluz');
    expect(result.query).toBe('gazpacho andaluz');
  });

  it('"piqué almendras" → "almendras"', () => {
    const result = extractFoodQuery('piqué almendras');
    expect(result.query).toBe('almendras');
  });

  it('R5 risk mitigation — "me hice una tortilla francesa con champiñones" → "tortilla francesa con champiñones"', () => {
    // H7-P3 regex: /^(?:me\s+)?(?:...|me\s+hice?|...)\s+/i
    // The inner me\s+hice? handles the "me hice" idiom.
    const result = extractFoodQuery('me hice una tortilla francesa con champiñones');
    expect(result.query).toBe('tortilla francesa con champiñones');
  });

  it('"hice una tortilla" → "tortilla" (outer clitic absent, inner hice? matches)', () => {
    // Outer (?:me\s+)? not present; inner hice? matches standalone
    const result = extractFoodQuery('hice una tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('Non-regression: H7-P3 does NOT fire when H7-P1 already matched: "ayer cené paella" → "paella"', () => {
    // Pattern 3 (index 2) fires, not H7-P3 (index 15)
    const result = extractFoodQuery('ayer cené paella');
    expect(result.query).toBe('paella');
  });

  it('Non-regression: H7-P3 does NOT fire when H7-P2 already matched: "después de correr me comí salmón" → "salmón"', () => {
    // H7-P2 (index 14) fires first
    const result = extractFoodQuery('después de correr me comí salmón');
    expect(result.query).toBe('salmón');
  });

  it('Empty-remainder guard: "comí" alone → H7-P3 would strip leaving empty; guard returns "comí"', () => {
    const result = extractFoodQuery('comí');
    expect(result.query).toBe('comí');
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — H7-P4: Leading Conversational Fillers (index 16)
// ---------------------------------------------------------------------------

describe('H7-P4 — Leading conversational fillers', () => {
  it('Q487: "quiero un pastel de nata" → "pastel de nata"', () => {
    const result = extractFoodQuery('quiero un pastel de nata');
    expect(result.query).toBe('pastel de nata');
  });

  it('Q463: "quiero probar la ropa vieja canaria" → "ropa vieja canaria"', () => {
    const result = extractFoodQuery('quiero probar la ropa vieja canaria');
    expect(result.query).toBe('ropa vieja canaria');
  });

  it('Q453: "quería probar el ternasco de aragón" → "ternasco de aragón"', () => {
    const result = extractFoodQuery('quería probar el ternasco de aragón');
    expect(result.query).toBe('ternasco de aragón');
  });

  it('Q456: "qué tal está el bacalao al pil-pil" → "bacalao al pil-pil"', () => {
    const result = extractFoodQuery('qué tal está el bacalao al pil-pil');
    expect(result.query).toBe('bacalao al pil-pil');
  });

  it('Q457: "ponme una tapa de zarangollo murciano" → "zarangollo murciano"', () => {
    const result = extractFoodQuery('ponme una tapa de zarangollo murciano');
    expect(result.query).toBe('zarangollo murciano');
  });

  it('Q462: "tráeme una de escalivada con anchoas" → "escalivada con anchoas"', () => {
    const result = extractFoodQuery('tráeme una de escalivada con anchoas');
    expect(result.query).toBe('escalivada con anchoas');
  });

  it('Q474: "cuánto cuesta la sobrassada con miel" → "sobrassada con miel"', () => {
    const result = extractFoodQuery('cuánto cuesta la sobrassada con miel');
    expect(result.query).toBe('sobrassada con miel');
  });

  it('Q499: "tenéis gyozas a la plancha?" → "gyozas a la plancha" (trailing ? stripped by normalizer)', () => {
    const result = extractFoodQuery('tenéis gyozas a la plancha?');
    expect(result.query).toBe('gyozas a la plancha');
  });

  it('Q504: "quiero probar el steak tartar" → "steak tartar"', () => {
    const result = extractFoodQuery('quiero probar el steak tartar');
    expect(result.query).toBe('steak tartar');
  });

  it('"me pones patatas bravas" → "patatas bravas"', () => {
    const result = extractFoodQuery('me pones patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });

  it('"ponme un vermut" → "vermut" (article stripped after wrapper)', () => {
    const result = extractFoodQuery('ponme un vermut');
    expect(result.query).toBe('vermut');
  });

  it('"tráeme un de calamares" → "calamares"', () => {
    const result = extractFoodQuery('tráeme un de calamares');
    expect(result.query).toBe('calamares');
  });

  it('Q472: "una de michirones para picar" → "michirones para picar" (bare "una de" stripped by H7-P4)', () => {
    // H7-P4 strips "una de" → "michirones para picar"
    // The "para picar" trailing modifier will later be handled by H7-P5 in engineRouter.ts
    const result = extractFoodQuery('una de michirones para picar');
    expect(result.query).toBe('michirones para picar');
  });

  it('Bare "un de" form: "un de cordero" → "cordero"', () => {
    const result = extractFoodQuery('un de cordero');
    expect(result.query).toBe('cordero');
  });

  it('Bare "una de pad thai": "una de pad thai de langostinos" → "pad thai de langostinos"', () => {
    // H7-P4 strips "una de"; trailing "de langostinos" is dish-semantic — must NOT be stripped
    const result = extractFoodQuery('una de pad thai de langostinos');
    expect(result.query).toBe('pad thai de langostinos');
  });

  it('Interaction with ARTICLE_PATTERN: "quiero un pastel de nata" → "pastel de nata" (ARTICLE_PATTERN must NOT strip "pastel")', () => {
    const result = extractFoodQuery('quiero un pastel de nata');
    expect(result.query).toBe('pastel de nata');
    // Verify "pastel" is NOT stripped (it's not a leading bare article)
    expect(result.query).not.toBe('de nata');
  });

  it('Non-regression: "tenéis" alone → empty-remainder guard returns "tenéis"', () => {
    const result = extractFoodQuery('tenéis');
    expect(result.query).toBe('tenéis');
  });
});
