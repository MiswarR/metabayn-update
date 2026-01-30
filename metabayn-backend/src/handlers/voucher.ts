
import { Env } from '../types';
import { getWelcomeVoucherTemplate, getPurchaseVoucherTemplate, sendEmail, getWelcomeDualVoucherTemplate } from '../utils/email';

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
  const voucherType = type || 'token'; // Default to token
  
  if (voucherType === 'token' && !amount) {
      return Response.json({ error: "Amount is required for token vouchers" }, { status: 400 });
  }

  if (voucherType === 'subscription' && !duration_days) {
      return Response.json({ error: "Duration is required for subscription vouchers" }, { status: 400 });
  }

  try {
    // allowed_emails: "email1@a.com, email2@b.com" -> store as string
    await env.DB.prepare(
      "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)"
    ).bind(
      code.toUpperCase(), 
      amount || 0, 
      max_usage || 0, 
      expires_at || null, 
      allowed_emails || null, 
      voucherType,
      duration_days || 0,
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
  const voucherType = type || 'token';
  
  if (voucherType === 'token' && (!amount || amount < 1)) {
      return Response.json({ error: "Invalid amount for token vouchers" }, { status: 400 });
  }

  if (voucherType === 'subscription' && (!duration_days || duration_days < 1)) {
      return Response.json({ error: "Invalid duration for subscription vouchers" }, { status: 400 });
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
          amount || 0, 
          max_usage || 1, 
          expires_at || null, 
          voucherType,
          duration_days || 0,
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
export async function handleRedeemVoucher(req: Request, env: Env) {
  const body: any = await req.json();
  const { userId, code, deviceHash } = body;

  if (!userId || !code || !deviceHash) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const voucherCode = code.toUpperCase().trim();

  // 1. Check Voucher Validity
  const voucher = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(voucherCode).first();
  if (!voucher) {
    return Response.json({ error: "Invalid voucher code" }, { status: 404 });
  }

  // Check Expiry
  if (voucher.expires_at) {
      const now = new Date();
      const expiry = new Date(voucher.expires_at as string);
      if (now > expiry) {
          return Response.json({ error: "Voucher has expired" }, { status: 410 });
      }
  }

  // Check Usage Limit
  const maxUsage = voucher.max_usage as number;
  const currentUsage = voucher.current_usage as number;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ error: "Voucher fully redeemed" }, { status: 410 });
  }

  // Check Whitelist (Allowed Emails)
  if (voucher.allowed_emails) {
      const allowedList = (voucher.allowed_emails as string).split(',').map(s => s.trim().toLowerCase());
      // Need user email. Get from DB or Token (if passed in context, but here we only have userId in body)
      // We should fetch user email from DB to be safe
      const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
      if (!user || !allowedList.includes((user.email as string).toLowerCase())) {
          return Response.json({ error: "This voucher is not valid for your account" }, { status: 403 });
      }
  }

  // 2. Check if USER already claimed THIS voucher
  const userClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE user_id = ? AND voucher_code = ?")
    .bind(userId, voucherCode).first();
  
  if (userClaim) {
    return Response.json({ error: "You have already redeemed this voucher" }, { status: 409 });
  }

  // 3. Check if DEVICE already claimed THIS voucher (Anti-Tuyul)
  const deviceClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE device_hash = ? AND voucher_code = ?")
    .bind(deviceHash, voucherCode).first();

  if (deviceClaim) {
    return Response.json({ error: "This device has already redeemed this voucher code" }, { status: 403 });
  }

  // 4. EXECUTE REDEMPTION (Atomic Transaction using Batch)
  try {
    const stmts: any[] = [];
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

        stmts.push(
            env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                .bind(newExpiryIso, userId)
        );

        successMessage = `Subscription activated! Valid until ${newExpiryDate.toLocaleDateString()}`;
        responseData = { subscription_active: true, subscription_expiry: newExpiryIso };

    } else {
        // --- TOKEN LOGIC (Default) ---
        stmts.push(
            env.DB.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").bind(voucher.amount, userId)
        );
        successMessage = `Voucher redeemed! ${voucher.amount} tokens added.`;
        responseData = { amount_added: voucher.amount };
    }

    // Common Statements
    stmts.push(
        env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
        env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    );

    await env.DB.batch(stmts);

    // 5. Auto-Delete if Max Usage Reached
    // User Requirement: "setiap kode voucher yang maksimal usage nya terpenuhi maka otomatis terhapus"
    // "tidak mempengaruhi token user" -> We already updated user tokens in the batch above.
    
    // We check if the NEW usage matches Max Usage.
    // currentUsage (from DB select) was before increment. So new usage is currentUsage + 1.
    if (maxUsage > 0 && (currentUsage + 1) >= maxUsage) {
       // Delete claims first to avoid FK issues
       await env.DB.prepare("DELETE FROM voucher_claims WHERE voucher_code = ?").bind(voucherCode).run();
       // Delete voucher
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
    return Response.json({ error: "Failed to redeem voucher. Please try again." }, { status: 500 });
  }
}

