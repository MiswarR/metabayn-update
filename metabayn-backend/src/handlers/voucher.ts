
import { Env } from '../types';
import { getWelcomeVoucherTemplate, getPurchaseVoucherTemplate, sendEmail, getWelcomeDualVoucherTemplate, getLicenseVoucherTemplate, getTopupSuccessTemplate, getSubscriptionSuccessTemplate } from '../utils/email';
import { addUserTokens } from '../utils/userToken';

// --- VOUCHER PACKAGES CONFIGURATION (SMART RANGES) ---
// Define min/max price ranges to handle:
// 1. Admin Fees (e.g., Price 20k becomes 24k paid)
// 2. Discounts (e.g., Price 20k becomes 15k paid)
// 3. App Purchase detection (Specific range for App License)


// Admin: List Vouchers
export async function handleListVouchers(_req: Request, env: Env) {
  // 1. Lazy Cleanup: Delete vouchers expired more than 7 days ago
  // We also need to delete associated claims to prevent FK violations (if enforced) or just for cleanup
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // Find codes to delete (optional, but safer if we need to delete claims first)
    // For performance, we can just run delete query if FKs are not strict or configured to cascade
    // But D1/SQLite default FK is often OFF or RESTRICT. Safest is to delete claims first.
    
    // Get codes that are really old
    const oldVouchers = await env.DB.prepare("SELECT code FROM vouchers WHERE expires_at IS NOT NULL AND expires_at < ?").bind(sevenDaysAgo).all();
    
    if (oldVouchers.results && oldVouchers.results.length > 0) {
      const codes = oldVouchers.results.map((v: any) => v.code);
      const placeholders = codes.map(() => '?').join(',');
      
      // Delete claims first
      await env.DB.prepare(`DELETE FROM voucher_claims WHERE voucher_code IN (${placeholders})`).bind(...codes).run();
      
      // Delete vouchers
      await env.DB.prepare(`DELETE FROM vouchers WHERE code IN (${placeholders})`).bind(...codes).run();
      
      console.log(`Cleaned up ${codes.length} expired vouchers`);
    }
  } catch (e) {
    console.error("Auto-cleanup error:", e);
    // Continue listing even if cleanup fails
  }

  const vouchers = await env.DB.prepare("SELECT * FROM vouchers ORDER BY created_at DESC").all();
  return Response.json(vouchers.results);
}

// Admin: Extend Voucher
export async function handleExtendVoucher(req: Request, env: Env) {
  try {
    const body: any = await req.json();
    let { code, days } = body;

    if (!code || !days) {
      return Response.json({ error: "Missing code or days" }, { status: 400 });
    }
    
    // Normalize code
    code = code.toUpperCase().trim();

    const daysInt = parseInt(days);
    if (isNaN(daysInt) || daysInt < 1) {
        return Response.json({ error: "Invalid days value" }, { status: 400 });
    }

    const voucher = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(code).first();
    if (!voucher) {
      return Response.json({ error: "Voucher not found" }, { status: 404 });
    }

    // Calculate new expiry: max(now, current_expiry) + days
    const now = new Date();
    let baseDate = now;
    
    if (voucher.expires_at) {
        const currentExpiry = new Date(voucher.expires_at as string);
        // If current expiry is in the future, we extend FROM that future date
        // If it's in the past (expired), we extend from NOW to make it valid again
        if (currentExpiry > now) {
            baseDate = currentExpiry;
        }
    }

    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + daysInt);
    const newExpiryIso = newExpiry.toISOString();

    await env.DB.prepare("UPDATE vouchers SET expires_at = ? WHERE code = ?").bind(newExpiryIso, code).run();

    return Response.json({ success: true, message: `Voucher extended until ${newExpiryIso}`, new_expiry: newExpiryIso });
  } catch (e: any) {
    return Response.json({ error: "Extend Error: " + e.message }, { status: 500 });
  }
}

