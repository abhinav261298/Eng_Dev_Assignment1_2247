import OpenAI from 'openai';
import { festivalAnalysis } from '../src/insights/useCases';
import { tryOpenAiNarrative, isOpenAiConfigured } from '../src/narrative/openaiRenderer';
import { renderNarrative } from '../src/narrative/render';
import { UseCaseEvidence } from '../src/insights/types';
import { createFixtureDb } from './fixtures';

const buildEvidence = (): UseCaseEvidence => {
  const db = createFixtureDb();
  const evidence = festivalAnalysis(db);
  db.close();
  return evidence;
};

const mockClient = (create: jest.Mock): OpenAI =>
  ({ chat: { completions: { create } } }) as unknown as OpenAI;

describe('OpenAI narrative layer', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('returns the model narrative and passes evidence JSON + reference render (happy path)', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'Grounded narrative from the model.' } }]
    });
    const evidence = buildEvidence();
    const narrative = await tryOpenAiNarrative(evidence, { client: mockClient(create), model: 'test-model' });
    expect(narrative).toBe('Grounded narrative from the model.');
    const request = create.mock.calls[0]?.[0];
    expect(request.model).toBe('test-model');
    expect(request.messages[1].content).toContain('"useCase": "UC5"');
    expect(request.messages[1].content).toContain('FESTIVAL PERIOD');
    expect(request.messages[0].content).toContain('NEVER present an association as a cause');
  });

  it('returns null when the API call fails (error path)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('rate limited'));
    const narrative = await tryOpenAiNarrative(buildEvidence(), { client: mockClient(create) });
    expect(narrative).toBeNull();
  });

  it('returns null on an empty model response (error path)', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const narrative = await tryOpenAiNarrative(buildEvidence(), { client: mockClient(create) });
    expect(narrative).toBeNull();
  });

  it('returns null without a configured key and no injected client', async () => {
    delete process.env.OPENAI_API_KEY;
    expect(isOpenAiConfigured()).toBe(false);
    const narrative = await tryOpenAiNarrative(buildEvidence());
    expect(narrative).toBeNull();
  });
});

describe('renderNarrative fallback chain', () => {
  it('uses the OpenAI narrative when available', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'LLM prose.' } }]
    });
    const result = await renderNarrative(buildEvidence(), { client: mockClient(create) });
    expect(result).toEqual({ narrative: 'LLM prose.', source: 'openai' });
  });

  it('falls back to the deterministic template when the LLM fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('boom'));
    const result = await renderNarrative(buildEvidence(), { client: mockClient(create) });
    expect(result.source).toBe('template');
    expect(result.narrative).toContain('FESTIVAL PERIOD');
  });
});
