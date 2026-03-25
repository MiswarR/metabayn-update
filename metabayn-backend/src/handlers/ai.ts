import { Env } from '../types';
import { MODEL_CONFIG } from '../config/models';
import { checkRateLimit } from '../utils/userRateLimiter';
import { acquireLock, releaseLock } from '../utils/concurrencyLock';
import { enqueue, setConcurrencyLimit } from '../utils/aiQueue';
import { waitTurn } from '../utils/providerThrottle';
import { checkDailyLimit } from '../utils/tokenDailyLimit';
import { calculateOpenRouterCostUsd, calculateTokenCost, isOpenRouterFreeModel, recordTokenUsage } from '../utils/tokenCostManager';
import { getFallbackChain } from '../utils/modelFallback';
import { validateUserAccess } from '../utils/validation';
import { chargeUserBalanceFromUsdCost, writeActivityLog } from '../utils/balanceLedger.js';
import { ensureUserOpenRouterKey } from './auth';

export function resolveAccessMode(connectionModeRaw: string): 'gateway' | 'standard' {
  return String(connectionModeRaw || '').trim().toLowerCase() === 'direct' ? 'standard' : 'gateway';
}

export function resolveShouldDeductTokens(mode: 'gateway' | 'standard', feature: 'metadata' | 'csv_fix'): boolean {
  return mode === 'gateway';
}

