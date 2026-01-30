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
    
    // Fallback default
    "default": { input: 0.10, output: 0.40 } 
};

export async function calculateTokenCost(inputTokens: number, outputTokens: number, userModel: string, env: Env): Promise<number> {
  // 1. DETERMINE BASE PRICE (USD PER 1 MILLION TOKENS)
  let price = SAFE_PRICES[userModel];
  
  // TRY TO FETCH DYNAMIC PRICE FROM DB (model_prices table)
  try {
      const dbPrice = await env.DB.prepare("SELECT input_price, output_price, profit_multiplier FROM model_prices WHERE model_name = ? AND active = 1").bind(userModel).first();
      if (dbPrice) {
          price = {
              input: Number(dbPrice.input_price),
              output: Number(dbPrice.output_price)
          };
          // Optional: We could use specific profit multiplier from model_prices too, but global config is safer for now
          // to match user expectation of "Global Profit Margin"
          console.log(`[Pricing] Using DB Price for ${userModel}: Input $${price.input}, Output $${price.output}`);
      }
  } catch (e) {
      console.warn(`[Pricing] Failed to fetch DB price for ${userModel}, using safe fallback.`, e);
  }

  if (!price) {
      // Try to find by partial match or fallback
      if (userModel.includes("flash-lite") || userModel.includes("8b")) price = SAFE_PRICES["gemini-2.0-flash-lite"];
      else if (userModel.includes("flash") && (userModel.includes("1.5") || userModel.includes("001") || userModel.includes("002"))) price = SAFE_PRICES["gemini-1.5-flash"];
      else if (userModel.includes("flash")) price = SAFE_PRICES["gemini-2.0-flash"];
      else if (userModel.includes("mini")) price = SAFE_PRICES["gpt-4o-mini"];
      else if (userModel.includes("ultra")) price = SAFE_PRICES["gemini-2.5-ultra"]; // Safe high fallback
      else if (userModel.includes("pro")) price = SAFE_PRICES["gemini-1.5-pro"];
      else if (userModel.includes("gpt-4o") || userModel.includes("gpt-4.1")) price = SAFE_PRICES["gpt-4o"];
      else if (userModel.includes("gpt-5") || userModel.includes("o1") || userModel.includes("o3")) price = SAFE_PRICES["gpt-5.1"];
      else price = SAFE_PRICES["default"];
      
      console.warn(`[Pricing] Model '${userModel}' not found in safe list. Using fallback price: Input $${price.input}/1M`);
  }

  // 2. CALCULATE RAW COST (USD)
  // Formula: (Tokens / 1,000,000) * Price_Per_1M
  const inputCostUSD = (inputTokens / 1_000_000) * price.input;
  const outputCostUSD = (outputTokens / 1_000_000) * price.output;
  const rawCostUSD = inputCostUSD + outputCostUSD;

  // 3. APPLY PROFIT MARGIN (Configurable)
  // Fetch profit margin from DB or use default 60%
  let profitMarginPercent = 60;
  try {
      const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
      if (config && config.value) {
          profitMarginPercent = Number(config.value);
      }
  } catch (e) {
      console.warn("[TokenCalc] Failed to fetch profit margin, using default 60%", e);
  }

  // Multiplier = 1 + (Percent / 100)
  // e.g. 60% -> 1.6
  const PROFIT_MULTIPLIER = 1 + (profitMarginPercent / 100);
  const finalCostUSD = rawCostUSD * PROFIT_MULTIPLIER;

  // 4. LOGGING FOR DEBUGGING
  console.log(`[TokenCalc] Model: ${userModel}`);
  console.log(`[TokenCalc] Usage: ${inputTokens} In / ${outputTokens} Out`);
  console.log(`[TokenCalc] Base Price (1M): $${price.input} / $${price.output}`);
  console.log(`[TokenCalc] Raw Cost: $${rawCostUSD.toFixed(8)}`);
  console.log(`[TokenCalc] Profit Margin: ${profitMarginPercent}% (x${PROFIT_MULTIPLIER})`);
  console.log(`[TokenCalc] Final Cost: $${finalCostUSD.toFixed(8)}`);

  return finalCostUSD;
}

export async function recordTokenUsage(userId: number, userModel: string, actualModelUsed: string, inputTokens: number, outputTokens: number, cost: number, env: Env) {
    try {
        await env.DB.prepare("INSERT INTO history (user_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?)")
            .bind(userId, userModel, inputTokens, outputTokens, cost)
            .run();
    } catch (e) {
        console.error("Failed to record history:", e);
    }
}

// Deprecated but kept for compatibility if imported elsewhere
export async function getModelPrice(modelName: string, env: Env) {
    let profit = 60;
    try {
        const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
        if (config) profit = Number(config.value);
    } catch {}
    
    return {
        input_price: SAFE_PRICES[modelName]?.input || 0.1,
        output_price: SAFE_PRICES[modelName]?.output || 0.4,
        profit_multiplier: 1 + (profit/100)
    };
}
