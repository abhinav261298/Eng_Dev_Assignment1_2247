import { UseCaseEvidence } from '../insights/types';
import { renderTemplate } from './templates';

export interface NarrativeResult {
  readonly narrative: string;
  readonly source: 'openai' | 'template';
}

/**
 * Renders a narrative for the given evidence.
 * Phase 3 adds an OpenAI renderer tried first; the deterministic template is always
 * the fallback so the six use cases never depend on LLM availability.
 */
export const renderNarrative = async (evidence: UseCaseEvidence): Promise<NarrativeResult> => ({
  narrative: renderTemplate(evidence),
  source: 'template'
});
