import { Env } from '../types';
import { addUserBalanceTenths } from './balanceLedger.js';

/**
 * Menambah token ke saldo user secara atomic
 * @param userId ID User
 * @param tokens Jumlah token yang ditambahkan
 * @param env Environment variables
 */
export async function addUserTokens(
    userId: string,
    tokens: number,
    env: Env,
    options: { logLabel?: string; reason?: string; idempotencyKey?: string; meta?: any } = {}
): Promise<number> {
    const n = Number(tokens);
    const addTenths = BigInt(Math.round((Number.isFinite(n) ? n : 0) * 10));
    const res = await addUserBalanceTenths(env, {
        userId,
        amountTenths: addTenths,
        logLabel: options.logLabel || 'Top-up',
        reason: options.reason,
        idempotencyKey: options.idempotencyKey,
        meta: options.meta
    });
    return Number(res.userBalanceAfterTenths) / 10;
}
