import { Env } from '../types';
import { MODEL_CONFIG } from '../config/models';

// HARDCODED PRICES TO PREVENT DB CORRUPTION/ERRORS
// Base Price in USD per 1 Million Tokens
const SAFE_PRICES: Record<string, { input: number, output: number }> = {
    // Gemini 2.0 Flash Lite (The user's target)
    "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
    "gemini-2.0-flash-lite-preview-02-05": { input: 0.075, output: 0.30 },
    "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
    
    // Gemini 2.0 Flash
    "gemini-2.0-flash": { input: 0.10, output: 0.40 },
    "gemini-2.0-flash-exp": { input: 0.10, output: 0.40 },
    
    // Gemini 1.5 Flash
    "gemini-1.5-flash": { input: 0.075, output: 0.30 },
    "gemini-1.5-flash-001": { input: 0.075, output: 0.30 },
    "gemini-1.5-flash-002": { input: 0.075, output: 0.30 },
    
    // Gemini Pro
    "gemini-1.5-pro": { input: 3.50, output: 10.50 },
    "gemini-1.5-pro-001": { input: 3.50, output: 10.50 },
    "gemini-1.5-pro-002": { input: 3.50, output: 10.50 },
    "gemini-2.0-pro": { input: 3.50, output: 10.50 },
    "gemini-2.0-pro-exp-02-05": { input: 3.50, output: 10.50 },

    // Gemini 1.0
    "gemini-1.0-pro": { input: 0.50, output: 1.50 },

    // Gemini 2.5 (Hypothetical / Future)
    "gemini-2.5-pro": { input: 1.25, output: 10.00 },
    "gemini-2.5-flash": { input: 0.30, output: 2.50 },
    "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
    "gemini-2.5-ultra": { input: 2.50, output: 12.00 },

    // Gemini 3.0 (Preview)
    "gemini-3.0-flash-preview": { input: 0.35, output: 3.00 },
    "gemini-3.0-pro-preview": { input: 1.50, output: 8.00 },
    "gemini-3.0-ultra": { input: 4.00, output: 12.00 },

    // Gemini Ultra (2.0)
    "gemini-2.0-ultra": { input: 2.50, output: 12.00 },
    
    // GPT-4o
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },

    // OpenAI Next Gen (Estimates)
    "gpt-4.1": { input: 2.50, output: 10.00 },
    "gpt-4.1-mini": { input: 0.15, output: 0.60 },
    "gpt-4.1-distilled": { input: 1.10, output: 4.40 },
    "gpt-5.1": { input: 15.00, output: 60.00 },
    "gpt-5.1-mini": { input: 3.00, output: 12.00 },
    "gpt-5.1-instant": { input: 1.10, output: 4.40 },
    "o1": { input: 15.00, output: 60.00 },
    "o3": { input: 20.00, output: 80.00 },
    "o4-mini": { input: 0.50, output: 2.00 },
    
    // Cloudflare AI Models (Updated Pricing 2025)
    // Llama 3.1 8B (Standard): ~$0.28 input / $0.83 output
    "@cf/meta/llama-3.1-8b-instruct": { input: 0.30, output: 0.85 },
    // Llama 3.1 8B (FP8 - Cheaper): ~$0.15 input / $0.30 output
    "@cf/meta/llama-3.1-8b-instruct-fp8": { input: 0.16, output: 0.30 },
    // Llama 3.1 8B (Fast): ~$0.05 input / $0.40 output
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 0.05, output: 0.40 },

    // Llama 3.2 11B Vision: ~$0.05 input / $0.68 output
    "@cf/meta/llama-3.2-11b-vision-instruct": { input: 0.05, output: 0.70 },
    
    // Llama 3.2 1B (Ultra Cheap): ~$0.03 input / $0.20 output
    "@cf/meta/llama-3.2-1b-instruct": { input: 0.03, output: 0.21 },
    
    // Llama 3.2 3B (Balanced): ~$0.05 input / $0.35 output
    "@cf/meta/llama-3.2-3b-instruct": { input: 0.06, output: 0.35 },

    // Fallback for previews
    "@cf/meta/llama-3.2-1b-preview": { input: 0.03, output: 0.21 },

    // Fallback default
    "default": { input: 0.10, output: 0.40 } 
};

