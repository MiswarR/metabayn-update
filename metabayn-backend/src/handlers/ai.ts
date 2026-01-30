import { Env } from '../types';
import { MODEL_CONFIG } from '../config/models';
import { checkRateLimit } from '../utils/userRateLimiter';
import { acquireLock, releaseLock } from '../utils/concurrencyLock';
import { enqueue } from '../utils/aiQueue';
import { waitTurn } from '../utils/providerThrottle';
import { checkDailyLimit } from '../utils/tokenDailyLimit';
import { calculateTokenCost, recordTokenUsage } from '../utils/tokenCostManager';
import { TOKEN_RATE_USD_TO_CREDIT, getLiveUsdRate } from '../utils/tokenTopup';
import { getFallbackChain } from '../utils/modelFallback';
import { getGoogleAccessToken } from '../lib/google-auth';

export async function handleGenerate(req: Request, userId: number, env: Env) {
  // 0. Rate Limit & Concurrency Check
  if (!checkRateLimit(userId)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  // LOCK DISABLED to allow parallel processing
  const lockId = null; 
  // const lockId = acquireLock(userId);
  // if (!lockId) {
  //   return Response.json({ error: "You already have a running job." }, { status: 409 });
  // }

  try {
    const body: any = await req.json();
    const { model, prompt, messages, image, mimeType } = body; 
    const userModel = model; // Keep reference to what user asked for

    // 1. Cek Saldo
    console.log(`[AI] Checking balance for ${userId}...`);
    const user = await env.DB.prepare("SELECT tokens, is_admin FROM users WHERE id = ?").bind(userId).first();
    // REMOVED ADMIN BYPASS: User requested strict limit enforcement even for admin/testing.
    // const isAdmin = user?.is_admin === 1; 
    
    // Strict check: If tokens <= 0, STOP.
    if (!user || (user.tokens as number) <= 0) {
      return Response.json({ error: "Insufficient balance. Please Top Up." }, { status: 402 });
    }

    // 0.1 Check Daily Limit (Async) - DISABLED BY USER REQUEST
    // if (!isAdmin) {
    //     const withinDailyLimit = await checkDailyLimit(userId, env);
    //     if (!withinDailyLimit) {
    //     return Response.json({ error: "Daily token quota reached." }, { status: 403 });
    //     }
    // }

    // Get Fallback Chain
    const fallbackChain = [userModel];
    console.log(`[AI] Fallback chain for ${userModel}:`, fallbackChain);

    // 3. ENQUEUE JOB with Retry Loop
    const aiTask = async () => {
      let lastError: any = null;
      const startTime = Date.now();
      const MAX_DURATION = 10000;

      for (const currentModel of fallbackChain) {
        if (Date.now() - startTime > MAX_DURATION) {
            console.error(`[AI] Job timed out after ${MAX_DURATION}ms`);
            throw new Error("Job timed out.");
        }

        try {
            console.log(`[AI] Attempting model: ${currentModel}`);
            
            // Get provider info for the CURRENT model in the chain
            let currentProvider = 'openai'; // Default
            let modelInfo = MODEL_CONFIG.models[currentModel];
            
            if (modelInfo) {
                currentProvider = modelInfo.provider;
            } else {
                // Try to guess from name if not in static config (for dynamic models)
                if (currentModel.startsWith('gemini')) currentProvider = 'gemini';
                else if (currentModel.startsWith('claude')) currentProvider = 'anthropic';
                // else default openai
            }
            
            console.log(`[AI] Provider Selection: Model=${currentModel} -> Provider=${currentProvider}`);

            await waitTurn(currentProvider);

            let content = "";
            let inputTokens = 0;
            let outputTokens = 0;

            const selectionMode = !!body.selectionMode;
            if (currentProvider === 'openai') {
                console.log(`[DEBUG] OpenAI Image Mode. Prompt len: ${prompt?.length}, Image len: ${image?.length}`);
                
                let msgs = messages;
                if (!msgs) {
                if (image) {
                    msgs = [{
                    role: "user",
                    content: [
                        { type: "text", text: (prompt && prompt.length > 50000) ? (prompt.substring(0, 1000) + "... [TRUNCATED]") : (prompt || "Describe this image") },
                        { type: "image_url", image_url: { 
                            url: `data:${mimeType || 'image/jpeg'};base64,${image}`,
                            detail: "low" 
                        } }
                    ]
                    }];
                } else {
                    msgs = [{role: "user", content: prompt}];
                }
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 9000);
                
                try {
                    const res = await fetch("https://api.openai.com/v1/chat/completions", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ model: currentModel, messages: msgs }),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    
                    const data: any = await res.json();
                    
                    if (!res.ok) {
                        if (res.status >= 500 || res.status === 429) {
                            throw new Error(`[${res.status}] ${data.error?.message || 'Provider Error'}`);
                        }
                        // For 400 errors, stop immediately (don't fallback)
                        throw new Error(`NON_RETRYABLE: [${res.status}] ${data.error?.message}`);
                    }
                    
                    content = data.choices[0].message.content;
                    inputTokens = data.usage.prompt_tokens;
                    outputTokens = data.usage.completion_tokens;
                } catch(e: any) {
                    console.error(`[AI] OpenAI Error: ${e.message}`);
                    clearTimeout(timeoutId);
                    throw e;
                }

            } else if (currentProvider === 'gemini') {
                // Check if Vertex AI is configured, otherwise fallback to API Key
                let useVertex = false;
                if (env.GOOGLE_PROJECT_ID && env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
                    useVertex = true;
                }

                // CRITICAL FIX: Force Legacy API (AI Studio) for Gemini 2.0 & Flash Lite
                // REMOVED: We now try Vertex AI first and fallback to Legacy if 404.
                // This ensures we use Enterprise infrastructure whenever possible.

                // NORMALIZE MODEL NAMES
                let targetModel = currentModel;
                if (targetModel === 'gemini-2.0-flash-lite') {
                    targetModel = 'gemini-2.0-flash-lite-preview-02-05';
                } else if (targetModel === 'gemini-flash') {
                    targetModel = 'gemini-1.5-flash';
                }

                const parts: any[] = [{ text: prompt || "Describe this image" }];
                if (image) {
                    parts.push({
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: image
                        }
                    });
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 9000);

                try {
                    // Helper for Legacy API Call
                    const callLegacyApi = async (modelId: string) => {
                         const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${env.GEMINI_API_KEY}`;
                         return fetch(url, {
                             method: "POST",
                             headers: { "Content-Type": "application/json" },
                             body: JSON.stringify({ contents: [{ parts: parts }] }),
                             signal: controller.signal
                         });
                    };

                    let res;
                    if (useVertex) {
                        // VERTEX AI PATH
                        const accessToken = await getGoogleAccessToken(
                            env.GOOGLE_CLIENT_EMAIL,
                            env.GOOGLE_PRIVATE_KEY
                        );
                        
                        const location = env.GOOGLE_LOCATION || 'us-central1';
                        
                        // FIX: Normalize Model ID for Vertex AI (Updated Dec 2025)
                        // Use base names to let Google resolve to default stable version
                        let vertexModelId = targetModel;
                        
                        // REMOVED explicit mapping to 001/002 to avoid 404s
                        // Vertex AI should resolve 'gemini-1.5-flash' to the latest available version in the region

                        const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${env.GOOGLE_PROJECT_ID}/locations/${location}/publishers/google/models/${vertexModelId}:generateContent`;

                        res = await fetch(vertexUrl, {
                            method: "POST",
                            headers: { 
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${accessToken}`
                            },
                            body: JSON.stringify({ 
                                contents: [{ role: "user", parts: parts }] 
                            }),
                            signal: controller.signal
                        });

                        // AUTO-FALLBACK: If Vertex returns 404 (Model Not Found) or 400 (Bad Request - Invalid Argument), try Legacy API
                        // This handles cases where a model is Preview-only (not in Vertex) or Region-restricted
                        if (res.status === 404 || res.status === 400) {
                            // Clone response to read text without consuming original if needed (though we discard it here)
                            const errText = await res.text();
                            // Check if it's actually a "Not Found" or "Publisher Model" error
                            if (res.status === 404 || (res.status === 400 && errText.includes("Publisher Model"))) {
                                console.warn(`[AI] Vertex AI error for ${vertexModelId} (${res.status}): ${errText.substring(0, 100)}... Switching to Legacy API.`);
                                res = await callLegacyApi(targetModel);
                            } else {
                                // Restore response body for downstream error handling if it wasn't a model availability issue
                                // Since we consumed body, we must re-construct a response or throw immediately
                                throw new Error(`[${res.status}] Vertex AI Error: ${errText}`);
                            }
                        }

                    } else {
                        // LEGACY API KEY PATH
                        res = await callLegacyApi(targetModel);
                    }

                    clearTimeout(timeoutId);
                    const data: any = await res.json();
                    
                    if (!res.ok) {
                         // Common error handling
                         const errMsg = data.error?.message || JSON.stringify(data.error) || 'Provider Error';
                         if (res.status >= 500 || res.status === 429) {
                            throw new Error(`[${res.status}] ${errMsg}`);
                         }
                         throw new Error(`NON_RETRYABLE: [${res.status}] ${errMsg}`);
                    }

                    if (data.error) throw new Error(`[${res.status}] ${data.error.message}`);

                    // Vertex & AI Studio response structure is very similar
                    const candidate = data.candidates?.[0];
                    if (!candidate) {
                        // Check if it's a prompt feedback block (safety)
                        if (data.promptFeedback?.blockReason) {
                             throw new Error(`Blocked by Safety Filters: ${data.promptFeedback.blockReason}`);
                        }
                        throw new Error("No response candidates from AI provider.");
                    }

                    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "BLOCKLIST" || candidate.finishReason === "PROHIBITED_CONTENT") {
                        throw new Error(`Blocked by Safety Filters (${candidate.finishReason})`);
                    }

                    if (!candidate.content?.parts?.[0]?.text) {
                        throw new Error(`Empty response from AI (Finish Reason: ${candidate.finishReason || 'Unknown'})`);
                    }

                    content = candidate.content.parts[0].text;
                    inputTokens = data.usageMetadata?.promptTokenCount || Math.ceil((prompt || "").length / 4);
                    outputTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(content.length / 4);

                } catch(e: any) {
                    console.error(`[AI] Gemini/Vertex Error: ${e.message}`);
                    clearTimeout(timeoutId);
                    throw e;
                }
            }
            
            // Success! Return result
            return { content, inputTokens, outputTokens, usedModel: currentModel };

        } catch (e: any) {
            console.error(`[AI] Error with model ${currentModel}:`, e.message);
            lastError = e;
            
            // Stop if error is explicitly non-retryable
            if (e.message.includes("NON_RETRYABLE")) {
                throw e; // Break loop and fail
            }
            
            // Otherwise, continue loop to next model
            continue;
        }
      }
      
      // If we exit loop, all failed
      throw lastError || new Error("All model providers are temporarily busy.");
    };

    // EXECUTE VIA QUEUE
    let result;
    try {
        result = await enqueue(aiTask);
    } catch (e: any) {
        // Clean up error message for user
        const msg = e.message.replace("NON_RETRYABLE: ", "");
        return Response.json({ error: msg }, { status: 502 });
    }

    const { content, inputTokens, outputTokens, usedModel } = result;

    // 4. Hitung Biaya & Profit (DYNAMIC PRICING FROM DB)
    // CRITICAL: Calculate cost based on USER MODEL (userModel), not usedModel (Rule #2)
    // Profit Margin Strategy: 50% - 70%
    let costFinal = 0;
    try {
      costFinal = await calculateTokenCost(inputTokens, outputTokens, userModel, env);
      console.log(`[Cost] Model: ${userModel}, In: ${inputTokens}, Out: ${outputTokens}, Cost: ${costFinal}`);
      
      // SAFETY CAP: Prevent astronomical costs due to bugs or huge inputs
      // Cap at $0.25 per request (approx Rp 4.000)
      if (costFinal > 0.25) {
          console.warn(`[Cost] Cost exceeded safety cap ($${costFinal}). Capping at $0.25.`);
          costFinal = 0.25;
      }
      
    } catch (e: any) {
       console.error("Pricing DB Error:", e);
       // Fallback logic for pricing
       // Default to 60% profit margin for safety if DB config is missing
       let profitMarginPercent = 60;
       try {
            const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
            if (config && config.value) {
                profitMarginPercent = Number(config.value);
            }
       } catch {}
       
       const profitMultiplier = 1 + (profitMarginPercent / 100);

       // Try to get static price for userModel from MODEL_CONFIG
       const staticModel = MODEL_CONFIG.models[userModel];
       if (staticModel) {
            const costRaw = ((inputTokens / 1_000_000) * staticModel.input) + ((outputTokens / 1_000_000) * staticModel.output);
            costFinal = costRaw * profitMultiplier;
            console.log(`[Cost Fallback] Model: ${userModel}, Raw: ${costRaw}, Multiplier: ${profitMultiplier}, Final: ${costFinal}`);
       } else {
            // Extreme fallback: Assume high cost ($5/1M) to prevent loss
            const safePrice = 5.0; 
            costFinal = ((inputTokens + outputTokens) / 1_000_000) * safePrice * profitMultiplier; 
            console.log(`[Cost Extreme Fallback] Model: ${userModel}, Price: ${safePrice}, Final: ${costFinal}`);
       }
       
       // SAFETY CAP for Fallback too
       if (costFinal > 0.25) {
           console.warn(`[Cost Fallback] Cost exceeded safety cap ($${costFinal}). Capping at $0.25.`);
           costFinal = 0.25;
       }
    }

    // 5. Deduksi Saldo & Simpan History (Atomic Transaction)
    // Note: We record 'userModel' in history to match the cost calculation basis.
    // REMOVED !isAdmin CHECK - Admin also pays tokens now for testing/tracking purposes.
    
    // CONVERT USD COST TO TOKENS (CREDITS)
    // costFinal is in USD. We need to convert to our Token unit (IDR-pegged).
    // Rate: 1 USD = ~16,000 Tokens (Credits) - Real-time
    const currentRate = await getLiveUsdRate(env);
    const costInTokens = costFinal * currentRate;
    
    // Ensure cost is at least minimal to register a change
    const deductAmount = Math.max(costInTokens, 1); // Minimum 1 Token (Rp 1) deduction
    
    console.log(`[AI] Deducting ${deductAmount} Tokens (from $${costFinal}) from User ${userId}...`);
    // Prevent negative balance: only deduct if user has enough tokens to cover the cost
    const deductRes = await env.DB
      .prepare("UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens")
      .bind(deductAmount, userId, deductAmount)
      .first();

    if (!deductRes || typeof deductRes.tokens !== 'number') {
      // Abort: do not allow negative balance, return error with current balance
      const currentBal = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
      return Response.json({ 
        error: "Insufficient balance. Process cancelled to prevent negative balance.",
        required_tokens: Math.ceil(deductAmount),
        user_balance: (currentBal?.tokens as number) || 0
      }, { status: 402 });
    }

    // Record history with actual model used (and cost in USD for reporting)
    // We store cost in USD in the history table for financial tracking
    await recordTokenUsage(userId, userModel, usedModel, inputTokens, outputTokens, costFinal, env);

    // 6. Ambil sisa saldo dari RETURNING
    const updatedUserTokens = deductRes.tokens as number;

    // 7. Response Ideal
    return Response.json({
      status: "success",
      model_chosen: userModel,
      model_used: usedModel,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost: costFinal,
      user_balance_after: updatedUserTokens,
      result: content, // Keep 'result' for backward compatibility or change to 'metadata' if desired, but 'result' is standard here
      metadata: {
        provider: body.useGroq ? 'groq' : (usedModel.startsWith('gpt') ? 'openai' : 'gemini'),
        finish_reason: "stop" // Simplified
      }
    });
  } finally {
    if (lockId) releaseLock(userId, lockId);
  }
}
