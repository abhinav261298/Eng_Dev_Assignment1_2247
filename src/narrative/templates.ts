import {
  CityComparisonEvidence,
  CityDelayEvidence,
  ClientFailureEvidence,
  FestivalEvidence,
  OnboardingRiskEvidence,
  PopulationEvidence,
  UseCaseEvidence,
  WarehouseFailureEvidence
} from '../insights/types';

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number): string => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`;

const outcomesBlock = (evidence: PopulationEvidence): string => {
  const { outcomes } = evidence;
  return [
    `Population: ${evidence.population} — ${outcomes.totalOrders} orders.`,
    `Outcomes: ${outcomes.failed} failed (${pct(outcomes.failureRate)}), ${outcomes.late} delivered late (${pct(outcomes.lateRate)}), ` +
      `${outcomes.onTime} on-time, ${outcomes.returned} returned, ${outcomes.pendingOrInTransit} pending/in-transit.`
  ].join('\n');
};

const reasonsBlock = (evidence: PopulationEvidence): string => {
  if (evidence.failureReasons.length === 0) return 'Recorded causes: no failed orders in this population.';
  const lines = evidence.failureReasons.map(
    (entry) => `  - ${entry.reason}: ${entry.count} orders (${pct(entry.share)} of failures)`
  );
  return `Recorded causes (failure_reason on failed orders):\n${lines.join('\n')}`;
};

const corroborationBlock = (evidence: PopulationEvidence): string => {
  if (evidence.corroborations.length === 0) return '';
  const lines = evidence.corroborations.map(
    (entry) =>
      `  - "${entry.reason}" corroborated by ${entry.evidenceLabel} in ` +
      `${entry.matchedOrders}/${entry.ordersWithReason} orders (${pct(entry.corroborationRate)})`
  );
  return `Corroborating operational evidence:\n${lines.join('\n')}`;
};

const associationBlock = (evidence: PopulationEvidence, topN = 5): string => {
  if (evidence.factorRates.length === 0) return 'Associated conditions: none met the minimum support threshold (n >= 30).';
  const lines = evidence.factorRates
    .slice(0, topN)
    .map(
      (factor) =>
        `  - ${factor.label}: ${pct(factor.rate)} of orders (baseline ${pct(factor.baselineRate)}, ` +
        `lift ${signedPct(factor.lift)}, n=${factor.support})`
    );
  return `Associated conditions (co-occurrence, NOT causation; vs ${evidence.baseline}):\n${lines.join('\n')}`;
};

const feedbackBlock = (evidence: PopulationEvidence): string =>
  evidence.feedbackSamples.length > 0
    ? `Customer feedback samples: ${evidence.feedbackSamples.map((sample) => `"${sample}"`).join(' / ')}`
    : '';

const caveatsBlock = (caveats: readonly string[]): string =>
  `Caveats:\n${caveats.map((caveat) => `  - ${caveat}`).join('\n')}`;

const populationSections = (evidence: PopulationEvidence): string[] =>
  [
    outcomesBlock(evidence),
    reasonsBlock(evidence),
    corroborationBlock(evidence),
    associationBlock(evidence),
    feedbackBlock(evidence)
  ].filter((section) => section.length > 0);

const renderCityDelay = (evidence: CityDelayEvidence): string =>
  [
    `WHY WERE DELIVERIES DELAYED IN ${evidence.city.toUpperCase()} ON ${evidence.date}?`,
    ...populationSections(evidence),
    caveatsBlock(evidence.caveats)
  ].join('\n\n');

const renderClientFailures = (evidence: ClientFailureEvidence): string =>
  [
    `WHY DID ${evidence.clientName.toUpperCase()}'S ORDERS FAIL (${evidence.fromDate} to ${evidence.toDate})?`,
    ...populationSections(evidence),
    `Context: window failure rate ${pct(evidence.outcomes.failureRate)} vs client all-time ${pct(evidence.clientAllTimeFailureRate)} vs system ${pct(evidence.systemFailureRate)}.`,
    caveatsBlock(evidence.caveats)
  ].join('\n\n');

