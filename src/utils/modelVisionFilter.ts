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

  return openRouterVision || openAiVision || geminiVision;
}

export function filterVisionOnly(options: ModelOption[]): ModelOption[] {
  return (options || []).filter((o) => isVisionLikeModelId(o.value));
}
