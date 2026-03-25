import { Env } from '../types';
import { hashPassword } from '../lib/crypto';
import { getExchangeRate } from '../utils/currency';

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
      .bind(provider, model_name, input_price, output_price, profit_multiplier || 1.6, active !== undefined ? active : 1, fallback_priority || 1)
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

export async function handleExportUsersCsv(_request: Request, env: Env): Promise<Response> {
    try {
        const users = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
        const results = Array.isArray(users) ? users : (users.results || []);

        if (results.length === 0) {
            return new Response("id,email,tokens,created_at\n", {
                headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=users.csv" }
            });
        }

        // Get headers from first object
        const headers = Object.keys(results[0]).join(',');
        
        const rows = results.map((u: any) => {
            return Object.values(u).map((v: any) => {
                if (v === null || v === undefined) return '';
                // Escape commas/newlines if string
                if (typeof v === 'string') {
                    if (v.includes(',') || v.includes('\n') || v.includes('"')) {
                        return `"${v.replace(/"/g, '""')}"`;
                    }
                }
                return v;
            }).join(',');
        }).join('\n');

        return new Response(headers + '\n' + rows, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=users.csv"
            }
        });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleListUsers(request: Request, env: Env): Promise<Response> {
    try {
        const users = await env.DB.prepare("SELECT id, email, tokens, is_admin, created_at, subscription_active, subscription_expiry FROM users ORDER BY created_at DESC").all();
        // Handle both D1 result formats (array directly or object with results)
        const results = Array.isArray(users) ? users : (users.results || []);

        const nowMs = Date.now();
        const bonusRes = await env.DB.prepare(
            `
            SELECT user_id, SUM(remaining_tenths) AS bonus_remaining_tenths
            FROM bonus_token_grants
            WHERE deleted_at IS NULL
              AND remaining_tenths > 0
              AND expires_at > ?
            GROUP BY user_id
            `
        )
            .bind(nowMs)
            .all()
            .catch(() => null as any);
        const bonusRows = Array.isArray(bonusRes) ? bonusRes : (bonusRes?.results || []);
        const bonusByUserId = new Map<string, number>();
        for (const r of bonusRows) {
            const k = String((r as any)?.user_id ?? '');
            const v = Number((r as any)?.bonus_remaining_tenths ?? 0);
            if (k) bonusByUserId.set(k, Number.isFinite(v) ? v : 0);
        }

        const formattedUsers = results.map(user => {
            const tokensNum = Number((user as any)?.tokens ?? 0) || 0;
            const tokensTenths = Math.round(tokensNum * 10);
            const bonusTenths = bonusByUserId.get(String((user as any)?.id ?? '')) || 0;
            const topupTenths = Math.max(0, tokensTenths - bonusTenths);
            return {
                ...user,
                bonus_tokens: bonusTenths / 10,
                topup_tokens: topupTenths / 10,
                // D1 returns timestamps as numbers (seconds). JS Date needs milliseconds.
                created_at: (user as any).created_at ? new Date((user as any).created_at * 1000).toISOString() : null
            };
        });

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
            .bind(activeVal, expiry_date || null, user_id)
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

async function deleteUserCascade(userId: number | string, env: Env) {
    await env.DB.prepare("DELETE FROM voucher_claims WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM history WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM topup_transactions WHERE user_id = ?").bind(String(userId)).run();
    await env.DB.prepare("DELETE FROM auth_logs WHERE user_id = ?").bind(String(userId)).run();
    return await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

export async function handleDeleteUser(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
        const body: any = await request.json();
        const { user_id } = body;

        if (!user_id) {
            return Response.json({ error: "User ID is required" }, { status: 400 });
        }

        const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(user_id).first();
        if (!user) {
             return Response.json({ error: "User not found" }, { status: 404 });
        }
        if (user.email === 'metabayn@gmail.com') {
             return Response.json({ error: "Cannot delete super admin account" }, { status: 403 });
        }
        const result = await deleteUserCascade(user_id, env);

        if (result.meta && result.meta.changes === 0) {
            return Response.json({ success: false, error: "User delete failed (0 changes)" });
        }

        return Response.json({ success: true, message: "User deleted successfully" });
    } catch (e: any) {
        console.error("Delete user error:", e);
        return Response.json({ error: "Delete failed: " + e.message }, { status: 500 });
    }
}

export async function handlePurgeNonAdminUsers(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
        const superAdmin = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind('metabayn@gmail.com').first();
        if (!superAdmin) {
            return Response.json({ error: "Super admin account not found; purge aborted" }, { status: 409 });
        }

        const toDelete = await env.DB.prepare("SELECT id, email, is_admin FROM users WHERE email <> ? AND IFNULL(is_admin, 0) = 0").bind('metabayn@gmail.com').all();
        const rows = Array.isArray(toDelete) ? toDelete : (toDelete.results || []);

        const deleted: Array<{ id: number | string; email: string }> = [];
        const failed: Array<{ id: number | string; email: string; error: string }> = [];

        for (const u of rows) {
            try {
                const userId = u.id;
                const email = String(u.email || '');
                const isAdmin = !!u.is_admin;
                if (email === 'metabayn@gmail.com' || isAdmin) continue;
                const res = await deleteUserCascade(userId, env);
                if (res.meta && res.meta.changes === 0) {
                    failed.push({ id: userId, email, error: "0 changes" });
                } else {
                    deleted.push({ id: userId, email });
                }
            } catch (e: any) {
                failed.push({ id: u.id, email: String(u.email || ''), error: String(e?.message || e) });
            }
        }

        const remaining = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind('metabayn@gmail.com').all();
        const remainingRows = Array.isArray(remaining) ? remaining : (remaining.results || []);

        return Response.json({
            success: failed.length === 0,
            deleted_count: deleted.length,
            failed_count: failed.length,
            remaining_count: remainingRows.length,
            deleted,
            failed
        });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

async function fetchOpenRouterKeyList(env: Env) {
    const mgmt = env.OPENROUTER_MANAGEMENT_KEY || "";
    if (!mgmt) return null;
    const res = await fetch("https://openrouter.ai/api/v1/keys", {
        headers: { "Authorization": `Bearer ${mgmt}` }
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    return Array.isArray(data?.data) ? data.data : null;
}

async function ensureOpenRouterColumns(env: Env) {
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_api_key TEXT").run(); } catch {}
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_api_key_id TEXT").run(); } catch {}
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN or_key_name TEXT").run(); } catch {}
}

async function getUsersColumnSet(env: Env): Promise<Set<string>> {
    const info = await env.DB.prepare("PRAGMA table_info(users);").all();
    const rows = Array.isArray(info) ? info : (info.results || []);
    return new Set(rows.map((r: any) => String(r?.name || '')).filter(Boolean));
}

function toIsoFromUnknownTimestamp(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return null;
        if (s.includes('T')) {
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d.toISOString();
        }
        const n = Number(s);
        if (!isNaN(n)) {
            const ms = n > 1e10 ? n : n * 1000;
            const d = new Date(ms);
            return isNaN(d.getTime()) ? null : d.toISOString();
        }
        return null;
    }
    if (typeof value === 'number') {
        const ms = value > 1e10 ? value : value * 1000;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
}

export async function handleAdminUsersOverview(_request: Request, env: Env): Promise<Response> {
    try {
        await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").bind('metabayn@gmail.com').run().catch(() => null);

        const colSet = await getUsersColumnSet(env);
        const baseCols = ["id", "email", "tokens", "is_admin", "created_at", "subscription_active", "subscription_expiry"];
        const optionalCols: string[] = [];
        if (colSet.has("or_api_key_id")) optionalCols.push("or_api_key_id");
        if (colSet.has("or_key_name")) optionalCols.push("or_key_name");
        const sql = `SELECT ${baseCols.concat(optionalCols).join(", ")} FROM users ORDER BY created_at DESC`;

        const usersRes = await env.DB.prepare(sql).all();
        const users = Array.isArray(usersRes) ? usersRes : (usersRes.results || []);

        const nowMs = Date.now();
        const bonusRes = await env.DB.prepare(
            `
            SELECT user_id, SUM(remaining_tenths) AS bonus_remaining_tenths
            FROM bonus_token_grants
            WHERE deleted_at IS NULL
              AND remaining_tenths > 0
              AND expires_at > ?
            GROUP BY user_id
            `
        )
            .bind(nowMs)
            .all()
            .catch(() => null as any);
        const bonusRows = Array.isArray(bonusRes) ? bonusRes : (bonusRes?.results || []);
        const bonusByUserId = new Map<string, number>();
        for (const r of bonusRows) {
            const k = String((r as any)?.user_id ?? '');
            const v = Number((r as any)?.bonus_remaining_tenths ?? 0);
            if (k) bonusByUserId.set(k, Number.isFinite(v) ? v : 0);
        }

        const now = Math.floor(Date.now() / 1000);
        const t24h = now - 86400;
        const t7d = now - 7 * 86400;
        const t30d = now - 30 * 86400;

        const usageRes = await env.DB.prepare(`
            SELECT
              user_id,
              MAX(timestamp) as last_ts,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(cost, 0) ELSE 0 END) as cost_24h,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(cost, 0) ELSE 0 END) as cost_7d,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(cost, 0) ELSE 0 END) as cost_30d,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(input_tokens, 0) ELSE 0 END) as input_24h,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(output_tokens, 0) ELSE 0 END) as output_24h,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(input_tokens, 0) ELSE 0 END) as input_7d,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(output_tokens, 0) ELSE 0 END) as output_7d,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(input_tokens, 0) ELSE 0 END) as input_30d,
              SUM(CASE WHEN timestamp >= ? THEN IFNULL(output_tokens, 0) ELSE 0 END) as output_30d,
              SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as req_24h,
              SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as req_7d,
              SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as req_30d
            FROM history
            GROUP BY user_id
        `).bind(
            t24h, t7d, t30d,
            t24h, t24h,
            t7d, t7d,
            t30d, t30d,
            t24h, t7d, t30d
        ).all();
        const usageRows = Array.isArray(usageRes) ? usageRes : (usageRes.results || []);
        const usageByUserId = new Map<number, any>();
        for (const r of usageRows) {
            usageByUserId.set(Number(r.user_id), r);
        }

        const orKeys = await fetchOpenRouterKeyList(env);
        const orByHash = new Map<string, any>();
        const orByName = new Map<string, any>();
        if (Array.isArray(orKeys)) {
            for (const k of orKeys) {
                if (k && k.hash) orByHash.set(String(k.hash), k);
                if (k && k.name) orByName.set(String(k.name), k);
            }
        }

        const formattedUsers = users.map(u => {
            const uid = Number(u.id);
            const usage = usageByUserId.get(uid) || {};
            const createdAtIso = toIsoFromUnknownTimestamp(u.created_at);
            const lastTsIso = toIsoFromUnknownTimestamp(usage.last_ts);

            const tokensNum = Number((u as any)?.tokens ?? 0) || 0;
            const tokensTenths = Math.round(tokensNum * 10);
            const bonusTenths = bonusByUserId.get(String((u as any)?.id ?? '')) || 0;
            const topupTenths = Math.max(0, tokensTenths - bonusTenths);

            const keyHash = (u as any)?.or_api_key_id ? String((u as any).or_api_key_id) : '';
            const keyName = (u as any)?.or_key_name ? String((u as any).or_key_name) : '';
            let orInfo = null as any;
            if (keyHash && orByHash.has(keyHash)) orInfo = orByHash.get(keyHash);
            if (!orInfo && keyName && orByName.has(keyName)) orInfo = orByName.get(keyName);
            if (!orInfo && !keyName) {
                const prefix = `metabayn-${uid}-`;
                for (const [nm, info] of orByName.entries()) {
                    if (nm.startsWith(prefix)) { orInfo = info; break; }
                }
            }

            return {
                id: u.id,
                email: u.email,
                tokens: u.tokens,
                bonus_tokens: bonusTenths / 10,
                topup_tokens: topupTenths / 10,
                is_admin: u.is_admin,
                subscription_active: u.subscription_active,
                subscription_expiry: u.subscription_expiry,
                created_at: createdAtIso,
                last_request_at: lastTsIso,
                app_usage: {
                    cost_24h: Number(usage.cost_24h || 0),
                    cost_7d: Number(usage.cost_7d || 0),
                    cost_30d: Number(usage.cost_30d || 0),
                    input_24h: Number(usage.input_24h || 0),
                    output_24h: Number(usage.output_24h || 0),
                    input_7d: Number(usage.input_7d || 0),
                    output_7d: Number(usage.output_7d || 0),
                    input_30d: Number(usage.input_30d || 0),
                    output_30d: Number(usage.output_30d || 0),
                    req_24h: Number(usage.req_24h || 0),
                    req_7d: Number(usage.req_7d || 0),
                    req_30d: Number(usage.req_30d || 0)
                },
                openrouter_usage: orInfo ? {
                    hash: orInfo.hash,
                    name: orInfo.name,
                    disabled: orInfo.disabled,
                    usage: Number(orInfo.usage || 0),
                    usage_daily: Number(orInfo.usage_daily || 0),
                    usage_weekly: Number(orInfo.usage_weekly || 0),
                    usage_monthly: Number(orInfo.usage_monthly || 0),
                    limit: orInfo.limit ?? null,
                    limit_remaining: orInfo.limit_remaining ?? null,
                    limit_reset: orInfo.limit_reset ?? null,
                    updated_at: orInfo.updated_at ?? null
                } : null
            };
        });

        return Response.json(formattedUsers);
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}

export async function handleAdminCleanupOpenRouterKeys(request: Request, env: Env): Promise<Response> {
    try {
        const mgmt = String(env.OPENROUTER_MANAGEMENT_KEY || '').trim();
        if (!mgmt) return Response.json({ error: "OPENROUTER_MANAGEMENT_KEY missing" }, { status: 500 });

        const url = new URL(request.url);
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200) || 200));
        const dryRun = String(url.searchParams.get('dry_run') || '').trim() === '1';

        await ensureOpenRouterColumns(env);

        const orKeys = await fetchOpenRouterKeyList(env);
        if (!Array.isArray(orKeys)) {
            return Response.json({ error: "Failed to fetch OpenRouter keys list" }, { status: 502 });
        }

        const usersRes = await env.DB.prepare("SELECT id, or_api_key_id, or_key_name FROM users").all();
        const users = Array.isArray(usersRes) ? usersRes : (usersRes.results || []);

        const keepHashes = new Set<string>();
        const keepNames = new Set<string>();
        for (const u of users) {
            const h = String((u as any)?.or_api_key_id || '').trim();
            const n = String((u as any)?.or_key_name || '').trim();
            if (h) keepHashes.add(h);
            if (n) keepNames.add(n);
        }

        const candidates = orKeys
            .filter((k: any) => k && String(k.name || '').startsWith('metabayn-'))
            .filter((k: any) => {
                const hash = String(k.hash || '').trim();
                const name = String(k.name || '').trim();
                if (!hash || !name) return false;
                if (keepHashes.has(hash)) return false;
                if (keepNames.has(name)) return false;
                return true;
            })
            .slice(0, limit);

        const deleted: Array<{ hash: string; name: string }> = [];
        const failed: Array<{ hash: string; name: string; status?: number; error: string }> = [];

        for (const k of candidates) {
            const hash = String(k.hash || '').trim();
            const name = String(k.name || '').trim();
            if (!hash || !name) continue;
            if (dryRun) {
                deleted.push({ hash, name });
                continue;
            }
            try {
                const res = await fetch(`https://openrouter.ai/api/v1/keys/${encodeURIComponent(hash)}`, {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${mgmt}` },
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) {
                    const t = await res.text().catch(() => '');
                    failed.push({ hash, name, status: res.status, error: t || 'request_failed' });
                    continue;
                }
                deleted.push({ hash, name });
            } catch (e: any) {
                failed.push({ hash, name, error: String(e?.message || e) });
            }
        }

        return Response.json({
            success: failed.length === 0,
            dry_run: dryRun,
            scanned: orKeys.length,
            candidates: candidates.length,
            deleted_count: deleted.length,
            failed_count: failed.length,
            deleted,
            failed
        });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
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
            let val: any = value;
            if (key === 'ai_concurrency_limit') {
                let n = Number(value);
                if (!Number.isFinite(n)) n = 5;
                n = Math.max(1, Math.min(n, 10));
                val = n;
            }
            const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
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

export async function handleAdminSyncUsdIdr(_request: Request, env: Env): Promise<Response> {
  try {
    const live = await getExchangeRate(env);
    if (!live || typeof live !== 'number' || live <= 0) {
      return Response.json({ error: 'Failed to fetch live USD/IDR rate' }, { status: 502 });
    }
    await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind('usd_idr_rate', String(live)).run();
    await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind('usd_idr_rate_last_update', String(Date.now())).run();
    return Response.json({ success: true, usd_idr_rate: live, updated_at: Date.now() });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
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

function parseLimitOffset(url: URL, maxLimit: number) {
  const limitRaw = url.searchParams.get('limit');
  const pageRaw = url.searchParams.get('page');
  let limit = Number(limitRaw || 100);
  if (!Number.isFinite(limit)) limit = 100;
  limit = Math.max(1, Math.min(maxLimit, Math.trunc(limit)));
  let page = Number(pageRaw || 1);
  if (!Number.isFinite(page)) page = 1;
  page = Math.max(1, Math.trunc(page));
  const offset = (page - 1) * limit;
  return { limit, offset, page };
}

export async function handleAdminLynkPurchases(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const { limit, offset } = parseLimitOffset(url, 200);
  const status = String(url.searchParams.get('status') || '').trim();
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();

  try {
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

    const where: string[] = ["p.deleted_at IS NULL"];
    const args: any[] = [];
    if (status) {
      where.push("p.status = ?");
      args.push(status);
    }
    if (q) {
      where.push("(lower(p.email) LIKE ? OR lower(p.id) LIKE ? OR lower(p.idempotency_key) LIKE ? OR lower(p.voucher_code) LIKE ?)");
      const like = `%${q}%`;
      args.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT
        p.id,
        p.idempotency_key,
        p.provider,
        p.product_ref,
        p.email,
        p.voucher_code,
        p.payment_status,
        p.purchase_ts,
        p.status,
        p.user_id,
        p.activated_at,
        p.activation_started_at,
        p.signature_status,
        p.email_status,
        p.email_last_error,
        p.failure_count,
        p.next_retry_at,
        p.last_error,
        p.created_at,
        p.updated_at,
        vc.user_id AS voucher_redeemed_by_user_id,
        vc.created_at AS voucher_redeemed_at
      FROM lynk_purchases p
      LEFT JOIN voucher_claims vc ON vc.voucher_code = p.voucher_code
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await env.DB.prepare(sql).bind(...args, limit, offset).all();
    const rows = Array.isArray(rowsRes) ? rowsRes : (rowsRes.results || []);

    const countsRes = await env.DB.prepare(
      `
      SELECT status, COUNT(*) AS c
      FROM lynk_purchases
      WHERE deleted_at IS NULL
      GROUP BY status
      `
    ).all();
    const countsRows = Array.isArray(countsRes) ? countsRes : (countsRes.results || []);
    const counts: Record<string, number> = {};
    for (const r of countsRows) counts[String(r.status)] = Number(r.c || 0);

    return Response.json({ purchases: rows, counts });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('no such table')) return Response.json({ purchases: [], counts: {} });
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function handleAdminLynkWebhookLogs(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const { limit, offset } = parseLimitOffset(url, 200);
  const purchaseId = String(url.searchParams.get('purchase_id') || '').trim();
  const ip = String(url.searchParams.get('ip') || '').trim();

  try {
    const where: string[] = [];
    const args: any[] = [];
    if (purchaseId) {
      where.push("purchase_id = ?");
      args.push(purchaseId);
    }
    if (ip) {
      where.push("ip = ?");
      args.push(ip);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT
        id,
        provider,
        idempotency_key,
        purchase_id,
        received_at,
        ip,
        auth_ok,
        signature_status,
        status_code,
        error
      FROM lynk_webhook_logs
      ${whereSql}
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await env.DB.prepare(sql).bind(...args, limit, offset).all();
    const rows = Array.isArray(rowsRes) ? rowsRes : (rowsRes.results || []);
    return Response.json({ logs: rows });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('no such table')) return Response.json({ logs: [] });
    return Response.json({ error: msg }, { status: 500 });
  }
}
