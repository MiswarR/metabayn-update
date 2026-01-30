import { Env } from '../types';
import { addUserTokens } from '../utils/userToken';
import { sendEmail, getManualApproveTemplate } from '../utils/email';

// 1. GET /admin/topup/list
export async function listTopups(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  // Filter Params
  const method = url.searchParams.get('method') || null;
  const status = url.searchParams.get('status') || null;
  const search = url.searchParams.get('search') || null; // email or user_id
  
  // Date Range (Default to full range if not provided)
  const dateFrom = url.searchParams.get('date_from') || '1970-01-01';
  const dateTo = url.searchParams.get('date_to') || '2099-12-31';

  // Helper to get total count with same filters
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM topup_transactions t
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (CASE 
          WHEN u.email IS NOT NULL THEN u.email 
          WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
          ELSE NULL 
        END LIKE ? OR t.user_id = ? OR ? IS NULL) 
      AND (date(t.created_at) BETWEEN date(?) AND date(?))
  `;

  // Search param handling (if search provided, wrap with %)
  const searchLike = search ? `%${search}%` : null;

  // Params order: method, method, status, status, searchLike, search, search, dateFrom, dateTo
  const bindParams = [
    method, method, 
    status, status, 
    searchLike, search, search, 
    dateFrom, dateTo
  ];

  const countRes = await env.DB.prepare(countQuery).bind(...bindParams).first();
  const total = countRes?.total as number || 0;
  const pageCount = Math.ceil(total / limit);

  // Main Data Query
  const query = `
    SELECT t.*, 
      CASE 
        WHEN u.email IS NOT NULL THEN u.email 
        WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
        ELSE NULL 
      END as user_email, 
      u.tokens as user_balance
    FROM topup_transactions t 
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (CASE 
          WHEN u.email IS NOT NULL THEN u.email 
          WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
          ELSE NULL 
        END LIKE ? OR t.user_id = ? OR ? IS NULL) 
      AND (date(t.created_at) BETWEEN date(?) AND date(?))
    ORDER BY t.created_at DESC 
    LIMIT ? OFFSET ?
  `;
  
  const results = await env.DB.prepare(query).bind(...bindParams, limit, offset).all();

  return Response.json({
    total,
    page,
    page_count: pageCount,
    transactions: results.results
  });
}

// 2. GET /admin/topup/detail/:id
export async function getTopupDetail(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop(); // Assumes /admin/topup/detail/:id

  if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });

  const query = `
    SELECT t.*, u.email, u.tokens as current_balance
    FROM topup_transactions t 
    LEFT JOIN users u ON t.user_id = CAST(u.id AS TEXT)
    WHERE t.id = ?
  `;

  const transaction = await env.DB.prepare(query).bind(id).first();

  if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });

  return Response.json(transaction);
}

// 3. POST /admin/topup/manual-approve
export async function manualApproveTopup(request: Request, env: Env, adminId: string = "SYSTEM"): Promise<Response> {
  try {
    const { id } = await request.json() as { id: number | string };
    if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });

    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(id).first();

    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status !== 'pending') return Response.json({ error: "Transaction is not pending" }, { status: 400 });

    // Update Status
    await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(id).run();

    // Add Tokens
    const tokensAdded = transaction.tokens_added as number;
    await addUserTokens(transaction.user_id as string, tokensAdded, env);

    // Send Email
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first() as { email: string } | null;
    if (user && user.email) {
        const currency = transaction.method === 'paypal' ? 'USD' : 'IDR';
        const amount = transaction.method === 'paypal' ? transaction.amount_usd : transaction.amount_rp;
        const name = user.email.split('@')[0]; // Simple name extraction
        const html = getManualApproveTemplate(name, amount as number, tokensAdded, currency);
        sendEmail(user.email as string, "Top-Up Token Anda Berhasil (Manual Approval)", html, env);
    }

    // Log Action
    await env.DB.prepare("INSERT INTO admin_logs (admin_id, action, target_id) VALUES (?, ?, ?)").bind(adminId, 'manual_approve', id).run();

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// 4. POST /admin/topup/delete
export async function deleteTopup(request: Request, env: Env, adminId: string = "SYSTEM"): Promise<Response> {
  try {
    const { id } = await request.json() as { id: number | string };
    if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });

    const transaction = await env.DB.prepare("SELECT status FROM topup_transactions WHERE id = ?").bind(id).first();
    
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status === 'paid') return Response.json({ error: "Cannot delete PAID transaction" }, { status: 400 });

    await env.DB.prepare("DELETE FROM topup_transactions WHERE id = ?").bind(id).run();

    // Log Action
    await env.DB.prepare("INSERT INTO admin_logs (admin_id, action, target_id) VALUES (?, ?, ?)").bind(adminId, 'delete_transaction', id).run();

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// 5. GET /admin/topup/statistics
export async function getTopupStatistics(_request: Request, env: Env): Promise<Response> {
  // Overall Stats
  const totalStats = await env.DB.prepare(`
    SELECT 
      COUNT(*) as total_transactions,
      SUM(amount_rp) as total_rp,
      SUM(amount_usd) as total_usd,
      SUM(tokens_added) as total_tokens_given
    FROM topup_transactions
    WHERE status = 'paid'
  `).first();

  // Top Methods
  const methods = await env.DB.prepare(`
    SELECT method, COUNT(*) as count 
    FROM topup_transactions 
    WHERE status = 'paid' 
    GROUP BY method
  `).all();

  const top_methods: Record<string, number> = {};
  methods.results.forEach((r: any) => top_methods[r.method] = r.count);

  // Time Series (Daily Statistics as requested)
  // SELECT DATE(created_at) AS day, COUNT(*) AS count, SUM(amount_rp) AS total_rp, SUM(amount_usd) AS total_usd, SUM(tokens_added) AS total_tokens ...
  const dailyStats = await env.DB.prepare(`
    SELECT 
      DATE(created_at) as day,
      COUNT(*) as count,
      SUM(amount_rp) as total_rp,
      SUM(amount_usd) as total_usd,
      SUM(tokens_added) as total_tokens
    FROM topup_transactions
    WHERE status = 'paid'
    GROUP BY day
    ORDER BY day DESC
  `).all();

  return Response.json({
    total_transactions: totalStats?.total_transactions || 0,
    total_rp: totalStats?.total_rp || 0,
    total_usd: totalStats?.total_usd || 0,
    total_tokens_given: totalStats?.total_tokens_given || 0,
    top_methods,
    daily_stats: dailyStats.results // Changed key to daily_stats to be explicit
  });
}

// 6. GET /admin/topup/export-csv
export async function exportTopupCsv(_request: Request, env: Env): Promise<Response> {
  // Dump all paid transactions (or all?) - User said "export-csv", usually implies full data dump.
  // Let's dump everything including pending/failed so admin can analyze.
  const query = `
    SELECT t.id, t.user_id, u.email, t.amount_rp, t.amount_usd, t.tokens_added, t.method, t.status, t.payment_ref, t.created_at
    FROM topup_transactions t
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
    ORDER BY t.created_at DESC
  `;
  
  const results = await env.DB.prepare(query).all();
  
  // Build CSV
  const header = "id,user_id,user_email,amount_rp,amount_usd,tokens_added,method,status,payment_ref,created_at\n";
  const rows = results.results.map((r: any) => {
    return [
      r.id,
      r.user_id,
      r.email || '',
      r.amount_rp || 0,
      r.amount_usd || 0,
      r.tokens_added,
      r.method,
      r.status,
      r.payment_ref || '',
      r.created_at
    ].join(',');
  }).join('\n');

  return new Response(header + rows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=topup_transactions.csv"
    }
  });
}
