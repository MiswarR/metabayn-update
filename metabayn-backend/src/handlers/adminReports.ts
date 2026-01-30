import { Env } from '../types';

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
