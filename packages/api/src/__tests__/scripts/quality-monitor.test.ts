// Unit tests for quality-monitor.ts — runQualityMonitor() exported function.
//
// All tests inject a mock assembleReport (or mock prisma) — no real DB.
// Tests cover: JSON output shape, Markdown section headers, --output writes to file,
// DB error causes process exit code 1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
// Mock assembleReport before importing the CLI script
vi.mock('../../quality/assembleReport.js', () => ({
  assembleReport: vi.fn(),
}));

import { runQualityMonitor } from '../../scripts/quality-monitor.js';
import { assembleReport } from '../../quality/assembleReport.js';

// ---------------------------------------------------------------------------
// Minimal QualityReportData fixture
// ---------------------------------------------------------------------------

const sampleReport = {
  generatedAt: '2026-03-17T12:00:00.000Z',
  totalDishes: 100,
  totalRestaurants: 5,
  stalenessThresholdDays: 90,
  scopedToChain: null as string | null,
  chainSummary: [
    {
      chainSlug: 'chain-a',
      totalDishes: 60,
      nutrientCoveragePercent: 80,
      issueCount: 5,
    },
  ],
  nutrientCompleteness: {
    dishesWithNutrients: 80,
    dishesWithoutNutrients: 20,
    dishesWithoutNutrientsPercent: 20,
    ghostRowCount: 5,
    zeroCaloriesCount: 8,
    byChain: [],
  },
  implausibleValues: {
    caloriesAboveThreshold: 2,
    ghostRows: 5,
    suspiciouslyRoundCalories: 10,
    caloriesThreshold: 5000 as const,
    byChain: [],
  },
  dataGaps: {
    dishesWithoutPortionGrams: 30,
    dishesWithoutPriceEur: 45,
    restaurantsWithoutDishes: 1,
  },
  duplicates: {
    duplicateGroupCount: 3,
    totalDuplicateDishes: 8,
    groups: [
      { name: 'Big Mac', chainSlug: 'chain-a', count: 2, dishIds: ['d1', 'd2'] },
      { name: 'Whopper', chainSlug: 'chain-b', count: 3, dishIds: ['d3', 'd4', 'd5'] },
      { name: 'Quarter Pounder', chainSlug: 'chain-a', count: 3, dishIds: ['d6', 'd7', 'd8'] },
    ],
  },
  confidenceDistribution: {
    global: { high: 40, medium: 40, low: 20 },
    byEstimationMethod: { official: 30, scraped: 50, ingredients: 10, extrapolation: 10 },
    byChain: [],
  },
  dataFreshness: {
    totalSources: 3,
    staleSources: 1,
    staleSourcesDetail: [
      { sourceId: 'src-001', name: 'Old Source', lastUpdated: null, daysSinceUpdate: null },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runQualityMonitor()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assembleReport).mockResolvedValue(sampleReport);
  });

  it('JSON format: output is valid JSON matching QualityReportData shape', async () => {
    let capturedOutput = '';
    const fakeWrite = (data: string) => {
      capturedOutput = data;
    };

    await runQualityMonitor(
      { format: 'json', stalenessThresholdDays: 90 },
      undefined,
      fakeWrite,
    );

    const parsed = JSON.parse(capturedOutput) as typeof sampleReport;
    expect(parsed.totalDishes).toBe(100);
    expect(parsed.totalRestaurants).toBe(5);
    expect(parsed.nutrientCompleteness.dishesWithoutNutrients).toBe(20);
    expect(parsed.duplicates.duplicateGroupCount).toBe(3);
  });

  it('Markdown format: output contains expected section headers', async () => {
    let capturedOutput = '';
    const fakeWrite = (data: string) => {
      capturedOutput = data;
    };

    await runQualityMonitor(
      { format: 'markdown', stalenessThresholdDays: 90 },
      undefined,
      fakeWrite,
    );

    expect(capturedOutput).toContain('# Data Quality Report');
    expect(capturedOutput).toContain('## Nutrient Completeness');
    expect(capturedOutput).toContain('## Implausible Values');
    expect(capturedOutput).toContain('## Data Gaps');
    expect(capturedOutput).toContain('## Duplicates');
    expect(capturedOutput).toContain('## Confidence Distribution');
    expect(capturedOutput).toContain('## Data Freshness');
  });

  it('Markdown format: summary table contains totalDishes and totalRestaurants', async () => {
    let capturedOutput = '';
    const fakeWrite = (data: string) => {
      capturedOutput = data;
    };

    await runQualityMonitor(
      { format: 'markdown', stalenessThresholdDays: 90 },
      undefined,
      fakeWrite,
    );

    expect(capturedOutput).toContain('100'); // totalDishes
    expect(capturedOutput).toContain('5');   // totalRestaurants
  });

  it('--output: writes output to a temp file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quality-monitor-test-'));
    const outputPath = path.join(tmpDir, 'report.json');

    await runQualityMonitor(
      { format: 'json', stalenessThresholdDays: 90, output: outputPath },
      undefined,
    );

    const fileContent = await fs.readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as typeof sampleReport;
    expect(parsed.totalDishes).toBe(100);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('chainSlug scope passed to assembleReport', async () => {
    await runQualityMonitor(
      { format: 'json', stalenessThresholdDays: 30, chainSlug: 'mcdonalds-es' },
      undefined,
      () => {},
    );

    expect(assembleReport).toHaveBeenCalledWith(
      expect.anything(),
      { chainSlug: 'mcdonalds-es' },
      30,
    );
  });

  it('stalenessThresholdDays passed to assembleReport', async () => {
    await runQualityMonitor(
      { format: 'json', stalenessThresholdDays: 45 },
      undefined,
      () => {},
    );

    expect(assembleReport).toHaveBeenCalledWith(
      expect.anything(),
      {},
      45,
    );
  });

  it('DB error: runQualityMonitor throws (caller handles exit code 1)', async () => {
    vi.mocked(assembleReport).mockRejectedValue(new Error('DB connection lost'));

    await expect(
      runQualityMonitor(
        { format: 'json', stalenessThresholdDays: 90 },
        undefined,
        () => {},
      ),
    ).rejects.toThrow('DB connection lost');
  });

  it('no chainSlug: assembleReport called with empty scope', async () => {
    await runQualityMonitor(
      { format: 'json', stalenessThresholdDays: 90 },
      undefined,
      () => {},
    );

    expect(assembleReport).toHaveBeenCalledWith(
      expect.anything(),
      {},
      90,
    );
  });
});
