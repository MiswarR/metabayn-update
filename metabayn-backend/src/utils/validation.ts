import { Env } from '../types';

/**
 * Validates user access rights based on subscription status, token balance, mode, and feature.
 * 
 * Rules:
 * 1. Generate Metadata (AI Gateway):
 *    - Subscription MUST be active and not expired (Free user diblokir).
 *    - Token balance hanya divalidasi secara minimal (> 0) sebelum request; validasi final dilakukan setelah biaya diketahui.
 * 
 * 2. Standard Mode (User API key):
 *    - Tidak memotong saldo token aplikasi, kecuali fitur CSV Fix.
 * 
 * 3. CSV Fix Feature ('csv_fix'):
 *    - Subscription status diabaikan (Free user tetap boleh akses Tools).
 *    - Wajib punya saldo token aplikasi (> 0) sebelum request; validasi final dilakukan setelah biaya diketahui.
 * 
 * @param userId User ID to validate
 * @param env Cloudflare Environment (DB access)
 * @param options Configuration options
 * @returns Validation result with user object if valid
 */
export async function validateUserAccess(
    userId: number, 
    env: Env,
    options: { mode?: 'gateway' | 'standard', feature?: 'metadata' | 'csv_fix' } = {}
): Promise<{ 
    valid: boolean; 
    error?: string; 
    status?: number; 
    user?: any;
}> {
    let { mode, feature = 'metadata' } = options;

    // Ambil data user dengan detail lengkap
    const user = await env.DB.prepare(
        "SELECT tokens, subscription_active, subscription_expiry, email, or_api_key, or_api_key_id, or_key_name, is_admin FROM users WHERE id = ?"
    ).bind(userId).first();

    if (!user) {
        return { valid: false, error: "User not found", status: 404 };
    }

    // Auto-detect mode if not specified
    // Jika user punya API Key OpenRouter sendiri, asumsikan Standard Mode (kecuali dipaksa gateway)
    if (!mode) {
        mode = user.or_api_key ? 'standard' : 'gateway';
    }

    const now = new Date();
    const expiryStr = user.subscription_expiry as string | null;
    let isSubscriptionValid = false;
    let isTokenValid = false;
    
    // --- 1. Subscription Status Check ---
    if (user.subscription_active) {
        if (expiryStr) {
            const expiryDate = new Date(expiryStr);
            if (!isNaN(expiryDate.getTime())) {
                if (expiryDate > now) {
                    isSubscriptionValid = true;
                } else {
                    // Expired: Log & Auto-update
                    console.log(`[Validation] Subscription EXPIRED for User ${userId}. Expiry: ${expiryStr} < Now: ${now.toISOString()}`);
                    // Fire-and-forget update
                    env.DB.prepare("UPDATE users SET subscription_active = 0 WHERE id = ?").bind(userId).run().catch((e: any) => console.error("Failed to auto-expire user:", e));
                    isSubscriptionValid = false; 
                }
            } else {
                 console.warn(`[Validation] Invalid expiry date for User ${userId}: ${expiryStr}`);
                 isSubscriptionValid = false;
            }
        } else {
            // Active without expiry (Lifetime?)
            isSubscriptionValid = true;
        }
    } else {
        isSubscriptionValid = false;
    }

    // --- 2. Token Balance Check ---
    const currentTokens = Number(user.tokens ?? 0);
    const currentTenths = Math.trunc((Number.isFinite(currentTokens) ? currentTokens : 0) * 10);
    if (currentTenths > 0) isTokenValid = true;

    // --- 3. Apply Rules based on Mode & Feature ---

    // Special Case: CSV Fix Feature
    if (feature === 'csv_fix') {
        const requireToken = (mode === 'gateway');
        if (requireToken && !isTokenValid) {
            return { 
                valid: false, 
                error: `Saldo token tidak cukup untuk Tools generate CSV (tersisa Rp ${currentTenths / 10}).`, 
                status: 402,
                user
            };
        }
        return { valid: true, user };
    }

    // General Rules
    
    // Rule A: Subscription Requirement
    // "Jika masa berlangganan sudah selesai maka tetap kedua mode tidak dapat di gunakan"
    if (!isSubscriptionValid) {
        if (mode === 'standard') {
            return { valid: true, user };
        }

        if (mode === 'gateway' && isTokenValid) {
            return { valid: true, user };
        }

        const error = mode === 'gateway'
            ? `Saldo token tidak cukup (tersisa Rp ${currentTenths / 10}).`
            : "Langganan tidak aktif.";

        return { valid: false, error, status: mode === 'gateway' ? 402 : 403, user };
    }

    // Rule B: Token Requirement
    // "Saldo Token hanya tergunakan pada mode AI Gateway"
    // Standard mode uses user's own API key, so tokens are not consumed
    const requireToken = (mode === 'gateway');
    if (requireToken && !isTokenValid) {
        return { 
            valid: false, 
            error: `Saldo token tidak cukup (tersisa Rp ${currentTenths / 10}).`, 
            status: 402,
            user
        };
    }

    return { valid: true, user };
}
