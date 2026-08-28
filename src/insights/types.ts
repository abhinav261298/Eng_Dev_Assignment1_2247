/**
 * Typed evidence structures produced by the deterministic engine.
 * Every number in a narrative MUST originate from these structures; the LLM layer
 * only rewrites them into prose and is forbidden from computing or inventing facts.
 */

/** Evidence tiers — controls the causal language allowed in narratives. */
export type EvidenceTier =
  | 'recorded_cause'   // orders.failure_reason: causal language allowed ("failed due to X")
  | 'corroboration'    // per-order log cross-checks ("corroborated by")
  | 'association';     // baseline lifts ("associated with"), min support n >= 30

export interface ReasonCount {
  readonly reason: string;
  readonly count: number;
  readonly share: number; // 0..1 share among failed orders in the population
}

export interface FactorRate {
  readonly factor: string;        // e.g. 'had_congestion'
  readonly label: string;         // human label, e.g. 'fleet reported heavy congestion'
  readonly tier: EvidenceTier;
  readonly rate: number;          // 0..1 within the population
  readonly baselineRate: number;  // 0..1 within the baseline population
  readonly lift: number;          // rate - baselineRate
  readonly support: number;       // orders in population with the factor present
}

export interface OutcomeSummary {
  readonly totalOrders: number;
  readonly failed: number;
  readonly late: number;
  readonly onTime: number;
  readonly returned: number;
  readonly pendingOrInTransit: number;
  readonly failureRate: number; // failed / total
  readonly lateRate: number;    // late / total
}

export interface CorroborationEntry {
  readonly reason: string;
  readonly evidenceLabel: string;
  readonly matchedOrders: number;
  readonly ordersWithReason: number;
  readonly corroborationRate: number; // matched / ordersWithReason
}

/** Common shape shared by UC1–UC5 evidence payloads. */
export interface PopulationEvidence {
  readonly population: string;         // human description of the filter
  readonly baseline: string;           // human description of the baseline
  readonly outcomes: OutcomeSummary;
  readonly failureReasons: readonly ReasonCount[];
  readonly factorRates: readonly FactorRate[];
  readonly corroborations: readonly CorroborationEntry[];
  readonly feedbackSamples: readonly string[];
  readonly caveats: readonly string[];
}

export interface CityDelayEvidence extends PopulationEvidence {
  readonly useCase: 'UC1';
  readonly city: string;
  readonly date: string; // YYYY-MM-DD (promised delivery date)
}

export interface ClientFailureEvidence extends PopulationEvidence {
  readonly useCase: 'UC2';
  readonly clientId: number;
  readonly clientName: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly clientAllTimeFailureRate: number;
  readonly systemFailureRate: number;
}

export interface WarehouseFailureEvidence extends PopulationEvidence {
  readonly useCase: 'UC3';
  readonly warehouseName: string;
  readonly month: string; // YYYY-MM
  readonly avgPickingMins: number | null;
  readonly avgDispatchLagMins: number | null;
  readonly allWarehousePickingMins: number | null;
  readonly allWarehouseDispatchLagMins: number | null;
  readonly warehouseCityMix: readonly { city: string; orders: number }[];
}

export interface CityComparisonEvidence {
  readonly useCase: 'UC4';
  readonly month: string; // YYYY-MM
  readonly cityA: PopulationEvidence & { readonly city: string };
  readonly cityB: PopulationEvidence & { readonly city: string };
  readonly caveats: readonly string[];
}

export interface FestivalEvidence extends PopulationEvidence {
  readonly useCase: 'UC5';
  readonly preparationRecommendations: readonly string[];
}

export interface ProjectedReason {
  readonly reason: string;
  readonly historicalRate: number;     // share of ALL orders that fail with this reason
  readonly projectedMonthlyFailures: number;
}

export interface CityCapacity {
  readonly city: string;
  readonly currentAvgMonthlyOrders: number;
  readonly warehouseCapacityTotal: number;
  readonly activeDrivers: number;
  readonly ordersPerActiveDriver: number;
}

export interface OnboardingRiskEvidence {
  readonly useCase: 'UC6';
  readonly extraMonthlyOrders: number;
  readonly targetCities: readonly string[];
  readonly systemFailureRate: number;
  readonly systemLateRate: number;
  readonly projectedMonthlyFailures: number;
  readonly projectedMonthlyLate: number;
  readonly projectedReasons: readonly ProjectedReason[];
  readonly cityCapacities: readonly CityCapacity[];
  readonly comparableClientRates: readonly { clientName: string; orders: number; failureRate: number }[];
  readonly mitigations: readonly string[];
  readonly caveats: readonly string[];
}

export type UseCaseEvidence =
  | CityDelayEvidence
  | ClientFailureEvidence
  | WarehouseFailureEvidence
  | CityComparisonEvidence
  | FestivalEvidence
  | OnboardingRiskEvidence;
