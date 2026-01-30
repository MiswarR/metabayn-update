import { Env } from '../types';
import { hashPassword } from '../lib/crypto';

export async function handleAdminModelPrices(req: Request, env: Env) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/');
  // /admin/model-prices/:id -> ["", "admin", "model-prices", "123"]
  const id = pathParts[3];

  if (method === 'GET') {
    // List all
    const results = await env.DB.prepare("SELECT * FROM model_prices ORDER BY fallback_priority ASC").all();
    return Response.json(results.results);
  }

  if (method === 'POST') {
    // Add new
    const body: any = await req.json();
    const { provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority } = body;
    
    try {
      await env.DB.prepare(`
        INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(provider, model_name, input_price, output_price, profit_multiplier || 1.5, active !== undefined ? active : 1, fallback_priority || 1)
      .run();
      return Response.json({ success: true });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  if (method === 'PUT' && id) {
    // Edit existing
    const body: any = await req.json();
    const { provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority } = body;
    
    try {
      // Dynamic update query builder would be better, but fixed for now
      await env.DB.prepare(`
        UPDATE model_prices 
        SET provider = ?, model_name = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
        WHERE id = ?
      `)
      .bind(provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority, id)
      .run();
      return Response.json({ success: true });
    } catch (e: any) {
       return Response.json({ error: e.message }, { status: 500 });
    }
  }

  if (method === 'DELETE' && id) {
    await env.DB.prepare("DELETE FROM model_prices WHERE id = ?").bind(id).run();
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function handleListUsers(request: Request, env: Env): Promise<Response> {
    try {
        const users = await env.DB.prepare("SELECT id, email, tokens, is_admin, created_at, subscription_active, subscription_expiry FROM users ORDER BY created_at DESC").all();
        // Handle both D1 result formats (array directly or object with results)
        const results = Array.isArray(users) ? users : (users.results || []);

        const formattedUsers = results.map(user => ({
            ...user,
            // D1 returns timestamps as numbers (seconds). JS Date needs milliseconds.
            created_at: user.created_at ? new Date(user.created_at * 1000).toISOString() : null
        }));

        return Response.json(formattedUsers);
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleUpdateSubscription(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: "Method not allowed" }, { status: 405 });
    
    try {
        const body: any = await request.json();
        const { user_id, is_active, expiry_date } = body;
        
        if (!user_id) return Response.json({ error: "User ID required" }, { status: 400 });
        
        // is_active should be boolean or 0/1. expiry_date should be string or null
        const activeVal = is_active ? 1 : 0;
        
        const result = await env.DB.prepare("UPDATE users SET subscription_active = ?, subscription_expiry = ? WHERE id = ?")
            .bind(activeVal, expiry_date, user_id)
            .run();

        // Check if any row was actually updated
        if (result.meta && result.meta.changes === 0) {
             return Response.json({ success: false, error: "User not found or no changes made" });
        }
            
        return Response.json({ success: true, changes: result.meta.changes });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
        const body: any = await request.json();
        const { user_id, new_password } = body;

        if (!user_id || !new_password) {
            return Response.json({ error: "User ID and new password are required" }, { status: 400 });
        }

        if (new_password.length < 6) {
            return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
        }

        const hashedPassword = await hashPassword(new_password);

        const result = await env.DB.prepare("UPDATE users SET password = ? WHERE id = ?")
            .bind(hashedPassword, user_id)
            .run();

        if (result.meta && result.meta.changes === 0) {
            return Response.json({ success: false, error: "User not found" });
        }

        return Response.json({ success: true, message: "Password updated successfully" });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleDeleteUser(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
        const body: any = await request.json();
        const { user_id } = body;

        if (!user_id) {
            return Response.json({ error: "User ID is required" }, { status: 400 });
        }

        // Prevent deleting special accounts
        const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(user_id).first();
        if (!user) {
             return Response.json({ error: "User not found" }, { status: 404 });
        }
        if (user.email === 'metabayn@gmail.com') {
             return Response.json({ error: "Cannot delete super admin account" }, { status: 403 });
        }

        // --- Execute Deletions sequentially ---
        // We do NOT use try-catch here because if these fail, the final delete will fail due to FK constraints anyway.
        // It is better to fail fast or ensure these succeed.

        // 1. Delete Voucher Claims (Has Foreign Key: user_id INTEGER)
        // Bind as-is (number/string) usually works, but if strict, number is safer for INTEGER column.
        await env.DB.prepare("DELETE FROM voucher_claims WHERE user_id = ?").bind(user_id).run();

        // 2. Delete History (Has Foreign Key: user_id INTEGER)
        await env.DB.prepare("DELETE FROM history WHERE user_id = ?").bind(user_id).run();

        // 3. Delete Topup Transactions (user_id TEXT - No FK but good cleanup)
        // Bind as String because column is TEXT
        await env.DB.prepare("DELETE FROM topup_transactions WHERE user_id = ?").bind(String(user_id)).run();

        // 4. Delete Auth Logs (user_id TEXT - No FK)
        await env.DB.prepare("DELETE FROM auth_logs WHERE user_id = ?").bind(String(user_id)).run();

        // 5. Delete User (Parent Table)
        const result = await env.DB.prepare("DELETE FROM users WHERE id = ?")
            .bind(user_id)
            .run();

        if (result.meta && result.meta.changes === 0) {
            return Response.json({ success: false, error: "User delete failed (0 changes)" });
        }

        return Response.json({ success: true, message: "User deleted successfully" });
    } catch (e: any) {
        console.error("Delete user error:", e);
        return Response.json({ error: "Delete failed: " + e.message }, { status: 500 });
    }
}

export async function handleSeedUsers(request: Request, env: Env): Promise<Response> {
    try {
        // Check if users already exist
        const count: any = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
        if (count && count.count > 0) {
            return Response.json({ message: "Users already exist", count: count.count });
        }

        const dummyUsers = [
            { email: "user1@example.com", tokens: 1000, is_admin: 0, subscription_active: 0 },
            { email: "user2@example.com", tokens: 5000, is_admin: 0, subscription_active: 1, subscription_expiry: new Date(Date.now() + 86400000 * 30).toISOString() },
            { email: "admin@metabayn.com", tokens: 999999, is_admin: 1, subscription_active: 1, subscription_expiry: new Date(Date.now() + 86400000 * 365).toISOString() },
            { email: "expired@example.com", tokens: 0, is_admin: 0, subscription_active: 1, subscription_expiry: new Date(Date.now() - 86400000).toISOString() },
            { email: "newuser@example.com", tokens: 100, is_admin: 0, subscription_active: 0 }
        ];

        const stmt = env.DB.prepare("INSERT INTO users (email, password, tokens, is_admin, subscription_active, subscription_expiry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
        
        const batch = dummyUsers.map(u => 
            stmt.bind(u.email, "hashed_password_placeholder", u.tokens, u.is_admin, u.subscription_active, u.subscription_expiry || null, new Date().toISOString())
        );

        await env.DB.batch(batch);

        return Response.json({ success: true, message: `Seeded ${dummyUsers.length} users` });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleAdminConfig(request: Request, env: Env): Promise<Response> {
  const method = request.method;

  if (method === 'GET') {
    const configs = await env.DB.prepare("SELECT * FROM app_config").all();
    const configMap: Record<string, any> = {};
    configs.results.forEach((row: any) => {
        try {
            configMap[row.key] = JSON.parse(row.value);
        } catch {
            configMap[row.key] = row.value;
        }
    });
    return Response.json(configMap);
  }

  if (method === 'POST') {
    try {
        const body = await request.json() as Record<string, any>;
        
        const batch = [];
        
        for (const [key, value] of Object.entries(body)) {
            const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            // Prepare a fresh statement for each item to avoid any bind reuse issues
            batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind(key, valStr));
        }
        
        if (batch.length > 0) {
            await env.DB.batch(batch);
        }
        
        return Response.json({ success: true });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

// Sync Official Model Prices into DB (Upsert by model_name)
export async function handleAdminAuthLogs(request: Request, env: Env): Promise<Response> {
  const method = request.method;

  if (method === 'GET') {
    try {
        const logs = await env.DB.prepare("SELECT * FROM auth_logs ORDER BY timestamp DESC LIMIT 100").all();
        const results = Array.isArray(logs) ? logs : (logs.results || []);
        return Response.json(results);
    } catch (e: any) {
        // If table doesn't exist, return empty
        if (e.message.includes('no such table')) return Response.json([]);
        return Response.json({ error: e.message }, { status: 500 });
    }
  }

  if (method === 'POST') {
      // Manual Init / Migration for Auth Logs
      try {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS auth_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email TEXT NOT NULL,
                action TEXT NOT NULL,
                ip_address TEXT,
                device_hash TEXT,
                timestamp INTEGER DEFAULT (unixepoch())
            )
          `).run();

          // Also init rate_limits if missing
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )
          `).run();

          return Response.json({ success: true, message: "Tables initialized (auth_logs, rate_limits)" });
      } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
      }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function handleSyncModelPrices(request: Request, env: Env): Promise<Response> {
  try {
    // Fetch global profit margin from config
    let profitPercent = 60;
    try {
      const cfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
      if (cfg && cfg.value) profitPercent = Number(cfg.value);
    } catch {}
    const profitMultiplier = 1 + (profitPercent / 100);

    // Curated official prices (USD per 1M tokens)
    const OFFICIAL: Array<{provider:string, model_name:string, input_price:number, output_price:number, active:number, fallback_priority:number}> = [
      // OpenAI (Updated Dec 2025)
      { provider: 'openai', model_name: 'o1', input_price: 15.00, output_price: 60.00, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'o1-mini', input_price: 3.00, output_price: 12.00, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'o3-mini', input_price: 1.10, output_price: 4.40, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'gpt-4o', input_price: 2.50, output_price: 10.00, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'gpt-4o-mini', input_price: 0.15, output_price: 0.60, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'gpt-4.5-preview', input_price: 75.00, output_price: 150.00, active: 0, fallback_priority: 1 },
      { provider: 'openai', model_name: 'gpt-4-turbo', input_price: 10.00, output_price: 30.00, active: 1, fallback_priority: 1 },
      
      // OpenAI Legacy / Custom Aliases
      { provider: 'openai', model_name: 'gpt-4.1', input_price: 3.00, output_price: 12.00, active: 1, fallback_priority: 1 },
      { provider: 'openai', model_name: 'gpt-4o-realtime', input_price: 5.00, output_price: 20.00, active: 0, fallback_priority: 1 },
      { provider: 'openai', model_name: 'o1-preview', input_price: 15.00, output_price: 60.00, active: 0, fallback_priority: 1 },
      
      // Gemini
      { provider: 'gemini', model_name: 'gemini-3.0-flash-preview', input_price: 0.35, output_price: 3.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-3.0-pro-preview', input_price: 1.50, output_price: 8.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-3.0-ultra', input_price: 4.00, output_price: 12.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.5-ultra', input_price: 2.50, output_price: 12.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.5-pro', input_price: 1.25, output_price: 10.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.5-flash', input_price: 0.30, output_price: 2.50, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.5-flash-lite', input_price: 0.10, output_price: 0.40, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-ultra', input_price: 2.50, output_price: 12.00, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-pro', input_price: 3.50, output_price: 10.50, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-pro-exp-02-05', input_price: 3.50, output_price: 10.50, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-flash', input_price: 0.10, output_price: 0.40, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-flash-exp', input_price: 0.10, output_price: 0.40, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-flash-lite', input_price: 0.075, output_price: 0.30, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-2.0-flash-lite-preview-02-05', input_price: 0.075, output_price: 0.30, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-1.5-pro', input_price: 3.50, output_price: 10.50, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-1.5-flash', input_price: 0.075, output_price: 0.30, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-1.5-flash-8b', input_price: 0.0375, output_price: 0.15, active: 1, fallback_priority: 1 },
      { provider: 'gemini', model_name: 'gemini-pro', input_price: 0.50, output_price: 1.50, active: 1, fallback_priority: 1 },
    ];

    // Upsert entries
    for (const p of OFFICIAL) {
      const existing = await env.DB.prepare("SELECT id FROM model_prices WHERE model_name = ?").bind(p.model_name).first();
      if (existing && existing.id) {
        await env.DB.prepare(`
          UPDATE model_prices 
          SET provider = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
          WHERE id = ?
        `).bind(p.provider, p.input_price, p.output_price, profitMultiplier, p.active, p.fallback_priority, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(p.provider, p.model_name, p.input_price, p.output_price, profitMultiplier, p.active, p.fallback_priority).run();
      }
    }

    return Response.json({ success: true, count: OFFICIAL.length });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleSyncLiveModelPrices(request: Request, env: Env): Promise<Response> {
  try {
    let profitPercent = 60;
    try {
      const cfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
      if (cfg && cfg.value) profitPercent = Number(cfg.value);
    } catch {}
    const profitMultiplier = 1 + (profitPercent / 100);

    const upsert = async (provider: string, model_name: string, input_price: number, output_price: number, active = 1, fallback_priority = 1) => {
      const existing = await env.DB.prepare("SELECT id FROM model_prices WHERE model_name = ?").bind(model_name).first();
      if (existing && existing.id) {
        await env.DB.prepare(`
          UPDATE model_prices 
          SET provider = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
          WHERE id = ?
        `).bind(provider, input_price, output_price, profitMultiplier, active, fallback_priority, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(provider, model_name, input_price, output_price, profitMultiplier, active, fallback_priority).run();
      }
    };

    let count = 0;

    try {
      const res = await fetch('https://openai.com/api/pricing');
      const html = await res.text();
      const pick = (name: string) => {
        const re = new RegExp(name + ".*?\$([0-9\.]+).*?\$([0-9\.]+)", 'is');
        const m = html.match(re);
        if (m) return { in: Number(m[1]), out: Number(m[2]) };
        return null;
      };
      const o4o = pick('gpt-4o');
      if (o4o) { await upsert('openai', 'gpt-4o', o4o.in, o4o.out); count++; }
      const o4omini = pick('gpt-4o-mini');
      if (o4omini) { await upsert('openai', 'gpt-4o-mini', o4omini.in, o4omini.out); count++; }
      const g41 = pick('gpt-4.1');
      if (g41) { await upsert('openai', 'gpt-4.1', g41.in, g41.out); count++; }
      const o1 = pick('o1');
      if (o1) { await upsert('openai', 'o1', o1.in, o1.out); count++; }
      const o3 = pick('o3');
      if (o3) { await upsert('openai', 'o3', o3.in, o3.out); count++; }
      const o4mini = pick('o4-mini');
      if (o4mini) { await upsert('openai', 'o4-mini', o4mini.in, o4mini.out); count++; }
    } catch {}

    try {
      const res = await fetch('https://ai.google.dev/pricing');
      const html = await res.text();
      const pick = (name: string) => {
        const re = new RegExp(name + ".*?\$([0-9\.]+).*?\$([0-9\.]+)", 'is');
        const m = html.match(re);
        if (m) return { in: Number(m[1]), out: Number(m[2]) };
        return null;
      };
      const g15pro = pick('Gemini 1\.5 Pro');
      if (g15pro) { await upsert('gemini', 'gemini-1.5-pro', g15pro.in, g15pro.out); count++; }
      const g15flash = pick('Gemini 1\.5 Flash');
      if (g15flash) { await upsert('gemini', 'gemini-1.5-flash', g15flash.in, g15flash.out); count++; }
      const g15flash8b = pick('Flash-8B');
      if (g15flash8b) { await upsert('gemini', 'gemini-1.5-flash-8b', g15flash8b.in, g15flash8b.out); count++; }
      const g20flash = pick('Gemini 2\.0 Flash');
      if (g20flash) { await upsert('gemini', 'gemini-2.0-flash', g20flash.in, g20flash.out); count++; }
      const g20flashlite = pick('Flash Lite');
      if (g20flashlite) { await upsert('gemini', 'gemini-2.0-flash-lite', g20flashlite.in, g20flashlite.out); count++; }
      const g25pro = pick('Gemini 2\.5 Pro');
      if (g25pro) { await upsert('gemini', 'gemini-2.5-pro', g25pro.in, g25pro.out); count++; }
      const g25flash = pick('Gemini 2\.5 Flash');
      if (g25flash) { await upsert('gemini', 'gemini-2.5-flash', g25flash.in, g25flash.out); count++; }
    } catch {}

    if (count === 0) {
      const fallback = [
        ['openai','gpt-4o',5.0,15.0],
        ['openai','gpt-4o-mini',0.15,0.60],
        ['openai','gpt-4.1',5.0,15.0],
        ['openai','o1',15.0,60.0],
        ['openai','o3',4.0,16.0],
        ['openai','o4-mini',0.20,0.80],
        ['gemini','gemini-1.5-pro',3.5,10.5],
        ['gemini','gemini-1.5-flash',0.075,0.30],
        ['gemini','gemini-1.5-flash-8b',0.0375,0.15],
        ['gemini','gemini-2.0-flash',0.10,0.40],
        ['gemini','gemini-2.0-flash-lite',0.075,0.30],
        ['gemini','gemini-2.5-pro',1.25,10.0],
        ['gemini','gemini-2.5-flash',0.30,2.50]
      ];
      for (const [prov, name, ip, op] of fallback) {
        await upsert(String(prov), String(name), Number(ip), Number(op));
      }
      count = fallback.length;
    }

    return Response.json({ success: true, count });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
