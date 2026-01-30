import { Env } from '../types';

// LIMIT DIHAPUS / DITINGKATKAN (UNLIMITED)
// Set ke angka sangat besar (1 Milyar Token per hari) agar praktis unlimited
// User meminta tidak ada batasan.
const DEFAULT_DAILY_LIMIT = 1_000_000_000;

export async function checkDailyLimit(userId: number, env: Env): Promise<boolean> {
  // 1. Calculate start of the day in seconds (Unix Epoch)
  // Using UTC to ensure consistency across regions
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const startTimestamp = Math.floor(startOfDay.getTime() / 1000);

  // 2. Query history for total tokens used since start of day
  // D1 query to sum input + output tokens
  const result = await env.DB.prepare(`
    SELECT SUM(input_tokens + output_tokens) as total 
    FROM history 
    WHERE user_id = ? AND timestamp >= ?
  `)
  .bind(userId, startTimestamp)
  .first();

  const totalUsed = (result?.total as number) || 0;

  // 3. Check against limit
  // Future improvement: Fetch specific user tier limit from DB if available
  if (totalUsed >= DEFAULT_DAILY_LIMIT) {
    // Log warning but don't block unless it's abusive (e.g. > 1B)
    console.warn(`User ${userId} hit soft daily limit (${totalUsed})`);
    // return false; // DISABLED BLOCKING
    return true; 
  }

  return true;
}
