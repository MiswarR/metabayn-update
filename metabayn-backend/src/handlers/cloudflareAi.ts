
import { Env } from '../types';
import { calculateTokenCost, recordTokenUsage } from '../utils/tokenCostManager';
import { checkRateLimit } from '../utils/userRateLimiter';
import { validateUserAccess } from '../utils/validation';
import { chargeUserBalanceFromUsdCost, writeActivityLog } from '../utils/balanceLedger.js';

export async function handleCloudflareGenerate(request: Request, userId: number | string, env: Env): Promise<Response> {
  // Check Env AI
  if (!env || !env.AI) {
      console.error("[CloudflareAI] Fatal: AI binding missing");
      return new Response(JSON.stringify({ error: "System Error: AI service unavailable" }), { status: 500 });
  }

  const uid = Number(userId);
  if (isNaN(uid)) {
    return new Response(JSON.stringify({ error: 'Invalid User ID' }), { status: 400 });
  }

  // 1. Rate Limit
  if (!checkRateLimit(uid)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
  }

  // 2. Parse Body
  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { model, prompt, image, validate_json } = body;
  const requestId = String(request.headers.get('x-request-id') || body?.request_id || '').trim() || crypto.randomUUID();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400 });
  }

  // Detect Feature (CSV Fix vs General)
  // CSV Fix prompt contains specific JSON structure request
  const isCsvFix = prompt.includes('Output ONLY valid JSON: { "categories":');
  const feature = isCsvFix ? 'csv_fix' : 'metadata';
  
  // 3. Dual Validation (Token + Subscription)
  // Cloudflare AI is ALWAYS Gateway Mode
  const validation = await validateUserAccess(uid, env, { mode: 'gateway', feature });
  
  if (!validation.valid || !validation.user) {
      return new Response(JSON.stringify({ error: validation.error }), { status: validation.status || 403 });
  }

  // 4. Determine Model & Inputs
  // Default to Llama 3.1 8B Instruct if not specified or text-only
  let finalModel = model || '@cf/meta/llama-3.1-8b-instruct';

  // VALIDATE MODEL TO PREVENT ABUSE OR ERRORS
  const ALLOWED_MODELS = [
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3.1-8b-instruct-fp8',
    '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-70b-instruct',
    '@cf/meta/llama-3.2-11b-vision-instruct',
    '@cf/meta/llama-3.2-1b-preview',
    '@cf/meta/llama-3.2-1b-instruct',
    '@cf/meta/llama-3.2-3b-instruct'
  ];

  if (!ALLOWED_MODELS.includes(finalModel) && !image) {
      // If model not allowed, fallback to default 8b
      finalModel = '@cf/meta/llama-3.1-8b-instruct';
  }

  let inputs: any = { prompt };

  // If image is present, force Vision model
  if (image) {
    // Prefer Llama 3.2 11B Vision Instruct
    if (!finalModel.includes('vision') && !finalModel.includes('llava') && !finalModel.includes('resnet')) {
      finalModel = '@cf/meta/llama-3.2-11b-vision-instruct';
    }

    // Convert data URI to array of integers
    let imageBytes: number[] = [];
    if (typeof image === 'string' && image.startsWith('data:')) {
      try {
        const base64Data = image.split(',')[1];
        const binaryString = atob(base64Data);
        for (let i = 0; i < binaryString.length; i++) {
          imageBytes.push(binaryString.charCodeAt(i));
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid image data' }), { status: 400 });
      }
    } else {
        return new Response(JSON.stringify({ error: 'Image must be base64 data URI' }), { status: 400 });
    }

    inputs = {
      prompt: prompt,
      image: imageBytes
    };
  }

  // 5. Run AI
  try {
    const response: any = await env.AI.run(finalModel, inputs);
    
    // 6. Extract Result
    let resultText = "";
    if (response && typeof response === 'object') {
        if ('response' in response) {
            if (typeof response.response === 'object') resultText = JSON.stringify(response.response);
            else resultText = String(response.response || "");
        }
        else if ('result' in response) {
            // Nested result object
            const res = response.result;
            if (typeof res === 'string') resultText = res;
            else if (typeof res === 'object') {
                 if ('response' in res) {
                     if (typeof res.response === 'object') resultText = JSON.stringify(res.response);
                     else resultText = String(res.response || "");
                 }
                 else if ('description' in res) {
                     if (typeof res.description === 'object') resultText = JSON.stringify(res.description);
                     else resultText = String(res.description || "");
                 }
                 else resultText = JSON.stringify(res);
            }
        }
        else if ('description' in response) {
            if (typeof response.description === 'object') resultText = JSON.stringify(response.description);
            else resultText = String(response.description || ""); // LLaVA/Vision often returns description
        }
        else resultText = JSON.stringify(response);
    } else if (typeof response === 'string') {
        resultText = response;
    }
    
    // Ensure resultText is a string
    if (typeof resultText !== 'string') {
        resultText = String(resultText || "");
    }

    // --- SECURITY & LEAK PROTECTION ---
    // 1. Validate Output Content
    // Check if the output is actually an error message masquerading as success
    const lowerRes = resultText.toLowerCase().trim();
    if (
        lowerRes.startsWith("error:") || 
        lowerRes.startsWith("error ") || 
        lowerRes.includes("internal server error") || 
        lowerRes.includes("upstream service error") ||
        lowerRes.includes("model loading") ||
        lowerRes.includes("rate limit")
    ) {
        console.error(`[LeakProtection] AI returned error-like text: ${resultText.substring(0, 100)}...`);
        return new Response(JSON.stringify({ error: `AI Provider Error: ${resultText}` }), { status: 500 });
    }

    // 2. Validate Output Length
    // Prevent deduction for empty or extremely short/nonsense responses
    if (!resultText || resultText.length < 5) {
        console.error(`[LeakProtection] AI returned empty/short response: ${resultText}`);
        return new Response(JSON.stringify({ error: "AI returned empty or invalid response" }), { status: 500 });
    }

    // 3. Validate JSON (If requested)
    if (validate_json) {
        console.log(`[CloudflareAI] Raw AI Output for validation: ${resultText}`);
        
        let isValidJson = false;
        let cleanText = resultText.trim();
        
        // Strategy 1: Extract from Markdown Code Blocks
        const jsonBlock = cleanText.match(/```json\s*([\s\S]*?)\s*```/i);
        const codeBlock = cleanText.match(/```\s*([\s\S]*?)\s*```/i);
        
        if (jsonBlock) {
            cleanText = jsonBlock[1].trim();
        } else if (codeBlock) {
            cleanText = codeBlock[1].trim();
        }

        // Strategy 2: Direct Parse
        try {
            const firstBrace = cleanText.indexOf('{');
            if (firstBrace > 0) {
                const prefix = cleanText.substring(0, firstBrace).trim();
                if (prefix.length < 50 || prefix.toLowerCase().includes("json") || prefix.toLowerCase().includes("here")) {
                    cleanText = cleanText.substring(firstBrace);
                }
            }

            JSON.parse(cleanText);
            isValidJson = true;
            resultText = cleanText; 
        } catch (e) {
            // Strategy 3: Find first '{' and last '}'
            const start = cleanText.indexOf('{');
            const end = cleanText.lastIndexOf('}');
            
            if (start !== -1 && end > start) {
                const potentialJson = cleanText.substring(start, end + 1);
                try {
                    JSON.parse(potentialJson);
                    isValidJson = true;
                    resultText = potentialJson;
                } catch (e2) {
                    console.error(`[CloudflareAI] JSON Extraction Failed: ${e2}`);
                    
                    try {
                        let fixedJson = potentialJson.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                        fixedJson = fixedJson.replace(/(?<!\\)\n/g, " ");
                        
                        JSON.parse(fixedJson);
                        isValidJson = true;
                        resultText = fixedJson;
                    } catch (e3) {
                         console.error(`[CloudflareAI] Aggressive JSON Fix Failed: ${e3}`);
                    }
                }
            }
        }

        if (!isValidJson) {
            // Sanitize output for error message (remove newlines, limit length)
            const safeOutput = resultText.replace(/[\r\n]+/g, ' ').substring(0, 200);
            console.error(`[LeakProtection] AI returned invalid JSON: ${safeOutput}`);
            return new Response(JSON.stringify({ 
                error: `AI Response is not valid JSON. Received: "${safeOutput}". No tokens deducted.` 
            }), { status: 422 });
        }
    }

    // 7. Calculate Cost & Record Usage
    // Estimate tokens (simple char count / 4)
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(resultText.length / 4);
    
    // Calculate Cost in USD
    const costUsdRaw = calculateTokenCost(finalModel, inputTokens, outputTokens, 1);

    const explicitIdempotencyKeyRaw =
      String(body?.idempotency_key || request.headers.get('Idempotency-Key') || '').trim();
    const idempotencyKey =
      explicitIdempotencyKeyRaw || `cfai:${uid}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())}`;

    await writeActivityLog(env, {
      userId: uid,
      level: 'INFO',
      message: `[RID:${requestId}] debit_start mode=gateway feature=${feature} before=${Number(validation.user?.tokens ?? 0)} usd=${Number(costUsdRaw || 0).toFixed(6)} idempotency=${idempotencyKey}`,
      timestampMs: Date.now()
    }).catch(() => {});

    const charge = await chargeUserBalanceFromUsdCost(env, {
      userId: uid,
      costUsd: costUsdRaw,
      reason: `cloudflare_ai:${feature}:${finalModel}`,
      insufficientLogMessage: `[CloudflareAI] Insufficient balance user ${uid} for ${feature} (${finalModel})`,
      insufficientErrorMessage: 'Saldo token tidak cukup.',
      idempotencyKey,
      meta: {
        provider: 'cloudflare_ai',
        feature,
        requested_model: model || null,
        model_used: finalModel,
        request_id: requestId,
        cost_usd: Number(costUsdRaw),
        input_tokens: inputTokens,
        output_tokens: outputTokens
      }
    });

    if (!charge.ok) {
      await writeActivityLog(env, {
        userId: uid,
        level: 'ERROR',
        message: `[RID:${requestId}] debit_failed mode=gateway feature=${feature} reason=${String(charge.error || 'unknown')}`,
        timestampMs: Date.now()
      }).catch(() => {});
      return new Response(JSON.stringify({ error: charge.error || 'Saldo token tidak cukup.' }), { status: charge.status || 402 });
    }

    const userBalanceAfter = Number(charge.userBalanceAfterTenths) / 10;
    await writeActivityLog(env, {
      userId: uid,
      level: 'INFO',
      message: `[RID:${requestId}] debit_success mode=gateway feature=${feature} deducted=${Number(charge.tokensDeductedTenths) / 10} after=${userBalanceAfter}`,
      timestampMs: Date.now()
    }).catch(() => {});

    // Record Usage
    await recordTokenUsage(uid, finalModel, finalModel, inputTokens, outputTokens, Number(costUsdRaw), env);

    return new Response(JSON.stringify({
        result: resultText,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost: Number(costUsdRaw),
        model_used: finalModel,
        request_id: requestId,
        user_balance_after: userBalanceAfter,
        app_tokens_deducted: Number(charge.tokensDeductedTenths) / 10,
        app_balance_after: userBalanceAfter
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error("Cloudflare AI Error:", e);
    return new Response(JSON.stringify({ error: `Cloudflare AI Error: ${e.message}` }), { status: 500 });
  }
}
