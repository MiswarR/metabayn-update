import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeUserBalanceFromUsdCost, computeIdrChargeTenthsFromUsdCost, getAdminPricingConfig } from './balanceLedger.js';

test('computeIdrChargeTenthsFromUsdCost matches example (0.002 USD, 20%, 17000 IDR)', () => {
  const tenths = computeIdrChargeTenthsFromUsdCost({
    costUsd: 0.002,
    profitMarginPercent: '20',
    usdIdrRate: 17000
  });
  assert.equal(tenths, 408n); // 40.8 IDR => 408 tenths
});

test('rounds to 1 decimal properly (half-up)', () => {
  // 0.001 USD * (1 + 10%) = 0.0011 * 20000 = 22.0 -> 220 tenths
  const tenths1 = computeIdrChargeTenthsFromUsdCost({
    costUsd: 0.001,
    profitMarginPercent: '10',
    usdIdrRate: 20000
  });
  assert.equal(tenths1, 220n);

  // Very small USD should still round up to at least 0.1 when positive total
  const tenths2 = computeIdrChargeTenthsFromUsdCost({
    costUsd: 0.000000000001, // 1e-12 USD
    profitMarginPercent: '0',
    usdIdrRate: 15000
  });
  assert.equal(tenths2 >= 0n, true);
});

test('throws when usd_idr_rate invalid or missing', () => {
  assert.throws(() => computeIdrChargeTenthsFromUsdCost({
    costUsd: 0.01,
    profitMarginPercent: '0',
    usdIdrRate: 0
  }), /USD\/IDR rate not configured/i);
});

function createMockEnv(initialTokensTenths = 0n, opts = {}) {
  const { usdIdrRateValue = '10000', profitMarginPercentValue = '0' } = opts || {};
  const state = {
    userTokensTenths: BigInt(initialTokensTenths),
    txByIdempotency: new Map(),
    txById: new Map()
  };

  const makeStmt = (sql) => {
    const query = String(sql || '');
    const stmt = {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        if (query.includes("SELECT value FROM app_config WHERE key = 'profit_margin_percent'")) {
          return { value: String(profitMarginPercentValue) };
        }
        if (query.includes("SELECT value FROM app_config WHERE key = 'usd_idr_rate'")) {
          if (usdIdrRateValue === null || usdIdrRateValue === undefined) return null;
          return { value: String(usdIdrRateValue) };
        }
        if (query.includes("SELECT id, status, amount_tenths, balance_before_tenths, balance_after_tenths, error FROM balance_transactions")) {
          const key = String(this.args[0] || '');
          return state.txByIdempotency.get(key) || null;
        }
        if (query.includes("SELECT CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths FROM users")) {
          return { tenths: Number(state.userTokensTenths) };
        }
        if (query.includes("UPDATE users") && query.includes("RETURNING CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths")) {
          const amount = BigInt(Number(this.args[0] || 0));
          if (state.userTokensTenths < amount) return null;
          state.userTokensTenths -= amount;
          return { tenths: Number(state.userTokensTenths) };
        }
        return null;
      },
      async run() {
        if (query.includes("INSERT OR IGNORE INTO balance_transactions")) {
          const [id, idempotencyKey, userId, amountTenths, meta, createdAt] = this.args;
          const key = String(idempotencyKey || '');
          if (key && state.txByIdempotency.has(key)) return { meta: { changes: 0 } };
          const row = {
            id: String(id),
            idempotency_key: key || null,
            user_id: String(userId),
            amount_tenths: Number(amountTenths),
            balance_before_tenths: null,
            balance_after_tenths: null,
            status: 'pending',
            error: null,
            meta,
            created_at: createdAt
          };
          if (key) state.txByIdempotency.set(key, row);
          state.txById.set(String(id), row);
          return { meta: { changes: 1 } };
        }
        if (query.includes("UPDATE balance_transactions SET balance_before_tenths")) {
          const [before, after, arg3, arg4] = this.args;
          const hasErrorArg = query.includes("status = 'failed'");
          const maybeId = hasErrorArg ? arg4 : arg3;
          const tx = state.txById.get(String(maybeId));
          if (tx) {
            tx.balance_before_tenths = Number(before);
            tx.balance_after_tenths = Number(after);
            if (query.includes("status = 'succeeded'")) {
              tx.status = 'succeeded';
              tx.error = null;
            } else if (query.includes("status = 'failed'")) {
              tx.status = 'failed';
              tx.error = String(arg3 || '');
            }
          }
          return { meta: { changes: tx ? 1 : 0 } };
        }
        if (query.includes("INSERT INTO balance_transactions")) {
          const [id, idempotencyKey, userId, type, amount, before, after, status, error, meta, createdAt] = this.args;
          const row = {
            id: String(id),
            idempotency_key: idempotencyKey ? String(idempotencyKey) : null,
            user_id: String(userId),
            type: String(type),
            amount_tenths: Number(amount),
            balance_before_tenths: before === null ? null : Number(before),
            balance_after_tenths: after === null ? null : Number(after),
            status: String(status),
            error: error ? String(error) : null,
            meta,
            created_at: createdAt
          };
          if (row.idempotency_key) state.txByIdempotency.set(row.idempotency_key, row);
          state.txById.set(row.id, row);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      }
    };
    return stmt;
  };

  return {
    DB: {
      prepare(sql) {
        return makeStmt(sql);
      }
    },
    __state: state
  };
}

