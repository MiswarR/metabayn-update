import { Env } from '../types';
import { getTokenFromUSD, getLiveUsdRate } from '../utils/tokenTopup';
import { addUserTokens } from '../utils/userToken';
import { sendEmail, getTopupSuccessTemplate } from '../utils/email';

// --- PAYPAL HANDLERS (USD) ---

function normalizeEnvSecret(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function normalizePaypalCredential(value: string): string {
  return normalizeEnvSecret(value).replace(/\s+/g, '');
}

function getEnvString(env: any, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = env?.[key];
    if (typeof val === 'string') {
      const normalized = normalizeEnvSecret(val);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function getEnvStringWithKey(env: any, keys: string[]): { value: string; key: string } | undefined {
  for (const key of keys) {
    const val = env?.[key];
    if (typeof val === 'string') {
      const normalized = normalizeEnvSecret(val);
      if (normalized) return { value: normalized, key };
    }
  }
  return undefined;
}

function getPaypalMode(env: any): 'live' | 'sandbox' {
  const mode = (getEnvString(env, ['PAYPAL_MODE', 'PAYPAL_ENV']) || '').toLowerCase();
  if (mode === 'live' || mode === 'production') return 'live';
  return 'sandbox';
}

function resolvePaypalCredentialsForMode(env: any, mode: 'live' | 'sandbox'): { clientId: string; clientSecret: string; clientIdSource: string; clientSecretSource: string } {
  const idModeKeys = mode === 'live'
    ? ['PAYPAL_CLIENT_ID_LIVE', 'PAYPAL_LIVE_CLIENT_ID']
    : ['PAYPAL_CLIENT_ID_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_ID'];
  const secretModeKeys = mode === 'live'
    ? ['PAYPAL_CLIENT_SECRET_LIVE', 'PAYPAL_LIVE_CLIENT_SECRET']
    : ['PAYPAL_CLIENT_SECRET_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_SECRET'];

  const idGenericKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENTID'];
  const secretGenericKeys = ['PAYPAL_CLIENT_SECRET', 'PAYPAL_CLIENTSECRET'];

  const modeId = getEnvStringWithKey(env, idModeKeys);
  const modeSecret = getEnvStringWithKey(env, secretModeKeys);
  if (modeId?.value && modeSecret?.value) {
    return {
      clientId: normalizePaypalCredential(modeId.value),
      clientSecret: normalizePaypalCredential(modeSecret.value),
      clientIdSource: modeId.key,
      clientSecretSource: modeSecret.key
    };
  }

  const genericId = getEnvStringWithKey(env, idGenericKeys);
  const genericSecret = getEnvStringWithKey(env, secretGenericKeys);
  if (genericId?.value && genericSecret?.value) {
    return {
      clientId: normalizePaypalCredential(genericId.value),
      clientSecret: normalizePaypalCredential(genericSecret.value),
      clientIdSource: genericId.key,
      clientSecretSource: genericSecret.key
    };
  }

  const anyId = getEnvStringWithKey(env, [...idModeKeys, ...idGenericKeys]);
  const anySecret = getEnvStringWithKey(env, [...secretModeKeys, ...secretGenericKeys]);
  const missing = [
    !anyId?.value ? 'client_id' : null,
    !anySecret?.value ? 'client_secret' : null
  ].filter(Boolean).join(' & ');
  const hintMode = mode === 'live' ? 'live' : 'sandbox';
  throw new Error(`PayPal belum dikonfigurasi di server (${missing} kosong; mode=${hintMode})`);
}

function getPaypalBaseUrl(env: any): string {
  const mode = getPaypalMode(env);
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function readJsonSafe(res: Response): Promise<{ text: string; json: any | null }> {
  const text = await res.text().catch(() => '');
  if (!text) return { text: '', json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

async function insertBonusGrantForPaypalSubscription(
  env: Env,
  opts: { transactionId: string | number; userId: string; tokensAdded: number; expiresAtIso: string }
) {
  const n = Number(opts.tokensAdded);
  if (!Number.isFinite(n) || n <= 0) return;
  const expiresAtMs = new Date(String(opts.expiresAtIso || '')).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return;
  const amountTenths = Math.round(n * 10);
  const grantId = `grant_paypal_sub_${String(opts.transactionId)}`;
  const purchaseId = `paypal_subscription:${String(opts.transactionId)}`;
  const nowMs = Date.now();
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO bonus_token_grants (id, user_id, source, purchase_id, amount_tenths, remaining_tenths, expires_at, created_at, deleted_at) VALUES (?, ?, 'paypal_subscription', ?, ?, ?, ?, ?, NULL)"
    )
      .bind(grantId, String(opts.userId), purchaseId, amountTenths, amountTenths, expiresAtMs, nowMs)
      .run();
  } catch {}
}

async function getPaypalAccessToken(env: any): Promise<{ accessToken: string; baseUrl: string; mode: 'live' | 'sandbox'; switched: boolean }> {
  const configuredMode = getPaypalMode(env);
  const primaryBaseUrl = getPaypalBaseUrl(env);
  const secondaryBaseUrl = primaryBaseUrl.includes('sandbox')
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const tryFetch = async (baseUrl: string, creds: { clientId: string; clientSecret: string }) => {
    const auth = btoa(`${creds.clientId}:${creds.clientSecret}`);
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString()
    });
    const { text, json } = await readJsonSafe(tokenRes);
    return { tokenRes, text, json };
  };

  const primaryCreds = resolvePaypalCredentialsForMode(env, configuredMode);
  const primary = await tryFetch(primaryBaseUrl, primaryCreds);
  if (primary.tokenRes.ok && primary.json?.access_token) {
    return { accessToken: String(primary.json.access_token), baseUrl: primaryBaseUrl, mode: configuredMode, switched: false };
  }

  if (primary.tokenRes.status === 401) {
    const secondaryMode: 'live' | 'sandbox' = secondaryBaseUrl.includes('sandbox') ? 'sandbox' : 'live';
    let secondaryCreds = primaryCreds;
    try {
      secondaryCreds = resolvePaypalCredentialsForMode(env, secondaryMode);
    } catch {}
    const secondary = await tryFetch(secondaryBaseUrl, secondaryCreds);
    if (secondary.tokenRes.ok && secondary.json?.access_token) {
      return { accessToken: String(secondary.json.access_token), baseUrl: secondaryBaseUrl, mode: secondaryMode, switched: true };
    }
  }

  const err = primary.json?.error || undefined;
  const desc = primary.json?.error_description || undefined;
  const status = primary.tokenRes.status;
  const extra = [err, desc].filter(Boolean).join(': ');
  const detail = extra ? ` (${extra})` : '';
  const credHint = `mode=${configuredMode}, client_id_source=${primaryCreds.clientIdSource}, client_secret_source=${primaryCreds.clientSecretSource}, client_id_len=${primaryCreds.clientId.length}, client_secret_len=${primaryCreds.clientSecret.length}`;
  throw new Error(`Failed to authenticate with PayPal (HTTP ${status})${detail}; ${credHint}`);
}

export async function createPaypalPayment(request: Request, env: Env): Promise<Response> {
  try {
    // amount here implies USD
    const body = await request.json() as { amount: number, userId: string, type?: string, tokensPack?: number, duration?: number };
    const amount = body.amount;
    let userId = String(body.userId);
    // Ensure userId is clean string (remove .0 if present from potential float conversion)
    if (!isNaN(Number(userId)) && userId.includes('.')) {
        userId = userId.split('.')[0];
    }
    if (userId.includes('@')) {
        const userRow = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(userId).first();
        if (userRow && userRow.id) {
            userId = String(userRow.id);
        }
    }
    const type = body.type === 'subscription' ? 'subscription' : 'token';
    const tokensPack = Number(body.tokensPack || 0) || 0;
    const durationDays = Number(body.duration || 0) || (type === 'subscription' ? 30 : 0);
    
    if (!amount || !userId) {
      return Response.json({ error: "Missing amount or userId" }, { status: 400 });
    }

    const rateUsd = await getLiveUsdRate(env);
    // 2. Hitung Token (USD) khusus untuk top up token
    // NORMALISASI: jika tokensPack dikirim dari frontend, gunakan nilai tetap tersebut
    const tokenCalc = { totalTokens: 0 } as any;
    
    if (type === 'token') {
        tokenCalc.totalTokens = tokensPack > 0 ? tokensPack : getTokenFromUSD(amount, rateUsd).totalTokens;
    } else if (type === 'subscription') {
        // For subscriptions, tokensPack contains the bonus tokens
        tokenCalc.totalTokens = tokensPack;
    }
    
    // 3. Buat Transaksi Pending di DB
    const method = type === 'subscription' ? 'paypal_subscription' : 'paypal';
    const insertRes = await env.DB.prepare(
      "INSERT INTO topup_transactions (user_id, amount_usd, tokens_added, method, status, duration_days) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(userId, amount, tokenCalc.totalTokens, method, 'pending', durationDays).first();
    
    const transactionId = insertRes?.id;

    // 4. Panggil PayPal API (Real Implementation)
    const { accessToken, baseUrl, mode, switched } = await getPaypalAccessToken(env as any);

    const origin = new URL(request.url).origin;

    // 4.2. Create Order
    const orderPayload: any = {
        intent: 'CAPTURE',
        purchase_units: [{
            reference_id: String(transactionId),
            amount: { 
                currency_code: 'USD', 
                value: amount.toString(),
                breakdown: {
                    item_total: {
                        currency_code: 'USD',
                        value: amount.toString()
                    }
                }
            },
            description: type === 'subscription'
              ? `Metabayn API Subscription ${durationDays} Days`
              : `TopUp ${tokenCalc.totalTokens} Tokens (Metabayn)`,
            items: [{
                name: type === 'subscription' ? `Subscription ${durationDays} Days` : `${tokenCalc.totalTokens} Tokens`,
                unit_amount: {
                    currency_code: 'USD',
                    value: amount.toString()
                },
                quantity: "1",
                category: "DIGITAL_GOODS"
            }]
        }],
        payment_source: {
            paypal: {
                experience_context: {
                    brand_name: 'Metabayn App',
                    shipping_preference: 'NO_SHIPPING',
                    landing_page: 'LOGIN',
                    user_action: 'PAY_NOW',
                    return_url: `${origin}/payment/success`,
                    cancel_url: `${origin}/payment/cancel`
                }
            }
        }
    };

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${accessToken}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify(orderPayload)
    });

    if (!orderRes.ok) {
        const { text, json } = await readJsonSafe(orderRes);
        const name = json?.name ? String(json.name) : '';
        const message = json?.message ? String(json.message) : '';
        const details = Array.isArray(json?.details) ? json.details : [];
        const issue = details?.[0]?.issue ? String(details[0].issue) : '';
        const desc = details?.[0]?.description ? String(details[0].description) : '';
        const bits = [name, message, issue, desc].filter(Boolean).join(' | ');
        throw new Error(`Failed to create PayPal Order (HTTP ${orderRes.status})${bits ? `: ${bits}` : text ? `: ${text.substring(0, 160)}` : ''}`);
    }

    const orderData = await orderRes.json() as any;
    const paypalOrderId = orderData?.id;
    const links = Array.isArray(orderData?.links) ? orderData.links : [];
    const pickLink = (rel: string): string | undefined => {
      const hit = links.find((l: any) => String(l?.rel || '').toLowerCase() === rel && typeof l?.href === 'string' && l.href);
      return hit?.href;
    };

    let approveLink =
      pickLink('approve') ||
      pickLink('payer-action') ||
      pickLink('redirect') ||
      pickLink('checkout') ||
      undefined;

    // SAFETY: Ensure Sandbox URL is used in Sandbox Mode
    // FORCE Sandbox URL construction manually to be 100% sure
    if (mode !== 'live' && paypalOrderId) {
         approveLink = `https://www.sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`;
    }

    if (!approveLink && paypalOrderId) {
      approveLink = mode === 'live'
        ? `https://www.paypal.com/checkoutnow?token=${paypalOrderId}`
        : `https://www.sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`;
    }

    if (!approveLink) {
        const rels = links.map((l: any) => String(l?.rel || '').toLowerCase()).filter(Boolean).join(',');
        throw new Error(`No approval link returned from PayPal${paypalOrderId ? ` (order_id=${paypalOrderId})` : ''}${rels ? ` (rels=${rels})` : ''}`);
    }

    // Update payment_ref
    await env.DB.prepare("UPDATE topup_transactions SET payment_ref = ? WHERE id = ?")
      .bind(paypalOrderId, transactionId).run();

    return Response.json({
      status: "success",
      transactionId,
      tokensExpected: tokenCalc.totalTokens,
      paymentUrl: approveLink,
      type,
      debug_info: switched ? `Mode mismatch auto-fixed (${mode})` : (mode === 'live' ? "Live Mode" : "Sandbox Mode")
    });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function checkPaypalStatus(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { transactionId: number | string };
    const transactionId = body.transactionId;
    if (!transactionId) return Response.json({ error: "Missing transactionId" }, { status: 400 });

    // 1. Get Transaction from DB
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(transactionId).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });

    if (transaction.status === 'paid') {
        // For subscription payments, also return subscription info if available
        if (transaction.method === 'paypal_subscription') {
            const user = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?")
              .bind(transaction.user_id).first();
            return Response.json({
                status: 'paid',
                message: "Already paid",
                subscription_active: user?.subscription_active === 1,
                subscription_expiry: user?.subscription_expiry || null,
                tokens_added: transaction.tokens_added,
                type: 'subscription',
                duration_days: transaction.duration_days,
                amount_usd: transaction.amount_usd
            });
        }
        return Response.json({ 
            status: 'paid', 
            message: "Already paid",
            tokens_added: transaction.tokens_added,
            amount_usd: transaction.amount_usd,
            type: 'token'
        });
    }

    const orderId = transaction.payment_ref;
    if (!orderId) return Response.json({ error: "No PayPal Order ID found" }, { status: 400 });

    // 2. Auth PayPal
    const { accessToken, baseUrl } = await getPaypalAccessToken(env as any);

    // 3. Get Order Details
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!orderRes.ok) {
        const { text, json } = await readJsonSafe(orderRes);
        const name = json?.name ? String(json.name) : '';
        const message = json?.message ? String(json.message) : '';
        const bits = [name, message].filter(Boolean).join(' | ');
        throw new Error(`Failed to fetch PayPal Order (HTTP ${orderRes.status})${bits ? `: ${bits}` : text ? `: ${text.substring(0, 160)}` : ''}`);
    }
    
    const orderData = await orderRes.json() as any;
    const paypalStatus = orderData.status; // CREATED, APPROVED, COMPLETED

    const isSubscription = transaction.method === 'paypal_subscription';

    // 4. If APPROVED, Capture it!
    if (paypalStatus === 'APPROVED') {
        const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: '{}'
        });
        
        if (!captureRes.ok) {
             const errText = await captureRes.text();
             console.error("Capture Failed:", errText);
             return Response.json({ status: 'pending', paypal_status: 'CAPTURE_FAILED', error_details: errText.substring(0, 200) });
        }
        
        const captureData = await captureRes.json() as any;
        if (captureData.status === 'COMPLETED') {
            // Update Status & Tambah Token (Atomic Check)
            const amountPaid = parseFloat(captureData.purchase_units[0].payments.captures[0].amount.value);
            
            // ATOMIC UPDATE: Only update if status is currently 'pending'
            const updateRes = await env.DB.prepare("UPDATE topup_transactions SET status = 'paid', amount_usd = ? WHERE id = ? AND status = 'pending'")
                .bind(amountPaid, transactionId).run();
            
            // Initialize with transaction value so we return correct data even if update fails (race condition)
            let tokensAdded = (transaction.tokens_added as number) || 0;
            
            // Only add tokens/update subscription if WE were the ones who updated the status
            if (updateRes.meta.changes > 0) {
                if (tokensAdded > 0) {
                     await addUserTokens(transaction.user_id as string, tokensAdded, env, { logLabel: isSubscription ? 'Bonus langganan' : 'Top-up' });
                }

                if (isSubscription) {
                    let durationDays = Number(transaction.duration_days) || 30;
                    
                    // Update User Subscription
                    const currentUser = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(transaction.user_id).first();
                    if (!currentUser) throw new Error("User not found");
                    
                    let newExpiry = new Date();
                    if (currentUser.subscription_active && currentUser.subscription_expiry) {
                        const currentExpiry = new Date(currentUser.subscription_expiry as string);
                        if (currentExpiry > new Date()) {
                            newExpiry = currentExpiry;
                        }
                    }
                    newExpiry.setDate(newExpiry.getDate() + durationDays);
                    const newExpiryIso = newExpiry.toISOString();
                    
                    await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                      .bind(newExpiryIso, transaction.user_id).run();
                    await insertBonusGrantForPaypalSubscription(env, {
                      transactionId,
                      userId: String(transaction.user_id),
                      tokensAdded,
                      expiresAtIso: newExpiryIso
                    });

                    // Send Email
                    if (currentUser.email) {
                        const emailSubject = `Subscription Activated (${durationDays} Days)`;
                        const emailHtml = getSubscriptionSuccessTemplate(
                            amountPaid,
                            durationDays,
                            tokensAdded,
                            newExpiryIso,
                            'USD'
                        );
                        try {
                            await sendEmail(currentUser.email as string, emailSubject, emailHtml, env);
                        } catch (e) { console.error("Email error:", e); }
                    }
                    
                    return Response.json({
                        status: 'paid',
                        paypal_status: 'COMPLETED',
                        tokens_added: tokensAdded,
                        type: 'subscription',
                        duration_days: durationDays,
                        amount_usd: amountPaid,
                        subscription_active: true,
                        subscription_expiry: newExpiryIso
                    });
                }

                // Send Email Notification for Token Topup
                const userEmailRow = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
                if (userEmailRow && userEmailRow.email) {
                    const emailSubject = `Top Up Successful (${tokensAdded} Tokens)`;
                    const emailHtml = getTopupSuccessTemplate(
                        amountPaid,
                        tokensAdded,
                        'USD'
                    );
                    try {
                        await sendEmail(userEmailRow.email as string, emailSubject, emailHtml, env);
                    } catch (emailErr) {
                        console.error("Failed to send token topup email:", emailErr);
                    }
                }
            } else {
                // Transaction was already marked paid (Race Condition), fetch actual values
                const updatedTx = await env.DB.prepare("SELECT tokens_added, amount_usd FROM topup_transactions WHERE id = ?").bind(transactionId).first();
                if (updatedTx) {
                    tokensAdded = (updatedTx.tokens_added as number) || 0;
                    // amountPaid is already set from capture data, but we can use DB value too
                }
            }

            return Response.json({ 
                status: 'paid', 
                paypal_status: 'COMPLETED',
                tokens_added: tokensAdded,
                type: isSubscription ? 'subscription' : 'token',
                amount_usd: amountPaid
            });
        }
    } else if (paypalStatus === 'COMPLETED') {
         // ATOMIC UPDATE for COMPLETED status
         const updateRes = await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ? AND status = 'pending'")
            .bind(transactionId).run();

         let tokensAdded = (transaction.tokens_added as number) || 0;

         if (updateRes.meta.changes > 0) {
             if (isSubscription) {
                 let durationDays = Number(transaction.duration_days) || 30;
                 const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?")
                   .bind(transaction.user_id).first();
                 let newExpiryDate = new Date();
                 if (currentUser && currentUser.subscription_expiry) {
                     const currentExpiry = new Date(currentUser.subscription_expiry as string);
                     if (currentExpiry > new Date()) {
                         newExpiryDate = currentExpiry;
                     }
                 }
                 newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
                 const newExpiryIso = newExpiryDate.toISOString();

                 await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                   .bind(newExpiryIso, transaction.user_id).run();

                 // Add bonus tokens if any
                 if (tokensAdded > 0) {
                    await addUserTokens(transaction.user_id as string, tokensAdded, env, { logLabel: 'Bonus langganan' });
                    await insertBonusGrantForPaypalSubscription(env, {
                      transactionId,
                      userId: String(transaction.user_id),
                      tokensAdded,
                      expiresAtIso: newExpiryIso
                    });
                 }

                 // Send Email
                 const userEmailRow = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
                 if (userEmailRow && userEmailRow.email) {
                    const emailSubject = `Subscription Activated (${durationDays} Days)`;
                    const emailHtml = getSubscriptionSuccessTemplate(
                        0, 
                        durationDays, 
                        tokensAdded, 
                        newExpiryIso, 
                        'USD'
                    );
                    try {
                        await sendEmail(userEmailRow.email as string, emailSubject, emailHtml, env);
                    } catch (e) { console.error("Email error:", e); }
                 }
                 
                return Response.json({
                    status: 'paid',
                    paypal_status: 'COMPLETED',
                    type: 'subscription',
                    subscription_active: true,
                    subscription_expiry: newExpiryIso,
                    tokens_added: tokensAdded,
                    amount_usd: transaction.amount_usd,
                    duration_days: durationDays
                });
             }

             // Standard Token Add
             await addUserTokens(transaction.user_id as string, tokensAdded, env, { logLabel: 'Top-up' });

             const userEmailRow = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
             if (userEmailRow && userEmailRow.email) {
                const emailSubject = `Top Up Successful (${tokensAdded} Tokens)`;
                const emailHtml = getTopupSuccessTemplate(
                    Number(transaction.amount_usd || 0),
                    tokensAdded,
                    'USD'
                );
                try {
                    await sendEmail(userEmailRow.email as string, emailSubject, emailHtml, env);
                } catch (emailErr) {
                    console.error("Failed to send token topup email:", emailErr);
                }
             }
         }
         
         return Response.json({ 
             status: 'paid', 
             paypal_status: 'COMPLETED',
             tokens_added: tokensAdded,
             amount_usd: transaction.amount_usd
         });
    }

    return Response.json({ status: transaction.status, paypal_status: paypalStatus });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function checkLastLynkIdTransaction(request: Request, userId: string, env: Env): Promise<Response> {
    try {
        const body = await request.json() as any;
        const amountIdr = (body as any).amount_idr ?? (body as any).amountIdr;
        const productType =
          (body as any).productType === 'subscription'
            ? 'subscription'
            : (body as any).productType === 'token'
              ? 'token'
              : undefined;
        
        // We use a generous lookback window instead of strict client-provided 'since'
        // This solves the clock skew issue completely.
        const nowMs = Date.now();
        const lookbackWindowMs = 24 * 60 * 60 * 1000;
        const sinceCandidate = typeof body?.since === 'number' && Number.isFinite(body.since) && body.since > 0 ? body.since : null;
        const effectiveSinceMs =
          sinceCandidate && sinceCandidate <= nowMs + 5 * 60 * 1000
            ? Math.max(nowMs - lookbackWindowMs, sinceCandidate - 10 * 60 * 1000)
            : (nowMs - lookbackWindowMs);
        const sinceDate = new Date(effectiveSinceMs).toISOString();
        const createdAtExpr = `(CASE WHEN typeof(created_at) = 'integer' THEN datetime(created_at, 'unixepoch') ELSE datetime(created_at) END)`;

        // Query builder
        let query = `
            SELECT * FROM topup_transactions 
            WHERE user_id = ? 
            AND method = 'lynkid' 
            AND status = 'paid' 
            AND ${createdAtExpr} >= datetime(?) 
        `;
        const params: any[] = [userId, sinceDate];

        if (productType === 'subscription') {
            query += ` AND CAST(COALESCE(duration_days, 0) AS INTEGER) > 0 `;
        } else if (productType === 'token') {
            query += ` AND CAST(COALESCE(duration_days, 0) AS INTEGER) = 0 `;
        }

        // Optional: Filter by amount if provided (improves accuracy)
        // DISABLED PER USER REQUEST: "jika anda deteksi jumlah total pembelian maka jangan gunakan"
        /*
        if (amountIdr && amountIdr > 0) {
            // Allow larger margin (e.g. 25k) to accommodate larger fees or tax differences
            // Lynk.id might deduct significant fees before settling.
            query += ` AND (amount_rp = ? OR ABS(amount_rp - ?) < 25000) `;
            params.push(amountIdr, amountIdr);
        }
        */

        query += ` ORDER BY ${createdAtExpr} DESC LIMIT 1`;

        const transaction = await env.DB.prepare(query).bind(...params).first();

        if (transaction) {
            await applyLynkIdTransactionToUser(env, userId, transaction);
        }

        if (!transaction) {
            // Fallback: Try searching by email if user_id lookup failed in voucher handler
            // This handles cases where voucher.ts inserted 'email:user@example.com'
            const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
            if (user && user.email) {
                 let emailQuery = `
                    SELECT * FROM topup_transactions 
                    WHERE user_id = ? 
                    AND method = 'lynkid' 
                    AND status = 'paid' 
                    AND ${createdAtExpr} >= datetime(?) 
                `;
                const emailParams: any[] = [`email:${user.email}`, sinceDate];

                /*
                if (amountIdr && amountIdr > 0) {
                    emailQuery += ` AND (amount_rp = ? OR ABS(amount_rp - ?) < 25000) `;
                    emailParams.push(amountIdr, amountIdr);
                }
                */
                emailQuery += ` ORDER BY ${createdAtExpr} DESC LIMIT 1`;
                
                const txByEmail = await env.DB.prepare(emailQuery).bind(...emailParams).first();
                if (txByEmail) {
                    await applyLynkIdTransactionToUser(env, userId, txByEmail);

                    await env.DB.prepare("UPDATE topup_transactions SET user_id = ? WHERE id = ? AND user_id = ?")
                      .bind(userId, txByEmail.id, `email:${user.email}`).run();

                    return await formatLynkIdResponse(txByEmail, env, userId);
                }
            }

            return Response.json({ status: 'pending', server_time: Date.now() });
        }

        return await formatLynkIdResponse(transaction, env, userId);

    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

async function applyLynkIdTransactionToUser(env: Env, userId: string, transaction: any): Promise<{ applied: boolean }> {
    const stableId = transaction?.payment_ref ? String(transaction.payment_ref) : String(transaction?.id || '');

    const tokensToAdd = Number(transaction?.tokens_added || 0) || 0;
    const durationDays = Number(transaction?.duration_days || 0) || 0;

    if (tokensToAdd > 0) {
        await addUserTokens(String(userId), tokensToAdd, env, {
            logLabel: 'Top-up',
            reason: stableId ? `Lynk.id ${stableId}` : 'Lynk.id',
            idempotencyKey: stableId ? `lynkid:${stableId}:tokens` : `lynkid:${String(transaction?.id || '')}:tokens`
        });
    }

    if (durationDays > 0) {
        const markerKey = stableId ? `lynkid_sub_applied:${stableId}` : `lynkid_sub_applied_id:${String(transaction?.id || '')}`;
        const claimed = await env.DB.prepare("INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)")
          .bind(markerKey, new Date().toISOString()).run();
        if (!(claimed?.meta?.changes > 0)) return { applied: tokensToAdd > 0 };

        const currentUser = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(userId).first();
        let newExpiryDate = new Date();
        if (currentUser?.subscription_expiry) {
            const currentExpiry = new Date(currentUser.subscription_expiry as string);
            if (currentExpiry > new Date()) {
                newExpiryDate = currentExpiry;
            }
        }
        newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
        const newExpiryIso = newExpiryDate.toISOString();
        await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
          .bind(newExpiryIso, userId).run();
    }

    return { applied: tokensToAdd > 0 || durationDays > 0 };
}

async function formatLynkIdResponse(transaction: any, env: Env, userId?: string) {
        const durationDays = Number(transaction?.duration_days || 0) || 0;
        const isSubscription = durationDays > 0;
        let subscriptionExpiry: string | undefined = undefined;

        if (isSubscription && userId) {
            try {
                const user: any = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(userId).first();
                if (user?.subscription_expiry) subscriptionExpiry = String(user.subscription_expiry);
            } catch {}
        }
        
        return Response.json({
            status: 'paid',
            method: 'lynkid',
            id: transaction.id,
            tokens_added: transaction.tokens_added || 0,
            amount_rp: transaction.amount_rp || 0,
            type: isSubscription ? 'subscription' : 'token',
            duration_days: durationDays,
            created_at: transaction.created_at,
            server_time: Date.now(),
            subscription_expiry: subscriptionExpiry
        });
}

export async function handlePaypalWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // 1. SECURITY CHECK (Signature Verification)
    // In production, you MUST verify the PayPal signature header to ensure the request comes from PayPal.
    // See: https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
    
    // For now, we rely on the unique 'payment_ref' (Order ID) being present and in 'pending' status in our DB.
    // An attacker cannot easily guess a valid, pending Order ID.
    
    const data = await request.json() as any;
    
    const eventType = typeof data?.event_type === 'string' ? data.event_type : '';
    const resource = data?.resource || {};

    const captureId = typeof resource?.id === 'string' ? resource.id : undefined;
    const orderIdFromCapture = resource?.supplementary_data?.related_ids?.order_id;
    const orderId =
      (typeof orderIdFromCapture === 'string' && orderIdFromCapture) ||
      (eventType.startsWith('CHECKOUT.ORDER.') && typeof resource?.id === 'string' ? resource.id : undefined);

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'CHECKOUT.ORDER.COMPLETED') {
        const amountPaid = parseFloat(resource?.amount?.value);
        const refCandidates = [orderId, captureId].filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (!Number.isFinite(amountPaid) || amountPaid <= 0 || refCandidates.length === 0) {
            return Response.json({ status: "ignored", message: "Missing reference or amount" });
        }
        
        // 3. Cari Transaksi
        const placeholders = refCandidates.map(() => '?').join(', ');
        const transaction = await env.DB.prepare(`SELECT * FROM topup_transactions WHERE payment_ref IN (${placeholders})`)
          .bind(...refCandidates).first();
        
        if (transaction && transaction.status === 'pending') {
            // Verify amount logic (Optional but recommended)
            // if (Math.abs(amountPaid - (transaction.amount_usd as number)) > 0.1) ...

            // 4. Update Status & Tambah Token (ATOMIC)
            // Hanya update jika status masih 'pending'. Ini mencegah race condition dengan checkPaypalStatus
            const updateRes = await env.DB.prepare("UPDATE topup_transactions SET status = 'paid', amount_usd = ? WHERE id = ? AND status = 'pending'")
                .bind(amountPaid, transaction.id).run();

            // Jika tidak ada baris yang diupdate (karena status sudah 'paid' oleh checkPaypalStatus), kita berhenti di sini
            if (updateRes.meta.changes === 0) {
                 return Response.json({ status: "ignored", message: "Transaction already processed by client polling" });
            }

            if (transaction.method === 'paypal_subscription') {
                let durationDays = Number(transaction.duration_days) || 30;
                const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry, email FROM users WHERE id = ?")
                  .bind(transaction.user_id).first();

                let newExpiryDate = new Date();
                if (currentUser && currentUser.subscription_expiry) {
                    const currentExpiry = new Date(currentUser.subscription_expiry as string);
                    if (currentExpiry > new Date()) {
                        newExpiryDate = currentExpiry;
                    }
                }
                newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
                const newExpiryIso = newExpiryDate.toISOString();

                await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                  .bind(newExpiryIso, transaction.user_id).run();

                // Add bonus tokens if any
                if (transaction.tokens_added && (transaction.tokens_added as number) > 0) {
                    const bonus = transaction.tokens_added as number;
                    await addUserTokens(transaction.user_id as string, bonus, env, { logLabel: 'Bonus langganan' });
                    await insertBonusGrantForPaypalSubscription(env, {
                      transactionId: String(transaction.id),
                      userId: String(transaction.user_id),
                      tokensAdded: bonus,
                      expiresAtIso: newExpiryIso
                    });
                }

                // Send Email Notification (Webhook)
                if (currentUser && currentUser.email) {
                    const emailSubject = `Subscription Activated (${durationDays} Days)`;
                    const emailHtml = getSubscriptionSuccessTemplate(
                        amountPaid, 
                        durationDays, 
                        transaction.tokens_added as number || 0, 
                        newExpiryIso, 
                        'USD'
                    );
                    try {
                        await sendEmail(currentUser.email as string, emailSubject, emailHtml, env);
                    } catch (e) { console.error("Webhook Email error:", e); }
                }

                return Response.json({
                    status: "success",
                    method: "paypal_subscription",
                    amount_usd: amountPaid,
                    subscription_active: true,
                    subscription_expiry: newExpiryIso,
                    tokens_added: transaction.tokens_added
                });
            }

            const newBalance = await addUserTokens(transaction.user_id as string, transaction.tokens_added as number, env, { logLabel: 'Top-up' });
            
            const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
            if (user && user.email) {
                const html = getTopupSuccessTemplate(amountPaid, transaction.tokens_added as number, 'USD');
                try {
                    await sendEmail(user.email as string, "Top Up Successful!", html, env);
                } catch (e) {
                    console.error("Webhook Email error:", e);
                }
            }

            return Response.json({ 
                status: "success", 
                method: "paypal",
                amount_usd: amountPaid,
                tokens_added: transaction.tokens_added,
                new_balance: newBalance
            });
        }
    }
    
    return Response.json({ status: "ignored" });

  } catch (e: any) {
    console.error("PayPal Webhook Error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function paymentSuccessPage(_req: Request, _env: Env): Promise<Response> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#4caf50;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}</script></head><body><div class="box"><h1>Payment Successful</h1><p>You can close this tab and return to the app.</p><p>If your balance has not updated yet, the app will check automatically.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export async function paymentCancelPage(_req: Request, _env: Env): Promise<Response> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Cancelled</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#ff7043;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}</script></head><body><div class="box"><h1>Payment Cancelled</h1><p>The transaction was not completed. You can close this tab and return to the app.</p><p>If you encounter issues with your payment, please contact the admin via WhatsApp at <a class="link" href="https://wa.me/628996701661" target="_blank" rel="noopener">+62 899 6701 661</a>.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// Helper: Subscription Email Template
function getSubscriptionSuccessTemplate(amount: number, durationDays: number, tokensAdded: number, newExpiryDate: string, currency: 'IDR' | 'USD' = 'IDR') {
    const formattedAmount = currency === 'IDR' 
        ? `Rp ${amount.toLocaleString('id-ID')}`
        : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const formattedDate = new Date(newExpiryDate).toLocaleDateString('en-US', { 
        year: 'numeric', month: 'long', day: 'numeric' 
    });

    return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Subscription Activated</h2>
        </div>
        <p>Hello,</p>
        <p>We have received your payment${amount > 0 ? ` of <strong>${formattedAmount}</strong>` : ''}.</p>
        
        <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin: 15px 0;">
            <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin-bottom: 8px;">Subscription: <strong>${durationDays} Days</strong></li>
                <li style="margin-bottom: 8px;">Bonus Tokens: <strong>${tokensAdded.toLocaleString()} Tokens</strong></li>
                <li>Valid Until: <strong>${formattedDate}</strong></li>
            </ul>
        </div>

        <p>Your subscription is now active. You can enjoy premium features and your bonus tokens have been added to your balance.</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply.<br>
            For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

// --- QRIS HANDLERS (IDR) ---

export async function createQrisPayment(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}

export async function checkQrisStatus(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}

export async function handleQrisCallback(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}
