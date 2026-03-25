import { Env } from '../types';
import { chargeUserBalanceFromUsdCost, reverseBalanceTransaction } from '../utils/balanceLedger.js';

export async function handleUserUsage(req: Request, env: Env) {
  const url = new URL(req.url);
  // /admin/users/:id/usage -> ["", "admin", "users", "123", "usage"]
  const pathParts = url.pathname.split('/');
  const userId = pathParts[3];

  if (!userId) {
    return Response.json({ error: "User ID required" }, { status: 400 });
  }

  try {
    const results = await env.DB.prepare(`
      SELECT 
        date(timestamp, 'unixepoch') as day, 
        SUM(input_tokens) as total_input, 
        SUM(output_tokens) as total_output, 
        SUM(cost) as total_cost,
        COUNT(*) as request_count
      FROM history 
      WHERE user_id = ? 
      GROUP BY day 
      ORDER BY day DESC
    `).bind(userId).all();

    return Response.json(results.results);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleExportUsageCsv(req: Request, env: Env) {
  try {
    const results = await env.DB.prepare(`
      SELECT 
        u.email,
        u.id as user_id,
        date(h.timestamp, 'unixepoch') as day,
        SUM(h.input_tokens) as total_input,
        SUM(h.output_tokens) as total_output,
        SUM(h.cost) as total_cost,
        COUNT(h.id) as request_count
      FROM history h
      JOIN users u ON h.user_id = u.id
      GROUP BY u.id, day
      ORDER BY day DESC, u.email ASC
    `).all();

    // Generate CSV
    const rows = results.results as any[];
    const headers = ["Date", "User Email", "User ID", "Input Tokens", "Output Tokens", "Total Cost ($)", "Requests"];
    
    let csv = headers.join(",") + "\n";
    
    for (const row of rows) {
      csv += [
        row.day,
        row.email,
        row.user_id,
        row.total_input || 0,
        row.total_output || 0,
        (row.total_cost || 0).toFixed(6), // Cost is small usually
        row.request_count
      ].join(",") + "\n";
    }

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=user_usage_report.csv"
      }
    });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleAuditCheck(req: Request, env: Env) {
  try {
    // 1. Check Negative Balances (Critical Leak)
    const negativeUsers = await env.DB.prepare("SELECT id, email, tokens FROM users WHERE tokens < 0").all();
    
    // 2. Check High Frequency Usage (Last 5 mins) - Potential Loop
    const now = Math.floor(Date.now() / 1000);
    const fiveMinsAgo = now - 300;
    
    const highFreqUsers = await env.DB.prepare(`
        SELECT user_id, COUNT(*) as count, SUM(cost) as recent_cost 
        FROM history 
        WHERE timestamp > ? 
        GROUP BY user_id 
        HAVING count > 50
    `).bind(fiveMinsAgo).all();

    // 3. Check High Cost Today (Potential Abuse)
    // Assuming 'timestamp' in history is UNIX timestamp (seconds)
    // SQLite 'start of day' uses 'unixepoch'
    const highCostUsers = await env.DB.prepare(`
        SELECT user_id, SUM(cost) as daily_cost
        FROM history
        WHERE date(timestamp, 'unixepoch') = date('now')
        GROUP BY user_id
        HAVING daily_cost > 10.0 -- Alert if > $10/day
    `).all();

    let failedBalanceTransactions: any[] = [];
    let doubleEntryViolations: any[] = [];
    try {
      const since = Date.now() - 10 * 60 * 1000;
      const failedRes = await env.DB.prepare(
        "SELECT id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, created_at FROM balance_transactions WHERE status = 'failed' AND created_at >= ? ORDER BY created_at DESC LIMIT 50"
      )
        .bind(since)
        .all();
      failedBalanceTransactions = (failedRes?.results as any[]) || [];

      const violationsRes = await env.DB.prepare(
        "SELECT tx_id, COUNT(*) AS entry_count, SUM(delta_tenths) AS sum_delta FROM balance_entries GROUP BY tx_id HAVING entry_count >= 2 AND sum_delta != 0 LIMIT 50"
      ).all();
      doubleEntryViolations = (violationsRes?.results as any[]) || [];
    } catch {}

    return Response.json({
        status: "success",
        timestamp: new Date().toISOString(),
        anomalies: {
            negative_balance_users: negativeUsers.results,
            high_frequency_users: highFreqUsers.results,
            high_cost_users: highCostUsers.results,
            failed_balance_transactions_last_10m: failedBalanceTransactions,
            double_entry_violations: doubleEntryViolations
        }
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleAdminReverseBalance(req: Request, env: Env) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const txId = body?.txId || body?.tx_id;
    const reason = body?.reason || null;
    const adminId = body?.adminId || body?.admin_id || 'admin';
    const res = await reverseBalanceTransaction(env, { txId, adminId, reason });
    if (!res.ok) return Response.json({ ok: false, error: res.error || 'Rollback failed' }, { status: 400 });
    return Response.json({ ok: true, tx_id: res.txId, user_balance_after: res.userBalanceAfterTenths ? Number(res.userBalanceAfterTenths) / 10 : undefined });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function handleAdminBalanceStressTest(req: Request, env: Env) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const userId = body?.userId ?? body?.user_id;
    const costUsd = body?.costUsd ?? body?.cost_usd;
    const total = Math.max(1, Math.min(200, Number(body?.total ?? 50) || 50));
    const concurrency = Math.max(1, Math.min(50, Number(body?.concurrency ?? 10) || 10));

    if (!userId || !(typeof costUsd === 'number' || (typeof costUsd === 'string' && costUsd))) {
      return Response.json({ ok: false, error: 'Missing userId or costUsd' }, { status: 400 });
    }

    const beforeRow = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
    const beforeTokens = Number(beforeRow?.tokens ?? 0);

    const runOne = async (i: number) => {
      const idempotencyKey = `stress:${userId}:${Date.now()}:${i}:${crypto.randomUUID()}`;
      return await chargeUserBalanceFromUsdCost(env, {
        userId,
        costUsd: Number(costUsd),
        reason: `stress_test#${i}`,
        idempotencyKey,
        meta: { kind: 'stress_test', seq: i }
      });
    };

    const results: any[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < total) {
        const i = idx++;
        const r = await runOne(i).catch((e: any) => ({ ok: false, status: 500, error: String(e?.message || e) }));
        results.push(r);
      }
    };

    const pool = Array.from({ length: concurrency }, () => worker());
    await Promise.all(pool);

    const success = results.filter((r) => r && r.ok).length;
    const failed = results.length - success;

    const afterRow = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
    const afterTokens = Number(afterRow?.tokens ?? 0);

    return Response.json({
      ok: true,
      user_id: userId,
      before_tokens: beforeTokens,
      after_tokens: afterTokens,
      attempts: results.length,
      succeeded: success,
      failed,
      sample_errors: results.filter((r) => !r?.ok).slice(0, 10).map((r) => ({ status: r?.status, error: r?.error }))
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