// Admin: Create Voucher
export async function handleCreateVoucher(req: Request, env: Env) {
  const body: any = await req.json();
  const { code, amount, max_usage, expires_at, allowed_emails, type, duration_days } = body;

  if (!code) {
    return Response.json({ error: "Missing voucher code" }, { status: 400 });
  }

  // Validation based on type
  const voucherType = String(type || 'token').trim() || 'token';
  const hasAmount = amount !== undefined && amount !== null && String(amount).trim() !== '';
  const hasDuration = duration_days !== undefined && duration_days !== null && String(duration_days).trim() !== '';

  let finalAmount = 0;
  let finalDurationDays = 0;

  if (voucherType === 'token') {
      const n = Number(amount);
      if (!hasAmount || !Number.isFinite(n) || n < 1) {
          return Response.json({ error: "Amount is required for token vouchers" }, { status: 400 });
      }
      finalAmount = n;
  } else if (voucherType === 'subscription') {
      const d = Number(duration_days);
      if (!hasDuration || !Number.isFinite(d) || d < 1) {
          return Response.json({ error: "Duration is required for subscription vouchers" }, { status: 400 });
      }
      finalDurationDays = d;
  } else if (voucherType === 'license') {
      const n = hasAmount ? Number(amount) : 50000;
      const d = hasDuration ? Number(duration_days) : 30;
      if (!Number.isFinite(n) || n < 1) {
          return Response.json({ error: "Invalid amount for license vouchers" }, { status: 400 });
      }
      if (!Number.isFinite(d) || d < 1) {
          return Response.json({ error: "Invalid duration for license vouchers" }, { status: 400 });
      }
      finalAmount = n;
      finalDurationDays = d;
  } else {
      return Response.json({ error: "Invalid voucher type" }, { status: 400 });
  }

  try {
    // allowed_emails: "email1@a.com, email2@b.com" -> store as string
    await env.DB.prepare(
      "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)"
    ).bind(
      code.toUpperCase(), 
      finalAmount || 0, 
      max_usage || 0, 
      expires_at || null, 
      allowed_emails || null, 
      voucherType,
      finalDurationDays || 0,
      new Date().toISOString()
    ).run();

    return Response.json({ success: true, message: "Voucher created" });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// Admin: Bulk Create Vouchers
export async function handleBulkCreateVouchers(req: Request, env: Env) {
  const body: any = await req.json();
  const { amount, quantity, max_usage, expires_at, type, duration_days } = body;

  // Validation
  const voucherType = String(type || 'token').trim() || 'token';
  const hasAmount = amount !== undefined && amount !== null && String(amount).trim() !== '';
  const hasDuration = duration_days !== undefined && duration_days !== null && String(duration_days).trim() !== '';

  let finalAmount = 0;
  let finalDurationDays = 0;

  if (voucherType === 'token') {
      const n = Number(amount);
      if (!hasAmount || !Number.isFinite(n) || n < 1) {
          return Response.json({ error: "Invalid amount for token vouchers" }, { status: 400 });
      }
      finalAmount = n;
  } else if (voucherType === 'subscription') {
      const d = Number(duration_days);
      if (!hasDuration || !Number.isFinite(d) || d < 1) {
          return Response.json({ error: "Invalid duration for subscription vouchers" }, { status: 400 });
      }
      finalDurationDays = d;
  } else if (voucherType === 'license') {
      const n = hasAmount ? Number(amount) : 50000;
      const d = hasDuration ? Number(duration_days) : 30;
      if (!Number.isFinite(n) || n < 1) {
          return Response.json({ error: "Invalid amount for license vouchers" }, { status: 400 });
      }
      if (!Number.isFinite(d) || d < 1) {
          return Response.json({ error: "Invalid duration for license vouchers" }, { status: 400 });
      }
      finalAmount = n;
      finalDurationDays = d;
  } else {
      return Response.json({ error: "Invalid voucher type" }, { status: 400 });
  }

  if (!quantity || quantity < 1) {
    return Response.json({ error: "Invalid quantity" }, { status: 400 });
  }

  // Helper to generate 6-char random alphanumeric code
  const generateCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    const randomValues = new Uint8Array(6);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 6; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    return result;
  };

  const generatedCodes: string[] = [];
  const stmts: any[] = [];
  const createdAt = new Date().toISOString();

  // Limit quantity to prevent timeout/abuse (e.g. max 500 per request)
  const safeQuantity = Math.min(quantity, 500);

  for (let i = 0; i < safeQuantity; i++) {
    const code = generateCode();
    generatedCodes.push(code);
    stmts.push(
      env.DB.prepare(
        "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)"
      ).bind(
          code, 
          finalAmount || 0, 
          max_usage || 1, 
          expires_at || null, 
          voucherType,
          finalDurationDays || 0,
          createdAt
      )
    );
  }

  try {
    // Execute in batches of 50 to respect D1 limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const batch = stmts.slice(i, i + BATCH_SIZE);
      await env.DB.batch(batch);
    }

    return Response.json({ 
      success: true, 
      message: `${safeQuantity} vouchers created successfully`,
      codes: generatedCodes 
    });
  } catch (e: any) {
    // If collision occurs (rare but possible), it might fail. 
    // Ideally we should handle it, but for simplicity we return error.
    return Response.json({ error: "Failed to create vouchers (Code collision or DB error). Try again." + e.message }, { status: 500 });
  }
}

// Admin: Delete Voucher
export async function handleDeleteVoucher(req: Request, env: Env) {
  const body: any = await req.json();
  const { id } = body;
  await env.DB.prepare("DELETE FROM vouchers WHERE id = ?").bind(id).run();
  return Response.json({ success: true });
}