export async function handleGenerate(req: Request, userId: number, env: Env) {
  // Check Env DB
  if (!env || !env.DB) {
      console.error("[AI] Fatal: DB binding missing");
      return Response.json({ error: "System Error: Database connection failed" }, { status: 500 });
  }

  // 0. Rate Limit & Concurrency Check
  if (!checkRateLimit(userId)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  // LOCK DISABLED to allow parallel processing
  const lockIdRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_unlimited_mode'").first().catch(() => null);
  const unlimitedMode = !lockIdRow || String(lockIdRow?.value).toLowerCase().includes('true'); // Default ON if missing
  const lockId = unlimitedMode ? null : acquireLock(userId);
  if (!unlimitedMode && !lockId) {
    return Response.json({ error: "You already have a running job." }, { status: 409 });
  }

  try {
    const body: any = await req.json();
    const requestId = String(req.headers.get('x-request-id') || body?.request_id || '').trim() || crypto.randomUUID();
    const { model, prompt, messages, image, mimeType } = body; 
    const hasImageInput = typeof image === 'string' && image.trim().length > 0;
    const requestedRetriesRaw = body?.retries ?? body?.retry ?? body?.retry_count ?? body?.retryCount ?? null;
    const requestedRetries = (() => {
      const n = Number(requestedRetriesRaw);
      if (!Number.isFinite(n)) return null;
      const i = Math.floor(n);
      if (i < 0) return 0;
      return Math.min(i, 10);
    })();
    const connectionModeRaw = String(body?.connection_mode || body?.connectionMode || '')
      .trim()
      .toLowerCase();
    let userModel = typeof model === 'string' ? model.trim() : '';
    if (!userModel) userModel = 'qwen/qwen3-vl-235b-a22b-thinking';
    if (userModel === 'openrouter/auto') {
        return Response.json({ error: 'Model Auto Router (openrouter/auto) dinonaktifkan di AI Gateway. Pilih model yang spesifik.' }, { status: 400 });
    }

    // Detect Feature: CSV Fix
    let feature: 'metadata' | 'csv_fix' = body?.feature === 'csv_fix' ? 'csv_fix' : 'metadata';
    const promptText = (typeof prompt === 'string' ? prompt : '') + 
                       (Array.isArray(messages) ? messages.map((m: any) => m.content).join(' ') : '');
    
    // Check for specific CSV Fix prompt signature
    if (promptText.includes('Output ONLY valid JSON: { "categories":')) {
        feature = 'csv_fix';
        console.log(`[AI] Feature detected: CSV Fix`);
    }

    // 1. Dual Validation (Token + Subscription)
    console.log(`[AI] Checking balance for ${userId} (Feature: ${feature})...`);
    const mode = resolveAccessMode(connectionModeRaw);
    const validation = await validateUserAccess(userId, env, { mode, feature });
    if (!validation.valid || !validation.user) {
        if (validation.error) {
            await writeActivityLog(env, {
                userId,
                level: 'ERROR',
                message: validation.error,
                timestampMs: Date.now()
            }).catch(() => {});
        }
        return Response.json({ error: validation.error || "Access Denied" }, { status: validation.status || 403 });
    }
    
    // User object for later use
    let user: any = validation.user;


    // 0.1 Check Daily Limit (Async) - DISABLED BY USER REQUEST
    // if (!isAdmin) {
    //     const withinDailyLimit = await checkDailyLimit(userId, env);
    //     if (!withinDailyLimit) {
    //     return Response.json({ error: "Daily token quota reached." }, { status: 403 });
    //     }
    // }
    
    // Dynamic concurrency from Admin Config
    try {
      const unlimitedRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_unlimited_mode'").first();
      const concRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_concurrency_limit'").first();
      const unlimited = !unlimitedRow || String(unlimitedRow.value).toLowerCase().includes('true'); // Default ON if missing
      let limit = Number(concRow?.value);
      if (!Number.isFinite(limit)) limit = 5;
      limit = Math.max(1, Math.min(limit, 10));
      if (unlimited) limit = 100;
      setConcurrencyLimit(limit, 'default');
      setConcurrencyLimit(1, 'openrouter_free');
    } catch {}

    const isFreeUserModel = userModel === 'openrouter/free' || userModel.endsWith(':free') || userModel.includes('qwen3-vl');
    const fallbackChain = [userModel];

    const extractMessageText = (msgs: any): string => {
      if (!Array.isArray(msgs)) return '';
      let out = '';
      for (const m of msgs) {
        const c: any = m?.content;
        if (typeof c === 'string') {
          out += c;
          continue;
        }
        if (Array.isArray(c)) {
          for (const p of c) {
            if (p && typeof p === 'object' && String(p.type || '').toLowerCase() === 'text' && typeof p.text === 'string') {
              out += p.text;
            }
          }
        }
      }
      return out;
    };
    const norm = (v: any) => (typeof v === 'string' ? v.replace(/^['"]|['"]$/g, '').trim() : '');

    const estimateTokensFromText = (text: string): number => {
      const t = String(text || '');
      const approx = Math.ceil(t.length / 4);
      const n = Number.isFinite(approx) ? approx : 0;
      return Math.max(1, Math.min(n, 20000));
    };

    type AiTaskResult = {
      content: string;
      inputTokens: number;
      outputTokens: number;
      usedModel: string;
      costUsdFromOpenRouter?: number;
      costUsdSource: 'header' | 'generation' | 'usage_pricing';
      openRouterGenerationId: string;
      openRouterAttempts: number;
    };

    // 3. ENQUEUE JOB with Retry Loop
    const aiTask: () => Promise<AiTaskResult> = async () => {
      let lastError: any = null;
      const startTime = Date.now();
      const MAX_DURATION = hasImageInput ? 130000 : 35000;

      for (const currentModel of fallbackChain) {
        if (Date.now() - startTime > MAX_DURATION) {
            console.error(`[AI] Job timed out after ${MAX_DURATION}ms`);
            throw new Error("Job timed out.");
        }

        try {
            console.log(`[AI] Attempting model: ${currentModel}`);
            
            // Get provider info for the CURRENT model in the chain
            let currentProvider = 'openrouter'; // Default to OpenRouter
            let modelInfo = MODEL_CONFIG.models[currentModel];
            
            if (modelInfo) {
                currentProvider = modelInfo.provider;
            } else {
                // Try to guess from name if not in static config (for dynamic models)
                // Defaulting everything to openrouter as requested
                currentProvider = 'openrouter';
            }
            
            console.log(`[AI] Provider Selection: Model=${currentModel} -> Provider=${currentProvider}`);

            const throttleKey = currentModel === 'openrouter/free' || currentModel.endsWith(':free') ? 'free' : undefined;
            try {
                // Timeout waitTurn to prevent hanging
                const waitPromise = waitTurn(currentProvider, throttleKey, env);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Queue Wait Timeout")), 5000));
                await Promise.race([waitPromise, timeoutPromise]);
            } catch (e) {
                console.warn(`[AI] waitTurn skipped or timed out: ${e}`);
            }

            let content = "";
            let inputTokens = 0;
            let outputTokens = 0;
            let costUsdFromOpenRouter: number | undefined = undefined;
            let costUsdSource: 'header' | 'generation' | 'usage_pricing' = 'usage_pricing';
            let openRouterGenerationId = '';
            let openRouterAttempts = 0;

            const selectionMode = !!body.selectionMode;
            
            // Unified OpenRouter Handler
            // All requests go through OpenRouter logic
            console.log(`[AI] OpenRouter Mode: ${currentModel}`);
            const startedAt = Date.now();
            const deadlineAt = startedAt + (hasImageInput ? 120000 : 25000);

            try {
                const isAdmin = !!(user?.is_admin === 1);
                let userApiKey = user?.or_api_key as string | undefined;

                if (!userApiKey) {
                    try { await ensureUserOpenRouterKey(userId, String(user?.email || ''), env); } catch {}
                    try {
                        const row: any = await env.DB.prepare("SELECT or_api_key FROM users WHERE id = ?").bind(userId).first();
                        userApiKey = row?.or_api_key ? String(row.or_api_key) : undefined;
                    } catch {}
                }

                const authKey = String(userApiKey || '').trim();
                if (!authKey) {
                    throw new Error("OpenRouter key belum tersedia untuk user ini. Admin: pastikan OPENROUTER_MANAGEMENT_KEY terpasang dan provisioning key berhasil.");
                }
                const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                const isFreeAttemptModel = isOpenRouterFreeModel(String(currentModel || '').trim());
                const maxAttemptsCap = isFreeAttemptModel ? 3 : 2;
                const maxAttemptsDefault = isFreeAttemptModel ? 3 : 1;
                const maxAttempts = requestedRetries === null
                  ? maxAttemptsDefault
                  : Math.max(1, Math.min(maxAttemptsCap, requestedRetries + 1));
                let res: Response | null = null;
                let data: any = null;
                let lastStatus = 0;
                let lastErrMsg = '';

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    openRouterAttempts = attempt;
                    const timeLeft = deadlineAt - Date.now();
                    if (timeLeft <= (hasImageInput ? 5000 : 1200)) break;
                    const attemptTimeoutMs = hasImageInput
                      ? Math.min(Math.max(30000, timeLeft - 1000), Math.max(1000, timeLeft - 200))
                      : Math.max(1000, Math.min(12000, timeLeft - 200));

                    try {
                        res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${authKey}`,
                                "HTTP-Referer": "https://metabayn.com",
                                "X-Title": "Metabayn App",
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                model: currentModel,
                                messages: messages || [{ role: "user", content: prompt }]
                            }),
                            signal: AbortSignal.timeout(attemptTimeoutMs)
                        });

                        lastStatus = res.status || 0;

                        const costHeaderRaw = res.headers.get('X-OpenRouter-Cost');
                        if (costHeaderRaw !== null) {
                            const parsed = Number(String(costHeaderRaw).trim());
                            if (Number.isFinite(parsed) && parsed > 0) {
                                costUsdFromOpenRouter = parsed;
                                costUsdSource = 'header';
                            }
                        }

                        if (res.ok) {
                            const rawText = await res.text().catch(() => '');
                            data = null;
                            if (rawText) {
                                try { data = JSON.parse(rawText); } catch { data = null; }
                            }
                            if (data) break;
                            lastErrMsg = `NON_RETRYABLE: Status 200 OK but Invalid JSON response. Text length: ${rawText.length}`;
                            const err: any = new Error(lastErrMsg);
                            err.metabayn = {
                                cost_usd: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter)) ? costUsdFromOpenRouter : 0,
                                cost_usd_source: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0)
                                    ? costUsdSource
                                    : 'none',
                                openrouter_attempts: openRouterAttempts
                            };
                            throw err;
                        }

                        const rawText = await res.text().catch(() => '');
                        data = null;
                        if (rawText) {
                            try { data = JSON.parse(rawText); } catch { data = null; }
                        }

                        const errMsg =
                            (data && (data.error?.message || data.error)) ||
                            rawText ||
                            'OpenRouter Error';

                        lastErrMsg = String(errMsg || '');
                        const retryable = res.status >= 500 || res.status === 429;

                        if (!retryable) {
                            const err: any = new Error(`NON_RETRYABLE: [${res.status}] ${lastErrMsg}`);
                            err.metabayn = {
                                cost_usd: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter)) ? costUsdFromOpenRouter : 0,
                                cost_usd_source: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0)
                                    ? costUsdSource
                                    : 'none',
                                openrouter_attempts: openRouterAttempts
                            };
                            throw err;
                        }

                        if (attempt < maxAttempts) {
                            const base = Math.min(2500, 400 * Math.pow(2, attempt - 1));
                            const jitter = Math.floor(Math.random() * 250);
                            await sleep(base + jitter);
                            continue;
                        }

                        const err: any = new Error(`[${res.status}] ${lastErrMsg}`);
                        err.metabayn = {
                            cost_usd: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter)) ? costUsdFromOpenRouter : 0,
                            cost_usd_source: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0)
                                ? costUsdSource
                                : 'none',
                            openrouter_attempts: openRouterAttempts
                        };
                        throw err;
                    } catch (e: any) {
                        const msg = String(e?.message || e);
                        lastErrMsg = msg;
                        const timeLeft2 = deadlineAt - Date.now();
                        if (attempt < maxAttempts && timeLeft2 > 1200) {
                            const base = Math.min(2500, 400 * Math.pow(2, attempt - 1));
                            const jitter = Math.floor(Math.random() * 250);
                            await sleep(base + jitter);
                            continue;
                        }
                        const err: any = new Error(`[${lastStatus || 0}] ${lastErrMsg}`);
                        err.metabayn = {
                            cost_usd: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter)) ? costUsdFromOpenRouter : 0,
                            cost_usd_source: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0)
                                ? costUsdSource
                                : 'none',
                            openrouter_attempts: openRouterAttempts
                        };
                        throw err;
                    }
                }

                if (!res || !data || !res.ok) {
                    const err: any = new Error(`[${lastStatus || 0}] ${lastErrMsg || 'OpenRouter Error'}`);
                    err.metabayn = {
                        cost_usd: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter)) ? costUsdFromOpenRouter : 0,
                        cost_usd_source: (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0)
                            ? costUsdSource
                            : 'none',
                        openrouter_attempts: openRouterAttempts
                    };
                    throw err;
                }

                openRouterGenerationId = data?.id ? String(data.id) : '';

                if (costUsdFromOpenRouter === undefined) {
                    const generationId = openRouterGenerationId;
                    if (generationId) {
                        for (let costAttempt = 0; costAttempt < 2; costAttempt++) {
                            try {
                                if (costAttempt > 0) await sleep(800);
                                const genRes = await fetch(
                                    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
                                    {
                                        headers: {
                                            "Authorization": `Bearer ${authKey}`,
                                            "HTTP-Referer": "https://metabayn.com",
                                            "X-Title": "Metabayn App"
                                        },
                                        signal: AbortSignal.timeout(4000)
                                    }
                                );
                                if (genRes.ok) {
                                    const genJson: any = await genRes.json().catch(() => null);
                                    const raw = genJson?.data?.total_cost ?? genJson?.total_cost ?? null;
                                    const parsed = Number(raw);
                                    if (Number.isFinite(parsed) && parsed > 0) {
                                        costUsdFromOpenRouter = parsed;
                                        costUsdSource = 'generation';
                                        break;
                                    }
                                }
                            } catch {}
                        }
                    }
                }

                // OpenRouter standard response matches OpenAI format
                content = data.choices[0].message.content;
                inputTokens = data.usage?.prompt_tokens || 0;
                outputTokens = data.usage?.completion_tokens || 0;

            } catch (e: any) {
                console.error(`[AI] OpenRouter Error: ${e.message}`);
                throw e;
            }
            
            // Success! Return result
            return { content, inputTokens, outputTokens, usedModel: currentModel, costUsdFromOpenRouter, costUsdSource, openRouterGenerationId, openRouterAttempts };

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
        const queueKey = isFreeUserModel ? 'openrouter_free' : 'default';
        result = await enqueue(aiTask, queueKey);
    } catch (e: any) {
        // Clean up error message for user
        const msg = e.message.replace("NON_RETRYABLE: ", "");
        const costUsd = Number(e?.metabayn?.cost_usd || 0);
        const costUsdSource = String(e?.metabayn?.cost_usd_source || 'none');
        const openRouterAttempts = Number(e?.metabayn?.openrouter_attempts || 0);
        return Response.json({ error: msg, metabayn: { cost_usd: costUsd, cost_usd_source: costUsdSource, openrouter_attempts: openRouterAttempts } }, { status: 502 });
    }

    const { content, inputTokens, outputTokens, usedModel, costUsdFromOpenRouter, costUsdSource, openRouterGenerationId, openRouterAttempts } = result;
    let promptTokensFinal = Number(inputTokens || 0);
    let completionTokensFinal = Number(outputTokens || 0);
    const isFreeModelUsed =
      (feature !== 'csv_fix') &&
      (isOpenRouterFreeModel(String(usedModel || '').trim()) || isOpenRouterFreeModel(String(userModel || '').trim()));

    // 5. Deduct Balance (Atomic Transaction)
    // Check if deduction is required based on Mode and Feature
    // Standard Mode (User API Key) = FREE (No deduction), EXCEPT for CSV Fix feature which always costs tokens.
    const shouldDeduct = resolveShouldDeductTokens(mode, feature) && !isFreeModelUsed;

    let costFinalUSD = 0;
    let deductAmount = 0;
    let updatedUserTokens = Number(user?.tokens ?? 0) || 0;
    let costUsdSourceFinal =
        isFreeModelUsed
            ? 'free_model'
            : shouldDeduct
            ? (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0
                ? costUsdSource
                : 'usage_pricing')
            : 'none';

    if (shouldDeduct) {
        if (typeof costUsdFromOpenRouter === 'number' && Number.isFinite(costUsdFromOpenRouter) && costUsdFromOpenRouter > 0) {
            costFinalUSD = costUsdFromOpenRouter;
        } else {
            const hasImage =
              !!image ||
              !!mimeType ||
              (Array.isArray(messages) &&
                messages.some((m: any) => {
                  const c: any = m?.content;
                  if (Array.isArray(c)) {
                    return c.some((p: any) => !!p?.image_url || p?.type === 'image_url' || p?.type === 'input_image');
                  }
                  if (c && typeof c === 'object') {
                    return !!c?.image_url || !!c?.image;
                  }
                  return false;
                }));

            if (promptTokensFinal + completionTokensFinal <= 0) {
              const baseText = (typeof prompt === 'string' && prompt.trim().length > 0)
                ? prompt
                : extractMessageText(messages);
              promptTokensFinal = estimateTokensFromText(String(baseText).slice(0, 20000));
              completionTokensFinal = estimateTokensFromText(String(content || '').slice(0, 20000));
            }

            try {
              costFinalUSD = await calculateOpenRouterCostUsd(
                userModel,
                usedModel,
                promptTokensFinal,
                completionTokensFinal,
                env,
                hasImage
              );
            } catch (e: any) {
              const pricingError = String(e?.message || e || 'OpenRouter pricing unavailable');
              await writeActivityLog(env, {
                userId,
                level: 'ERROR',
                message: `[RID:${requestId}] pricing_error model=${usedModel} reason=${pricingError}`,
                timestampMs: Date.now()
              }).catch(() => {});
              costFinalUSD = 0;
            }

            if (!(typeof costFinalUSD === 'number' && Number.isFinite(costFinalUSD) && costFinalUSD > 0)) {
              const fallbackModel = String(usedModel || userModel || '').trim() || 'default';
              const fallback = calculateTokenCost(fallbackModel, promptTokensFinal, completionTokensFinal, 1.0);
              if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
                costFinalUSD = fallback;
                costUsdSourceFinal = 'safe_pricing_fallback';
              } else {
                costFinalUSD =
                  (promptTokensFinal / 1_000_000) * 0.5 +
                  (completionTokensFinal / 1_000_000) * 1.5;
                if (!(Number.isFinite(costFinalUSD) && costFinalUSD > 0)) costFinalUSD = 0.0001;
                if (costFinalUSD < 0.0001) costFinalUSD = 0.0001;
                costUsdSourceFinal = 'emergency_fallback';
              }
            }
        }

        const now = new Date();
        const expiryStr = user?.subscription_expiry ? String(user.subscription_expiry) : null;
        let subscriptionValid = !!user?.subscription_active;
        if (subscriptionValid && expiryStr) {
            const expiryDate = new Date(expiryStr);
            if (!isNaN(expiryDate.getTime()) && expiryDate <= now) subscriptionValid = false;
        }

        const insufficientLogMessage =
            feature === 'csv_fix' && !subscriptionValid
                ? 'Generate CSV metadata Free user dibatalkan – saldo token kurang'
                : undefined;

        const idempotencyKey = openRouterGenerationId ? `ai:${userId}:${openRouterGenerationId}` : `ai:${userId}:${crypto.randomUUID()}`;
        await writeActivityLog(env, {
            userId,
            level: 'INFO',
            message: `[RID:${requestId}] debit_start mode=${mode} feature=${feature} before=${Number(user?.tokens ?? 0)} usd=${Number(costFinalUSD || 0).toFixed(6)} idempotency=${idempotencyKey}`,
            timestampMs: Date.now()
        }).catch(() => {});
        const charge = await chargeUserBalanceFromUsdCost(env, {
            userId,
            costUsd: costFinalUSD,
            reason: `usd=$${Number(costFinalUSD || 0).toFixed(6)}, model=${usedModel}`,
            insufficientLogMessage,
            insufficientErrorMessage: undefined,
            idempotencyKey,
            meta: {
              kind: 'ai_generate',
              user_model: userModel,
              used_model: usedModel,
              openrouter_generation_id: openRouterGenerationId || null,
              cost_usd: costFinalUSD,
              cost_usd_source: costUsdSourceFinal,
              request_id: requestId,
              prompt_tokens: promptTokensFinal,
              completion_tokens: completionTokensFinal
            }
        });

        if (!charge.ok) {
            await writeActivityLog(env, {
                userId,
                level: 'ERROR',
                message: `[RID:${requestId}] debit_failed mode=${mode} feature=${feature} reason=${String(charge.error || 'unknown')}`,
                timestampMs: Date.now()
            }).catch(() => {});
            return Response.json({ error: charge.error }, { status: charge.status || 402 });
        }

        deductAmount = Number(charge.tokensDeductedTenths) / 10;
        updatedUserTokens = Number(charge.userBalanceAfterTenths) / 10;
        await writeActivityLog(env, {
            userId,
            level: 'INFO',
            message: `[RID:${requestId}] debit_success mode=${mode} feature=${feature} deducted=${deductAmount} after=${updatedUserTokens}`,
            timestampMs: Date.now()
        }).catch(() => {});
    } else {
        console.log(`[AI] [RID:${requestId}] Standard Mode: Skipped token deduction for User ${userId}`);
    }

    // Record history with actual model used (and cost in USD for reporting)
    // We store cost in USD in the history table for financial tracking
    await recordTokenUsage(userId, userModel, usedModel, promptTokensFinal, completionTokensFinal, costFinalUSD, env);

    // 7. Response Ideal
    const url = new URL(req.url);
    if (url.pathname === '/v1/chat/completions') {
       return Response.json({
         id: `chatcmpl-${Date.now()}`,
         object: "chat.completion",
         created: Math.floor(Date.now() / 1000),
         model: usedModel,
         choices: [
           {
             index: 0,
             message: {
               role: "assistant",
               content: content
             },
             finish_reason: "stop"
           }
         ],
         usage: {
           prompt_tokens: promptTokensFinal,
           completion_tokens: completionTokensFinal,
           total_tokens: promptTokensFinal + completionTokensFinal
         },
         metabayn: {
           cost_usd: costFinalUSD,
           cost_usd_source: costUsdSourceFinal,
           tokens_deducted: deductAmount,
           user_balance_after: updatedUserTokens,
          actual_model_used: usedModel,
          request_id: requestId,
          openrouter_generation_id: openRouterGenerationId,
          openrouter_attempts: openRouterAttempts
         }
       }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({
      status: "success",
      model_chosen: userModel,
      model_used: usedModel,
      input_tokens: promptTokensFinal,
      output_tokens: completionTokensFinal,
      cost_usd: costFinalUSD,
      cost_usd_source: costUsdSourceFinal,
      tokens_deducted: deductAmount,
      user_balance_after: updatedUserTokens,
      request_id: requestId,
      openrouter_generation_id: openRouterGenerationId,
      openrouter_attempts: openRouterAttempts,
      result: content,
      metadata: {
        provider: 'openrouter',
        finish_reason: "stop"
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    if (lockId) releaseLock(userId, lockId);
  }
}


