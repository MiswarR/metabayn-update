
import { Env } from '../types';
import { getWelcomeVoucherTemplate, getPurchaseVoucherTemplate, sendEmail, getWelcomeDualVoucherTemplate, getLicenseVoucherTemplate, getToolLicenseVoucherTemplate, getTopupSuccessTemplate, getSubscriptionSuccessTemplate } from '../utils/email';
import { addUserTokens } from '../utils/userToken';

// --- VOUCHER PACKAGES CONFIGURATION (SMART RANGES) ---
// Define min/max price ranges to handle:
// 1. Admin Fees (e.g., Price 20k becomes 24k paid)
// 2. Discounts (e.g., Price 20k becomes 15k paid)
// 3. App Purchase detection (Specific range for App License)


// Admin: List Vouchers
export async function handleListVouchers(req: Request, env: Env) {
  const url = new URL(req.url);
  const typeParam = String(url.searchParams.get('type') || '').trim().toLowerCase();
  const includeAll = typeParam === 'all' || typeParam === '*';
  const requestedType = typeParam && !includeAll ? typeParam : 'license';

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

  const vouchers = includeAll
    ? await env.DB.prepare("SELECT * FROM vouchers ORDER BY created_at DESC").all()
    : await env.DB.prepare("SELECT * FROM vouchers WHERE type = ? ORDER BY created_at DESC").bind(requestedType).all();
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
  const { code, amount, max_usage, expires_at, allowed_emails, type, duration_days, tool_code } = body;

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
  } else if (voucherType === 'tool_license') {
      const tc = String(tool_code || '').trim().toLowerCase();
      if (!tc) {
        return Response.json({ error: "tool_code wajib diisi untuk tool_license vouchers" }, { status: 400 });
      }
  } else {
      return Response.json({ error: "Invalid voucher type" }, { status: 400 });
  }

  try {
    // allowed_emails: "email1@a.com, email2@b.com" -> store as string
    await env.DB.prepare(
      "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, tool_code, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
    ).bind(
      code.toUpperCase(), 
      finalAmount || 0, 
      max_usage || 0, 
      expires_at || null, 
      allowed_emails || null, 
      voucherType,
      finalDurationDays || 0,
      voucherType === 'tool_license' ? String(tool_code || '').trim().toLowerCase() : null,
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
  const { amount, quantity, max_usage, expires_at, type, duration_days, tool_code } = body;

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
  } else if (voucherType === 'tool_license') {
      const tc = String(tool_code || '').trim().toLowerCase();
      if (!tc) {
        return Response.json({ error: "tool_code wajib diisi untuk tool_license vouchers" }, { status: 400 });
      }
  } else {
      return Response.json({ error: "Invalid voucher type" }, { status: 400 });
  }

  if (!quantity || quantity < 1) {
    return Response.json({ error: "Invalid quantity" }, { status: 400 });
  }

  const generatedCodes: string[] = [];
  const stmts: any[] = [];
  const createdAt = new Date().toISOString();

  // Limit quantity to prevent timeout/abuse (e.g. max 500 per request)
  const safeQuantity = Math.min(quantity, 500);

  for (let i = 0; i < safeQuantity; i++) {
    const code =
      voucherType === 'license' || voucherType === 'tool_license'
        ? generatePrefixedVoucherCode(voucherType as any, voucherType === 'tool_license' ? String(tool_code || '').trim().toLowerCase() || null : null)
        : generateShortCode();
    generatedCodes.push(code);
    stmts.push(
      env.DB.prepare(
        "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, tool_code, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)"
      ).bind(
          code, 
          finalAmount || 0, 
          max_usage || 1, 
          expires_at || null, 
          voucherType,
          finalDurationDays || 0,
          voucherType === 'tool_license' ? String(tool_code || '').trim().toLowerCase() : null,
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
  return Response.json(
    { error: "Endpoint voucher sudah dinonaktifkan. Gunakan aktivasi lisensi.", error_code: "deprecated" },
    { status: 410 }
  );
}

async function ensureLicenseTables(env: Env) {
  await ensureVoucherTables(env);
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS device_licenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        voucher_code TEXT NOT NULL,
        activated_at INTEGER NOT NULL,
        revoked_at INTEGER,
        last_seen_at INTEGER
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("DROP INDEX IF EXISTS idx_device_licenses_device_unique;").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_device_licenses_voucher_unique ON device_licenses(voucher_code) WHERE revoked_at IS NULL;").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_device_licenses_user ON device_licenses(user_id, revoked_at);").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_device_licenses_device ON device_licenses(device_hash, revoked_at);").run();
  } catch {}
}

async function ensureToolLicenseTables(env: Env) {
  await ensureVoucherTables(env);
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS device_tool_licenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        tool_code TEXT NOT NULL,
        voucher_code TEXT NOT NULL,
        activated_at INTEGER NOT NULL,
        revoked_at INTEGER,
        last_seen_at INTEGER
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("DROP INDEX IF EXISTS idx_device_tool_licenses_device_tool_unique;").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tool_licenses_voucher_unique ON device_tool_licenses(voucher_code) WHERE revoked_at IS NULL;").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_device_tool_licenses_user ON device_tool_licenses(user_id, revoked_at);").run();
  } catch {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_device_tool_licenses_device_tool ON device_tool_licenses(device_hash, tool_code, revoked_at);").run();
  } catch {}
}

