import { Db } from '../db';
import { invalidParam, notFound } from '../errors';
import { buildPopulationEvidence, PopulationFilter } from './common';
import {
  CityComparisonEvidence,
  CityDelayEvidence,
  ClientFailureEvidence,
  FestivalEvidence,
  WarehouseFailureEvidence
} from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export const listCities = (db: Db): string[] =>
  (db.prepare('SELECT DISTINCT city FROM orders ORDER BY city').all() as { city: string }[]).map(
    (row) => row.city
  );

const assertCity = (db: Db, city: string): void => {
  if (!listCities(db).includes(city)) {
    throw notFound(`Unknown city "${city}". Known cities: ${listCities(db).join(', ')}`);
  }
};

const assertDate = (value: string, label: string): void => {
  if (!DATE_PATTERN.test(value)) throw invalidParam(`${label} must be in YYYY-MM-DD format, got "${value}"`);
};

const assertMonth = (value: string): void => {
  if (!MONTH_PATTERN.test(value)) throw invalidParam(`month must be in YYYY-MM format, got "${value}"`);
};

/** UC1 — Why were deliveries delayed in city X on a given day (default: yesterday)? */
export const cityDelayAnalysis = (db: Db, city: string, date: string): CityDelayEvidence => {
  assertCity(db, city);
  assertDate(date, 'date');
  const population: PopulationFilter = {
    where: 'city = :city AND date(promised_delivery_date) = :date',
    params: { city, date },
    description: `orders due for delivery in ${city} on ${date}`
  };
  const baseline: PopulationFilter = {
    where: 'city = :city',
    params: { city },
    description: `all ${city} orders (Jan–Sep 2025)`
  };
  const evidence = buildPopulationEvidence(db, population, baseline, [
    'Delivered-but-late orders carry no recorded failure_reason; their explanation rests on association evidence only.'
  ]);
  if (evidence.outcomes.totalOrders === 0) {
    throw notFound(`No orders were due for delivery in ${city} on ${date}.`);
  }
  return { useCase: 'UC1', city, date, ...evidence };
};

/** UC2 — Why did a client's orders fail in a date window (default: past week)? */
export const clientFailureAnalysis = (
  db: Db,
  clientName: string,
  fromDate: string,
  toDate: string
): ClientFailureEvidence => {
  assertDate(fromDate, 'fromDate');
  assertDate(toDate, 'toDate');
  if (fromDate > toDate) throw invalidParam(`fromDate ${fromDate} is after toDate ${toDate}`);
  const client = db
    .prepare('SELECT client_id, client_name FROM clients WHERE client_name = ?')
    .get(clientName) as { client_id: number; client_name: string } | undefined;
  if (!client) throw notFound(`Unknown client "${clientName}".`);

  const population: PopulationFilter = {
    where: 'client_id = :clientId AND date(order_date) BETWEEN :fromDate AND :toDate',
    params: { clientId: client.client_id, fromDate, toDate },
    description: `orders placed by ${client.client_name} between ${fromDate} and ${toDate}`
  };
  const baseline: PopulationFilter = {
    where: 'client_id = :clientId',
    params: { clientId: client.client_id },
    description: `all ${client.client_name} orders`
  };
  const evidence = buildPopulationEvidence(db, population, baseline);
  const clientAllTime = db
    .prepare('SELECT AVG(is_failed) AS rate FROM order_360 WHERE client_id = ?')
    .get(client.client_id) as { rate: number | null };
  const system = db.prepare('SELECT AVG(is_failed) AS rate FROM order_360').get() as {
    rate: number | null;
  };
  return {
    useCase: 'UC2',
    clientId: client.client_id,
    clientName: client.client_name,
    fromDate,
    toDate,
    clientAllTimeFailureRate: clientAllTime.rate ?? 0,
    systemFailureRate: system.rate ?? 0,
    ...evidence
  };
};