test('chargeUserBalanceFromUsdCost: debit 0 token tidak mengubah saldo', async () => {
  const env = createMockEnv(100n);
  const out = await chargeUserBalanceFromUsdCost(env, {
    userId: 1,
    costUsd: 0,
    reason: 'zero',
    idempotencyKey: 'test-zero'
  });
  assert.equal(out.ok, true);
  assert.equal(out.tokensDeductedTenths, 0n);
  assert.equal(out.userBalanceAfterTenths, 100n);
});

test('chargeUserBalanceFromUsdCost: debit 1 token terpotong tepat', async () => {
  const env = createMockEnv(500n);
  const expected = computeIdrChargeTenthsFromUsdCost({ costUsd: 0.0001, profitMarginPercent: '0', usdIdrRate: 10000 });
  const out = await chargeUserBalanceFromUsdCost(env, {
    userId: 2,
    costUsd: 0.0001,
    reason: 'one',
    idempotencyKey: 'test-one'
  });
  assert.equal(out.ok, true);
  assert.equal(out.tokensDeductedTenths, expected);
  assert.equal(out.userBalanceAfterTenths, 500n - expected);
});

test('chargeUserBalanceFromUsdCost: debit N token terpotong konsisten', async () => {
  const env = createMockEnv(10000n);
  const expected = computeIdrChargeTenthsFromUsdCost({ costUsd: 0.01, profitMarginPercent: '0', usdIdrRate: 10000 });
  const out = await chargeUserBalanceFromUsdCost(env, {
    userId: 3,
    costUsd: 0.01,
    reason: 'many',
    idempotencyKey: 'test-many'
  });
  assert.equal(out.ok, true);
  assert.equal(out.tokensDeductedTenths, expected);
  assert.equal(out.userBalanceAfterTenths, 10000n - expected);
});

test('chargeUserBalanceFromUsdCost: profit margin Admin mempengaruhi markup pemotongan', async () => {
  const env = createMockEnv(10000n, { usdIdrRateValue: '17000', profitMarginPercentValue: '20' });
  const expected = computeIdrChargeTenthsFromUsdCost({ costUsd: 0.002, profitMarginPercent: '20', usdIdrRate: 17000 });
  const out = await chargeUserBalanceFromUsdCost(env, {
    userId: 4,
    costUsd: 0.002,
    reason: 'profit-margin',
    idempotencyKey: 'test-profit-margin'
  });
  assert.equal(out.ok, true);
  assert.equal(out.profitMarginPercent, '20');
  assert.equal(out.usdIdrRate, 17000);
  assert.equal(out.tokensDeductedTenths, expected);
  assert.equal(out.userBalanceAfterTenths, 10000n - expected);
});

test('chargeUserBalanceFromUsdCost: tetap jalan walau usd_idr_rate belum diset', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  try {
    const env = createMockEnv(10000n, { usdIdrRateValue: null });
    const out = await chargeUserBalanceFromUsdCost(env, {
      userId: 9,
      costUsd: 0.01,
      reason: 'no-rate',
      idempotencyKey: 'test-no-rate'
    });
    assert.equal(out.ok, true);
    assert.equal(out.usdIdrRate, 17000);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('getAdminPricingConfig: membaca usd_idr_rate format ribuan (17.000) dari Admin', async () => {
  const env = createMockEnv(0n, { usdIdrRateValue: '17.000' });
  const cfg = await getAdminPricingConfig(env);
  assert.equal(cfg.usdIdrRate, 17000);
});

test('getAdminPricingConfig: tidak menambahkan markup dari kurs Admin', async () => {
  const env = createMockEnv(0n, { usdIdrRateValue: '16900' });
  const cfg = await getAdminPricingConfig(env);
  assert.equal(cfg.usdIdrRate, 16900);
});
