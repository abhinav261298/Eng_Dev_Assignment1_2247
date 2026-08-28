import { Db } from '../db';
import {
  CorroborationEntry,
  FactorRate,
  OutcomeSummary,
  PopulationEvidence,
  ReasonCount
} from './types';

/** Minimum orders with a factor present before an association lift is surfaced. */
export const MIN_SUPPORT = 30;

export interface PopulationFilter {
  /** SQL condition over the order_360 view (without the WHERE keyword). */
  readonly where: string;
  readonly params: Record<string, string | number>;
  /** Human description used in narratives, e.g. "orders due in Mumbai on 2025-08-14". */
  readonly description: string;
}

interface FactorSpec {
  readonly column: string;
  readonly label: string;
}

/** Evidence-flag columns of order_360 (all tier-3 association signals as population rates). */
export const FACTOR_SPECS: readonly FactorSpec[] = [
  { column: 'had_congestion', label: 'fleet log reported heavy congestion' },
  { column: 'had_breakdown', label: 'fleet log reported vehicle breakdown' },
  { column: 'had_address_issue', label: 'fleet log reported address not found' },
  { column: 'had_stock_delay', label: 'warehouse noted stock delay on item' },
  { column: 'had_system_issue', label: 'warehouse noted system issue' },
  { column: 'had_slow_packing', label: 'warehouse noted slow packing' },
  { column: 'had_heavy_traffic', label: 'external factor: heavy traffic' },
  { column: 'had_bad_weather', label: 'external factor: rain or fog' },
  { column: 'had_festival', label: 'external factor: festival period' },
  { column: 'had_holiday', label: 'external factor: holiday period' },
  { column: 'had_strike', label: 'external factor: strike' }
];

/** Tier-2 mapping: recorded failure_reason -> operational flags that corroborate it. */
const REASON_EVIDENCE_MAP: readonly { reason: string; columns: readonly string[]; label: string }[] = [
  { reason: 'Incorrect address', columns: ['had_address_issue'], label: 'fleet "Address not found" note' },
  { reason: 'Stockout', columns: ['had_stock_delay'], label: 'warehouse "Stock delay on item" note' },
  {
    reason: 'Warehouse delay',
    columns: ['had_stock_delay', 'had_system_issue', 'had_slow_packing'],
    label: 'warehouse delay-related notes'
  },
  {
    reason: 'Traffic congestion',
    columns: ['had_congestion', 'had_heavy_traffic'],
    label: 'fleet congestion note or heavy-traffic record'
  },
  { reason: 'Weather disruption', columns: ['had_bad_weather'], label: 'rain/fog external record' }
];

export const STANDARD_CAVEATS: readonly string[] = [
  'Only ~63% of orders have fleet/warehouse/external/feedback records; factor rates use all orders in the population as denominator.',
  'Association lifts describe co-occurrence, not causation; recorded failure_reason is the only tier-1 causal field.',
  'Cross-table timestamps are unreliable in this dataset; all time filtering anchors on order dates.'
];

export const getOutcomeSummary = (db: Db, filter: PopulationFilter): OutcomeSummary => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(is_failed) AS failed,
              SUM(is_late) AS late,
              SUM(outcome = 'On-Time') AS onTime,
              SUM(outcome = 'Returned') AS returned,
              SUM(outcome IN ('Pending', 'In-Transit')) AS pendingOrInTransit
       FROM order_360 WHERE ${filter.where}`
    )
    .get(filter.params) as {
    total: number;
    failed: number | null;
    late: number | null;
    onTime: number | null;
    returned: number | null;
    pendingOrInTransit: number | null;
  };
  const total = row.total;
  const failed = row.failed ?? 0;
  const late = row.late ?? 0;
  return {
    totalOrders: total,
    failed,
    late,
    onTime: row.onTime ?? 0,
    returned: row.returned ?? 0,
    pendingOrInTransit: row.pendingOrInTransit ?? 0,
    failureRate: total > 0 ? failed / total : 0,
    lateRate: total > 0 ? late / total : 0
  };
};

export const getFailureReasons = (db: Db, filter: PopulationFilter): ReasonCount[] => {
  const rows = db
    .prepare(
      `SELECT failure_reason AS reason, COUNT(*) AS count
       FROM order_360
       WHERE is_failed = 1 AND (${filter.where})
       GROUP BY failure_reason ORDER BY count DESC`
    )
    .all(filter.params) as { reason: string; count: number }[];
  const totalFailed = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => ({
    reason: row.reason,
    count: row.count,
    share: totalFailed > 0 ? row.count / totalFailed : 0
  }));
};

const getFactorRate = (db: Db, column: string, filter: PopulationFilter): { rate: number; support: number } => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(IFNULL(${column}, 0)) AS present
       FROM order_360 WHERE ${filter.where}`
    )
    .get(filter.params) as { total: number; present: number | null };
  const present = row.present ?? 0;
  return { rate: row.total > 0 ? present / row.total : 0, support: present };
};