export async function handleLicenseStatus(req: Request, env: Env, authUserId?: string | number) {
  await ensureLicenseTables(env);
  const url = new URL(req.url);
  const userIdParam = url.searchParams.get('user_id') || url.searchParams.get('userId');
  const deviceHash = (url.searchParams.get('device_hash') || url.searchParams.get('deviceHash') || '').trim();
  const userId = String((authUserId ?? userIdParam) ?? '').trim();
  if (!userId || !deviceHash) {
    return Response.json({ error: "Missing fields", error_code: "missing_fields" }, { status: 400 });
  }
  if (authUserId != null && String(authUserId) !== String(userId)) {
    return Response.json({ error: "User tidak valid", error_code: "user_mismatch" }, { status: 403 });
  }

  try {
    const u: any = await env.DB.prepare("SELECT email, is_admin FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    const email = String(u?.email || '').trim().toLowerCase();
    const isAdmin = u && (u.is_admin === 1 || u.is_admin === true || email === 'metabayn@gmail.com');
    if (isAdmin) {
      return Response.json({
        active: true,
        bound: true,
        is_admin: true,
        license_code: 'ADMIN'
      }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch {}

  const row: any = await env.DB.prepare(
    "SELECT voucher_code, activated_at, revoked_at FROM device_licenses WHERE user_id = ? AND device_hash = ? AND revoked_at IS NULL ORDER BY activated_at DESC LIMIT 1"
  ).bind(userId, deviceHash).first();

  if (!row) {
    return Response.json({ active: false, bound: false }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    await env.DB.prepare("UPDATE device_licenses SET last_seen_at = ? WHERE user_id = ? AND device_hash = ? AND revoked_at IS NULL")
      .bind(Date.now(), userId, deviceHash)
      .run();
  } catch {}

  return Response.json({
    active: true,
    bound: true,
    license_code: String(row.voucher_code || ''),
    activated_at: Number(row.activated_at || 0) || 0
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function handleToolLicenseStatus(req: Request, env: Env, authUserId?: string | number) {
  await ensureToolLicenseTables(env);
  const url = new URL(req.url);
  const userIdParam = url.searchParams.get('user_id') || url.searchParams.get('userId');
  const deviceHash = (url.searchParams.get('device_hash') || url.searchParams.get('deviceHash') || '').trim();
  const toolCodeRaw = url.searchParams.get('tool') || url.searchParams.get('tool_code') || url.searchParams.get('toolCode');
  const toolCode = String(toolCodeRaw || '').trim().toLowerCase();
  const userId = String((authUserId ?? userIdParam) ?? '').trim();
  if (!userId || !deviceHash || !toolCode) {
    return Response.json({ error: "Missing fields", error_code: "missing_fields" }, { status: 400 });
  }
  if (authUserId != null && String(authUserId) !== String(userId)) {
    return Response.json({ error: "User tidak valid", error_code: "user_mismatch" }, { status: 403 });
  }

  let userEmail = '';
  try {
    const u: any = await env.DB.prepare("SELECT email, is_admin FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    userEmail = String(u?.email || '').trim().toLowerCase();
    const isAdmin = u && (u.is_admin === 1 || u.is_admin === true || userEmail === 'metabayn@gmail.com');
    if (isAdmin) {
      return Response.json({
        active: true,
        bound: true,
        is_admin: true,
        tool_code: toolCode,
        license_code: 'ADMIN'
      }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch {}

  const row: any = await env.DB.prepare(
    "SELECT voucher_code, activated_at, revoked_at FROM device_tool_licenses WHERE user_id = ? AND device_hash = ? AND tool_code = ? AND revoked_at IS NULL ORDER BY activated_at DESC LIMIT 1"
  ).bind(userId, deviceHash, toolCode).first();

  if (row) {
    try {
      await env.DB.prepare("UPDATE device_tool_licenses SET last_seen_at = ? WHERE user_id = ? AND device_hash = ? AND tool_code = ? AND revoked_at IS NULL")
        .bind(Date.now(), userId, deviceHash, toolCode)
        .run();
    } catch {}
    return Response.json({
      active: true,
      bound: true,
      tool_code: toolCode,
      license_code: String(row.voucher_code || ''),
      activated_at: Number(row.activated_at || 0) || 0
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!userEmail) {
    return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
  }

  const voucher: any = await env.DB.prepare(
    "SELECT code, expires_at, max_usage, current_usage FROM vouchers WHERE type = 'tool_license' AND lower(tool_code) = lower(?) AND lower(allowed_emails) = lower(?) ORDER BY created_at DESC LIMIT 1"
  ).bind(toolCode, userEmail).first();

  if (!voucher || !voucher.code) {
    return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
  }

  const voucherCode = String(voucher.code || '').toUpperCase().trim();
  const maxUsage = Number(voucher.max_usage || 0) || 0;
  const currentUsage = Number(voucher.current_usage || 0) || 0;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
  }
  if (voucher.expires_at) {
    const now = new Date();
    const expiry = new Date(String(voucher.expires_at));
    if (!Number.isNaN(expiry.getTime()) && now > expiry) {
      return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  const existingClaim: any = await env.DB.prepare("SELECT user_id FROM voucher_claims WHERE voucher_code = ? LIMIT 1")
    .bind(voucherCode).first();
  if (existingClaim) {
    return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const nowMs = Date.now();
    const licenseId = `tlic_${crypto.randomUUID()}`;
    const stmts: any[] = [
      env.DB.prepare("INSERT INTO device_tool_licenses (id, user_id, device_hash, tool_code, voucher_code, activated_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .bind(licenseId, userId, deviceHash, toolCode, voucherCode, nowMs, nowMs),
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    ];
    await env.DB.batch(stmts);
    return Response.json({ active: true, bound: true, tool_code: toolCode, license_code: voucherCode, activated_at: nowMs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ active: false, bound: false, tool_code: toolCode }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function handleLicenseActivate(req: Request, env: Env, authUserId?: string | number) {
  await ensureLicenseTables(env);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const userId = String((authUserId ?? body.userId ?? body.user_id) ?? '').trim();
  const deviceHash = String(body.deviceHash ?? body.device_hash ?? '').trim();
  const codeRaw = String(body.code ?? body.license_code ?? '').trim();

  if (!userId || !deviceHash || !codeRaw) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  if (authUserId != null && String(authUserId) !== String(userId)) {
    return Response.json({ error: "User tidak valid", error_code: "user_mismatch" }, { status: 403 });
  }

  try {
    const u: any = await env.DB.prepare("SELECT email, is_admin FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    const email = String(u?.email || '').trim().toLowerCase();
    const isAdmin = u && (u.is_admin === 1 || u.is_admin === true || email === 'metabayn@gmail.com');
    if (isAdmin) {
      return Response.json({ success: true, message: "Admin tidak memerlukan aktivasi lisensi", license_code: 'ADMIN' });
    }
  } catch {}

  const voucherCode = codeRaw.toUpperCase().trim();

  const existingVoucher: any = await env.DB.prepare(
    "SELECT user_id, device_hash FROM device_licenses WHERE voucher_code = ? AND revoked_at IS NULL LIMIT 1"
  ).bind(voucherCode).first();
  if (existingVoucher) {
    const boundUserId = String(existingVoucher.user_id || '').trim();
    const boundDevice = String(existingVoucher.device_hash || '').trim();
    if (boundUserId === String(userId) && boundDevice === String(deviceHash)) {
      return Response.json({ success: true, message: "Lisensi sudah aktif di perangkat ini", license_code: voucherCode });
    }
    return Response.json({ error: "Lisensi sudah digunakan di perangkat lain", error_code: "license_already_used" }, { status: 409 });
  }

  const voucher: any = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(voucherCode).first();
  if (!voucher || String(voucher.type || '') !== 'license') {
    return Response.json({ error: "Kode lisensi tidak valid", error_code: "invalid_license" }, { status: 404 });
  }
  try {
    const allowed = String(voucher.allowed_emails || '').trim().toLowerCase();
    if (allowed) {
      const u: any = await env.DB.prepare("SELECT email FROM users WHERE id = ? LIMIT 1").bind(userId).first();
      const userEmail = String(u?.email || '').trim().toLowerCase();
      if (userEmail && allowed !== userEmail) {
        return Response.json({ error: "Kode lisensi ini tidak untuk email tersebut", error_code: "license_email_mismatch" }, { status: 403 });
      }
    }
  } catch {}
  if (voucher.expires_at) {
    const now = new Date();
    const expiry = new Date(String(voucher.expires_at));
    if (!Number.isNaN(expiry.getTime()) && now > expiry) {
      return Response.json({ error: "Lisensi sudah kadaluarsa", error_code: "expired" }, { status: 410 });
    }
  }

  const maxUsage = Number(voucher.max_usage || 0) || 0;
  const currentUsage = Number(voucher.current_usage || 0) || 0;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ error: "Lisensi sudah digunakan", error_code: "license_already_used" }, { status: 409 });
  }

  const globalClaim: any = await env.DB.prepare("SELECT user_id, device_hash FROM voucher_claims WHERE voucher_code = ? LIMIT 1")
    .bind(voucherCode).first();
  if (globalClaim) {
    const claimUserId = String(globalClaim.user_id || '').trim();
    const claimDevice = String(globalClaim.device_hash || '').trim();
    if (claimUserId === String(userId) && claimDevice === String(deviceHash)) {
      return Response.json({ success: true, message: "Lisensi sudah aktif di perangkat ini", license_code: voucherCode });
    }
    return Response.json({ error: "Lisensi sudah digunakan", error_code: "license_already_used" }, { status: 409 });
  }

  try {
    const nowMs = Date.now();
    const licenseId = `lic_${crypto.randomUUID()}`;
    const stmts: any[] = [
      env.DB.prepare("INSERT INTO device_licenses (id, user_id, device_hash, voucher_code, activated_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .bind(licenseId, userId, deviceHash, voucherCode, nowMs, nowMs),
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    ];
    await env.DB.batch(stmts);

    try {
      await env.DB.prepare(
        "UPDATE lynk_purchases SET status = 'activated', activated_at = ?, activation_started_at = COALESCE(activation_started_at, ?), user_id = COALESCE(user_id, ?), updated_at = ? WHERE voucher_code = ? AND deleted_at IS NULL"
      )
        .bind(nowMs, nowMs, userId, nowMs, voucherCode)
        .run();
    } catch {}

    if (maxUsage > 0 && (currentUsage + 1) >= maxUsage) {
      await env.DB.prepare("DELETE FROM vouchers WHERE code = ?").bind(voucherCode).run();
    }

    return Response.json({ success: true, message: "Lisensi berhasil diaktifkan", license_code: voucherCode });
  } catch (e: any) {
    return Response.json({ error: "Gagal aktivasi lisensi", error_code: "activation_failed" }, { status: 500 });
  }
}

export async function handleToolLicenseActivate(req: Request, env: Env, authUserId?: string | number) {
  await ensureToolLicenseTables(env);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const userId = String((authUserId ?? body.userId ?? body.user_id) ?? '').trim();
  const deviceHash = String(body.deviceHash ?? body.device_hash ?? '').trim();
  const codeRaw = String(body.code ?? body.license_code ?? '').trim();
  const toolCode = String(body.tool ?? body.tool_code ?? body.toolCode ?? '').trim().toLowerCase();

  if (!userId || !deviceHash || !codeRaw || !toolCode) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  if (authUserId != null && String(authUserId) !== String(userId)) {
    return Response.json({ error: "User tidak valid", error_code: "user_mismatch" }, { status: 403 });
  }

  try {
    const u: any = await env.DB.prepare("SELECT email, is_admin FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    const email = String(u?.email || '').trim().toLowerCase();
    const isAdmin = u && (u.is_admin === 1 || u.is_admin === true || email === 'metabayn@gmail.com');
    if (isAdmin) {
      return Response.json({ success: true, message: "Admin tidak memerlukan aktivasi lisensi", license_code: 'ADMIN', tool_code: toolCode });
    }
  } catch {}

  const voucherCode = codeRaw.toUpperCase().trim();

  const existingVoucher: any = await env.DB.prepare(
    "SELECT user_id, device_hash FROM device_tool_licenses WHERE voucher_code = ? AND revoked_at IS NULL LIMIT 1"
  ).bind(voucherCode).first();
  if (existingVoucher) {
    const boundUserId = String(existingVoucher.user_id || '').trim();
    const boundDevice = String(existingVoucher.device_hash || '').trim();
    if (boundUserId === String(userId) && boundDevice === String(deviceHash)) {
      return Response.json({ success: true, message: "Lisensi tools sudah aktif di perangkat ini", license_code: voucherCode, tool_code: toolCode });
    }
    return Response.json({ error: "Lisensi tools sudah digunakan di perangkat lain", error_code: "license_already_used" }, { status: 409 });
  }

  const voucher: any = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(voucherCode).first();
  if (!voucher || String(voucher.type || '') !== 'tool_license' || String(voucher.tool_code || '').trim().toLowerCase() !== toolCode) {
    return Response.json({ error: "Kode lisensi tools tidak valid", error_code: "invalid_license" }, { status: 404 });
  }

  try {
    const allowed = String(voucher.allowed_emails || '').trim().toLowerCase();
    if (allowed) {
      const u: any = await env.DB.prepare("SELECT email FROM users WHERE id = ? LIMIT 1").bind(userId).first();
      const userEmail = String(u?.email || '').trim().toLowerCase();
      if (userEmail && allowed !== userEmail) {
        return Response.json({ error: "Kode lisensi ini tidak untuk email tersebut", error_code: "license_email_mismatch" }, { status: 403 });
      }
    }
  } catch {}

  if (voucher.expires_at) {
    const now = new Date();
    const expiry = new Date(String(voucher.expires_at));
    if (!Number.isNaN(expiry.getTime()) && now > expiry) {
      return Response.json({ error: "Lisensi sudah kadaluarsa", error_code: "expired" }, { status: 410 });
    }
  }

  const maxUsage = Number(voucher.max_usage || 0) || 0;
  const currentUsage = Number(voucher.current_usage || 0) || 0;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ error: "Lisensi sudah digunakan", error_code: "license_already_used" }, { status: 409 });
  }

  const globalClaim: any = await env.DB.prepare("SELECT user_id, device_hash FROM voucher_claims WHERE voucher_code = ? LIMIT 1")
    .bind(voucherCode).first();
  if (globalClaim) {
    const claimUserId = String(globalClaim.user_id || '').trim();
    const claimDevice = String(globalClaim.device_hash || '').trim();
    if (claimUserId === String(userId) && claimDevice === String(deviceHash)) {
      return Response.json({ success: true, message: "Lisensi tools sudah aktif di perangkat ini", license_code: voucherCode, tool_code: toolCode });
    }
    return Response.json({ error: "Lisensi sudah digunakan", error_code: "license_already_used" }, { status: 409 });
  }

  try {
    const nowMs = Date.now();
    const licenseId = `tlic_${crypto.randomUUID()}`;
    const stmts: any[] = [
      env.DB.prepare("INSERT INTO device_tool_licenses (id, user_id, device_hash, tool_code, voucher_code, activated_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .bind(licenseId, userId, deviceHash, toolCode, voucherCode, nowMs, nowMs),
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    ];
    await env.DB.batch(stmts);

    if (maxUsage > 0 && (currentUsage + 1) >= maxUsage) {
      await env.DB.prepare("DELETE FROM vouchers WHERE code = ?").bind(voucherCode).run();
    }

    return Response.json({ success: true, message: "Lisensi tools berhasil diaktifkan", license_code: voucherCode, tool_code: toolCode });
  } catch {
    return Response.json({ error: "Gagal aktivasi lisensi", error_code: "activation_failed" }, { status: 500 });
  }
}

async function ensureLicenseSupportTables(env: Env) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS license_support_requests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        user_id TEXT NOT NULL,
        account_email TEXT NOT NULL,
        purchase_email TEXT NOT NULL,
        product_code TEXT,
        purchase_time_hint TEXT,
        amount_hint TEXT,
        note TEXT,
        admin_note TEXT,
        selected_voucher_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      `
    ).run();
  } catch {}

  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_license_support_status_created ON license_support_requests(status, created_at);").run(); } catch {}
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_license_support_user ON license_support_requests(user_id, created_at);").run(); } catch {}
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_license_support_purchase_email ON license_support_requests(purchase_email, created_at);").run(); } catch {}
}

function normalizeEmailValue(v: any) {
  return String(v ?? '').trim().toLowerCase();
}

function isValidEmailValue(email: string) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(String(email || ''));
}

export async function handleSupportLicenseClaim(req: Request, env: Env, authUserId?: string | number) {
  await ensureLicenseSupportTables(env);
  let body: any = {};
  try { body = await req.json(); } catch {}

  const userId = String(authUserId ?? '').trim();
  const purchaseEmail = normalizeEmailValue(body.purchase_email ?? body.purchaseEmail);
  const productCode = String(body.product_code ?? body.productCode ?? '').trim().toLowerCase();
  const purchaseTimeHint = String(body.purchase_time_hint ?? body.purchaseTimeHint ?? '').trim();
  const amountHint = String(body.amount_hint ?? body.amountHint ?? '').trim();
  const note = String(body.note ?? body.message ?? '').trim();

  if (!userId || !purchaseEmail) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  if (!isValidEmailValue(purchaseEmail)) {
    return Response.json({ error: "Email pembelian tidak valid", error_code: "invalid_email" }, { status: 422 });
  }

  const allowedProduct = productCode === 'license' || productCode === 'prompt_grabber';
  const normalizedProduct = allowedProduct ? productCode : '';

  try {
    const u: any = await env.DB.prepare("SELECT email FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    const accountEmail = normalizeEmailValue(u?.email || '');
    if (!accountEmail) return Response.json({ error: "Akun tidak valid", error_code: "account_invalid" }, { status: 403 });

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const cntRow: any = await env.DB.prepare(
      "SELECT COUNT(1) AS c FROM license_support_requests WHERE user_id = ? AND created_at >= ?"
    ).bind(userId, since).first();
    const c = Number(cntRow?.c ?? 0) || 0;
    if (c >= 5) {
      return Response.json({ error: "Terlalu banyak permintaan. Coba lagi besok.", error_code: "rate_limited" }, { status: 429 });
    }

    const id = `lsr_${crypto.randomUUID()}`;
    const now = Date.now();
    await env.DB.prepare(
      `
      INSERT INTO license_support_requests
      (id, status, user_id, account_email, purchase_email, product_code, purchase_time_hint, amount_hint, note, admin_note, selected_voucher_code, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `
    ).bind(
      id,
      userId,
      accountEmail,
      purchaseEmail,
      normalizedProduct || null,
      purchaseTimeHint || null,
      amountHint || null,
      note ? note.slice(0, 4000) : null,
      now,
      now
    ).run();

    return Response.json({ success: true, request_id: id, status: 'pending' });
  } catch (e: any) {
    return Response.json({ error: "Gagal mengirim permintaan", error_code: "request_failed" }, { status: 500 });
  }
}

export async function handleAdminListLicenseSupport(req: Request, env: Env) {
  await ensureLicenseSupportTables(env);
  const url = new URL(req.url);
  const status = String(url.searchParams.get('status') || 'pending').trim().toLowerCase();
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const limitRaw = Number(url.searchParams.get('limit') || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 100;

  const where: string[] = [];
  const binds: any[] = [];
  if (status && status !== 'all' && status !== '*') {
    where.push("status = ?");
    binds.push(status);
  }
  if (q) {
    where.push("(lower(account_email) LIKE ? OR lower(purchase_email) LIKE ? OR lower(note) LIKE ? OR lower(product_code) LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM license_support_requests
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?
    `
  ).bind(...binds, limit).all();

  return Response.json({ results: rows?.results || [] });
}

export async function handleAdminFindLynkPurchasesByEmail(req: Request, env: Env) {
  const url = new URL(req.url);
  const email = normalizeEmailValue(url.searchParams.get('email') || '');
  const limitRaw = Number(url.searchParams.get('limit') || 30);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 30;
  if (!email || !isValidEmailValue(email)) {
    return Response.json({ error: "Email tidak valid", error_code: "invalid_email" }, { status: 422 });
  }

  const rows = await env.DB.prepare(
    `
    SELECT id, idempotency_key, product_ref, email, voucher_code, payment_status, purchase_ts, status, email_status, email_last_error, created_at, updated_at
    FROM lynk_purchases
    WHERE deleted_at IS NULL AND lower(email) = lower(?)
    ORDER BY purchase_ts DESC, created_at DESC
    LIMIT ?
    `
  ).bind(email, limit).all();

  return Response.json({ results: rows?.results || [] });
}

export async function handleAdminApproveLicenseSupport(req: Request, env: Env) {
  await ensureLicenseSupportTables(env);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const ticketId = String(body.ticket_id ?? body.ticketId ?? '').trim();
  const voucherCodeRaw = String(body.voucher_code ?? body.voucherCode ?? '').trim();
  const newEmail = normalizeEmailValue(body.new_email ?? body.newEmail ?? '');
  const resend = body.resend === true || String(body.resend || '') === '1';

  if (!ticketId || !voucherCodeRaw || !newEmail) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  if (!isValidEmailValue(newEmail)) {
    return Response.json({ error: "Email baru tidak valid", error_code: "invalid_email" }, { status: 422 });
  }

  const voucherCode = voucherCodeRaw.toUpperCase().trim();
  const ticket: any = await env.DB.prepare("SELECT * FROM license_support_requests WHERE id = ? LIMIT 1").bind(ticketId).first();
  if (!ticket) return Response.json({ error: "Request tidak ditemukan", error_code: "not_found" }, { status: 404 });
  if (String(ticket.status || '') !== 'pending') {
    return Response.json({ error: "Request sudah diproses", error_code: "already_processed" }, { status: 409 });
  }

  const voucher: any = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ? LIMIT 1").bind(voucherCode).first();
  if (!voucher) return Response.json({ error: "Voucher tidak ditemukan", error_code: "voucher_not_found" }, { status: 404 });

  try {
    await env.DB.prepare("UPDATE vouchers SET allowed_emails = ? WHERE code = ?").bind(newEmail, voucherCode).run();
  } catch (e: any) {
    return Response.json({ error: "Gagal update voucher", error_code: "voucher_update_failed" }, { status: 500 });
  }

  try {
    await env.DB.prepare("UPDATE lynk_purchases SET email = ?, updated_at = ? WHERE voucher_code = ? AND deleted_at IS NULL")
      .bind(newEmail, Date.now(), voucherCode)
      .run();
  } catch {}

  const now = Date.now();
  try {
    await env.DB.prepare(
      "UPDATE license_support_requests SET status = 'approved', selected_voucher_code = ?, admin_note = ?, updated_at = ? WHERE id = ?"
    )
      .bind(voucherCode, `approved:${newEmail}`, now, ticketId)
      .run();
  } catch {}

  if (resend) {
    try {
      const vType = String(voucher.type || '').trim().toLowerCase();
      const toolCode = String(voucher.tool_code || '').trim().toLowerCase();
      const subject = vType === 'tool_license'
        ? `Kode Lisensi Tools ${toolCode === 'prompt_grabber' ? 'Prompt Grabber' : 'Metabayn'} (1 Perangkat)`
        : 'Kode Lisensi Metabayn (1 Perangkat)';
      const html = vType === 'tool_license'
        ? getToolLicenseVoucherTemplate(newEmail, voucherCode, toolCode === 'prompt_grabber' ? 'Tools Prompt Grabber' : 'Tools')
        : getLicenseVoucherTemplate(newEmail, voucherCode, 0, 0);
      await sendEmail(newEmail, subject, html, env);
    } catch {}
  }

  return Response.json({ success: true, status: 'approved', voucher_code: voucherCode, new_email: newEmail, resent: resend });
}

export async function handleAdminRejectLicenseSupport(req: Request, env: Env) {
  await ensureLicenseSupportTables(env);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const ticketId = String(body.ticket_id ?? body.ticketId ?? '').trim();
  const adminNote = String(body.admin_note ?? body.adminNote ?? '').trim();
  if (!ticketId) {
    return Response.json({ error: "Field tidak lengkap", error_code: "missing_fields" }, { status: 400 });
  }
  const ticket: any = await env.DB.prepare("SELECT status FROM license_support_requests WHERE id = ? LIMIT 1").bind(ticketId).first();
  if (!ticket) return Response.json({ error: "Request tidak ditemukan", error_code: "not_found" }, { status: 404 });
  if (String(ticket.status || '') !== 'pending') {
    return Response.json({ error: "Request sudah diproses", error_code: "already_processed" }, { status: 409 });
  }

  await env.DB.prepare(
    "UPDATE license_support_requests SET status = 'rejected', admin_note = ?, updated_at = ? WHERE id = ?"
  )
    .bind(adminNote ? adminNote.slice(0, 2000) : 'rejected', Date.now(), ticketId)
    .run();

  return Response.json({ success: true, status: 'rejected' });
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
  const normalizeCompact = (s: string) => normalizeTitle(s).replace(/[^a-z0-9]/g, '');
  const includesAny = (hay: string, needles: string[]) => {
    const h = normalizeCompact(hay);
    if (!h) return false;
    for (const n of needles) {
      const nn = normalizeCompact(n);
      if (nn && h.includes(nn)) return true;
    }
    return false;
  };
  const collectItemHints = (item: any): string[] => {
    const hints: any[] = [];
    const add = (v: any) => { if (typeof v === 'string' && v.trim()) hints.push(v); };
    add(item?.title);
    add(item?.name);
    add(item?.product_name);
    add(item?.productName);
    add(item?.product);
    add(item?.product_ref);
    add(item?.productRef);
    add(item?.ref);
    add(item?.sku);
    add(item?.slug);
    add(item?.url);
    add(item?.link);
    add(item?.href);
    add(item?.id);
    add(item?.item_id);
    add(item?.itemId);
    return hints.map((x) => String(x));
  };

  const TITLE_MAP: Record<string, any> = {
    [normalizeTitle("Metabayn – Smart Metadata Generator App for Images & Videos")]: { type: 'license' },
    [normalizeTitle("Metabayn - Smart Metadata Agent")]: { type: 'license' }
  };

  const results: any[] = [];
  let totalAmountRp = 0;
  let hasLicenseItem = false;
  const rawString = (() => { try { return JSON.stringify(body || {}).toLowerCase(); } catch { return ''; } })();
  const productRefMatched = rawString.includes('851png1z505m');
  let hasPromptGrabberItem = false;
  const promptGrabberRefMatched = rawString.includes('wp6d9o37o51d');
  const promptGrabberNeedles = ['prompt grabber', 'promptgrabber', 'prompt_grabber', 'wp6d9o37o51d'];
  const messageTitleHint = String(messageData?.title || messageData?.product?.title || '').trim();

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

    let matched = false;
    let voucherType: 'license' | null = null;

    if (TITLE_MAP[titleNormalized]) {
      matched = true;
      const mapData = TITLE_MAP[titleNormalized];
      voucherType = mapData.type === 'license' ? 'license' : null;
      if (voucherType === 'license') hasLicenseItem = true;
    }

    if (!matched) {
      const isSmartMetadataAgent =
        titleNormalized.includes('metabayn') &&
        (titleNormalized.includes('smart metadata agent') || titleNormalized.includes('smart metadata generator'));

      if (isSmartMetadataAgent) {
        matched = true;
        voucherType = 'license';
        hasLicenseItem = true;
      }
    }

    if (!matched) {
      const itemHints = collectItemHints(item);
      if (messageTitleHint) itemHints.push(messageTitleHint);
      const isPromptGrabber =
        includesAny(title, promptGrabberNeedles) ||
        includesAny(messageTitleHint, promptGrabberNeedles) ||
        itemHints.some((h) => includesAny(h, promptGrabberNeedles));
      if (isPromptGrabber) {
        hasPromptGrabberItem = true;
        matched = true;
      }
    }

    if (!matched) continue;
    if (voucherType === 'license') hasLicenseItem = true;
  }

  if (!hasLicenseItem && productRefMatched) {
    hasLicenseItem = true;
  }

  if (!hasPromptGrabberItem && promptGrabberRefMatched) {
    hasPromptGrabberItem = true;
  }

  if (!hasLicenseItem && !hasPromptGrabberItem) {
    return Response.json({ success: true, ignored: true, reason: 'unsupported_product', order_id: orderId || null });
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(email).first();

  if (hasLicenseItem || hasPromptGrabberItem) {
    const nowMs = Date.now();
    const idempotencyKey = orderId || (body?.event_id ? String(body.event_id) : `lynkid:${nowMs}`);
    const purchaseId = existingPurchase?.id ? String(existingPurchase.id) : crypto.randomUUID();
    const productRef = normalizeTitle(items[0]?.title || '');

    const voucherTypeFinal: 'license' | 'tool_license' = hasLicenseItem ? 'license' : 'tool_license';
    const toolCodeFinal = voucherTypeFinal === 'tool_license' ? 'prompt_grabber' : null;
    const voucherCode = existingPurchase?.voucher_code
      ? String(existingPurchase.voucher_code)
      : generatePrefixedVoucherCode(voucherTypeFinal, toolCodeFinal);

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
        "INSERT OR IGNORE INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, tool_code, created_at) VALUES (?, 0, 1, 0, NULL, ?, ?, 0, ?, ?)"
      ).bind(
        voucherCode,
        email,
        voucherTypeFinal,
        toolCodeFinal,
        new Date().toISOString()
      ).run();
    } catch {}

    const emailSubject = voucherTypeFinal === 'tool_license'
      ? 'Kode Lisensi Tools Prompt Grabber (1 Perangkat)'
      : 'Kode Lisensi Metabayn (1 Perangkat)';
    const emailHtml = getLicenseVoucherTemplate(email, voucherCode, 0, 0);

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
      type: voucherTypeFinal,
      tool_code: toolCodeFinal
    });

    if (isEmailTestMode) {
      emailOutcome = 'skipped_test_mode';
      emailError = null;
    }
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
          total_tokens_added: 0,
          duration_days: 0,
          results: safeResults,
          processed_at: new Date().toISOString()
      };
      await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
        .bind('last_lynkid_processing', JSON.stringify(summary)).run();
  } catch (logErr) {
      console.error("Failed to log Lynk.id processing summary:", logErr);
  }

  return Response.json({ success: true, bundle_mode: 'single_voucher_v2', generated: results });
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
        tool_code TEXT,
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
    await env.DB.prepare("ALTER TABLE vouchers ADD COLUMN tool_code TEXT;").run();
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
function generateShortCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

function voucherPrefix(kind: 'license' | 'tool_license', toolCode: string | null) {
  if (kind === 'tool_license') {
    const tc = String(toolCode || '').trim().toLowerCase();
    if (tc === 'prompt_grabber') return 'TPG-';
    if (tc) return `TL-${tc.toUpperCase().slice(0, 8)}-`;
    return 'TL-';
  }
  return 'APM-';
}

function generateVoucherSuffix(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function generatePrefixedVoucherCode(kind: 'license' | 'tool_license', toolCode: string | null) {
  return `${voucherPrefix(kind, toolCode)}${generateVoucherSuffix(12)}`;
}
