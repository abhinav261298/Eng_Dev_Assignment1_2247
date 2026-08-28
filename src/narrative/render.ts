import { UseCaseEvidence } from '../insights/types';
import { renderTemplate } from './templates';
import { tryOpenAiNarrative, OpenAiNarrativeOptions } from './openaiRenderer';

export interface NarrativeResult {
  readonly narrative: string;
  readonly source: 'openai' | 'template';
}

/**
 * Renders a narrative for the given evidence: OpenAI first (strictly grounded in the
 * evidence JSON), deterministic template on ANY failure. The six use cases therefore
 * never depend on LLM availability.
 */
export const renderNarrative = async (
  evidence: UseCaseEvidence,
  options: OpenAiNarrativeOptions = {}
): Promise<NarrativeResult> => {
  const openAiNarrative = await tryOpenAiNarrative(evidence, options);
  if (openAiNarrative) return { narrative: openAiNarrative, source: 'openai' };
  return { narrative: renderTemplate(evidence), source: 'template' };
};
