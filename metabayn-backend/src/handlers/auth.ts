import { Env } from '../types';
import { hashPassword, verifyPassword, createToken } from '../lib/crypto';
import { sendEmail, getVerificationTemplate, getWelcomeTemplate, getResetPasswordTemplate, getResetPasswordRequestTemplate } from '../utils/email';
import { applyPendingLynkPurchasesForUser } from './lynkPurchase';

async function ensureAuthSchema(env: Env) {
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN confirmation_token TEXT").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN confirmation_expires_at INTEGER").run(); } catch {}

  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS email_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT, subject TEXT, status TEXT, error TEXT, timestamp INTEGER)"
    ).run();
  } catch {}

  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS auth_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, email TEXT, action TEXT, ip_address TEXT, device_hash TEXT, timestamp INTEGER)"
    ).run();
  } catch {}
}

export async function ensureOrColumns(env: Env) {
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_api_key TEXT").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_api_key_id TEXT").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_key_name TEXT").run(); } catch {}
}

export async function ensureUserOpenRouterKey(userId: number, email: string, env: Env) {
  await ensureOrColumns(env);
  let row: any = null;
  try {
    row = await env.DB.prepare("SELECT or_api_key, or_api_key_id FROM users WHERE id = ?").bind(userId).first();
  } catch {
    return;
  }
  if (row && String(row.or_api_key || '').trim()) return;
  const normalizeSecret = (value: unknown) => {
    const trimmed = String(value ?? '').trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return trimmed.slice(1, -1).trim();
      }
    }
    return trimmed;
  };
  const mgmt = normalizeSecret(env.OPENROUTER_MANAGEMENT_KEY || "");
  if (!mgmt) return;
  const name = `metabayn-${userId}-${(email || '').split('@')[0]}`.slice(0, 40);

  const createEndpoints = [
    "https://openrouter.ai/api/v1/management/keys",
    "https://openrouter.ai/api/v1/keys"
  ];

  const deleteKeyIfPossible = async (keyHash: string | null) => {
    const h = String(keyHash || '').trim();
    if (!h) return;
    try {
      await fetch(`https://openrouter.ai/api/v1/keys/${encodeURIComponent(h)}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${mgmt}` },
        signal: AbortSignal.timeout(5000)
      });
    } catch {}
  };

  let key: string | null = null;
  let keyId: string | null = null;
  for (const endpoint of createEndpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mgmt}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) continue;

      const data: any = await res.json().catch(() => null);
      key = data?.key || data?.data?.key || data?.token || data?.data?.token || null;
      keyId =
        data?.id ||
        data?.data?.id ||
        data?.hash ||
        data?.data?.hash ||
        null;

      if (key) break;
    } catch {}
  }

  if (!key) return;
  try {
    const upd: any = await env.DB.prepare(
      "UPDATE users SET or_api_key = ?, or_api_key_id = ?, or_key_name = ? WHERE id = ? AND (or_api_key IS NULL OR TRIM(or_api_key) = '')"
    )
      .bind(key, keyId || null, name, userId)
      .run();
    const changes = Number(upd?.meta?.changes || 0);
    if (changes <= 0) {
      await deleteKeyIfPossible(keyId);
    }
  } catch {
    await deleteKeyIfPossible(keyId);
    return;
  }
}

