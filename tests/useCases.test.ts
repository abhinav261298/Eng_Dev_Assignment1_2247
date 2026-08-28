import { Db } from '../src/db';
import { PocError } from '../src/errors';
import {
  cityDelayAnalysis,
  clientFailureAnalysis,
  warehouseFailureAnalysis,
  cityComparisonAnalysis,
  festivalAnalysis,
  listCities
} from '../src/insights/useCases';
import { createFixtureDb } from './fixtures';

describe('deterministic use-case engine', () => {
  let db: Db;

  beforeAll(() => {
    db = createFixtureDb();
  });

  afterAll(() => {
    db.close();
  });

  describe('UC1 cityDelayAnalysis', () => {
    it('classifies outcomes and surfaces recorded causes with corroboration (happy path)', () => {
      const evidence = cityDelayAnalysis(db, 'Mumbai', '2025-08-14');
      expect(evidence.outcomes).toMatchObject({ totalOrders: 3, failed: 1, late: 1, onTime: 1 });
      expect(evidence.failureReasons).toEqual([
        { reason: 'Incorrect address', count: 1, share: 1 }
      ]);
      const addressCorroboration = evidence.corroborations.find(
        (entry) => entry.reason === 'Incorrect address'
      );
      expect(addressCorroboration).toMatchObject({ matchedOrders: 1, ordersWithReason: 1, corroborationRate: 1 });
      expect(evidence.feedbackSamples).toContain('Delivery never came, wrong address issue.');
    });

    it('surfaces association factors only above the support threshold', () => {
      const smallPopulation = cityDelayAnalysis(db, 'Mumbai', '2025-08-14');
      expect(smallPopulation.factorRates).toHaveLength(0);

      const largePopulation = cityDelayAnalysis(db, 'Delhi', '2025-08-03');
      const congestion = largePopulation.factorRates.find((factor) => factor.factor === 'had_congestion');
      expect(congestion).toBeDefined();
      expect(congestion?.support).toBe(35);
      expect(congestion?.rate).toBe(1);
      expect(congestion?.tier).toBe('association');
    });

    it('rejects unknown cities', () => {
      expect(() => cityDelayAnalysis(db, 'Atlantis', '2025-08-14')).toThrow(PocError);
    });

    it('rejects malformed dates', () => {
      expect(() => cityDelayAnalysis(db, 'Mumbai', '14-08-2025')).toThrow(/YYYY-MM-DD/);
    });

    it('reports when no orders were due on the date', () => {
      expect(() => cityDelayAnalysis(db, 'Mumbai', '2030-01-01')).toThrow(/No orders/);
    });
  });

  describe('UC2 clientFailureAnalysis', () => {
    it('computes window failure profile with client and system baselines (happy path)', () => {
      const evidence = clientFailureAnalysis(db, 'Acme Corp', '2025-08-01', '2025-08-31');
      expect(evidence.outcomes).toMatchObject({ totalOrders: 3, failed: 1 });
      expect(evidence.clientAllTimeFailureRate).toBeCloseTo(1 / 3);
      expect(evidence.systemFailureRate).toBeCloseTo(37 / 41);
      expect(evidence.failureReasons[0]).toMatchObject({ reason: 'Incorrect address', count: 1 });
    });

    it('rejects unknown clients', () => {
      expect(() => clientFailureAnalysis(db, 'Ghost Inc', '2025-08-01', '2025-08-07')).toThrow(/Unknown client/);
    });

    it('rejects inverted date ranges', () => {
      expect(() => clientFailureAnalysis(db, 'Acme Corp', '2025-08-07', '2025-08-01')).toThrow(/after/);
    });
  });

  describe('UC3 warehouseFailureAnalysis', () => {
    it('uses pair-level attribution: a multi-warehouse order counts toward each warehouse', () => {
      const warehouseOne = warehouseFailureAnalysis(db, 'Warehouse 1', '2025-08');
      const warehouseTwo = warehouseFailureAnalysis(db, 'Warehouse 2', '2025-08');
      expect(warehouseOne.outcomes.totalOrders).toBe(2); // o1 + o4
      expect(warehouseTwo.outcomes.totalOrders).toBe(1); // o4 only
      expect(warehouseTwo.failureReasons).toEqual([{ reason: 'Stockout', count: 1, share: 1 }]);
      expect(warehouseTwo.warehouseCityMix).toEqual([{ city: 'Pune', orders: 1 }]);
    });

    it('reports warehouse ops durations vs the all-warehouse baseline', () => {
      const evidence = warehouseFailureAnalysis(db, 'Warehouse 1', '2025-08');
      expect(evidence.avgPickingMins).toBeCloseTo(9);   // (8 + 10) / 2
      expect(evidence.avgDispatchLagMins).toBeCloseTo(30);
      expect(evidence.allWarehousePickingMins).toBeCloseTo(12.7);
    });

    it('rejects unknown warehouses and malformed months', () => {
      expect(() => warehouseFailureAnalysis(db, 'Warehouse 99', '2025-08')).toThrow(/Unknown warehouse/);
      expect(() => warehouseFailureAnalysis(db, 'Warehouse 1', 'Aug-2025')).toThrow(/YYYY-MM/);
    });

    it('reports when the warehouse had no orders in the month', () => {
      expect(() => warehouseFailureAnalysis(db, 'Warehouse 1', '2024-01')).toThrow(/No orders involving/);
    });
  });

  describe('UC4 cityComparisonAnalysis', () => {
    it('produces symmetric per-city blocks (happy path)', () => {
      const evidence = cityComparisonAnalysis(db, 'Mumbai', 'Pune', '2025-08');
      expect(evidence.cityA.city).toBe('Mumbai');
      expect(evidence.cityA.outcomes.totalOrders).toBe(3);
      expect(evidence.cityB.outcomes.totalOrders).toBe(1);
      expect(evidence.cityB.failureReasons[0]?.reason).toBe('Stockout');
    });

    it('rejects comparing a city to itself', () => {
      expect(() => cityComparisonAnalysis(db, 'Mumbai', 'Mumbai', '2025-08')).toThrow(/different cities/);
    });

    it('reports when a city has no orders in the month', () => {
      expect(() => cityComparisonAnalysis(db, 'Mumbai', 'Pune', '2024-01')).toThrow(/No orders found/);
    });
  });

  describe('UC5 festivalAnalysis', () => {
    it('segments festival-flagged orders against the non-festival baseline (happy path)', () => {
      const evidence = festivalAnalysis(db);
      expect(evidence.outcomes.totalOrders).toBe(1); // only o4 is festival-flagged
      expect(evidence.outcomes.failureRate).toBe(1);
      expect(evidence.failureReasons[0]?.reason).toBe('Stockout');
      expect(evidence.preparationRecommendations.length).toBeGreaterThan(0);
      expect(evidence.preparationRecommendations[0]).toMatch(/stock buffers/i);
    });
  });

  describe('listCities', () => {
    it('lists distinct order cities alphabetically', () => {
      expect(listCities(db)).toEqual(['Delhi', 'Mumbai', 'Pune']);
    });
  });
});