/**
 * Tier-3 association rates for each evidence flag: population rate vs baseline rate.
 * Factors below MIN_SUPPORT in the population are omitted (insufficient evidence).
 */
export const getFactorRates = (
  db: Db,
  population: PopulationFilter,
  baseline: PopulationFilter
): FactorRate[] =>
  FACTOR_SPECS.map((spec) => {
    const populationRate = getFactorRate(db, spec.column, population);
    const baselineRate = getFactorRate(db, spec.column, baseline);
    return {
      factor: spec.column,
      label: spec.label,
      tier: 'association' as const,
      rate: populationRate.rate,
      baselineRate: baselineRate.rate,
      lift: populationRate.rate - baselineRate.rate,
      support: populationRate.support
    };
  })
    .filter((factor) => factor.support >= MIN_SUPPORT)
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));

/** Tier-2 corroboration: how often the recorded reason is backed by matching log evidence. */
export const getCorroborations = (db: Db, filter: PopulationFilter): CorroborationEntry[] =>
  REASON_EVIDENCE_MAP.map((mapping) => {
    const anyFlag = mapping.columns.map((column) => `IFNULL(${column}, 0) = 1`).join(' OR ');
    const row = db
      .prepare(
        `SELECT COUNT(*) AS withReason, SUM(CASE WHEN ${anyFlag} THEN 1 ELSE 0 END) AS matched
         FROM order_360
         WHERE is_failed = 1 AND failure_reason = '${mapping.reason}' AND (${filter.where})`
      )
      .get(filter.params) as { withReason: number; matched: number | null };
    const matched = row.matched ?? 0;
    return {
      reason: mapping.reason,
      evidenceLabel: mapping.label,
      matchedOrders: matched,
      ordersWithReason: row.withReason,
      corroborationRate: row.withReason > 0 ? matched / row.withReason : 0
    };
  }).filter((entry) => entry.ordersWithReason > 0);

export const getFeedbackSamples = (db: Db, filter: PopulationFilter, limit = 3): string[] => {
  const rows = db
    .prepare(
      `SELECT feedback_texts FROM order_360
       WHERE feedback_texts IS NOT NULL AND (is_failed = 1 OR is_late = 1) AND (${filter.where})
       LIMIT 50`
    )
    .all(filter.params) as { feedback_texts: string }[];
  const distinct = new Set<string>();
  for (const row of rows) {
    for (const textEntry of row.feedback_texts.split(' | ')) {
      const trimmed = textEntry.trim();
      if (trimmed.length > 0) distinct.add(trimmed);
      if (distinct.size >= limit) return [...distinct];
    }
  }
  return [...distinct];
};

/** Assembles the standard evidence block shared by UC1–UC5. */
export const buildPopulationEvidence = (
  db: Db,
  population: PopulationFilter,
  baseline: PopulationFilter,
  extraCaveats: readonly string[] = []
): PopulationEvidence => ({
  population: population.description,
  baseline: baseline.description,
  outcomes: getOutcomeSummary(db, population),
  failureReasons: getFailureReasons(db, population),
  factorRates: getFactorRates(db, population, baseline),
  corroborations: getCorroborations(db, population),
  feedbackSamples: getFeedbackSamples(db, population),
  caveats: [...STANDARD_CAVEATS, ...extraCaveats]
});