type OpenRouterPricing = {
  promptPerToken: number;
  completionPerToken: number;
  requestPerRequest: number;
  imagePerImage: number;
};

let openRouterPricingCache: Map<string, OpenRouterPricing> | null = null;
let openRouterPricingCacheAtMs = 0;
const OPENROUTER_PRICING_CACHE_TTL_MS = 10 * 60 * 1000;

const OPENROUTER_FREE_MODEL_IDS = new Set<string>([
  'qwen/qwen3-vl-235b-a22b-thinking',
  'qwen/qwen3-vl-30b-a3b-thinking'
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isOpenRouterFreeModel(modelId: string): boolean {
  const id = String(modelId || '').trim();
  if (!id) return false;
  if (id === 'openrouter/free') return true;
  if (id.endsWith(':free')) return true;
  if (OPENROUTER_FREE_MODEL_IDS.has(id)) return true;
  return false;
}

function lookupSafePrice(modelId: string): { input: number; output: number } | null {
  const id = String(modelId || '').trim();
  if (!id) return null;

  const exact = SAFE_PRICES[id];
  if (exact) return exact;

  const slashIdx = id.lastIndexOf('/');
  const shortId = slashIdx >= 0 ? id.slice(slashIdx + 1) : id;
  const shortExact = SAFE_PRICES[shortId];
  if (shortExact) return shortExact;

  const colonIdx = shortId.indexOf(':');
  const noVariant = colonIdx >= 0 ? shortId.slice(0, colonIdx) : shortId;
  const noVariantExact = SAFE_PRICES[noVariant];
  if (noVariantExact) return noVariantExact;

  const parts = noVariant.split('-').filter(Boolean);
  for (let i = parts.length - 1; i >= 2; i--) {
    const partial = parts.slice(0, i).join('-');
    const hit = SAFE_PRICES[partial];
    if (hit) return hit;
  }

  const lower = id.toLowerCase();
  if (lower.includes('flash-lite')) return SAFE_PRICES['gemini-2.0-flash-lite'] || SAFE_PRICES['gemini-1.5-flash'];
  if (lower.includes('flash')) return SAFE_PRICES['gemini-2.0-flash'] || SAFE_PRICES['gemini-1.5-flash'];
  if (lower.includes('pro')) return SAFE_PRICES['gemini-1.5-pro'];
  if (lower.includes('ultra')) return SAFE_PRICES['gemini-2.0-ultra'];
  if (lower.includes('gpt-4o-mini')) return SAFE_PRICES['gpt-4o-mini'];
  if (lower.includes('gpt-4o') || lower.includes('gpt-4.1')) return SAFE_PRICES['gpt-4o'];
  return null;
}

async function getOpenRouterPricingMap(env: Env): Promise<Map<string, OpenRouterPricing>> {
  if (openRouterPricingCache && Date.now() - openRouterPricingCacheAtMs < OPENROUTER_PRICING_CACHE_TTL_MS) {
    return openRouterPricingCache;
  }

  const apiKey =
    (env as any)?.OPENROUTER_API_KEY ||
    (env as any)?.OPENROUTER_MANAGEMENT_KEY ||
    (env as any)?.OPENROUTER_KEY;

  const map = new Map<string, OpenRouterPricing>();

  try {
    const headers: Record<string, string> = {};
    if (isNonEmptyString(apiKey)) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: Object.keys(headers).length ? headers : undefined,
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return map;
    }
    const json: any = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const item of data) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const pricing = item?.pricing || {};
      map.set(id, {
        promptPerToken: toFiniteNumber(pricing?.prompt),
        completionPerToken: toFiniteNumber(pricing?.completion),
        requestPerRequest: toFiniteNumber(pricing?.request),
        imagePerImage: toFiniteNumber(pricing?.image)
      });
    }
  } catch {}

  if (map.size > 0) {
    openRouterPricingCache = map;
    openRouterPricingCacheAtMs = Date.now();
  }

  return map;
}

