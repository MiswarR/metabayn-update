import { getExchangeRate } from './currency';
import { Env } from '../types';

// Konfigurasi Rate dan Bonus

// IDR: 1000 IDR = 1000 Token (Ratio 1:1)
// UPDATE DEC 2025: Agar user merasa "banyak", kita kalikan 1000
// $1 = 16,000 IDR
// Harga Modal 1M Token (Lite) = $0.04 = Rp 640
// Harga Jual 1M Token (Profit 60%) = $0.064 = Rp 1,024
// Jadi 1 Rupiah dapat = 1,000,000 / 1,024 = ~976 Token
// Kita bulatkan: 1 Rupiah = 1000 Token agar marketing mudah
export const TOKEN_RATE_IDR = 1; // 1 IDR = 1 Credit
export const TOKEN_RATE_IDR_TO_CREDIT = 1; // 1 Rupiah = 1 Credit

// USD: 1 USD = 16,300 Credit (Fixed Rate)
export const TOKEN_RATE_USD_TO_CREDIT = 0; // Deprecated default; use admin setting 'usd_idr_rate'

export const BONUS_IDR_TABLE: Record<number, number> = {
  100000: 3,  // Topup 100k -> Bonus 3%
  200000: 5, // Topup 200k -> Bonus 5%
  500000: 10  // Topup 500k -> Bonus 10%
};

export const BONUS_USD_TABLE: Record<number, number> = {
  10: 3,  // $10 -> Bonus 3%
  20: 5, // $20 -> Bonus 5%
  50: 10  // $50 -> Bonus 10%
};

// Legacy compatibility
export const TOKEN_RATE = TOKEN_RATE_IDR_TO_CREDIT;
export const BONUS_TABLE = BONUS_IDR_TABLE;

export async function getLiveUsdRate(env?: Env): Promise<number> {
  if (!env) throw new Error("Env required to read usd_idr_rate");
  let auto = false;
  try {
    const autoRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_auto_sync'").first();
    if (autoRow && autoRow.value) {
      const v = String(autoRow.value);
      try { auto = JSON.parse(v) === true; } catch { auto = v === '1' || v === 'true'; }
    }
  } catch {}

  if (auto) {
    try {
      const live = await getExchangeRate(env);
      if (live && typeof live === 'number' && live > 0) {
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind('usd_idr_rate', String(live)).run();
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind('usd_idr_rate_last_update', String(Date.now())).run();
        return live;
      }
    } catch {}
  }

  const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
  const rate = Number(config?.value);
  if (!rate || isNaN(rate) || rate <= 0) {
    try {
      const live = await getExchangeRate(env);
      if (live && typeof live === 'number' && live > 0) return live;
    } catch {}
    throw new Error("USD/IDR rate not configured in Admin Settings (usd_idr_rate)");
  }
  return rate;
}

export function getTokenAmount(amountRp: number) {
  return getTokenFromIDR(amountRp);
}

/**
 * Calculate tokens from IDR
 */
export function getTokenFromIDR(amountRp: number, rate: number = TOKEN_RATE_IDR_TO_CREDIT) {
  const tokensBase = Math.floor(amountRp * rate);
  const totalTokens = tokensBase;
  return {
    amount: amountRp,
    currency: 'IDR',
    tokensBase,
    bonusPercent: 0,
    tokensBonus: 0,
    totalTokens
  };
}

/**
 * Calculate tokens from USD
 */
export function getTokenFromUSD(amountUsd: number, rate?: number) {
  if (typeof rate !== 'number' || rate <= 0) {
    throw new Error("USD/IDR rate missing. Set 'usd_idr_rate' in Admin Settings.");
  }
  const tokensBase = Math.floor(amountUsd * rate);
  const totalTokens = tokensBase;
  return {
    amount: amountUsd,
    currency: 'USD',
    tokensBase,
    bonusPercent: 0,
    tokensBonus: 0,
    totalTokens
  };
}

function getBonusPercent(amount: number, table: Record<number, number>): number {
    const thresholds = Object.keys(table).map(Number).sort((a, b) => b - a);
    for (const threshold of thresholds) {
        if (amount >= threshold) {
            return table[threshold];
        }
    }
    return 0;
}
