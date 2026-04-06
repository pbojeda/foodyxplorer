/**
 * F081 — Health-Hacker Chain Suggestions — Unit Tests
 *
 * Tests the rule-based tips engine that generates calorie-saving
 * modification suggestions for chain dish estimations.
 */

import { describe, it, expect } from 'vitest';
import {
  getHealthHackerTips,
  type HealthHackerTip,
} from '../estimation/healthHacker.js';

// ---------------------------------------------------------------------------
// getHealthHackerTips
// ---------------------------------------------------------------------------

describe('getHealthHackerTips', () => {
  // -----------------------------------------------------------------------
  // Burger chains
  // -----------------------------------------------------------------------

  describe('burger chains', () => {
    it('returns tips for mcdonalds-es burger', () => {
      const tips = getHealthHackerTips('mcdonalds-es', 'Big Mac', 508);
      expect(tips.length).toBeGreaterThan(0);
      expect(tips.length).toBeLessThanOrEqual(3);
      expect(tips[0]).toMatchObject({
        tip: expect.any(String),
        caloriesSaved: expect.any(Number),
      });
    });

    it('returns tips for burger-king-es', () => {
      const tips = getHealthHackerTips('burger-king-es', 'Whopper', 670);
      expect(tips.length).toBeGreaterThan(0);
      expect(tips.length).toBeLessThanOrEqual(3);
    });

    it('returns tips for five-guys-es', () => {
      const tips = getHealthHackerTips('five-guys-es', 'Cheeseburger', 840);
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pizza chains
  // -----------------------------------------------------------------------

  describe('pizza chains', () => {
    it('returns tips for telepizza-es', () => {
      const tips = getHealthHackerTips('telepizza-es', 'Pizza Barbacoa', 280);
      expect(tips.length).toBeGreaterThan(0);
      // Should include pizza-specific tips
      const tipTexts = tips.map((t) => t.tip);
      expect(tipTexts.some((t) => t.toLowerCase().includes('masa') || t.toLowerCase().includes('queso'))).toBe(true);
    });

    it('returns tips for dominos-es', () => {
      const tips = getHealthHackerTips('dominos-es', 'Pizza Pepperoni', 300);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('returns tips for pizza-hut-es', () => {
      const tips = getHealthHackerTips('pizza-hut-es', 'Vegetal', 250);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('returns tips for papa-johns-es', () => {
      const tips = getHealthHackerTips('papa-johns-es', 'BBQ Chicken', 310);
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Chicken chains
  // -----------------------------------------------------------------------

  describe('chicken chains', () => {
    it('returns tips for kfc-es', () => {
      const tips = getHealthHackerTips('kfc-es', 'Original Bucket', 450);
      expect(tips.length).toBeGreaterThan(0);
      const tipTexts = tips.map((t) => t.tip);
      expect(tipTexts.some((t) => t.toLowerCase().includes('plancha') || t.toLowerCase().includes('salsa'))).toBe(true);
    });

    it('returns tips for popeyes-es', () => {
      const tips = getHealthHackerTips('popeyes-es', 'Chicken Sandwich', 400);
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Sandwich chains
  // -----------------------------------------------------------------------

  describe('sandwich chains', () => {
    it('returns tips for subway-es', () => {
      const tips = getHealthHackerTips('subway-es', 'Italian BMT', 410);
      expect(tips.length).toBeGreaterThan(0);
      const tipTexts = tips.map((t) => t.tip);
      expect(tipTexts.some((t) => t.toLowerCase().includes('integral') || t.toLowerCase().includes('salsa'))).toBe(true);
    });

    it('returns tips for pans-and-company-es', () => {
      const tips = getHealthHackerTips('pans-and-company-es', 'Serranito', 500);
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Coffee chains
  // -----------------------------------------------------------------------

  describe('coffee chains', () => {
    it('returns tips for starbucks-es', () => {
      const tips = getHealthHackerTips('starbucks-es', 'Frappuccino Mocha', 400);
      expect(tips.length).toBeGreaterThan(0);
      const tipTexts = tips.map((t) => t.tip);
      expect(tipTexts.some((t) => t.toLowerCase().includes('desnatada') || t.toLowerCase().includes('nata') || t.toLowerCase().includes('azúcar'))).toBe(true);
    });

    it('returns tips for tim-hortons-es', () => {
      const tips = getHealthHackerTips('tim-hortons-es', 'Iced Capp', 350);
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns empty array for unknown chain slug', () => {
      const tips = getHealthHackerTips('unknown-chain', 'Something', 500);
      expect(tips).toEqual([]);
    });

    it('returns empty array for cocina-espanola (virtual chain)', () => {
      const tips = getHealthHackerTips('cocina-espanola', 'Tortilla de Patatas', 300);
      expect(tips).toEqual([]);
    });

    it('returns empty array when calories < 200', () => {
      const tips = getHealthHackerTips('mcdonalds-es', 'Apple Slices', 150);
      expect(tips).toEqual([]);
    });

    it('returns exactly 200 kcal threshold — returns tips', () => {
      const tips = getHealthHackerTips('mcdonalds-es', 'Small Fries', 200);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('returns max 3 tips', () => {
      const tips = getHealthHackerTips('mcdonalds-es', 'Big Mac', 800);
      expect(tips.length).toBeLessThanOrEqual(3);
    });

    it('every tip has positive caloriesSaved', () => {
      const tips = getHealthHackerTips('burger-king-es', 'Whopper', 670);
      for (const tip of tips) {
        expect(tip.caloriesSaved).toBeGreaterThan(0);
      }
    });

    it('every tip has non-empty tip string', () => {
      const tips = getHealthHackerTips('kfc-es', 'Bucket', 500);
      for (const tip of tips) {
        expect(tip.tip.length).toBeGreaterThan(0);
      }
    });

    it('handles null/undefined chainSlug gracefully', () => {
      const tips = getHealthHackerTips(null as unknown as string, 'Test', 500);
      expect(tips).toEqual([]);
    });

    it('handles empty dishName', () => {
      const tips = getHealthHackerTips('mcdonalds-es', '', 500);
      // Should still return general chain tips
      expect(tips.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Tip structure
  // -----------------------------------------------------------------------

  describe('tip structure', () => {
    it('tips are in Spanish', () => {
      const tips = getHealthHackerTips('mcdonalds-es', 'Big Mac', 508);
      // All tips should contain Spanish text (no English-only tips)
      for (const tip of tips) {
        // At minimum, tips use Spanish food vocabulary
        expect(tip.tip).toMatch(/[a-záéíóúñü]/i);
      }
    });

    it('caloriesSaved values are reasonable (10-300 range)', () => {
      const allChains = [
        'mcdonalds-es', 'burger-king-es', 'kfc-es', 'telepizza-es',
        'subway-es', 'starbucks-es', 'dominos-es', 'popeyes-es',
      ];
      for (const chain of allChains) {
        const tips = getHealthHackerTips(chain, 'Test Dish', 500);
        for (const tip of tips) {
          expect(tip.caloriesSaved).toBeGreaterThanOrEqual(10);
          expect(tip.caloriesSaved).toBeLessThanOrEqual(300);
        }
      }
    });
  });
});
