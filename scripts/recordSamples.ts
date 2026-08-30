import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { openDatabase } from '../src/db';
import { logger } from '../src/logger';
import {
  cityDelayAnalysis,
  clientFailureAnalysis,
  warehouseFailureAnalysis,
  cityComparisonAnalysis,
  festivalAnalysis
} from '../src/insights/useCases';
import { onboardingRiskAnalysis } from '../src/insights/onboardingRisk';
import { renderTemplate } from '../src/narrative/templates';
import { UseCaseEvidence } from '../src/insights/types';

const OUTPUT_DIR = join(__dirname, '..', 'outputs', 'curated');

interface SampleRun {
  readonly id: string;
  readonly question: string;
  readonly invocation: string;
  readonly evidence: UseCaseEvidence;
}

/**
 * Records the curated sample outputs for the six assignment use cases using the
 * deterministic template renderer (fully reproducible; no LLM involved).
 */
const main = (): void => {
  const db = openDatabase();
  const runs: SampleRun[] = [
    {
      id: 'UC1',
      question: 'Why were deliveries delayed in New Delhi on 2025-04-27?',
      invocation: "cityDelayAnalysis(db, 'New Delhi', '2025-04-27')",
      evidence: cityDelayAnalysis(db, 'New Delhi', '2025-04-27')
    },
    {
      id: 'UC2',
      question: "Why did Swaminathan-Mahal's orders fail in the week 2025-08-01 to 2025-08-07?",
      invocation: "clientFailureAnalysis(db, 'Swaminathan-Mahal', '2025-08-01', '2025-08-07')",
      evidence: clientFailureAnalysis(db, 'Swaminathan-Mahal', '2025-08-01', '2025-08-07')
    },
    {
      id: 'UC3',
      question: 'Top reasons for delivery failures linked to Warehouse 7 in August 2025?',
      invocation: "warehouseFailureAnalysis(db, 'Warehouse 7', '2025-08')",
      evidence: warehouseFailureAnalysis(db, 'Warehouse 7', '2025-08')
    },
    {
      id: 'UC4',
      question: 'Compare delivery failure causes between New Delhi and Ahmedabad in July 2025?',
      invocation: "cityComparisonAnalysis(db, 'New Delhi', 'Ahmedabad', '2025-07')",
      evidence: cityComparisonAnalysis(db, 'New Delhi', 'Ahmedabad', '2025-07')
    },
    {
      id: 'UC5',
      question: 'What are the likely causes of delivery failures during the festival period, and how should we prepare?',
      invocation: 'festivalAnalysis(db)',
      evidence: festivalAnalysis(db)
    },
    {
      id: 'UC6',
      question: 'If we onboard a client with ~20,000 extra monthly orders (Mumbai & Pune focus), what new failure risks should we expect and how do we mitigate them?',
      invocation: "onboardingRiskAnalysis(db, 20000, ['Mumbai', 'Pune'])",
      evidence: onboardingRiskAnalysis(db, 20000, ['Mumbai', 'Pune'])
    }
  ];
  db.close();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sections: string[] = [
    '# Sample Use-Case Outputs — Delivery Root-Cause Analysis POC',
    '',
    'Generated deterministically from `logistics.db` (built from the provided `sample-data-set/` CSVs)',
    'using the template narrative renderer. Reproduce with: `npm run ingest && npm run record-samples`.',
    ''
  ];
  for (const run of runs) {
    const narrative = renderTemplate(run.evidence);
    writeFileSync(join(OUTPUT_DIR, `${run.id}.txt`), `${run.question}\n\n${narrative}\n`);
    writeFileSync(join(OUTPUT_DIR, `${run.id}.json`), JSON.stringify(run.evidence, null, 2));
    sections.push(
      `## ${run.id} — ${run.question}`,
      '',
      `Engine call: \`${run.invocation}\``,
      '',
      '```text',
      narrative,
      '```',
      ''
    );
    logger.info(`recorded ${run.id}`, { question: run.question });
  }
  writeFileSync(join(OUTPUT_DIR, 'sample-outputs.md'), sections.join('\n'));
  logger.info('curated sample outputs written', { dir: OUTPUT_DIR });
};

main();
