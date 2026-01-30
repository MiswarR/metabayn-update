import { Env } from '../types';

let cachedRate: number | null = null;
let lastFetch = 0;
const CACHE_TTL = 3600 * 1000; // 1 hour
const FALLBACK_RATE = 17000; // Safe fallback

export async function getExchangeRate(env?: Env): Promise<number> {
  const now = Date.now();
  if (cachedRate && (now - lastFetch < CACHE_TTL)) {
    return cachedRate;
  }

  try {
    // Use a reliable free API
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (resp.ok) {
      const data: any = await resp.json();
      const rate = data.rates?.IDR;
      if (rate && typeof rate === 'number') {
        cachedRate = rate;
        lastFetch = now;
        console.log(`Updated Exchange Rate: 1 USD = ${rate} IDR`);
        return rate;
      }
    }
  } catch (e) {
    console.error("Failed to fetch exchange rate:", e);
  }

  // Fallback to Env var or Hardcoded
  return cachedRate || FALLBACK_RATE;
}