/** UC3 — Top failure reasons for orders involving a warehouse in a month (pair-level). */
export const warehouseFailureAnalysis = (
  db: Db,
  warehouseName: string,
  month: string
): WarehouseFailureEvidence => {
  assertMonth(month);
  const warehouse = db
    .prepare('SELECT warehouse_id, warehouse_name FROM warehouses WHERE warehouse_name = ?')
    .get(warehouseName) as { warehouse_id: number; warehouse_name: string } | undefined;
  if (!warehouse) throw notFound(`Unknown warehouse "${warehouseName}".`);

  const pairSubquery =
    'SELECT order_id FROM v_order_warehouse_pairs WHERE warehouse_id = :warehouseId';
  const population: PopulationFilter = {
    where: `order_id IN (${pairSubquery}) AND strftime('%Y-%m', order_date) = :month`,
    params: { warehouseId: warehouse.warehouse_id, month },
    description: `orders involving ${warehouse.warehouse_name} placed in ${month}`
  };
  const baseline: PopulationFilter = {
    where: `strftime('%Y-%m', order_date) = :month AND order_id IN (SELECT order_id FROM warehouse_logs)`,
    params: { month },
    description: `all orders involving any warehouse in ${month}`
  };
  const evidence = buildPopulationEvidence(db, population, baseline, [
    `Attribution is pair-level: an order counts toward every warehouse that handled it.`
  ]);
  if (evidence.outcomes.totalOrders === 0) {
    throw notFound(`No orders involving ${warehouse.warehouse_name} were placed in ${month}.`);
  }

  const ops = db
    .prepare(
      `SELECT ROUND(AVG((julianday(picking_end)  - julianday(picking_start)) * 1440), 1) AS picking,
              ROUND(AVG((julianday(dispatch_time) - julianday(picking_end))  * 1440), 1) AS dispatchLag
       FROM warehouse_logs WHERE warehouse_id = ?`
    )
    .get(warehouse.warehouse_id) as { picking: number | null; dispatchLag: number | null };
  const allOps = db
    .prepare(
      `SELECT ROUND(AVG((julianday(picking_end)  - julianday(picking_start)) * 1440), 1) AS picking,
              ROUND(AVG((julianday(dispatch_time) - julianday(picking_end))  * 1440), 1) AS dispatchLag
       FROM warehouse_logs`
    )
    .get() as { picking: number | null; dispatchLag: number | null };
  const cityMix = db
    .prepare(
      `SELECT o.city, COUNT(DISTINCT o.order_id) AS orders
       FROM v_order_warehouse_pairs p JOIN orders o ON o.order_id = p.order_id
       WHERE p.warehouse_id = ? GROUP BY o.city ORDER BY orders DESC LIMIT 5`
    )
    .all(warehouse.warehouse_id) as { city: string; orders: number }[];

  return {
    useCase: 'UC3',
    warehouseName: warehouse.warehouse_name,
    month,
    avgPickingMins: ops.picking,
    avgDispatchLagMins: ops.dispatchLag,
    allWarehousePickingMins: allOps.picking,
    allWarehouseDispatchLagMins: allOps.dispatchLag,
    warehouseCityMix: cityMix,
    ...evidence
  };
};

/** UC4 — Compare delivery failure causes between two cities in a month. */
export const cityComparisonAnalysis = (
  db: Db,
  cityA: string,
  cityB: string,
  month: string
): CityComparisonEvidence => {
  assertCity(db, cityA);
  assertCity(db, cityB);
  assertMonth(month);
  if (cityA === cityB) throw invalidParam('Choose two different cities to compare.');

  const buildCityBlock = (city: string) => {
    const population: PopulationFilter = {
      where: `city = :city AND strftime('%Y-%m', order_date) = :month`,
      params: { city, month },
      description: `orders placed in ${city} during ${month}`
    };
    const baseline: PopulationFilter = {
      where: `strftime('%Y-%m', order_date) = :month`,
      params: { month },
      description: `all orders placed in ${month} (all cities)`
    };
    return { city, ...buildPopulationEvidence(db, population, baseline) };
  };

  const blockA = buildCityBlock(cityA);
  const blockB = buildCityBlock(cityB);
  if (blockA.outcomes.totalOrders === 0 || blockB.outcomes.totalOrders === 0) {
    throw notFound(`No orders found in ${month} for ${blockA.outcomes.totalOrders === 0 ? cityA : cityB}.`);
  }
  return {
    useCase: 'UC4',
    month,
    cityA: blockA,
    cityB: blockB,
    caveats: blockA.caveats
  };
};

const FESTIVAL_PREPARATIONS: readonly { factor: string; recommendation: string }[] = [
  { factor: 'Stockout', recommendation: 'Pre-build stock buffers for festival weeks at high-volume warehouses.' },
  { factor: 'Warehouse delay', recommendation: 'Add temporary picking/packing staff and extend dispatch windows before festival peaks.' },
  { factor: 'Traffic congestion', recommendation: 'Re-plan festival-week routes and shift deliveries to off-peak windows.' },
  { factor: 'Incorrect address', recommendation: 'Run address verification campaigns before festival-season order surges.' },
  { factor: 'Weather disruption', recommendation: 'Build weather-aware promised-date padding into festival-season SLAs.' }
];

/** UC5 — Failure causes during festival-flagged orders vs non-festival baseline. */
export const festivalAnalysis = (db: Db): FestivalEvidence => {
  const population: PopulationFilter = {
    where: 'IFNULL(had_festival, 0) = 1',
    params: {},
    description: 'orders with a festival record in external factors'
  };
  const baseline: PopulationFilter = {
    where: 'IFNULL(had_festival, 0) = 0',
    params: {},
    description: 'orders without a festival record'
  };
  const evidence = buildPopulationEvidence(db, population, baseline, [
    'Festival flag comes from external_factors records; orders without any external record fall into the baseline.'
  ]);
  const topReasons = evidence.failureReasons.slice(0, 3).map((entry) => entry.reason);
  const preparationRecommendations = FESTIVAL_PREPARATIONS.filter((preparation) =>
    topReasons.includes(preparation.factor)
  ).map((preparation) => preparation.recommendation);
  return { useCase: 'UC5', preparationRecommendations, ...evidence };
};
