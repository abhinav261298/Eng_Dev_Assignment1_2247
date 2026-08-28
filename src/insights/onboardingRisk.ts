import { Db } from '../db';
import { invalidParam, notFound } from '../errors';
import { listCities } from './useCases';
import { CityCapacity, OnboardingRiskEvidence, ProjectedReason } from './types';

const MITIGATION_BY_REASON: Readonly<Record<string, string>> = {
  Stockout: 'Negotiate inventory commitments and safety stock for the new client before go-live.',
  'Warehouse delay': 'Stage the volume ramp-up and pre-book additional picking/packing capacity.',
  'Incorrect address': 'Enforce address validation at order intake for the new client integration.',
  'Traffic congestion': 'Plan delivery windows outside peak traffic and diversify route options.',
  'Weather disruption': 'Add weather-aware buffer days to promised delivery dates in monsoon/fog seasons.'
};

/**
 * UC6 — Projection (clearly labeled): expected failure profile and capacity risks when
 * onboarding a new client with extraMonthlyOrders. All rates come from historical order_360
 * data; the only computation outside SQL is scaling those rates to the new volume.
 */
export const onboardingRiskAnalysis = (
  db: Db,
  extraMonthlyOrders: number,
  targetCities: readonly string[] = []
): OnboardingRiskEvidence => {
  if (!Number.isFinite(extraMonthlyOrders) || extraMonthlyOrders <= 0) {
    throw invalidParam(`extraMonthlyOrders must be a positive number, got ${extraMonthlyOrders}`);
  }
  const knownCities = listCities(db);
  for (const city of targetCities) {
    if (!knownCities.includes(city)) {
      throw notFound(`Unknown target city "${city}". Known cities: ${knownCities.join(', ')}`);
    }
  }
  const cities = targetCities.length > 0 ? [...targetCities] : knownCities;

  const systemRates = db
    .prepare('SELECT AVG(is_failed) AS failureRate, AVG(is_late) AS lateRate FROM order_360')
    .get() as { failureRate: number | null; lateRate: number | null };
  const failureRate = systemRates.failureRate ?? 0;
  const lateRate = systemRates.lateRate ?? 0;

  const reasonRows = db
    .prepare(
      `SELECT failure_reason AS reason,
              COUNT(*) * 1.0 / (SELECT COUNT(*) FROM orders) AS rate
       FROM orders WHERE status = 'Failed' GROUP BY failure_reason ORDER BY rate DESC`
    )
    .all() as { reason: string; rate: number }[];
  const projectedReasons: ProjectedReason[] = reasonRows.map((row) => ({
    reason: row.reason,
    historicalRate: row.rate,
    projectedMonthlyFailures: Math.round(row.rate * extraMonthlyOrders)
  }));

  const monthsObserved = (
    db.prepare(`SELECT COUNT(DISTINCT strftime('%Y-%m', order_date)) AS n FROM orders`).get() as {
      n: number;
    }
  ).n;
  const cityCapacities: CityCapacity[] = cities.map((city) => {
    const monthlyOrders = (
      db.prepare('SELECT COUNT(*) AS n FROM orders WHERE city = ?').get(city) as { n: number }
    ).n / Math.max(monthsObserved, 1);
    const warehouseCapacity = (
      db
        .prepare('SELECT IFNULL(SUM(capacity), 0) AS total FROM warehouses WHERE city = ?')
        .get(city) as { total: number }
    ).total;
    const activeDrivers = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM drivers WHERE city = ? AND status = 'Active'`)
        .get(city) as { n: number }
    ).n;
    return {
      city,
      currentAvgMonthlyOrders: Math.round(monthlyOrders),
      warehouseCapacityTotal: warehouseCapacity,
      activeDrivers,
      ordersPerActiveDriver: activeDrivers > 0 ? Math.round(monthlyOrders / activeDrivers) : 0
    };
  });

  const comparableClientRates = db
    .prepare(
      `SELECT client_name AS clientName, COUNT(*) AS orders, AVG(is_failed) AS failureRate
       FROM order_360 GROUP BY client_id ORDER BY orders DESC LIMIT 5`
    )
    .all() as { clientName: string; orders: number; failureRate: number }[];

  const mitigations = projectedReasons
    .slice(0, 3)
    .map((entry) => MITIGATION_BY_REASON[entry.reason])
    .filter((mitigation): mitigation is string => mitigation !== undefined);

  return {
    useCase: 'UC6',
    extraMonthlyOrders,
    targetCities: cities,
    systemFailureRate: failureRate,
    systemLateRate: lateRate,
    projectedMonthlyFailures: Math.round(failureRate * extraMonthlyOrders),
    projectedMonthlyLate: Math.round(lateRate * extraMonthlyOrders),
    projectedReasons,
    cityCapacities,
    comparableClientRates,
    mitigations,
    caveats: [
      'This is a PROJECTION from historical rates, not a measurement: the new client has no order history.',
      'Historical rates come from Jan–Sep 2025 orders; seasonality beyond that window is not modeled.',
      'Warehouse capacity units are as provided in warehouses.csv; interpretation (orders/day vs slots) is not specified in the data.'
    ]
  };
};