export async function handleRegister(req: Request, env: Env) {
  await ensureAuthSchema(env);
  const body: any = await req.json();
  const { email, password, device_hash } = body;

  if (!email || !password || !device_hash) return Response.json({ error: "Missing fields" }, { status: 400 });

  // Basic format validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return Response.json({ error: "Invalid email format. Please check your email." }, { status: 400 });
  }

  // RATE LIMITING REMOVED PER USER REQUEST
  // (Previously lines 17-37)

  const hashedPassword = await hashPassword(password);
  
  // Generate Confirmation Token
  const confirmToken = crypto.randomUUID();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  try {
    // Fetch USD Rate for initial balance ($3)
    let initialTokens = 48900; // Default fallback (16300 * 3)
    try {
        const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
        if (rateCfg && rateCfg.value) {
            const rate = Number(rateCfg.value);
            if (!isNaN(rate) && rate > 0) {
                initialTokens = Math.round(3 * rate);
            }
        }
    } catch (e) {
        console.error("Failed to fetch rate for initial balance, using default:", e);
        // Fallback is already set to 48900
    }

    // Ensure initialTokens is never 0 or invalid for the first device use
    if (!initialTokens || initialTokens <= 0) initialTokens = 48900;

    // Check if this device has already registered an account before
    const existingDeviceUser = await env.DB.prepare("SELECT id FROM users WHERE device_hash = ?")
      .bind(device_hash)
      .first();

    // If this device was used before, do NOT grant the free $3 again
    if (existingDeviceUser) {
        initialTokens = 0;
    }

    // Insert user with initial tokens (first device registration gets $3 equivalent)
    await env.DB.prepare("INSERT INTO users (email, password, tokens, status, confirmation_token, confirmation_expires_at, device_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(email, hashedPassword, initialTokens, 'pending', confirmToken, expiresAt, device_hash)
      .run();

    // Get the last inserted user ID for potential rollback
    const userIdResult = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!userIdResult) {
        // This should realistically never happen if the insert succeeded
        throw new Error("Failed to retrieve user ID after registration.");
    }
    const newUserId = userIdResult.id;

    const emailServiceConfigured = (() => {
        const k = (env as any)?.RESEND_API_KEY;
        return typeof k === 'string' && k.trim().length > 0;
    })();

    if (!emailServiceConfigured) {
        await env.DB.prepare("UPDATE users SET status = 'active', confirmation_token = NULL, confirmation_expires_at = NULL WHERE id = ?")
            .bind(newUserId)
            .run();
        try { await applyPendingLynkPurchasesForUser(env, String(newUserId), String(email), 'register'); } catch {}
        try {
            await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, error, timestamp) VALUES (?, ?, 'skipped', ?, ?)")
                .bind(email, "Verify Your Email Address", "Email service not configured (RESEND_API_KEY missing)", Date.now())
                .run();
        } catch {}

        try {
            const ip = req.headers.get("CF-Connecting-IP") || "unknown";
            await env.DB.prepare("INSERT INTO auth_logs (user_id, email, action, ip_address, device_hash, timestamp) VALUES (?, ?, 'register', ?, ?, ?)")
                .bind(newUserId, email, ip, device_hash, Math.floor(Date.now() / 1000))
                .run();
        } catch (e) { console.error("Auth log failed:", e); }

        return Response.json({
            success: true,
            message: "Registration successful. Email verification is temporarily unavailable, so your account has been activated automatically."
        });
    }

    try {
        // Construct Link & Send Verification Email (BLOCKING)
        const workerUrl = "https://metabayn-backend.metabayn.workers.dev";
        const link = `${workerUrl}/auth/verify?token=${confirmToken}`;
        const emailHtml = getVerificationTemplate(email, password, link);
        
        await sendEmail(email, "Verify Your Email Address", emailHtml, env);

        // Log email success
        await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, timestamp) VALUES (?, ?, 'sent', ?)")
            .bind(email, "Verify Your Email Address", Date.now())
            .run();

    } catch (emailErr: any) {
        console.error("Email send failed, rolling back user registration:", emailErr);
        
        // Rollback: Delete the user that was just created
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(newUserId).run();
        
        // Also log the email failure
        await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, error, timestamp) VALUES (?, ?, 'failed', ?, ?)")
            .bind(email, "Verify Your Email Address", String(emailErr), Date.now())
            .run();

        // Return a more descriptive error for debugging (especially for Resend Sandbox issues)
        const errorMessage = emailErr.message || String(emailErr);
        return Response.json({ error: `Registration failed (Email Service): ${errorMessage}` }, { status: 400 });
    }

    // Log Registration to Auth Logs
    try {
        const newUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (newUser) {
             const ip = req.headers.get("CF-Connecting-IP") || "unknown";
             await env.DB.prepare("INSERT INTO auth_logs (user_id, email, action, ip_address, device_hash, timestamp) VALUES (?, ?, 'register', ?, ?, ?)")
                 .bind(newUser.id, email, ip, device_hash, Math.floor(Date.now()/1000))
                 .run();
        }
    } catch (e) { console.error("Auth log failed:", e); }

    try {
        const u = await env.DB.prepare("SELECT id, email FROM users WHERE email = ? LIMIT 1").bind(email).first();
        if (u && u.id) {
            await applyPendingLynkPurchasesForUser(env, String(u.id), String(u.email || email), 'register');
        }
    } catch (e) {
        console.error("Failed to apply pending Lynk purchases on register:", e);
    }

    return Response.json({ success: true, message: "Registration successful. Please check your email to verify your account." });
  } catch (e: any) {
    console.error("Register Error:", e);
    // Only return "Email already exists" if it's actually a constraint violation
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return Response.json({ error: "Email already exists" }, { status: 409 });
    }
    // Otherwise return the real error so we can debug
    return Response.json({ error: "Registration failed: " + e.message }, { status: 500 });
  }
}