// User: Redeem (Updated)
export async function handleRedeemVoucher(req: Request, env: Env, authUserId?: string | number) {
  const body: any = await req.json();
  const { userId, code, deviceHash } = body;
  await ensureVoucherTables(env);

  if (!userId || !code || !deviceHash) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  if (authUserId != null && String(userId) !== String(authUserId)) {
    return Response.json({ error: "User tidak valid", error_code: "user_mismatch" }, { status: 403 });
  }

  const voucherCode = code.toUpperCase().trim();

  const globalClaim: any = await env.DB.prepare("SELECT user_id FROM voucher_claims WHERE voucher_code = ? LIMIT 1")
    .bind(voucherCode).first();
  if (globalClaim) {
    const claimedBy = String(globalClaim.user_id || '');
    if (claimedBy && claimedBy === String(userId)) {
      return Response.json({ error: "Anda sudah pernah menggunakan voucher ini", error_code: "already_redeemed_by_you" }, { status: 409 });
    }
    return Response.json({ error: "Voucher sudah digunakan", error_code: "already_redeemed" }, { status: 409 });
  }

  // 1. Check Voucher Validity
  const voucher = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(voucherCode).first();
  if (!voucher) {
    return Response.json({ error: "Kode voucher tidak valid", error_code: "invalid_voucher_code" }, { status: 404 });
  }

  // Check Expiry
  if (voucher.expires_at) {
      const now = new Date();
      const expiry = new Date(voucher.expires_at as string);
      if (now > expiry) {
          return Response.json({ error: "Voucher sudah kadaluarsa", error_code: "expired" }, { status: 410 });
      }
  }

  // Check Usage Limit
  const maxUsage = voucher.max_usage as number;
  const currentUsage = voucher.current_usage as number;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ error: "Voucher sudah digunakan", error_code: "already_redeemed" }, { status: 410 });
  }

  // Check Whitelist (Allowed Emails)
  if (voucher.allowed_emails) {
      const allowedList = (voucher.allowed_emails as string).split(',').map(s => s.trim().toLowerCase());
      // Need user email. Get from DB or Token (if passed in context, but here we only have userId in body)
      // We should fetch user email from DB to be safe
      const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
      if (!user || !allowedList.includes((user.email as string).toLowerCase())) {
          return Response.json({ error: "Voucher ini tidak berlaku untuk akun Anda", error_code: "not_allowed" }, { status: 403 });
      }
  }

  // 2. Check if USER already claimed THIS voucher
  const userClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE user_id = ? AND voucher_code = ?")
    .bind(userId, voucherCode).first();
  
  if (userClaim) {
    return Response.json({ error: "Anda sudah pernah menggunakan voucher ini", error_code: "already_redeemed_by_you" }, { status: 409 });
  }

  // 3. Check if DEVICE already claimed THIS voucher (Anti-Tuyul)
  const deviceClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE device_hash = ? AND voucher_code = ?")
    .bind(deviceHash, voucherCode).first();

  if (deviceClaim) {
    return Response.json({ error: "Perangkat ini sudah pernah menggunakan voucher ini", error_code: "already_redeemed_by_device" }, { status: 403 });
  }

  // 4. EXECUTE REDEMPTION (Atomic Transaction using Batch)
  try {
    try {
      await env.DB.prepare(
        `
        CREATE TABLE IF NOT EXISTS bonus_token_grants (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source TEXT NOT NULL,
          purchase_id TEXT UNIQUE,
          amount_tenths INTEGER NOT NULL,
          remaining_tenths INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        `
      ).run();
    } catch {}

    const userUpdateStmts: any[] = [];
    let successMessage = "";
    let responseData: any = {};

    if (voucher.type === 'subscription') {
        // --- SUBSCRIPTION LOGIC ---
        let durationDays = Number(voucher.duration_days);
        if (isNaN(durationDays) || durationDays < 1) durationDays = 30;
        
        // Get current user subscription status to determine start date
        const currentUser = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(userId).first();
        
        let newExpiryDate = new Date();
        if (currentUser && currentUser.subscription_expiry) {
            const currentExpiry = new Date(currentUser.subscription_expiry as string);
            // If current expiry is in the future, extend from there
            if (currentExpiry > new Date()) {
                newExpiryDate = currentExpiry;
            }
        }
        
        // Add duration
        newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
        const newExpiryIso = newExpiryDate.toISOString();

        userUpdateStmts.push(
            env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                .bind(newExpiryIso, userId)
        );

        successMessage = `Subscription activated! Valid until ${newExpiryDate.toLocaleDateString()}`;
        responseData = { subscription_active: true, subscription_expiry: newExpiryIso };

    } else if (voucher.type === 'license') {
        let durationDays = Number(voucher.duration_days);
        if (isNaN(durationDays) || durationDays < 1) durationDays = 30;

        let bonusTokens = Number(voucher.amount);
        if (isNaN(bonusTokens) || bonusTokens < 1) bonusTokens = 50000;

        const currentUser = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(userId).first();
        let newExpiryDate = new Date();
        if (currentUser && currentUser.subscription_expiry) {
            const currentExpiry = new Date(currentUser.subscription_expiry as string);
            if (currentExpiry > new Date()) {
                newExpiryDate = currentExpiry;
            }
        }
        newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
        const newExpiryIso = newExpiryDate.toISOString();

        const expiresAtMs = new Date(newExpiryIso).getTime();
        const nowMs = Date.now();
        const amountTenths = Math.round(bonusTokens * 10);
        const grantId = `grant_${crypto.randomUUID()}`;
        const purchaseId = `voucher:${voucherCode}:${userId}`;

        userUpdateStmts.push(
            env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                .bind(newExpiryIso, userId),
            env.DB.prepare("UPDATE users SET tokens = COALESCE(tokens, 0) + ? WHERE id = ?").bind(bonusTokens, userId),
            env.DB.prepare(
              "INSERT OR IGNORE INTO bonus_token_grants (id, user_id, source, purchase_id, amount_tenths, remaining_tenths, expires_at, created_at, deleted_at) VALUES (?, ?, 'voucher_license', ?, ?, ?, ?, ?, NULL)"
            ).bind(grantId, userId, purchaseId, amountTenths, amountTenths, expiresAtMs, nowMs)
        );

        successMessage = `License activated! Valid until ${newExpiryDate.toLocaleDateString()} and ${bonusTokens.toLocaleString()} bonus tokens added.`;
        responseData = { subscription_active: true, subscription_expiry: newExpiryIso, bonus_tokens_added: bonusTokens };
    } else {
        // --- TOKEN LOGIC (Default) ---
        userUpdateStmts.push(
            // Use COALESCE to handle case where tokens might be NULL (legacy users)
            env.DB.prepare("UPDATE users SET tokens = COALESCE(tokens, 0) + ? WHERE id = ?").bind(voucher.amount, userId)
        );
        successMessage = `Voucher redeemed! ${voucher.amount} tokens added.`;
        responseData = { amount_added: voucher.amount };
    }

    const stmts: any[] = [
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode),
      ...userUpdateStmts
    ];

    await env.DB.batch(stmts);

    // 5. Auto-Delete if Max Usage Reached
    // User Requirement: "setiap kode voucher yang maksimal usage nya terpenuhi maka otomatis terhapus"
    // "tidak mempengaruhi token user" -> We already updated user tokens in the batch above.
    
    // We check if the NEW usage matches Max Usage.
    // currentUsage (from DB select) was before increment. So new usage is currentUsage + 1.
    if (maxUsage > 0 && (currentUsage + 1) >= maxUsage) {
       await env.DB.prepare("DELETE FROM vouchers WHERE code = ?").bind(voucherCode).run();
       console.log(`Voucher ${voucherCode} auto-deleted (Max usage reached)`);
    }

    return Response.json({ 
        success: true, 
        message: successMessage,
        ...responseData
    });

  } catch (e: any) {
    console.error("Voucher Redeem Error:", e);
    // If batch fails, none of the changes are applied (D1 batch is atomic)
    return Response.json({ error: "Gagal redeem voucher. Silakan coba lagi.", error_code: "redeem_failed" }, { status: 500 });
  }
}

