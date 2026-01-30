import { Env } from '../index';
import { getLiveUsdRate } from '../utils/tokenTopup';

export async function handleBalance(userId: number, env: Env) {
  const user = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
  const rate = await getLiveUsdRate(env);
  return Response.json({ balance: user?.tokens || 0, usd_rate: rate });
}

export async function handleHistory(userId: number, env: Env) {
  const history = await env.DB.prepare("SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20").bind(userId).all();
  return Response.json(history.results);
}

export async function handleTopup(req: Request, userId: number, env: Env) {
  // Disini Anda bisa integrasi Xendit/Midtrans/Stripe
  // Untuk sekarang, kita buat simulasi topup manual/admin key
  const body: any = await req.json();
  const { amount, secret_admin_key } = body;

  // Simple security check (Hardcoded for simplicity, use ENV in production)
  if (secret_admin_key !== "RAHASIA_ADMIN_TOPUP") {
    return Response.json({ error: "Unauthorized topup" }, { status: 403 });
  }

  // Clamp saldo negatif lama ke 0 sebelum menambahkan topup
  await env.DB.prepare("UPDATE users SET tokens = (CASE WHEN tokens < 0 THEN 0 ELSE tokens END) + ? WHERE id = ?")
    .bind(amount, userId)
    .run();
  return Response.json({ success: true, message: `Added ${amount} tokens` });
}
