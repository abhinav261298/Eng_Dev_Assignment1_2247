import { Db } from '../src/db';
import { PocError } from '../src/errors';
import { onboardingRiskAnalysis } from '../src/insights/onboardingRisk';
import { createFixtureDb } from './fixtures';

describe('UC6 onboardingRiskAnalysis', () => {
  let db: Db;

  beforeAll(() => {
    db = createFixtureDb();
  });

  afterAll(() => {
    db.close();
  });

  it('projects failures from historical rates and reports capacity context (happy path)', () => {
    const evidence = onboardingRiskAnalysis(db, 1000, ['Mumbai']);
    // Fixture: 41 orders, 37 failed (35 Delhi traffic + o1 + o4).
    expect(evidence.systemFailureRate).toBeCloseTo(37 / 41);
    expect(evidence.projectedMonthlyFailures).toBe(Math.round((37 / 41) * 1000));
    const trafficProjection = evidence.projectedReasons.find(
      (entry) => entry.reason === 'Traffic congestion'
    );
    expect(trafficProjection?.projectedMonthlyFailures).toBe(Math.round((35 / 41) * 1000));

    expect(evidence.targetCities).toEqual(['Mumbai']);
    const mumbai = evidence.cityCapacities[0];
    expect(mumbai).toMatchObject({ city: 'Mumbai', warehouseCapacityTotal: 100, activeDrivers: 1 });
    expect(evidence.comparableClientRates.length).toBeGreaterThan(0);
    expect(evidence.mitigations.length).toBeGreaterThan(0);
    expect(evidence.caveats.join(' ')).toMatch(/PROJECTION/);
  });

  it('defaults to all known cities when no target cities are given', () => {
    const evidence = onboardingRiskAnalysis(db, 500);
    expect(evidence.targetCities).toEqual(['Delhi', 'Mumbai', 'Pune']);
  });

  it('rejects non-positive volumes', () => {
    expect(() => onboardingRiskAnalysis(db, 0)).toThrow(PocError);
    expect(() => onboardingRiskAnalysis(db, Number.NaN)).toThrow(/positive number/);
  });

  it('rejects unknown target cities', () => {
    expect(() => onboardingRiskAnalysis(db, 1000, ['Gotham'])).toThrow(/Unknown target city/);
  });
});
