import test from 'node:test';
import assert from 'node:assert/strict';
import { filterVisionModelPrices, isVisionLikeModel } from './modelFilter.js';

test('isVisionLikeModel: OpenAI only allow gpt-4o* or vision', () => {
  assert.equal(isVisionLikeModel('openai', 'gpt-4o-mini'), true);
  assert.equal(isVisionLikeModel('openai', 'gpt-4.1'), false);
  assert.equal(isVisionLikeModel('openai', 'gpt-4o'), true);
  assert.equal(isVisionLikeModel('openai', 'gpt-4o-mini-vision'), true);
});

test('isVisionLikeModel: OpenRouter vision hints', () => {
  assert.equal(isVisionLikeModel('openrouter', 'nvidia/nemotron-nano-12b-v2-vl:free'), true);
  assert.equal(isVisionLikeModel('openrouter', 'qwen/qwen3-vl-235b-a22b-thinking'), true);
  assert.equal(isVisionLikeModel('openrouter', 'openrouter/free'), false);
});

test('filterVisionModelPrices: respects active and excludes openrouter/free', () => {
  const rows = [
    { provider: 'OpenRouter', model_name: 'openrouter/free', active: 1 },
    { provider: 'OpenRouter', model_name: 'qwen/qwen3-vl-235b-a22b-thinking', active: 1 },
    { provider: 'OpenAI', model_name: 'gpt-4.1', active: 1 },
    { provider: 'OpenAI', model_name: 'gpt-4o-mini', active: 1 },
    { provider: 'Gemini', model_name: 'gemini-2.5-flash', active: 1 },
    { provider: 'Gemini', model_name: 'gemini-2.5-flash', active: 0 },
  ];
  const out = filterVisionModelPrices(rows);
  const ids = out.map((r) => `${String(r.provider).toLowerCase()}:${r.model_name}`);
  assert.deepEqual(ids.sort(), [
    'gemini:gemini-2.5-flash',
    'openai:gpt-4o-mini',
    'openrouter:qwen/qwen3-vl-235b-a22b-thinking',
  ].sort());
});