export async function handleLynkIdWebhook(req: Request, env: Env) {
  const hasEmailProvider = !!String((env as any)?.RESEND_API_KEY || '').trim();
  const isEmailTestMode = String((env as any)?.EMAIL_TEST_MODE || '') === '1' && !hasEmailProvider;
  const sendEmailFn =
    (env as any)?.__testSendEmail
      ? (env as any).__testSendEmail
      : isEmailTestMode
        ? (async () => {}) as any
        : sendEmail;
  const url = new URL(req.url);
  const secretQuery =
    url.searchParams.get('secret') ||
    url.searchParams.get('webhook_secret') ||
    url.searchParams.get('webhookSecret') ||
    url.searchParams.get('merchant_key') ||
    url.searchParams.get('merchantKey') ||
    url.searchParams.get('x-webhook-secret') ||
    url.searchParams.get('x-lynkid-webhook-secret') ||
    url.searchParams.get('x-lynkid-secret') ||
    url.searchParams.get('x-lynk-webhook-secret') ||
    url.searchParams.get('x-lynk-secret');
  const secretHeader =
    (req.headers.get('authorization') && req.headers.get('authorization')!.toLowerCase().startsWith('bearer ')
      ? req.headers.get('authorization')!.slice(7).trim()
      : null) ||
    req.headers.get('x-webhook-secret') ||
    req.headers.get('x-lynkid-webhook-secret') ||
    req.headers.get('x-lynkid-secret') ||
    req.headers.get('x-lynk-webhook-secret') ||
    req.headers.get('x-lynk-secret') ||
    req.headers.get('merchant-key') ||
    req.headers.get('merchant_key') ||
    req.headers.get('x-merchant-key') ||
    req.headers.get('x-merchant_key') ||
    req.headers.get('x-lynk-merchant-key') ||
    req.headers.get('x-lynk-merchant_key') ||
    req.headers.get('x-lynkid-merchant-key') ||
    req.headers.get('x-lynkid-merchant_key');
  
  // Prioritize header, fallback to query param
  const receivedSecret = secretHeader || secretQuery;

  const configuredSecret =
    env.LYNKID_WEBHOOK_SECRET ||
    (env as any).LYNK_WEBHOOK_SECRET ||
    (env as any).LYNKID_SECRET ||
    (env as any).LYNKID_MERCHANT_KEY ||
    (env as any).LYNK_MERCHANT_KEY;

  const receivedSource = secretHeader ? 'header' : (secretQuery ? 'query' : 'none');
  const configuredSource = env.LYNKID_WEBHOOK_SECRET
    ? 'env.LYNKID_WEBHOOK_SECRET'
    : (env as any).LYNK_WEBHOOK_SECRET
      ? 'env.LYNK_WEBHOOK_SECRET'
      : (env as any).LYNKID_SECRET
        ? 'env.LYNKID_SECRET'
        : (env as any).LYNKID_MERCHANT_KEY
          ? 'env.LYNKID_MERCHANT_KEY'
          : (env as any).LYNK_MERCHANT_KEY
            ? 'env.LYNK_MERCHANT_KEY'
            : 'none';
  const authSummary = {
    received_source: receivedSource,
    received_len: receivedSecret ? String(receivedSecret).length : 0,
    configured_source: configuredSource,
    configured_len: configuredSecret ? String(configuredSecret).length : 0,
    match: !!(configuredSecret && receivedSecret && receivedSecret === configuredSecret),
    url: url.origin + url.pathname,
    event_hint: req.headers.get('x-event-name') || req.headers.get('x-lynk-event') || null
  };

  try {
    const headersSnapshot: Record<string, string | null> = {
      'content-type': req.headers.get('content-type'),
      'user-agent': req.headers.get('user-agent'),
      'cf-connecting-ip': req.headers.get('cf-connecting-ip'),
      'cf-ipcountry': req.headers.get('cf-ipcountry'),
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      'x-real-ip': req.headers.get('x-real-ip'),
      'x-webhook-secret': req.headers.get('x-webhook-secret') ? '[present]' : null,
      'x-lynkid-webhook-secret': req.headers.get('x-lynkid-webhook-secret') ? '[present]' : null,
      'x-lynkid-secret': req.headers.get('x-lynkid-secret') ? '[present]' : null,
      'x-lynk-webhook-secret': req.headers.get('x-lynk-webhook-secret') ? '[present]' : null,
      'x-lynk-secret': req.headers.get('x-lynk-secret') ? '[present]' : null,
      'merchant-key': req.headers.get('merchant-key') ? '[present]' : null,
      'x-merchant-key': req.headers.get('x-merchant-key') ? '[present]' : null,
      'x-lynk-merchant-key': req.headers.get('x-lynk-merchant-key') ? '[present]' : null,
      'x-lynkid-merchant-key': req.headers.get('x-lynkid-merchant-key') ? '[present]' : null
    };
    await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
      .bind('last_lynkid_webhook_auth', JSON.stringify(authSummary)).run();
    await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
      .bind('last_lynkid_webhook_headers', JSON.stringify(headersSnapshot)).run();
  } catch {}

  if (!configuredSecret || receivedSecret !== configuredSecret) {
    return Response.json({
      success: false,
      error: "Invalid webhook secret",
      auth: authSummary
    }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
    
    // LOGGING: Save the raw webhook payload to DB for debugging/inspection
    try {
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind('last_lynkid_webhook', JSON.stringify(body)).run();
    } catch (logErr) {
        console.error("Failed to log webhook payload", logErr);
    }

  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // --- PARSE LYNK.ID PAYLOAD (Updated based on actual payload) ---
  // Structure: { event: "payment.received", data: { message_data: { customer: { email: ... }, items: [ ... ], totals: { ... } } } }
  
  const event = body.event;
  const data = body.data;
  const messageData =
    data?.message_data ??
    data?.messageData ??
    data?.payload?.message_data ??
    data?.payload?.messageData ??
    body?.message_data ??
    body?.messageData;
  
  // 1. Validate Event
  // Lynk.id sends 'payment.received'
  const eventNorm = typeof event === 'string' ? event.toLowerCase().trim() : '';
  const allowedEvents = new Set(['payment.received', 'payment.completed', 'payment.success', 'payment.paid']);
  if (!eventNorm || !allowedEvents.has(eventNorm)) {
    return Response.json({ success: true, message: `Event '${eventNorm || 'unknown'}' received but ignored` });
  }

  // 2. Validate Email
  const emailRaw =
    messageData?.customer?.email ??
    messageData?.customer_email ??
    messageData?.email ??
    data?.customer?.email ??
    data?.email ??
    body?.customer?.email ??
    body?.email;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : undefined;
  if (!email || typeof email !== 'string') {
    return Response.json({ success: false, error: "Missing email in customer data" }, { status: 400 });
  }

  const orderIdRaw =
    data?.order_id ??
    body?.event_id ??
    messageData?.refId ??
    data?.message_id ??
    body?.message_id ??
    messageData?.message_id;
  const orderId = typeof orderIdRaw === 'string' && orderIdRaw.trim() ? orderIdRaw.trim() : undefined;
  await ensureLynkPurchaseSchema(env);
  await ensureVoucherTables(env);

  let existingPurchase: any = null;
  if (orderId) {
    try {
      existingPurchase = await env.DB.prepare(
        "SELECT id, status, email_status, voucher_code, failure_count FROM lynk_purchases WHERE idempotency_key = ? AND deleted_at IS NULL LIMIT 1"
      ).bind(orderId).first();
    } catch {}
  }

  if (orderId && existingPurchase) {
    const st = String(existingPurchase.status || '');
    if (st === 'voucher_sent' || st === 'applied') {
    return Response.json({ success: true, status: 'already_processed', order_id: orderId });
    }
  }

  if (orderId && !existingPurchase) {
    try {
      const existing = await env.DB.prepare(
        "SELECT id FROM topup_transactions WHERE method = 'lynkid' AND payment_ref = ? LIMIT 1"
      ).bind(orderId).first();
      if (existing && (existing as any).id) {
        return Response.json({ success: true, status: 'already_processed', order_id: orderId });
      }
    } catch {}
  }

  // 3. Process Items
  const items: any[] = Array.isArray(messageData?.items)
    ? messageData.items
    : Array.isArray((messageData as any)?.item)
      ? (messageData as any).item
      : Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray((data as any)?.item)
          ? (data as any).item
          : [];
  if (!items || items.length === 0) {
      const titleFallback =
        (messageData as any)?.title ??
        (data as any)?.message_data?.title ??
        (data as any)?.title ??
        null;
      const totalsFallback =
        (messageData as any)?.totals?.total ??
        (messageData as any)?.totals?.amount ??
        (data as any)?.total_amount ??
        (data as any)?.amount ??
        (data as any)?.total ??
        0;
      const title = typeof titleFallback === 'string' ? titleFallback.trim() : '';
      const price = Number(totalsFallback) || 0;
      if (!title) {
        return Response.json({ success: false, error: "No items in transaction" }, { status: 400 });
      }
      items.push({ title, price });
  }

  const normalizeTitle = (s: string) => String(s || '')
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2015–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const TITLE_MAP: Record<string, any> = {
    [normalizeTitle("Metabayn – Smart Metadata Generator App for Images & Videos")]: { type: 'license', amount: 50000, duration: 30 },
    [normalizeTitle("Metabayn - Smart Metadata Agent")]: { type: 'license', amount: 50000, duration: 30 },
    [normalizeTitle("Metabayn Token 20.000 – Credit Top-Up for Metadata Processing")]: { type: 'token', amount: 20000 },
    [normalizeTitle("Metabayn Token 50.000 – Credit Top-Up for Metadata Processing")]: { type: 'token', amount: 50000 },
    [normalizeTitle("Metabayn Token 100.000 – Credit Top-Up for Metadata Processing")]: { type: 'token', amount: 100000 },
    [normalizeTitle("Metabayn Token 150.000 – Credit Top-Up for Metadata Processing")]: { type: 'token', amount: 150000 },
    [normalizeTitle("Metabayn Subscription - 30 Days")]: { type: 'subscription', duration: 30 },
    [normalizeTitle("Metabayn Subscription - 3 Months")]: { type: 'subscription', duration: 90 },
    [normalizeTitle("Metabayn Subscription - 6 Months")]: { type: 'subscription', duration: 180 },
    [normalizeTitle("Metabayn Subscription - 1 Year")]: { type: 'subscription', duration: 365 }
  };

  const tokenGrants: Array<{ amount: number; titleNormalized: string; logLabel: string }> = [];
  const results: any[] = [];
  let totalAmountRp = 0;
  let totalSubscriptionDays = 0;
  let maxDurationDays = 0;
  let hasLicenseItem = false;

  for (const item of items) {
    const title = item.title || "";
    const price = Number(
      item.price ??
      item.amount ??
      item.total ??
      item.total_amount ??
      item.total_price ??
      item.unit_price ??
      item.subtotal ??
      0
    ) || 0;
    totalAmountRp += price;

    const titleNormalized = normalizeTitle(title);
    const titleLower = String(title || '').toLowerCase();

    let matched = false;
    let voucherType: 'token' | 'subscription' | 'license' = 'token';
    let tokenAmount = 0;
    let subscriptionDuration = 0;

    if (TITLE_MAP[titleNormalized]) {
      matched = true;
      const mapData = TITLE_MAP[titleNormalized];
      voucherType = mapData.type || 'token';
      if (voucherType === 'subscription') {
        subscriptionDuration = Number(mapData.duration || 0) || 0;
      } else if (voucherType === 'license') {
        subscriptionDuration = Number(mapData.duration || 30) || 30;
        tokenAmount = Number(mapData.amount || 0) || 0;
      } else {
        tokenAmount = Number(mapData.amount || 0) || 0;
      }
    }

    if (!matched) {
      const isSmartMetadataAgent =
        titleNormalized.includes('metabayn') &&
        (titleNormalized.includes('smart metadata agent') || titleNormalized.includes('smart metadata generator'));

      if (isSmartMetadataAgent) {
        matched = true;
        voucherType = 'license';
        subscriptionDuration = 30;
        tokenAmount = 50000;
      } else if (titleLower.includes('subscription') || titleLower.includes('langganan')) {
        matched = true;
        voucherType = 'subscription';
        if (titleLower.includes('1 year') || titleLower.includes('tahun')) {
          subscriptionDuration = 365;
        } else if (titleLower.includes('6 month') || titleLower.includes('6 bulan')) {
          subscriptionDuration = 180;
        } else if (titleLower.includes('3 month') || titleLower.includes('3 bulan')) {
          subscriptionDuration = 90;
        } else {
          subscriptionDuration = 30;
        }
      } else if (titleLower.includes('token')) {
        voucherType = 'token';
        const allowedTokenAmounts = new Set([20000, 50000, 100000, 150000]);
        const normalizeDigits = (s: string) => s.replace(/[^\d]/g, '');

        let parsed = 0;

        const rbMatch = titleLower.match(/(\d{1,3})\s*(rb|ribu)\b/i);
        if (rbMatch?.[1]) {
          const base = Number(rbMatch[1]);
          if (Number.isFinite(base) && base > 0) parsed = base * 1000;
        }

        if (!parsed) {
          const sepMatch = titleLower.match(/(\d{1,3}(?:[.,]\s*\d{3})+)\b/);
          const digits = sepMatch?.[1] ? normalizeDigits(String(sepMatch[1])) : '';
          const num = digits ? Number(digits) : 0;
          if (Number.isFinite(num) && num > 0) parsed = num;
        }

        if (!parsed) {
          const tokenDigitsMatch = titleLower.match(/token[\s\-_:]*.*?(\d{1,6})\b/i);
          const digits = tokenDigitsMatch?.[1] ? normalizeDigits(String(tokenDigitsMatch[1])) : '';
          const num = digits ? Number(digits) : 0;
          if (Number.isFinite(num) && num > 0) {
            parsed = num < 1000 && (num === 20 || num === 50 || num === 100 || num === 150) ? num * 1000 : num;
          }
        }

        if (allowedTokenAmounts.has(parsed)) {
          matched = true;
          tokenAmount = parsed;
        }
      }
    }

    if (!matched) continue;

    if (subscriptionDuration > 0) {
      totalSubscriptionDays += subscriptionDuration;
      maxDurationDays = Math.max(maxDurationDays, subscriptionDuration);
    }

    if (tokenAmount > 0) {
      if (voucherType === 'license') hasLicenseItem = true;
      tokenGrants.push({
        amount: tokenAmount,
        titleNormalized,
        logLabel: voucherType === 'license' ? 'Voucher' : 'Top-up'
      });
    }
  }

  const totalTokenAmount = tokenGrants.reduce((sum, g) => sum + (Number(g.amount) || 0), 0);
  const totalTokensAdded = totalTokenAmount;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(email).first();

  if (totalTokenAmount > 0 || totalSubscriptionDays > 0) {
    const nowMs = Date.now();
    const idempotencyKey = orderId || (body?.event_id ? String(body.event_id) : `lynkid:${nowMs}`);
    const purchaseId = existingPurchase?.id ? String(existingPurchase.id) : crypto.randomUUID();
    const productRef = normalizeTitle(items[0]?.title || '');

    const purchaseKind: 'license' | 'subscription' | 'token' =
      hasLicenseItem ? 'license' : (totalSubscriptionDays > 0 ? 'subscription' : 'token');

    if (purchaseKind === 'license') {
      const voucherCode = existingPurchase?.voucher_code ? String(existingPurchase.voucher_code) : generateCode();

      if (!existingPurchase) {
        try {
          await env.DB.prepare(
            `
            INSERT INTO lynk_purchases
            (id, idempotency_key, provider, product_ref, email, voucher_code, payment_status, purchase_ts, status, user_id, activated_at, activation_started_at, raw_payload, signature_status, email_status, email_last_error, failure_count, next_retry_at, last_error, created_at, updated_at, deleted_at)
            VALUES (?, ?, 'lynkid', ?, ?, ?, ?, ?, 'voucher_pending', ?, NULL, NULL, ?, NULL, 'pending', NULL, 0, NULL, NULL, ?, ?, NULL)
            `
          )
            .bind(
              purchaseId,
              idempotencyKey,
              productRef,
              email,
              voucherCode,
              eventNorm,
              nowMs,
              user?.id ? String((user as any).id) : null,
              JSON.stringify(body),
              nowMs,
              nowMs
            )
            .run();
        } catch {}
      } else if (!existingPurchase?.voucher_code) {
        try {
          await env.DB.prepare("UPDATE lynk_purchases SET voucher_code = ?, updated_at = ? WHERE id = ?")
            .bind(voucherCode, nowMs, purchaseId)
            .run();
        } catch {}
      } else if (user?.id) {
        try {
          await env.DB.prepare("UPDATE lynk_purchases SET user_id = ?, updated_at = ? WHERE id = ?")
            .bind(String((user as any).id), nowMs, purchaseId)
            .run();
        } catch {}
      }

      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, 'license', ?, ?)"
        ).bind(
          voucherCode,
          totalTokenAmount,
          expiresAt.toISOString(),
          email,
          totalSubscriptionDays || 30,
          new Date().toISOString()
        ).run();
      } catch {}

      const emailSubject = 'Kode Voucher Metabayn';
      const emailHtml = getLicenseVoucherTemplate(email, voucherCode, totalSubscriptionDays || 30, totalTokenAmount);

      let emailOutcome: 'sent' | 'failed' | 'skipped_test_mode' = 'sent';
      let emailError: string | null = null;

      try {
        await sendEmailFn(email, emailSubject, emailHtml, env);
        try {
          await env.DB.prepare(
            "UPDATE lynk_purchases SET email_status = 'sent', email_last_error = NULL, status = 'voucher_sent', next_retry_at = NULL, updated_at = ? WHERE id = ?"
          )
            .bind(nowMs, purchaseId)
            .run();
        } catch {}
      } catch (e: any) {
        emailOutcome = 'failed';
        const msg = e instanceof Error ? e.message : String(e);
        emailError = msg.slice(0, 2000);
        const prevFc = Number(existingPurchase?.failure_count ?? 0);
        const nextFc = prevFc + 1;
        const backoffMs = Math.min(60 * 60 * 1000, 30_000 * Math.pow(2, Math.min(6, nextFc)));
        const nextRetryAt = nowMs + backoffMs;
        try {
          await env.DB.prepare(
            "UPDATE lynk_purchases SET email_status = 'failed', email_last_error = ?, failure_count = ?, next_retry_at = ?, updated_at = ? WHERE id = ?"
          )
            .bind(emailError, nextFc, nextRetryAt, nowMs, purchaseId)
            .run();
        } catch {}
        console.error("Failed to send Lynk.id voucher email:", e);
      }

      results.push({
        code: voucherCode,
        type: 'license',
        amount: totalTokenAmount,
        duration: totalSubscriptionDays || 30
      });

      if (isEmailTestMode) {
        emailOutcome = 'skipped_test_mode';
        emailError = null;
      }

    } else {
      if (!user?.id) {
        try {
          if (!existingPurchase) {
            await env.DB.prepare(
              `
              INSERT INTO lynk_purchases
              (id, idempotency_key, provider, product_ref, email, voucher_code, payment_status, purchase_ts, status, user_id, activated_at, activation_started_at, raw_payload, signature_status, email_status, email_last_error, failure_count, next_retry_at, last_error, created_at, updated_at, deleted_at)
              VALUES (?, ?, 'lynkid', ?, ?, NULL, ?, ?, 'pending_apply', NULL, NULL, NULL, ?, NULL, 'failed', 'user_not_found', 0, NULL, 'user_not_found', ?, ?, NULL)
              `
            )
              .bind(purchaseId, idempotencyKey, productRef, email, eventNorm, nowMs, JSON.stringify(body), nowMs, nowMs)
              .run();
          }
        } catch {}
        return Response.json({ success: true, applied: false, reason: 'user_not_found', order_id: orderId || null }, { status: 202 });
      }

      if (!existingPurchase) {
        try {
          await env.DB.prepare(
            `
            INSERT INTO lynk_purchases
            (id, idempotency_key, provider, product_ref, email, voucher_code, payment_status, purchase_ts, status, user_id, activated_at, activation_started_at, raw_payload, signature_status, email_status, email_last_error, failure_count, next_retry_at, last_error, created_at, updated_at, deleted_at)
            VALUES (?, ?, 'lynkid', ?, ?, NULL, ?, ?, 'pending_apply', ?, NULL, NULL, ?, NULL, 'pending', NULL, 0, NULL, NULL, ?, ?, NULL)
            `
          )
            .bind(
              purchaseId,
              idempotencyKey,
              productRef,
              email,
              eventNorm,
              nowMs,
              String((user as any).id),
              JSON.stringify(body),
              nowMs,
              nowMs
            )
            .run();
        } catch {}
      }

      let locked = false;
      try {
        const lockRes: any = await env.DB.prepare(
          `
          UPDATE lynk_purchases
          SET activation_started_at = ?,
              user_id = ?,
              updated_at = ?
          WHERE id = ?
            AND deleted_at IS NULL
            AND status = 'pending_apply'
            AND activation_started_at IS NULL
          `
        )
          .bind(nowMs, String((user as any).id), nowMs, purchaseId)
          .run();
        locked = !!(lockRes?.meta?.changes > 0);
      } catch {}

      if (!locked) {
        return Response.json({ success: true, status: 'already_processed', order_id: orderId || null });
      }

      let newExpiryIso: string | null = null;
      try {
        if (totalSubscriptionDays > 0) {
          const currentUser = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(String((user as any).id)).first();
          let newExpiryDate = new Date();
          if (currentUser && (currentUser as any).subscription_expiry) {
            const currentExpiry = new Date(String((currentUser as any).subscription_expiry));
            if (currentExpiry > new Date()) newExpiryDate = currentExpiry;
          }
          newExpiryDate.setDate(newExpiryDate.getDate() + totalSubscriptionDays);
          newExpiryIso = newExpiryDate.toISOString();
          await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
            .bind(newExpiryIso, String((user as any).id))
            .run();
        }

        if (totalTokenAmount > 0) {
          await addUserTokens(String((user as any).id), totalTokenAmount, env, {
            logLabel: 'Top-up',
            reason: 'Lynk.id',
            idempotencyKey: `lynkid:${idempotencyKey}:credit`,
            meta: { source: 'lynkid', order_id: idempotencyKey }
          });
        }
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          await env.DB.prepare(
            "UPDATE lynk_purchases SET status = 'failed', last_error = ?, email_status = 'failed', email_last_error = ?, updated_at = ? WHERE id = ?"
          )
            .bind(msg.slice(0, 1000), msg.slice(0, 1000), Date.now(), purchaseId)
            .run();
        } catch {}
        return Response.json({ success: false, error: 'apply_failed' }, { status: 500 });
      }

      try {
        await env.DB.prepare(
          "UPDATE lynk_purchases SET status = 'applied', activated_at = ?, updated_at = ? WHERE id = ?"
        )
          .bind(Date.now(), Date.now(), purchaseId)
          .run();
      } catch {}

      try {
        const isSub = totalSubscriptionDays > 0;
        if (isSub) {
          const subject = `Subscription Activated (${totalSubscriptionDays} Days)`;
          const html = getSubscriptionSuccessTemplate(totalAmountRp, totalSubscriptionDays, 0, newExpiryIso || new Date().toISOString(), 'IDR');
          await sendEmailFn(email, subject, html, env);
        } else {
          const subject = `Top Up Successful (${totalTokenAmount} Tokens)`;
          const html = getTopupSuccessTemplate(totalAmountRp, totalTokenAmount, 'IDR');
          await sendEmailFn(email, subject, html, env);
        }
        try {
          await env.DB.prepare("UPDATE lynk_purchases SET email_status = 'sent', email_last_error = NULL, updated_at = ? WHERE id = ?")
            .bind(Date.now(), purchaseId)
            .run();
        } catch {}
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          await env.DB.prepare("UPDATE lynk_purchases SET email_status = 'failed', email_last_error = ?, updated_at = ? WHERE id = ?")
            .bind(msg.slice(0, 1000), Date.now(), purchaseId)
            .run();
        } catch {}
      }

      results.push({
        type: purchaseKind,
        amount: totalTokenAmount,
        duration: totalSubscriptionDays,
        applied: true,
        subscription_expiry: newExpiryIso
      });
    }
  }

  // LOG TRANSACTION TO topup_transactions
  try {
      const orderId = data?.order_id || body.event_id || `lynkid-${Date.now()}`;
      const purchaseKindForLog: 'license' | 'subscription' | 'token' =
        hasLicenseItem ? 'license' : (totalSubscriptionDays > 0 ? 'subscription' : 'token');
      const loggedTokensAdded = purchaseKindForLog === 'token' ? totalTokenAmount : 0;
      const loggedDurationDays = purchaseKindForLog === 'subscription' ? maxDurationDays : 0;
      
      // Try to find user by email
      const user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(email).first();
      // If user not found, use special format "email:user@example.com" so admin panel can extract it
      const userId = user ? String(user.id) : `email:${email}`;
      
      await env.DB.prepare(`
          INSERT INTO topup_transactions 
          (user_id, amount_rp, tokens_added, method, status, payment_ref, created_at, duration_days) 
          VALUES (?, ?, ?, 'lynkid', 'paid', ?, ?, ?)
      `).bind(
          userId, 
          totalAmountRp, 
          loggedTokensAdded, 
          orderId, 
          new Date().toISOString(),
          loggedDurationDays
      ).run();
      
      console.log(`Logged Lynk.id transaction for ${email} (User: ${userId}, Amount: ${totalAmountRp}, Duration: ${loggedDurationDays})`);
  } catch (txErr) {
      console.error("Failed to log Lynk.id transaction:", txErr);
  }

  try {
      const orderId = data?.order_id || body.event_id || null;
      const safeResults = results.map((r: any) => {
          if (r && typeof r === 'object') {
              const { code, ...rest } = r;
              if (typeof code === 'string' && code) {
                  return { ...rest, status: 'voucher-generated' };
              }
              return rest;
          }
          return r;
      });
      const summary = {
          email,
          event: eventNorm,
          order_id: orderId,
          total_amount_rp: totalAmountRp,
          total_tokens_added: hasLicenseItem ? 0 : totalTokensAdded,
          duration_days: hasLicenseItem ? 0 : maxDurationDays,
          results: safeResults,
          processed_at: new Date().toISOString()
      };
      await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
        .bind('last_lynkid_processing', JSON.stringify(summary)).run();
  } catch (logErr) {
      console.error("Failed to log Lynk.id processing summary:", logErr);
  }

  if (hasLicenseItem) {
    return Response.json({ success: true, bundle_mode: 'single_voucher_v2', generated: results });
  }
  return Response.json({ success: true, mode: 'auto_apply_v1', applied: true, result: results });
}