export async function handleLynkIdWebhook(req: Request, env: Env) {
  const url = new URL(req.url);
  const secretQuery = url.searchParams.get('secret');
  const secretHeader = req.headers.get('x-webhook-secret');
  
  // Prioritize header, fallback to query param
  const receivedSecret = secretHeader || secretQuery;

  if (!env.LYNKID_WEBHOOK_SECRET || receivedSecret !== env.LYNKID_WEBHOOK_SECRET) {
    return Response.json({ success: false, error: "Invalid webhook secret" }, { status: 401 });
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
  const messageData = data?.message_data;
  
  // 1. Validate Event
  // Lynk.id sends 'payment.received'
  if (!event || event !== 'payment.received') {
    return Response.json({ success: true, message: `Event '${event || 'unknown'}' received but ignored` });
  }

  // 2. Validate Email
  const email = messageData?.customer?.email;
  if (!email || typeof email !== 'string') {
    return Response.json({ success: false, error: "Missing email in customer data" }, { status: 400 });
  }

  // 3. Process Items
  const items = messageData?.items || [];
  if (items.length === 0) {
      return Response.json({ success: false, error: "No items in transaction" }, { status: 400 });
  }

  const results = [];
  let totalTokensAdded = 0;
  let totalAmountRp = 0;

  // We loop through items, but usually there's only 1.
  for (const item of items) {
      const title = item.title || "";
      const price = Number(item.price) || 0; // Original Price (before discount)
      totalAmountRp += price;
      
      let voucherType: 'token' | 'subscription' = 'token';
      let tokenAmount = 0;
      let subscriptionDuration = 0;
      let emailSubject = 'Your Metabayn Studio Voucher';
      let isWelcomeBonus = false;
      let matched = false;

      const titleLower = title.toLowerCase();
      const normalizeTitle = (s: string) => s.toLowerCase().replace(/–/g, '-').replace(/\s+/g, ' ').trim();
      const TITLE_MAP: Record<string, { type: 'license' | 'token' | 'subscription', amount?: number, duration?: number }> = {
          [normalizeTitle('Metabayn – Smart Metadata Generator App for Images & Videos')]: { type: 'license' },
          [normalizeTitle('Metabayn Token Voucher 20.000 – Credit Top-Up for Metadata Processing')]: { type: 'token', amount: 20000 },
          [normalizeTitle('Metabayn Token Voucher 50.000 – Credit Top-Up for Metadata Processing')]: { type: 'token', amount: 50000 },
          [normalizeTitle('Metabayn Token Voucher 100.000 – Credit Top-Up for Metadata Processing')]: { type: 'token', amount: 100000 },
          [normalizeTitle('Metabayn Token Voucher 150.000 – Credit Top-Up for Metadata Processing')]: { type: 'token', amount: 150000 },
          [normalizeTitle('Metabayn API Key Mode Subscription - 30 Days')]: { type: 'subscription', duration: 30 },
          [normalizeTitle('Metabayn API Key Mode Subscription - 3 Months')]: { type: 'subscription', duration: 90 },
          [normalizeTitle('Metabayn API Key Mode Subscription - 6 Months')]: { type: 'subscription', duration: 180 },
          [normalizeTitle('Metabayn API Key Mode Subscription - 1 Year')]: { type: 'subscription', duration: 365 }
      };
      const mapped = TITLE_MAP[normalizeTitle(title)];
      if (mapped) {
          matched = true;
          if (mapped.type === 'license') {
              isWelcomeBonus = true;
              let welcomeAmountThreshold = 48900;
              try {
                const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
                if (rateCfg && rateCfg.value) {
                    const rate = Number(rateCfg.value);
                    if (!isNaN(rate) && rate > 0) welcomeAmountThreshold = Math.round(3 * rate);
                }
              } catch {}
              tokenAmount = welcomeAmountThreshold;
              emailSubject = 'Your Metabayn Studio Welcome Vouchers';
          } else if (mapped.type === 'token') {
              voucherType = 'token';
              tokenAmount = mapped.amount || 0;
              emailSubject = `Your ${title}`;
          } else {
              voucherType = 'subscription';
              subscriptionDuration = mapped.duration || 30;
              emailSubject = `Your ${title}`;
          }
      } else if (titleLower.includes('subscription') || titleLower.includes('langganan')) {
          // SUBSCRIPTION
          voucherType = 'subscription';
          matched = true;
          // Detect duration from title or price
          if (titleLower.includes('1 year') || titleLower.includes('tahun') || titleLower.includes('12 month')) {
              subscriptionDuration = 365;
              emailSubject = 'Your 1 Year Subscription Voucher';
          } else if (titleLower.includes('3 month') || titleLower.includes('3 bulan')) {
              subscriptionDuration = 90;
              emailSubject = 'Your 3 Months Subscription Voucher';
          } else {
              subscriptionDuration = 30; // Default 1 month
              emailSubject = 'Your 1 Month Subscription Voucher';
          }

      } else if (titleLower.includes('token')) {
          // TOKEN PACKAGES
          voucherType = 'token';
          matched = true;
          emailSubject = `Your ${title}`;
          
          // Detect amount from title (e.g. "100k Tokens") or Price
          // Fallback to Price logic if title parsing is hard
          // Mapping based on price (ignoring discount)
          if (price >= 15000 && price <= 29000) tokenAmount = 20000;
          else if (price >= 40000 && price <= 70000) tokenAmount = 55000;
          else if (price >= 80000 && price <= 130000) tokenAmount = 120000;
          else tokenAmount = price; // Fallback 1:1

      } else if (normalizeTitle(title) === normalizeTitle('Metabayn – Smart Metadata Generator App for Images & Videos')) {
          // APP LICENSE (Welcome Bonus) - strictly match exact app title
          isWelcomeBonus = true;
          matched = true;

          let welcomeAmountThreshold = 48900; 
          try {
            const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
            if (rateCfg && rateCfg.value) {
                const rate = Number(rateCfg.value);
                if (!isNaN(rate) && rate > 0) welcomeAmountThreshold = Math.round(3 * rate);
            }
          } catch {}
          tokenAmount = welcomeAmountThreshold;
          emailSubject = 'Your Metabayn Studio Welcome Vouchers';

      } else {
          // Final Fallback: Treat as Token Topup 1:1 based on price
          tokenAmount = price;
          emailSubject = 'Your Token Voucher';
      }

      if (tokenAmount > 0 || subscriptionDuration > 0) {
          // Accumulate tokens for transaction log
          if (voucherType === 'token') {
              totalTokensAdded += tokenAmount;
          }

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 30);
          let emailHtml = "";
          if (isWelcomeBonus) {
              const tokenCode = generateCode();
              const subscriptionCode = generateCode();
              await env.DB.prepare(
                "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
              ).bind(
                  tokenCode,
                  tokenAmount,
                  expiresAt.toISOString(),
                  'token',
                  0,
                  new Date().toISOString()
              ).run();
              await env.DB.prepare(
                "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
              ).bind(
                  subscriptionCode,
                  0,
                  expiresAt.toISOString(),
                  'subscription',
                  30,
                  new Date().toISOString()
              ).run();
              emailSubject = 'Your Metabayn Studio Welcome Vouchers';
              emailHtml = getWelcomeDualVoucherTemplate(email, tokenCode, tokenAmount, subscriptionCode, 30);
              await sendEmail(email, emailSubject, emailHtml, env);
              results.push({ code: tokenCode, type: 'token', amount: tokenAmount });
              results.push({ code: subscriptionCode, type: 'subscription', amount: 30 });
          } else {
              const code = generateCode();
              await env.DB.prepare(
                "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
              ).bind(
                  code,
                  tokenAmount,
                  expiresAt.toISOString(),
                  voucherType,
                  subscriptionDuration,
                  new Date().toISOString()
              ).run();
              emailHtml = getPurchaseVoucherTemplate(email, code, voucherType, voucherType === 'subscription' ? subscriptionDuration : tokenAmount);
              await sendEmail(email, emailSubject, emailHtml, env);
              results.push({ code, type: voucherType, amount: tokenAmount || subscriptionDuration });
          }
      }
  }

  // LOG TRANSACTION TO topup_transactions
  try {
      const orderId = data?.order_id || body.event_id || `lynkid-${Date.now()}`;
      
      // Try to find user by email
      const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      // If user not found, use special format "email:user@example.com" so admin panel can extract it
      const userId = user ? String(user.id) : `email:${email}`;
      
      await env.DB.prepare(`
          INSERT INTO topup_transactions 
          (user_id, amount_rp, tokens_added, method, status, payment_ref, created_at) 
          VALUES (?, ?, ?, 'lynkid', 'paid', ?, ?)
      `).bind(
          userId, 
          totalAmountRp, 
          totalTokensAdded, 
          orderId, 
          new Date().toISOString()
      ).run();
      
      console.log(`Logged Lynk.id transaction for ${email} (User: ${userId}, Amount: ${totalAmountRp})`);
  } catch (txErr) {
      console.error("Failed to log Lynk.id transaction:", txErr);
  }

  return Response.json({ success: true, generated: results });
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
