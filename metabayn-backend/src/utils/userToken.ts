import { Env } from '../types';

/**
 * Menambah token ke saldo user secara atomic
 * @param userId ID User
 * @param tokens Jumlah token yang ditambahkan
 * @param env Environment variables
 */
export async function addUserTokens(userId: string, tokens: number, env: Env): Promise<number> {
    // Clamp saldo negatif lama ke 0 sebelum menambahkan topup
    const res = await env.DB.prepare("UPDATE users SET tokens = (CASE WHEN tokens < 0 THEN 0 ELSE tokens END) + ? WHERE id = ? RETURNING tokens")
        .bind(tokens, userId)
        .first();
    return (res?.tokens as number) || 0;
}
