export function isVisionLikeModel(providerRaw, modelRaw) {
  const provider = String(providerRaw || '').toLowerCase().trim();
  const model = String(modelRaw || '').toLowerCase().trim();
  if (!provider || !model) return false;
  if (provider === 'gemini') return model.startsWith('gemini');
  if (provider === 'openai') return model.includes('gpt-4o') || model.includes('vision');

  return (
    model.includes('vision') ||
    model.includes('/vl') ||
    model.includes('-vl') ||
    model.includes('pixtral') ||
    model.includes('gpt-4o') ||
    model.includes('gemini') ||
    model.includes('claude-3') ||
    model.includes('llava') ||
    model.includes('internvl')
  );
}

export function filterVisionModelPrices(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => {
    const active = Number(r?.active ?? 1);
    const provider = String(r?.provider || '');
    const model = String(r?.model_name || '');
    if (active !== 1) return false;
    if (provider.toLowerCase() === 'openrouter' && model === 'openrouter/free') return false;
    return isVisionLikeModel(provider, model);
  });
}

export function summarizeModelRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byProvider = {};
  for (const r of list) {
    const p = String(r?.provider || 'unknown').toLowerCase() || 'unknown';
    byProvider[p] = (byProvider[p] || 0) + 1;
  }
  return { total: list.length, byProvider };
}

