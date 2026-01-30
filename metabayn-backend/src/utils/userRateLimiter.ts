// Simple in-memory rate limiter per worker instance
// Note: This only limits requests hitting the SAME worker instance.
// For global limits across distributed workers, we would need Cloudflare KV or Durable Objects.
// However, for preventing simple "double-click" or "burst" spam, this is effective.

const requestHistory = new Map<number, number>();

// Default: 1 request per 100ms (Fast burst allowed, Concurrency Lock will handle the rest)
const RATE_LIMIT_MS = 10;

export function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const lastRequest = requestHistory.get(userId) || 0;

  if (now - lastRequest < RATE_LIMIT_MS) {
    return false; // Rate limit exceeded
  }

  requestHistory.set(userId, now);
  
  // Simple cleanup to prevent memory leak
  if (requestHistory.size > 5000) {
      // If map grows too large, clear it. 
      // This resets limits for everyone but prevents OOM.
      requestHistory.clear(); 
  }
  
  return true;
}