export async function calculateOpenRouterCostUsd(
  userModel: string,
  actualModelUsed: string,
  inputTokens: number,
  outputTokens: number,
  env: Env,
  hasImage: boolean
): Promise<number> {
  const usedModel = String(actualModelUsed || userModel || '').trim();
  const requestedModel = String(userModel || '').trim();
  const pricingMap = await getOpenRouterPricingMap(env);
  const p = pricingMap.get(usedModel) || (requestedModel ? pricingMap.get(requestedModel) : undefined);

  if (p) {
    const rawCostUsd =
      inputTokens * p.promptPerToken +
      outputTokens * p.completionPerToken +
      p.requestPerRequest +
      (hasImage ? p.imagePerImage : 0);
    if (Number.isFinite(rawCostUsd) && rawCostUsd > 0) return rawCostUsd;
    return 0;
  }

  const safe = lookupSafePrice(usedModel) || (requestedModel ? lookupSafePrice(requestedModel) : null);
  if (safe) {
    const cost =
      (inputTokens / 1_000_000) * safe.input +
      (outputTokens / 1_000_000) * safe.output;
    return Number.isFinite(cost) && cost > 0 ? cost : 0;
  }

  const emergency =
    (inputTokens / 1_000_000) * 0.5 +
    (outputTokens / 1_000_000) * 1.5;
  return Number.isFinite(emergency) && emergency > 0 ? emergency : 0;
}

export function calculateTokenCost(userModel: string, inputTokens: number, outputTokens: number, profitMultiplierOverride?: number): number {
  // 1. Get Base Price
  let price = lookupSafePrice(userModel) || SAFE_PRICES["default"];

  // 2. Calculate Raw Cost (USD)
  const inputCost = (inputTokens / 1_000_000) * price.input;
  const outputCost = (outputTokens / 1_000_000) * price.output;
  const rawCostUSD = inputCost + outputCost;

  // 3. Apply Admin Profit Margin
  // Use override if provided, otherwise env var, otherwise default 1.6
  const multiplier = profitMultiplierOverride !== undefined ? profitMultiplierOverride : 1.6;
  
  const finalCostUSD = rawCostUSD * multiplier;

  return finalCostUSD;
}

export async function recordTokenUsage(userId: number, userModel: string, actualModelUsed: string, inputTokens: number, outputTokens: number, cost: number, env: Env) {
    try {
        await env.DB.prepare("INSERT INTO history (user_id, model, input_tokens, output_tokens, cost, timestamp, actual_model_used) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(userId, userModel, inputTokens, outputTokens, cost, Date.now(), actualModelUsed)
            .run();
    } catch (e) {
        try {
             await env.DB.prepare("INSERT INTO history (user_id, model, input_tokens, output_tokens, cost, actual_model_used) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(userId, userModel, inputTokens, outputTokens, cost, actualModelUsed)
            .run();
        } catch (e2) {
            try {
              await env.DB.prepare("INSERT INTO history (user_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?)")
                .bind(userId, userModel, inputTokens, outputTokens, cost)
                .run();
            } catch (e3) {
              console.error("Failed to record history:", e3);
            }
        }
    }
}

// Deprecated but kept for compatibility if imported elsewhere
export async function getModelPrice(modelName: string, env: Env) {
    let profit = 60;
    try {
        const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
        if (config) profit = Number(config.value);
    } catch {}
    
    const price = lookupSafePrice(modelName) || SAFE_PRICES["default"];
    return {
        input_price: price.input,
        output_price: price.output,
        profit_multiplier: 1 + (profit/100)
    };
}
