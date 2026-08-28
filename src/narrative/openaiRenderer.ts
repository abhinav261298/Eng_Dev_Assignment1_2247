import OpenAI from 'openai';
import { UseCaseEvidence } from '../insights/types';
import { renderTemplate } from './templates';
import { logger } from '../logger';

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = `You are a logistics operations analyst writing a short root-cause briefing.
You are given (a) a structured evidence JSON computed by a deterministic engine and (b) a
deterministic reference rendering of that evidence.

STRICT RULES — violating any of them makes the output unusable:
1. Use ONLY numbers, entities, and facts present in the evidence JSON. Never compute, estimate,
   or invent any figure, count, percentage, name, or event.
2. Respect evidence tiers:
   - failureReasons / recorded causes: causal language is allowed ("failed due to ...").
   - corroborations: say "corroborated by ..." with the given rates.
   - factorRates (tier "association"): only "associated with" / "co-occurred with" language.
     NEVER present an association as a cause.
3. Reproduce the caveats faithfully in a closing "Caveats" section.
4. If a section of the evidence is empty, say so plainly instead of speculating.
5. Keep it under ~350 words: a headline finding, key numbers, corroboration, associations,
   recommendations only if the evidence JSON contains them, then caveats.`;

export interface OpenAiNarrativeOptions {
  readonly client?: OpenAI; // injectable for tests
  readonly model?: string;
}

export const isOpenAiConfigured = (): boolean =>
  typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0;

/**
 * Renders the evidence through OpenAI. Returns null on ANY failure (missing key, network,
 * timeout, empty response) so callers always fall back to the deterministic template.
 */
export const tryOpenAiNarrative = async (
  evidence: UseCaseEvidence,
  options: OpenAiNarrativeOptions = {}
): Promise<string | null> => {
  if (!options.client && !isOpenAiConfigured()) {
    logger.info('OPENAI_API_KEY not set — using template narrative');
    return null;
  }
  try {
    const client =
      options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: REQUEST_TIMEOUT_MS });
    const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Evidence JSON:\n${JSON.stringify(evidence, null, 2)}\n\n` +
            `Deterministic reference rendering:\n${renderTemplate(evidence)}`
        }
      ]
    });
    const narrative = response.choices[0]?.message?.content?.trim();
    if (!narrative) {
      logger.warn('OpenAI returned an empty narrative — falling back to template');
      return null;
    }
    return narrative;
  } catch (error) {
    logger.warn('OpenAI narrative failed — falling back to template', {
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};