export async function handleVerify(req: Request, env: Env) {
    await ensureAuthSchema(env);
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) return new Response("Missing token", { status: 400 });

    const user = await env.DB.prepare("SELECT * FROM users WHERE confirmation_token = ?").bind(token).first();
    
    if (!user) {
        return new Response("Invalid or expired token.", { status: 400 });
    }

    if (user.confirmation_expires_at && (user.confirmation_expires_at as number) < Date.now()) {
        return new Response("Token expired. Please register again.", { status: 400 });
    }

    // Activate User & Send Welcome Email
    try {
        // Send Welcome Email (Verification Success)
        const emailHtml = getWelcomeTemplate(user.email as string);
        await sendEmail(user.email as string, "Verification Successful - Welcome to MetaBayn!", emailHtml, env);

        // Update User: Active, Clear Token
        await env.DB.prepare("UPDATE users SET status = 'active', confirmation_token = NULL WHERE id = ?")
            .bind(user.id)
            .run();
      try { await applyPendingLynkPurchasesForUser(env, String(user.id), String(user.email), 'verify'); } catch (e) { console.error("Failed to apply pending Lynk purchases on verify:", e); }

    } catch (e) {
        console.error("Verification error:", e);
        // Even if email fails, we should probably still activate the user? 
        // Or fail? Let's activate them but log error.
        await env.DB.prepare("UPDATE users SET status = 'active', confirmation_token = NULL WHERE id = ?")
            .bind(user.id)
            .run();
        try { await applyPendingLynkPurchasesForUser(env, String(user.id), String(user.email), 'verify'); } catch (e2) { console.error("Failed to apply pending Lynk purchases on verify:", e2); }
    }

    // Return HTML Success Page
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Account Activated</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #121212; color: #fff; }
          .container { text-align: center; padding: 40px; background: #1e1e1e; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
          h1 { color: #4caf50; }
          p { color: #aaa; }
        </style>
      </head>
      <body>
        <div class="container">
           <h1>Account Activated!</h1>
           <p>Your email has been verified successfully.</p>
           <p>You can now return to the MetaBayn app and login.</p>
        </div>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
}

export async function handleLogin(req: Request, env: Env) {
  await ensureAuthSchema(env);
  const body: any = await req.json();
  const { email, password, device_hash } = body;

  if (!device_hash) return Response.json({ error: "Device Hash required" }, { status: 400 });

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return Response.json({ error: "Email not registered" }, { status: 401 });

  // CHECK STATUS (Strict: Must verify email)
  if (user.status === 'pending') {
      return Response.json({ error: "Please verify your email address before logging in." }, { status: 403 });
  }

  const valid = await verifyPassword(password, user.password as string);
  if (!valid) return Response.json({ error: "Incorrect password" }, { status: 401 });

  // FORCE ADMIN for metabayn@gmail.com
  if (user.email === 'metabayn@gmail.com') {
     user.is_admin = 1;
  }

  // Check Subscription Expiry Logic
  if (user.subscription_active === 1 && user.subscription_expiry) {
      try {
        const expiryTime = new Date(user.subscription_expiry as string).getTime();
        if (Date.now() > expiryTime) {
            // Expired! Update DB and local object
            await env.DB.prepare("UPDATE users SET subscription_active = 0 WHERE id = ?").bind(user.id).run();
            user.subscription_active = 0;
        }
      } catch {}
  }

  try {
      const existing = await env.DB.prepare("SELECT DISTINCT device_hash FROM auth_logs WHERE user_id = ? AND device_hash IS NOT NULL AND device_hash != ''")
          .bind(String(user.id))
          .all();

      const rows = Array.isArray(existing) ? existing : (existing.results || []);
      const knownDevices = rows.map((r: any) => r.device_hash).filter((v: any) => typeof v === 'string' && v.length > 0);

      const isKnown = knownDevices.includes(device_hash);

      if (!isKnown && knownDevices.length >= 3) {
          return Response.json({
              error: "This account has already been used on 3 different devices. Please contact support if you need to reset devices."
          }, { status: 403 });
      }
  } catch (e) {
      console.error("Device limit check failed", e);
  }

  // --- ANTI CLONING LOGIC ---
  let currentDeviceHash = user.device_hash;
  
  if (!currentDeviceHash) {
    // First time login on a device, bind it!
    await env.DB.prepare("UPDATE users SET device_hash = ? WHERE id = ?").bind(device_hash, user.id).run();
  } else if (currentDeviceHash !== device_hash) {
    // Device mismatch! Block access.
    // DISABLED PER USER REQUEST (Allow multiple devices for now)
    // return Response.json({ error: "SECURITY ALERT: Account is bound to another device. Anti-cloning protection active." }, { status: 403 });
    
    // Optional: Update to new device? Or just ignore?
    // Let's just ignore the mismatch and allow login.
    // Or maybe update it to the latest one so it tracks "last used"?
    // For now, let's just NOT block.
  }

  try {
    await applyPendingLynkPurchasesForUser(env, String(user.id), String(user.email), 'login');
  } catch (e) {
    console.error("Failed to apply pending Lynk purchases on login:", e);
  }

  let freshUser: any = user;
  try {
    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    if (row) freshUser = row;
  } catch {}

  if (!env.JWT_SECRET || String(env.JWT_SECRET).trim().length < 8) {
    return Response.json({ error: "Server misconfigured: JWT_SECRET missing" }, { status: 500 });
  }
  const token = await createToken(freshUser, env.JWT_SECRET);
  
  // Log Login
  try {
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      await env.DB.prepare("INSERT INTO auth_logs (user_id, email, action, ip_address, device_hash, timestamp) VALUES (?, ?, 'login', ?, ?, ?)")
          .bind(user.id, user.email, ip, device_hash || 'unknown', Math.floor(Date.now()/1000))
          .run();
  } catch {}

  return Response.json({
    token,
    user: {
      id: freshUser.id,
      email: freshUser.email,
      tokens: freshUser.tokens,
      is_admin: freshUser.is_admin || 0,
      subscription_active: freshUser.subscription_active,
      subscription_expiry: freshUser.subscription_expiry
    }
  });
}

export async function handleGetMe(userId: number, env: Env) {
  await ensureAuthSchema(env);
  try {
    const user = await env.DB.prepare("SELECT id, email, tokens, is_admin, subscription_active, subscription_expiry, status, created_at FROM users WHERE id = ?").bind(userId).first();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });
    
    // Force admin for specific email
    if (user.email === 'metabayn@gmail.com') {
        user.is_admin = 1;
    }

    try {
      if (String(user.status || 'active') !== 'pending') {
        await applyPendingLynkPurchasesForUser(env, String(user.id), String(user.email), 'login');
      }
    } catch (e) {
      console.error("Failed to apply pending Lynk purchases on getMe:", e);
    }
    
    const fresh = await env.DB.prepare("SELECT id, email, tokens, is_admin, subscription_active, subscription_expiry, created_at FROM users WHERE id = ?").bind(userId).first();
    return Response.json(fresh || user, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleForgotPassword(req: Request, env: Env) {
  await ensureAuthSchema(env);
  if (req.method !== 'POST') {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const emailRaw = body.email || '';
  const email = String(emailRaw).trim();

  if (!email) {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }

  const user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first();

  if (!user) {
    return Response.json({ success: true, message: "If this email is registered, a reset email has been sent." });
  }

  const resetToken = crypto.randomUUID();
  const expiresAt = Date.now() + 60 * 60 * 1000;

  await env.DB.prepare("UPDATE users SET confirmation_token = ?, confirmation_expires_at = ? WHERE id = ?")
    .bind(resetToken, expiresAt, user.id)
    .run();

  try {
    const workerUrl = "https://metabayn-backend.metabayn.workers.dev";
    const link = `${workerUrl}/auth/reset-password?token=${resetToken}`;
    const html = getResetPasswordRequestTemplate(user.email as string, link);
    await sendEmail(user.email as string, "Reset Your Metabayn Studio Password", html, env);

    await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, timestamp) VALUES (?, ?, 'sent', ?)")
      .bind(user.email, "Password Reset Request", Date.now())
      .run();
  } catch (e: any) {
    await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, error, timestamp) VALUES (?, ?, 'failed', ?, ?)")
      .bind(user.email, "Password Reset Request", String(e), Date.now())
      .run();

    return Response.json({ error: "Failed to send reset email. Please contact support." }, { status: 500 });
  }

  return Response.json({ success: true, message: "If this email is registered, a reset email has been sent." });
}

export async function handleResetPasswordPage(req: Request, env: Env) {
  await ensureAuthSchema(env);
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE confirmation_token = ?").bind(token).first();

  if (!user) {
    return new Response("Invalid or expired token.", { status: 400 });
  }

  if (user.confirmation_expires_at && (user.confirmation_expires_at as number) < Date.now()) {
    return new Response("Reset link expired.", { status: 400 });
  }

  if (req.method === 'GET') {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #121212; color: #fff; }
          .container { text-align: center; padding: 40px; background: #1e1e1e; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 420px; }
          h1 { color: #4caf50; margin-bottom: 16px; }
          p { color: #aaa; font-size: 14px; }
          form { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
          input { padding: 10px 12px; border-radius: 6px; border: 1px solid #333; background: #121212; color: #fff; font-size: 14px; }
          button { margin-top: 10px; padding: 10px 12px; border-radius: 6px; border: none; background: #4caf50; color: #fff; font-weight: bold; cursor: pointer; font-size: 14px; }
          button:hover { background: #43a047; }
          .note { margin-top: 16px; font-size: 12px; color: #888; }
          .error { color: #f44336; margin-top: 10px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="container">
           <h1>Reset Password</h1>
           <p>Please enter your new password for your Metabayn Studio account.</p>
           <form method="POST">
             <input type="password" name="password" placeholder="New Password" required minlength="6" />
             <input type="password" name="confirm_password" placeholder="Confirm New Password" required minlength="6" />
             <button type="submit">Update Password</button>
           </form>
           <p class="note">After updating, please return to the Metabayn Studio app and login with your new password.</p>
        </div>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (req.method !== 'POST') {
    return new Response("Method not allowed", { status: 405 });
  }

  const form = await req.formData();
  const passRaw = form.get('password') || '';
  const confirmRaw = form.get('confirm_password') || '';
  const pass = String(passRaw);
  const confirm = String(confirmRaw);

  if (!pass || pass.length < 6 || !confirm) {
    return new Response("Invalid password", { status: 400 });
  }

  if (pass !== confirm) {
    return new Response("Passwords do not match", { status: 400 });
  }

  const hashedPassword = await hashPassword(pass);

  await env.DB.prepare("UPDATE users SET password = ?, confirmation_token = NULL WHERE id = ?")
    .bind(hashedPassword, user.id)
    .run();

  try {
    const html = getResetPasswordTemplate(user.email as string, pass);
    await sendEmail(user.email as string, "Your Metabayn Studio Password Has Been Reset", html, env);

    await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, timestamp) VALUES (?, ?, 'sent', ?)")
      .bind(user.email, "Password Reset", Date.now())
      .run();
  } catch (e: any) {
    await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, error, timestamp) VALUES (?, ?, 'failed', ?, ?)")
      .bind(user.email, "Password Reset", String(e), Date.now())
      .run();
  }

  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Password Updated</title>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #121212; color: #fff; }
        .container { text-align: center; padding: 40px; background: #1e1e1e; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 420px; }
        h1 { color: #4caf50; margin-bottom: 16px; }
        p { color: #aaa; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
         <h1>Password Updated</h1>
         <p>Your password has been updated successfully.</p>
         <p>You can now return to the Metabayn Studio app and login with your new password.</p>
      </div>
    </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}
