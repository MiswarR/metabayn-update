
import { Env } from '../types';

const lastRequestTime = new Map<string, number>();

const INTERVALS: Record<string, number> = {
  openai: 10,
  openrouter: 10
};

export async function waitTurn(provider: string, key?: string, env?: Env) {
  const bucket = `${provider}:${key || 'default'}`;
  const isFreeBucket = provider === 'openrouter' && (key === 'free' || key === 'openrouter_free');
  const now = Date.now();
  const last = lastRequestTime.get(bucket) || 0;
  
  // Check unlimited mode from DB config
  let unlimited = false;
  let interval = INTERVALS[provider] || 0;
  if (isFreeBucket) interval = Math.max(interval, 3500);
  try {
    if (env) {
      const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_unlimited_mode'").first();
      const raw = row ? String(row.value).toLowerCase() : '';
      if (!row || raw.includes('true')) unlimited = true; // Default: unlimited ON if missing
    }
  } catch {}
  
  if (unlimited) {
    lastRequestTime.set(bucket, Date.now());
    return;
  }
  
  const timeSinceLast = now - last;
  
  if (timeSinceLast < interval) {
    const jitter = 50 + Math.floor(Math.random() * 150);
    const delay = interval - timeSinceLast + jitter;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // Update timestamp AFTER waiting (or immediately if no wait needed)
  // This marks the "start" of the allowed slot.
  lastRequestTime.set(bucket, Date.now());
}
