import { describe, expect, it } from 'vitest';
import { filterVisionOnly, isVisionLikeModelId } from './modelVisionFilter';

describe('isVisionLikeModelId', () => {
  it('mendeteksi model vision umum', () => {
    expect(isVisionLikeModelId('gpt-4o-mini')).toBe(true);
    expect(isVisionLikeModelId('gpt-4.1')).toBe(true);
    expect(isVisionLikeModelId('gemini-2.5-flash')).toBe(true);
    expect(isVisionLikeModelId('google/gemini-2.0-flash-exp:free')).toBe(true);
    expect(isVisionLikeModelId('qwen/qwen3-vl-235b-a22b-thinking')).toBe(true);
    expect(isVisionLikeModelId('pixtral-12b')).toBe(true);
    expect(isVisionLikeModelId('openai/gpt-5-nano')).toBe(true);
  });

  it('menolak model non-vision yang jelas', () => {
    expect(isVisionLikeModelId('text-embedding-3-large')).toBe(false);
    expect(isVisionLikeModelId('gemini-embedding-001')).toBe(false);
    expect(isVisionLikeModelId('tts-1')).toBe(false);
    expect(isVisionLikeModelId('gpt-4o-audio-preview')).toBe(false);
    expect(isVisionLikeModelId('gpt-4o-realtime-preview')).toBe(false);
  });

  it('menganggap keluarga claude-3 sebagai vision-like', () => {
    expect(isVisionLikeModelId('anthropic/claude-3-5-sonnet')).toBe(true);
  });

  it('menolak openrouter/free', () => {
    expect(isVisionLikeModelId('openrouter/free')).toBe(false);
  });
});

describe('filterVisionOnly', () => {
  it('memfilter hanya model vision', () => {
    const out = filterVisionOnly([
      { label: 'A', value: 'gpt-4o-mini' },
      { label: 'B', value: 'gpt-4.1' },
      { label: 'C', value: 'text-embedding-3-large' },
      { label: 'D', value: 'openrouter/free' },
      { label: 'E', value: 'qwen/qwen3-vl-235b-a22b-thinking' },
    ]);
    expect(out.map((x) => x.value)).toEqual(['gpt-4o-mini', 'gpt-4.1', 'qwen/qwen3-vl-235b-a22b-thinking']);
  });
});
