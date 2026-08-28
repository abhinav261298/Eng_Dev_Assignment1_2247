import { Db } from '../src/db';
import {
  cityDelayAnalysis,
  clientFailureAnalysis,
  warehouseFailureAnalysis,
  cityComparisonAnalysis,
  festivalAnalysis
} from '../src/insights/useCases';
import { onboardingRiskAnalysis } from '../src/insights/onboardingRisk';
import { renderTemplate } from '../src/narrative/templates';
import { renderNarrative } from '../src/narrative/render';
import { logger } from '../src/logger';
import { createFixtureDb } from './fixtures';

describe('template narrative renderer', () => {
  let db: Db;

  beforeAll(() => {
    db = createFixtureDb();
  });

  afterAll(() => {
    db.close();
  });

  it('renders UC1 with recorded causes, corroboration, and caveats', () => {
    const narrative = renderTemplate(cityDelayAnalysis(db, 'Mumbai', '2025-08-14'));
    expect(narrative).toContain('WHY WERE DELIVERIES DELAYED IN MUMBAI ON 2025-08-14?');
    expect(narrative).toContain('Incorrect address: 1 orders (100.0% of failures)');
    expect(narrative).toContain('corroborated by fleet "Address not found" note in 1/1 orders (100.0%)');
    expect(narrative).toContain('Caveats:');
    expect(narrative).toContain('not causation');
  });

  it('renders UC1 association factors when support is sufficient', () => {
    const narrative = renderTemplate(cityDelayAnalysis(db, 'Delhi', '2025-08-03'));
    expect(narrative).toContain('fleet log reported heavy congestion');
    expect(narrative).toContain('n=35');
  });

  it('renders UC2 with baseline context', () => {
    const narrative = renderTemplate(clientFailureAnalysis(db, 'Acme Corp', '2025-08-01', '2025-08-31'));
    expect(narrative).toContain("WHY DID ACME CORP'S ORDERS FAIL");
    expect(narrative).toContain('vs client all-time 33.3% vs system 90.2%');
  });

  it('renders UC3 with pair-level wording and ops comparison', () => {
    const narrative = renderTemplate(warehouseFailureAnalysis(db, 'Warehouse 2', '2025-08'));
    expect(narrative).toContain('ORDERS INVOLVING WAREHOUSE 2 IN 2025-08');
    expect(narrative).toContain('Warehouse ops: avg picking');
    expect(narrative).toContain('City mix');
  });

  it('renders UC4 with both city blocks and the failure-rate gap', () => {
    const narrative = renderTemplate(cityComparisonAnalysis(db, 'Mumbai', 'Pune', '2025-08'));
    expect(narrative).toContain('MUMBAI vs PUNE');
    expect(narrative).toContain('--- Mumbai ---');
    expect(narrative).toContain('--- Pune ---');
    expect(narrative).toContain('Failure-rate gap');
  });

  it('renders UC5 with preparation recommendations', () => {
    const narrative = renderTemplate(festivalAnalysis(db));
    expect(narrative).toContain('FESTIVAL PERIOD');
    expect(narrative).toContain('Preparation recommendations:');
  });

  it('renders UC6 as an explicitly labeled projection', () => {
    const narrative = renderTemplate(onboardingRiskAnalysis(db, 1000, ['Mumbai']));
    expect(narrative).toContain('PROJECTED RISKS FOR ONBOARDING ~1000 EXTRA MONTHLY ORDERS');
    expect(narrative).toContain('Projected failure breakdown:');
    expect(narrative).toContain('Mitigations:');
    expect(narrative).toContain('PROJECTION');
  });
});

describe('renderNarrative dispatcher', () => {
  it('falls back to the deterministic template', async () => {
    const db = createFixtureDb();
    const result = await renderNarrative(festivalAnalysis(db));
    expect(result.source).toBe('template');
    expect(result.narrative).toContain('FESTIVAL PERIOD');
    db.close();
  });
});

describe('logger', () => {
  it('logs at every level without throwing', () => {
    expect(() => {
      logger.debug('debug message');
      logger.info('info message', { key: 'value' });
      logger.warn('warn message');
      logger.error('error message');
    }).not.toThrow();
  });
});
