export type ModelOption = { label: string; value: string };

export function isVisionLikeModelId(modelId: string): boolean {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return false;
  if (id === 'openrouter/free') return false;
  if (id.includes('embedding') || id.includes('text-embedding') || id.includes('tts') || id.includes('aqa')) return false;
  if (id.includes('realtime')) return false;
  if (id.startsWith('gpt-') && (id.includes('audio') || id.includes('transcribe') || id.includes('whisper'))) return false;

  const openRouterVision =
    id.includes('vision') ||
    id.includes('/vl') ||
    id.includes('-vl') ||
    id.includes('image') ||
    id.includes('video') ||
    id.includes('multimodal') ||
    id.includes('omni') ||
    id.includes('pixtral') ||
    id.includes('llava') ||
    id.includes('cogvlm') ||
    id.includes('qwen-vl') ||
    id.includes('qwen3-vl') ||
    id.includes('molmo') ||
    id.includes('moondream') ||
    id.includes('internvl') ||
    id.includes('claude-3') ||
    id.includes('claude-4') ||
    id.includes('gemini') ||
    id.includes('paligemma');

  const openAiVision =
    ((id.startsWith('gpt-') || id.includes('/gpt-')) &&
      (id.includes('vision') || id.includes('gpt-4o') || id.includes('gpt-4.1') || id.includes('gpt-4.5') || id.includes('gpt-5')));

  const geminiVision =
    id.includes('gemini') && !id.includes('embedding');

  // X.ai (Grok) vision-capable models. Grok vision/image models, plus
  // multimodal flagship lines (grok-4 and newer) that accept image input.
  const grokVision =
    id.startsWith('grok') &&
    (id.includes('vision') ||
      id.includes('image') ||
      /grok-([4-9]|\d{2,})/.test(id));

  return openRouterVision || openAiVision || geminiVision || grokVision;
}

export function filterVisionOnly(options: ModelOption[]): ModelOption[] {
  return (options || []).filter((o) => isVisionLikeModelId(o.value));
}

/**
 * Gemini model ids that Google has retired or that never existed on the public
 * Generative Language API (e.g. the fictional "Ultra" tier, the 1.x family, and
 * dated experimental/preview snapshots). These return HTTP 404/429-limit-0 and
 * should never be offered in the model picker.
 */
export function isDeprecatedGeminiModelId(modelId: string): boolean {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id.includes('gemini')) return false;
  if (id.includes('ultra')) return true; // no "Ultra" tier exists on the API
  if (id.includes('gemini-1.5') || id.includes('gemini-1.0')) return true; // retired families
  if (id === 'gemini-pro' || id === 'gemini-pro-vision') return true; // legacy ids
  if (id.includes('-exp') || id.includes('preview-02-05')) return true; // dated experimental snapshots
  return false;
}