async function ensureLynkPurchaseSchema(env: Env) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS lynk_purchases (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        provider TEXT NOT NULL,
        product_ref TEXT,
        email TEXT NOT NULL,
        voucher_code TEXT,
        payment_status TEXT,
        purchase_ts INTEGER,
        status TEXT NOT NULL,
        user_id TEXT,
        activated_at INTEGER,
        activation_started_at INTEGER,
        raw_payload TEXT,
        signature_status INTEGER,
        email_status TEXT,
        email_last_error TEXT,
        failure_count INTEGER DEFAULT 0,
        next_retry_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("ALTER TABLE lynk_purchases ADD COLUMN voucher_code TEXT;").run();
  } catch {}

  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lynk_purchases_status_retry ON lynk_purchases(status, next_retry_at, deleted_at);").run();
  } catch {}
}

async function ensureVoucherTables(env: Env) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS vouchers (
        code TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        max_usage INTEGER NOT NULL,
        current_usage INTEGER NOT NULL,
        expires_at TEXT,
        allowed_emails TEXT,
        type TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("ALTER TABLE vouchers ADD COLUMN created_at TEXT;").run();
    await env.DB.prepare("UPDATE vouchers SET created_at = COALESCE(created_at, datetime('now')) WHERE created_at IS NULL;").run();
  } catch {}

  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS voucher_claims (
        user_id TEXT NOT NULL,
        voucher_code TEXT NOT NULL,
        device_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("ALTER TABLE voucher_claims ADD COLUMN created_at TEXT;").run();
    await env.DB.prepare("UPDATE voucher_claims SET created_at = COALESCE(created_at, datetime('now')) WHERE created_at IS NULL;").run();
  } catch {}

  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_voucher_claims_user_code ON voucher_claims(user_id, voucher_code);").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_voucher_claims_device_code ON voucher_claims(device_hash, voucher_code);").run();
    await env.DB.prepare("DELETE FROM voucher_claims WHERE rowid NOT IN (SELECT MIN(rowid) FROM voucher_claims GROUP BY voucher_code);").run();
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_claims_code_unique ON voucher_claims(voucher_code);").run();
  } catch {}
}

// Helper to generate 6-char random alphanumeric code (Moved out to be shared)
function generateCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    const randomValues = new Uint8Array(6);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 6; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    return result;
}