const renderWarehouseFailures = (evidence: WarehouseFailureEvidence): string => {
  const ops =
    `Warehouse ops: avg picking ${evidence.avgPickingMins ?? 'n/a'} min (all warehouses ${evidence.allWarehousePickingMins ?? 'n/a'} min), ` +
    `avg dispatch lag ${evidence.avgDispatchLagMins ?? 'n/a'} min (all warehouses ${evidence.allWarehouseDispatchLagMins ?? 'n/a'} min).`;
  const cityMix = `City mix (confounder visibility): ${evidence.warehouseCityMix
    .map((entry) => `${entry.city} ${entry.orders}`)
    .join(', ')}.`;
  return [
    `TOP FAILURE REASONS FOR ORDERS INVOLVING ${evidence.warehouseName.toUpperCase()} IN ${evidence.month}`,
    ...populationSections(evidence),
    ops,
    cityMix,
    caveatsBlock(evidence.caveats)
  ].join('\n\n');
};

const renderCityComparison = (evidence: CityComparisonEvidence): string => {
  const renderSide = (side: CityComparisonEvidence['cityA']): string =>
    [`--- ${side.city} ---`, ...populationSections(side)].join('\n\n');
  const rateDelta = signedPct(evidence.cityA.outcomes.failureRate - evidence.cityB.outcomes.failureRate);
  return [
    `DELIVERY FAILURE COMPARISON: ${evidence.cityA.city.toUpperCase()} vs ${evidence.cityB.city.toUpperCase()} (${evidence.month})`,
    renderSide(evidence.cityA),
    renderSide(evidence.cityB),
    `Failure-rate gap (${evidence.cityA.city} minus ${evidence.cityB.city}): ${rateDelta}.`,
    caveatsBlock(evidence.caveats)
  ].join('\n\n');
};

const renderFestival = (evidence: FestivalEvidence): string =>
  [
    'LIKELY CAUSES OF DELIVERY FAILURES DURING THE FESTIVAL PERIOD & PREPARATION',
    ...populationSections(evidence),
    evidence.preparationRecommendations.length > 0
      ? `Preparation recommendations:\n${evidence.preparationRecommendations.map((entry) => `  - ${entry}`).join('\n')}`
      : '',
    caveatsBlock(evidence.caveats)
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');

const renderOnboardingRisk = (evidence: OnboardingRiskEvidence): string => {
  const reasons = evidence.projectedReasons
    .map(
      (entry) =>
        `  - ${entry.reason}: ~${entry.projectedMonthlyFailures} failures/month (historical rate ${pct(entry.historicalRate)})`
    )
    .join('\n');
  const capacities = evidence.cityCapacities
    .map(
      (entry) =>
        `  - ${entry.city}: ~${entry.currentAvgMonthlyOrders} orders/month today, warehouse capacity ${entry.warehouseCapacityTotal}, ` +
        `${entry.activeDrivers} active drivers (~${entry.ordersPerActiveDriver} orders/driver/month)`
    )
    .join('\n');
  const comparables = evidence.comparableClientRates
    .map((entry) => `  - ${entry.clientName}: ${entry.orders} orders, failure rate ${pct(entry.failureRate)}`)
    .join('\n');
  return [
    `PROJECTED RISKS FOR ONBOARDING ~${evidence.extraMonthlyOrders} EXTRA MONTHLY ORDERS`,
    `Projection: at the historical system failure rate of ${pct(evidence.systemFailureRate)} and late rate of ${pct(evidence.systemLateRate)}, ` +
      `expect ~${evidence.projectedMonthlyFailures} failed and ~${evidence.projectedMonthlyLate} late deliveries per month.`,
    `Projected failure breakdown:\n${reasons}`,
    `Capacity context (${evidence.targetCities.join(', ')}):\n${capacities}`,
    `Largest current clients for comparison:\n${comparables}`,
    evidence.mitigations.length > 0
      ? `Mitigations:\n${evidence.mitigations.map((entry) => `  - ${entry}`).join('\n')}`
      : '',
    caveatsBlock(evidence.caveats)
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
};

/** Deterministic narrative renderer — used directly and as the LLM fallback. */
export const renderTemplate = (evidence: UseCaseEvidence): string => {
  switch (evidence.useCase) {
    case 'UC1':
      return renderCityDelay(evidence);
    case 'UC2':
      return renderClientFailures(evidence);
    case 'UC3':
      return renderWarehouseFailures(evidence);
    case 'UC4':
      return renderCityComparison(evidence);
    case 'UC5':
      return renderFestival(evidence);
    case 'UC6':
      return renderOnboardingRisk(evidence);
  }
};
