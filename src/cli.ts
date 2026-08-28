import 'dotenv/config';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { openDatabase, DEFAULT_DB_PATH, Db } from './db';
import { logger } from './logger';
import { PocError } from './errors';
import {
  cityDelayAnalysis,
  clientFailureAnalysis,
  warehouseFailureAnalysis,
  cityComparisonAnalysis,
  festivalAnalysis,
  listCities
} from './insights/useCases';
import { onboardingRiskAnalysis } from './insights/onboardingRisk';
import { UseCaseEvidence } from './insights/types';
import { renderNarrative } from './narrative/render';

const OUTPUT_DIR = join(__dirname, '..', 'outputs');

const MENU = `
Delivery Root-Cause Analysis POC — pick a use case:
  1. Why were deliveries delayed in city X on a given day?
  2. Why did Client X's orders fail in a date window?
  3. Top failure reasons for orders involving a warehouse in a month
  4. Compare delivery failure causes between two cities in a month
  5. Likely causes during the festival period & how to prepare
  6. Risks of onboarding a client with extra monthly orders
  q. Quit
`;

// Line-buffered prompt helper: unlike readline/promises' question(), it never drops
// lines that arrive between prompts, so the CLI also works with piped (scripted) input.
const rl = createInterface({ input: process.stdin });
const bufferedLines: string[] = [];
let pendingResolve: ((line: string) => void) | null = null;
let inputClosed = false;

rl.on('line', (line) => {
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(line);
  } else {
    bufferedLines.push(line);
  }
});
rl.on('close', () => {
  inputClosed = true;
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve('q');
  }
});

const question = (prompt: string): Promise<string> => {
  process.stdout.write(prompt);
  const buffered = bufferedLines.shift();
  if (buffered !== undefined) {
    process.stdout.write(`${buffered}\n`);
    return Promise.resolve(buffered);
  }
  if (inputClosed) return Promise.resolve('q');
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
};

const askRequired = async (prompt: string, fallback?: string): Promise<string> => {
  const answer = (await question(fallback ? `${prompt} [${fallback}]: ` : `${prompt}: `)).trim();
  return answer.length > 0 ? answer : (fallback ?? '');
};

const askCity = async (db: Db, prompt: string): Promise<string> => {
  const cities = listCities(db);
  console.log(`Known cities: ${cities.join(', ')}`);
  return askRequired(prompt);
};

const runUseCase = async (db: Db, choice: string): Promise<UseCaseEvidence | null> => {
  switch (choice) {
    case '1': {
      const city = await askCity(db, 'City');
      const date = await askRequired('Date (YYYY-MM-DD)', '2025-08-14');
      return cityDelayAnalysis(db, city, date);
    }
    case '2': {
      const clientName = await askRequired('Client name (e.g. Saini LLC)');
      const fromDate = await askRequired('From date (YYYY-MM-DD)', '2025-08-01');
      const toDate = await askRequired('To date (YYYY-MM-DD)', '2025-08-07');
      return clientFailureAnalysis(db, clientName, fromDate, toDate);
    }
    case '3': {
      const warehouseName = await askRequired('Warehouse name (e.g. Warehouse 2)');
      const month = await askRequired('Month (YYYY-MM)', '2025-08');
      return warehouseFailureAnalysis(db, warehouseName, month);
    }
    case '4': {
      const cityA = await askCity(db, 'City A');
      const cityB = await askRequired('City B');
      const month = await askRequired('Month (YYYY-MM)', '2025-07');
      return cityComparisonAnalysis(db, cityA, cityB, month);
    }
    case '5':
      return festivalAnalysis(db);
    case '6': {
      const volume = Number.parseInt(await askRequired('Extra monthly orders', '20000'), 10);
      const citiesRaw = await askRequired('Target cities (comma-separated, empty = all)', '');
      const targetCities = citiesRaw.length > 0 ? citiesRaw.split(',').map((city) => city.trim()) : [];
      return onboardingRiskAnalysis(db, volume, targetCities);
    }
    default:
      return null;
  }
};

const saveOutput = (evidence: UseCaseEvidence, narrative: string): void => {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = join(OUTPUT_DIR, `${evidence.useCase}_${stamp}`);
  writeFileSync(`${basePath}.json`, JSON.stringify(evidence, null, 2));
  writeFileSync(`${basePath}.txt`, narrative);
  logger.info('saved output', { json: `${basePath}.json`, txt: `${basePath}.txt` });
};

const main = async (): Promise<void> => {
  if (!existsSync(DEFAULT_DB_PATH)) {
    logger.error('logistics.db not found — run "npm run ingest" first.');
    process.exitCode = 1;
    rl.close();
    return;
  }
  const db = openDatabase(DEFAULT_DB_PATH);
  try {
    for (;;) {
      console.log(MENU);
      const choice = (await question('Choice: ')).trim().toLowerCase();
      if (choice === 'q') break;
      try {
        const evidence = await runUseCase(db, choice);
        if (!evidence) {
          console.log('Unknown choice — pick 1-6 or q.');
          continue;
        }
        const { narrative, source } = await renderNarrative(evidence);
        console.log(`\n================= ANSWER (${source}) =================\n`);
        console.log(narrative);
        console.log('\n======================================================\n');
        saveOutput(evidence, narrative);
      } catch (error) {
        if (error instanceof PocError) {
          console.log(`\n[${error.code}] ${error.message}\n`);
        } else {
          logger.error('unexpected error while running use case', {
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  } finally {
    db.close();
    rl.close();
  }
};

void main();
