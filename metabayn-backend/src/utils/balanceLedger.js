const USD_SCALE = 12n;
const USD_SCALE_FACTOR = 10n ** USD_SCALE; // 1e12
const IDR_TENTHS_DIVISOR = 10n ** 11n; // 1e11 because IDR*1e12 -> tenths IDR
const IDR_TENTHS_ROUND_ADD = 5n * 10n ** 10n; // 0.5 * 1e11

let balanceSchemaEnsured = false;
let balanceSchemaEnsurePromise = null;

async function ensureBalanceSchema(env) {
  if (balanceSchemaEnsured) return;
  if (balanceSchemaEnsurePromise) return balanceSchemaEnsurePromise;
  if (!env || !env.DB || typeof env.DB.prepare !== 'function') return;

  balanceSchemaEnsurePromise = (async () => {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS balance_transactions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount_tenths INTEGER NOT NULL,
        balance_before_tenths INTEGER,
        balance_after_tenths INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        meta TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );
      `
    ).run();

    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_ts ON balance_transactions(user_id, created_at);"
    ).run();
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_balance_transactions_status_ts ON balance_transactions(status, created_at);"
    ).run();

    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_id TEXT NOT NULL,
        account_type TEXT NOT NULL,
        account_id TEXT,
        delta_tenths INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
      `
    ).run();

    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_balance_entries_tx ON balance_entries(tx_id);"
    ).run();

    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER DEFAULT (unixepoch())
      );
      `
    ).run();

    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_activity_log_user_ts ON activity_log(user_id, timestamp);"
    ).run();

    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS bonus_token_grants (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        purchase_id TEXT UNIQUE,
        amount_tenths INTEGER NOT NULL,
        remaining_tenths INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      `
    ).run();
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_bonus_grants_user_exp ON bonus_token_grants(user_id, expires_at, deleted_at);"
    ).run();

    balanceSchemaEnsured = true;
  })()
    .catch(() => {})
    .finally(() => {
      balanceSchemaEnsurePromise = null;
    });

  return balanceSchemaEnsurePromise;
}

async function getUserBonusRemainingTenths(env, userId, nowMs) {
  try {
    const row = await env.DB.prepare(
      `
      SELECT SUM(remaining_tenths) AS s
      FROM bonus_token_grants
      WHERE user_id = ?
        AND deleted_at IS NULL
        AND remaining_tenths > 0
        AND expires_at > ?
      `
    )
      .bind(String(userId), Number(nowMs))
      .first();
    const n = Number(row?.s ?? 0);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.trunc(n));
  } catch {
    return 0n;
  }
}

async function consumeUserBonusTenths(env, userId, needTenths, nowMs) {
  let remainingNeed = BigInt(needTenths);
  if (remainingNeed <= 0n) return 0n;

  const rows = await env.DB.prepare(
    `
    SELECT id, remaining_tenths
    FROM bonus_token_grants
    WHERE user_id = ?
      AND deleted_at IS NULL
      AND remaining_tenths > 0
      AND expires_at > ?
    ORDER BY expires_at ASC, created_at ASC
    LIMIT 200
    `
  )
    .bind(String(userId), Number(nowMs))
    .all();

  const list = Array.isArray(rows?.results) ? rows.results : [];
  let used = 0n;
  for (const r of list) {
    if (remainingNeed <= 0n) break;
    const grantId = String(r?.id || '');
    const grantRemaining = BigInt(String(r?.remaining_tenths ?? 0));
    if (!grantId || grantRemaining <= 0n) continue;
    const take = grantRemaining < remainingNeed ? grantRemaining : remainingNeed;
    if (take <= 0n) continue;

    const res = await env.DB.prepare(
      "UPDATE bonus_token_grants SET remaining_tenths = remaining_tenths - ? WHERE id = ? AND remaining_tenths >= ?"
    )
      .bind(Number(take), grantId, Number(take))
      .run();

    if (res?.meta?.changes > 0) {
      remainingNeed -= take;
      used += take;
      continue;
    }

    try {
      const cur = await env.DB.prepare("SELECT remaining_tenths FROM bonus_token_grants WHERE id = ?").bind(grantId).first();
      const curRem = BigInt(String(cur?.remaining_tenths ?? 0));
      const take2 = curRem < remainingNeed ? curRem : remainingNeed;
      if (take2 > 0n) {
        const res2 = await env.DB.prepare(
          "UPDATE bonus_token_grants SET remaining_tenths = remaining_tenths - ? WHERE id = ? AND remaining_tenths >= ?"
        )
          .bind(Number(take2), grantId, Number(take2))
          .run();
        if (res2?.meta?.changes > 0) {
          remainingNeed -= take2;
          used += take2;
        }
      }
    } catch {}
  }

  return used;
}

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function normalizeDecimalString(input) {
  const s = toTrimmedString(input).replace(',', '.');
  if (!s) return '0';
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return '0';
  return s;
}

function parsePercentToBps(percentInput) {
  const s = normalizeDecimalString(percentInput);
  const sign = s.startsWith('-') ? -1n : 1n;
  const abs = s.startsWith('-') || s.startsWith('+') ? s.slice(1) : s;
  const [intPartRaw, fracRaw = ''] = abs.split('.');
  const intPart = BigInt(intPartRaw || '0');
  const frac = (fracRaw + '00').slice(0, 2);
  const fracPart = BigInt(frac || '0');
  return sign * (intPart * 100n + fracPart);
}

function parseUsdToScaled(usdInput) {
  const s0 = normalizeDecimalString(
    typeof usdInput === 'number' && Number.isFinite(usdInput) ? usdInput.toFixed(Number(USD_SCALE)) : usdInput
  );
  const sign = s0.startsWith('-') ? -1n : 1n;
  const abs = s0.startsWith('-') || s0.startsWith('+') ? s0.slice(1) : s0;
  const [intPartRaw, fracRaw = ''] = abs.split('.');
  const intPart = BigInt(intPartRaw || '0');
  const frac = (fracRaw + '0'.repeat(Number(USD_SCALE))).slice(0, Number(USD_SCALE));
  const fracPart = BigInt(frac || '0');
  return sign * (intPart * USD_SCALE_FACTOR + fracPart);
}

function formatTenthsToString(tenths) {
  const t = BigInt(tenths);
  const sign = t < 0n ? '-' : '';
  const abs = t < 0n ? -t : t;
  const intPart = abs / 10n;
  const dec = abs % 10n;
  return `${sign}${intPart.toString()}.${dec.toString()}`;
}

export function computeIdrChargeTenthsFromUsdCost({
  costUsd,
  profitMarginPercent,
  usdIdrRate
}) {
  const usdScaled = parseUsdToScaled(costUsd);
  const rate = BigInt(String(Math.trunc(Number(usdIdrRate || 0))));
  const profitBps = parsePercentToBps(profitMarginPercent);

  if (rate <= 0n) {
    throw new Error("USD/IDR rate not configured in Admin Settings (usd_idr_rate)");
  }

  const multiplierBps = 10000n + profitBps;
  if (multiplierBps < 0n) {
    throw new Error("Invalid profit margin percent (profit_margin_percent)");
  }

  const usdWithProfitScaled = (usdScaled * multiplierBps + 5000n) / 10000n;
  const idrScaled = usdWithProfitScaled * rate;
  const idrTenths = (idrScaled + IDR_TENTHS_ROUND_ADD) / IDR_TENTHS_DIVISOR;

  if (usdScaled > 0n && idrTenths <= 0n) return 1n;
  if (idrTenths < 0n) return 0n;
  return idrTenths;
}

export async function getAdminPricingConfig(env) {
  const profitRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first().catch(() => null);
  const rateRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first().catch(() => null);

  const profitMarginPercent = profitRow?.value ?? '0';
  const usdIdrRateRaw = rateRow?.value;
  let usdIdrRate = parseConfigNumber(usdIdrRateRaw);
  if (!Number.isFinite(usdIdrRate) || usdIdrRate <= 0) {
    usdIdrRate = 0;
    try {
      const resp = await fetch('https://open.er-api.com/v6/latest/USD');
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const live = data?.rates?.IDR;
        if (typeof live === 'number' && Number.isFinite(live) && live > 0) {
          usdIdrRate = live;
        }
      }
    } catch {}
    if (!Number.isFinite(usdIdrRate) || usdIdrRate <= 0) {
      usdIdrRate = 17000;
    }
    try {
      await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
        .bind('usd_idr_rate', String(Math.trunc(usdIdrRate)))
        .run();
      await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
        .bind('usd_idr_rate_last_update', String(Date.now()))
        .run();
    } catch {}
  }

  return { profitMarginPercent, usdIdrRate: Math.trunc(usdIdrRate) };
}

function parseConfigNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === 'number') return value;

  let s = String(value).trim();
  if (!s) return Number.NaN;
  s = s.replace(/\s+/g, '');
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s || s === '-') return Number.NaN;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '');
      s = s.replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (parts.length > 2) {
      s = parts.join('');
    } else if (parts.length === 2) {
      const frac = parts[1] || '';
      if (frac.length === 3) s = parts.join('');
      else s = `${parts[0]}.${frac}`;
    }
  } else if (hasDot && !hasComma) {
    const parts = s.split('.');
    if (parts.length > 2) {
      s = parts.join('');
    } else if (parts.length === 2) {
      const frac = parts[1] || '';
      if (frac.length === 3) s = parts.join('');
    }
  }

  return Number(s);
}

export async function writeActivityLog(env, { userId, level, message, timestampMs }) {
  await ensureBalanceSchema(env);
  const ts = typeof timestampMs === 'number' && Number.isFinite(timestampMs) ? Math.trunc(timestampMs) : Date.now();
  const uid = String(userId);
  const lvl = String(level || 'INFO').toUpperCase();
  const msg = String(message || '');
  await env.DB.prepare(
    "INSERT INTO activity_log (user_id, level, message, timestamp) VALUES (?, ?, ?, ?)"
  )
    .bind(uid, lvl, msg, ts)
    .run();
}

function createTxId() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `tx_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function getExistingTransactionByIdempotencyKey(env, idempotencyKey) {
  const key = toTrimmedString(idempotencyKey);
  if (!key) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT id, status, amount_tenths, balance_before_tenths, balance_after_tenths, error FROM balance_transactions WHERE idempotency_key = ? LIMIT 1"
    )
      .bind(key)
      .first();
    return row || null;
  } catch {
    return null;
  }
}

async function insertDoubleEntry(env, { txId, userId, userDeltaTenths, systemAccount, systemDeltaTenths }) {
  const uid = String(userId);
  const sys = String(systemAccount || 'system_revenue');
  await env.DB.prepare(
    "INSERT INTO balance_entries (tx_id, account_type, account_id, delta_tenths, created_at) VALUES (?, 'user', ?, ?, ?)"
  )
    .bind(txId, uid, Number(userDeltaTenths), Date.now())
    .run();

  await env.DB.prepare(
    "INSERT INTO balance_entries (tx_id, account_type, account_id, delta_tenths, created_at) VALUES (?, 'system', ?, ?, ?)"
  )
    .bind(txId, sys, Number(systemDeltaTenths), Date.now())
    .run();
}

export async function chargeUserBalanceFromUsdCost(env, opts) {
  await ensureBalanceSchema(env);
  const {
    userId,
    costUsd,
    reason,
    insufficientLogMessage,
    insufficientErrorMessage,
    idempotencyKey,
    meta
  } = opts || {};
  const { profitMarginPercent, usdIdrRate } = await getAdminPricingConfig(env);

  const costTenths = computeIdrChargeTenthsFromUsdCost({
    costUsd,
    profitMarginPercent,
    usdIdrRate
  });

  const ts = Date.now();
  const costStr = formatTenthsToString(costTenths);

  const idKey = toTrimmedString(idempotencyKey);
  const existing = await getExistingTransactionByIdempotencyKey(env, idKey);
  if (existing && existing.id) {
    const after = BigInt(String(existing.balance_after_tenths ?? 0));
    return {
      ok: String(existing.status) === 'succeeded',
      status: String(existing.status) === 'succeeded' ? 200 : 402,
      profitMarginPercent,
      usdIdrRate,
      tokensDeductedTenths: BigInt(String(existing.amount_tenths ?? costTenths)),
      userBalanceAfterTenths: after,
      error: existing.error ? String(existing.error) : undefined,
      txId: String(existing.id)
    };
  }

  let reservedTxId = null;
  if (idKey) {
    const reserveId = createTxId();
    const reserveRes = await env.DB.prepare(
      "INSERT OR IGNORE INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, 'charge', ?, NULL, NULL, 'pending', NULL, ?, ?)"
    )
      .bind(
        reserveId,
        idKey,
        String(userId),
        Number(costTenths),
        meta ? JSON.stringify(meta) : null,
        ts
      )
      .run();

    if (!(reserveRes?.meta?.changes > 0)) {
      const ex = await getExistingTransactionByIdempotencyKey(env, idKey);
      const after = BigInt(String(ex?.balance_after_tenths ?? 0));
      return {
        ok: String(ex?.status) === 'succeeded',
        status: String(ex?.status) === 'succeeded' ? 200 : 402,
        profitMarginPercent,
        usdIdrRate,
        tokensDeductedTenths: BigInt(String(ex?.amount_tenths ?? costTenths)),
        userBalanceAfterTenths: after,
        error: ex?.error ? String(ex.error) : undefined,
        txId: String(ex?.id || '')
      };
    }
    reservedTxId = reserveId;
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const beforeRow = await env.DB
        .prepare("SELECT CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths FROM users WHERE id = ? LIMIT 1")
        .bind(userId)
        .first();
      const beforeTenths = BigInt(String(beforeRow?.tenths ?? 0));
      const bonusRemaining = await getUserBonusRemainingTenths(env, userId, ts);
      const plannedBonusUse = bonusRemaining < costTenths ? bonusRemaining : costTenths;

      if (beforeTenths < costTenths) {
        const msg =
          insufficientLogMessage ||
          `Saldo token tidak cukup: dibutuhkan Rp ${costStr}, tersisa Rp ${formatTenthsToString(beforeTenths)}`;
        try {
          if (reservedTxId) {
            await env.DB.prepare(
              "UPDATE balance_transactions SET balance_before_tenths = ?, balance_after_tenths = ?, status = 'failed', error = ? WHERE id = ?"
            )
              .bind(Number(beforeTenths), Number(beforeTenths), msg, reservedTxId)
              .run();
          } else {
            const txId = createTxId();
            await env.DB.prepare(
              "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
              .bind(
                txId,
                idKey || null,
                String(userId),
                'charge',
                Number(costTenths),
                Number(beforeTenths),
                Number(beforeTenths),
                'failed',
                msg,
                meta ? JSON.stringify(meta) : null,
                ts
              )
              .run();
          }
        } catch {}
        try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
        return {
          ok: false,
          status: 402,
          error: insufficientErrorMessage || msg,
          tokensDeductedTenths: costTenths,
          userBalanceAfterTenths: beforeTenths,
          txId: reservedTxId || ''
        };
      }

      const updateRes = await env.DB
        .prepare(
          `
          UPDATE users
          SET tokens = ((CAST(ROUND(tokens * 10, 0) AS INTEGER) - ?) / 10.0)
          WHERE id = ?
            AND CAST(ROUND(tokens * 10, 0) AS INTEGER) >= ?
          RETURNING CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths
        `
        )
        .bind(Number(costTenths), userId, Number(costTenths))
        .first();

      if (!updateRes) {
        continue;
      }

      const afterTenths = BigInt(String(updateRes?.tenths ?? 0));
      const beforeTenths2 = afterTenths + costTenths;
      const txId = reservedTxId || createTxId();
      let bonusUsed = 0n;
      try {
        if (plannedBonusUse > 0n) {
          bonusUsed = await consumeUserBonusTenths(env, userId, plannedBonusUse, ts);
        }
      } catch {}
      const persistentUsed = costTenths - bonusUsed;
      let metaOut = meta;
      try {
        const base = meta && typeof meta === 'object' ? meta : (meta ? JSON.parse(String(meta)) : {});
        metaOut = { ...(base || {}), bonus_used_tenths: Number(bonusUsed), persistent_used_tenths: Number(persistentUsed) };
      } catch {
        metaOut = { bonus_used_tenths: Number(bonusUsed), persistent_used_tenths: Number(persistentUsed) };
      }

      try {
        if (reservedTxId) {
          await env.DB.prepare(
            "UPDATE balance_transactions SET balance_before_tenths = ?, balance_after_tenths = ?, status = 'succeeded', error = NULL, meta = ? WHERE id = ?"
          )
            .bind(Number(beforeTenths2), Number(afterTenths), metaOut ? JSON.stringify(metaOut) : null, txId)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              txId,
              idKey || null,
              String(userId),
              'charge',
              Number(costTenths),
              Number(beforeTenths2),
              Number(afterTenths),
              'succeeded',
              null,
              metaOut ? JSON.stringify(metaOut) : null,
              ts
            )
            .run();
        }
      } catch {}

      try {
        await insertDoubleEntry(env, {
          txId,
          userId,
          userDeltaTenths: -costTenths,
          systemAccount: 'system_revenue',
          systemDeltaTenths: costTenths
        });
      } catch {}

      const msg = `Potong saldo Rp ${costStr} – saldo menjadi Rp ${formatTenthsToString(afterTenths)}${reason ? ` (${reason})` : ''}`;
      try { await writeActivityLog(env, { userId, level: 'INFO', message: msg, timestampMs: ts }); } catch {}
      return {
        ok: true,
        status: 200,
        profitMarginPercent,
        usdIdrRate,
        tokensDeductedTenths: costTenths,
        userBalanceAfterTenths: afterTenths,
        txId,
        bonusUsedTenths: bonusUsed,
        persistentUsedTenths: persistentUsed
      };
    } catch (e) {
      const msg = `Gagal potong saldo: ${String(e?.message || e)}`;
      try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
      try {
        if (reservedTxId) {
          await env.DB.prepare("UPDATE balance_transactions SET status = 'failed', error = ? WHERE id = ?")
            .bind(msg, reservedTxId)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              createTxId(),
              idKey || null,
              String(userId),
              'charge',
              Number(costTenths),
              null,
              null,
              'failed',
              msg,
              meta ? JSON.stringify(meta) : null,
              ts
            )
            .run();
        }
      } catch {}
      throw e;
    }
  }

  const msg = "Gagal potong saldo: konflik concurrent update";
  try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
  try {
    if (reservedTxId) {
      await env.DB.prepare("UPDATE balance_transactions SET status = 'failed', error = ? WHERE id = ?").bind(msg, reservedTxId).run();
    }
  } catch {}
  return { ok: false, status: 409, error: msg, tokensDeductedTenths: costTenths, userBalanceAfterTenths: 0n };
}

export async function addUserBalanceTenths(env, opts) {
  await ensureBalanceSchema(env);
  const { userId, amountTenths, reason, logLabel, idempotencyKey, meta } = opts || {};
  const addTenths = BigInt(amountTenths);
  if (addTenths <= 0n) {
    return { ok: true, userBalanceAfterTenths: 0n };
  }

  const ts = Date.now();
  const idKey = toTrimmedString(idempotencyKey);
  const existing = await getExistingTransactionByIdempotencyKey(env, idKey);
  if (existing && existing.id) {
    const after = BigInt(String(existing.balance_after_tenths ?? 0));
    return { ok: String(existing.status) === 'succeeded', userBalanceAfterTenths: after, txId: String(existing.id) };
  }

  let reservedTxId = null;
  if (idKey) {
    const reserveId = createTxId();
    const reserveRes = await env.DB.prepare(
      "INSERT OR IGNORE INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, 'credit', ?, NULL, NULL, 'pending', NULL, ?, ?)"
    )
      .bind(reserveId, idKey, String(userId), Number(addTenths), meta ? JSON.stringify(meta) : null, ts)
      .run();
    if (!(reserveRes?.meta?.changes > 0)) {
      const ex = await getExistingTransactionByIdempotencyKey(env, idKey);
      const after = BigInt(String(ex?.balance_after_tenths ?? 0));
      return { ok: String(ex?.status) === 'succeeded', userBalanceAfterTenths: after, txId: String(ex?.id || '') };
    }
    reservedTxId = reserveId;
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const beforeRow = await env.DB
        .prepare("SELECT CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths FROM users WHERE id = ? LIMIT 1")
        .bind(userId)
        .first();
      const beforeTenths = BigInt(String(beforeRow?.tenths ?? 0));

      const updateRes = await env.DB
        .prepare(
          `
          UPDATE users
          SET tokens = (
            (
              CASE
                WHEN CAST(ROUND(tokens * 10, 0) AS INTEGER) < 0 THEN 0
                ELSE CAST(ROUND(tokens * 10, 0) AS INTEGER)
              END
              + ?
            ) / 10.0
          )
          WHERE id = ?
            AND CAST(ROUND(tokens * 10, 0) AS INTEGER) = ?
          RETURNING CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths
        `
        )
        .bind(Number(addTenths), userId, Number(beforeTenths))
        .first();

      if (!updateRes) {
        continue;
      }

      const afterTenths = BigInt(String(updateRes?.tenths ?? 0));
      const txId = reservedTxId || createTxId();

      try {
        if (reservedTxId) {
          await env.DB.prepare(
            "UPDATE balance_transactions SET balance_before_tenths = ?, balance_after_tenths = ?, status = 'succeeded', error = NULL WHERE id = ?"
          )
            .bind(Number(beforeTenths), Number(afterTenths), txId)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              txId,
              idKey || null,
              String(userId),
              'credit',
              Number(addTenths),
              Number(beforeTenths),
              Number(afterTenths),
              'succeeded',
              null,
              meta ? JSON.stringify(meta) : null,
              ts
            )
            .run();
        }
      } catch {}

      try {
        await insertDoubleEntry(env, {
          txId,
          userId,
          userDeltaTenths: addTenths,
          systemAccount: 'system_cash',
          systemDeltaTenths: -addTenths
        });
      } catch {}

      const label = logLabel ? String(logLabel) : 'Top-up';
      const msg = `${label} Rp ${formatTenthsToString(addTenths)} – saldo menjadi Rp ${formatTenthsToString(afterTenths)}${reason ? ` (${reason})` : ''}`;
      try { await writeActivityLog(env, { userId, level: 'INFO', message: msg, timestampMs: ts }); } catch {}
      return { ok: true, userBalanceAfterTenths: afterTenths, txId };
    } catch (e) {
      const msg = `Gagal tambah saldo: ${String(e?.message || e)}`;
      try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
      try {
        if (reservedTxId) {
          await env.DB.prepare("UPDATE balance_transactions SET status = 'failed', error = ? WHERE id = ?")
            .bind(msg, reservedTxId)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              createTxId(),
              idKey || null,
              String(userId),
              'credit',
              Number(addTenths),
              null,
              null,
              'failed',
              msg,
              meta ? JSON.stringify(meta) : null,
              ts
            )
            .run();
        }
      } catch {}
      throw e;
    }
  }

  const msg = "Gagal tambah saldo: konflik concurrent update";
  try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
  try {
    if (reservedTxId) {
      await env.DB.prepare("UPDATE balance_transactions SET status = 'failed', error = ? WHERE id = ?").bind(msg, reservedTxId).run();
    }
  } catch {}
  return { ok: false, userBalanceAfterTenths: 0n, error: msg };
}

export async function applyBalanceDeltaTenths(env, opts) {
  await ensureBalanceSchema(env);
  const { userId, deltaTenths, idempotencyKey, meta, systemAccount, logLabel, reason } = opts || {};
  const delta = BigInt(deltaTenths ?? 0);
  if (delta === 0n) return { ok: true, userBalanceAfterTenths: 0n };

  if (delta > 0n) {
    return await addUserBalanceTenths(env, {
      userId,
      amountTenths: delta,
      idempotencyKey,
      meta,
      logLabel: logLabel || 'Top-up',
      reason
    });
  }

  const costTenths = -delta;
  const ts = Date.now();
  const idKey = toTrimmedString(idempotencyKey);
  const existing = await getExistingTransactionByIdempotencyKey(env, idKey);
  if (existing && existing.id) {
    const after = BigInt(String(existing.balance_after_tenths ?? 0));
    return { ok: String(existing.status) === 'succeeded', userBalanceAfterTenths: after, txId: String(existing.id) };
  }

  let reservedTxId = null;
  if (idKey) {
    const reserveId = createTxId();
    const reserveRes = await env.DB.prepare(
      "INSERT OR IGNORE INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, 'debit', ?, NULL, NULL, 'pending', NULL, ?, ?)"
    )
      .bind(reserveId, idKey, String(userId), Number(costTenths), meta ? JSON.stringify(meta) : null, ts)
      .run();
    if (!(reserveRes?.meta?.changes > 0)) {
      const ex = await getExistingTransactionByIdempotencyKey(env, idKey);
      const after = BigInt(String(ex?.balance_after_tenths ?? 0));
      return { ok: String(ex?.status) === 'succeeded', userBalanceAfterTenths: after, txId: String(ex?.id || '') };
    }
    reservedTxId = reserveId;
  }

  const costStr = formatTenthsToString(costTenths);
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const beforeRow = await env.DB.prepare("SELECT CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths FROM users WHERE id = ? LIMIT 1")
      .bind(userId)
      .first();
    const beforeTenths = BigInt(String(beforeRow?.tenths ?? 0));
    if (beforeTenths < costTenths) {
      const msg = `Saldo token tidak cukup untuk debit Rp ${costStr}`;
      try {
        if (reservedTxId) {
          await env.DB.prepare("UPDATE balance_transactions SET balance_before_tenths = ?, balance_after_tenths = ?, status = 'failed', error = ? WHERE id = ?")
            .bind(Number(beforeTenths), Number(beforeTenths), msg, reservedTxId)
            .run();
        }
      } catch {}
      return { ok: false, userBalanceAfterTenths: beforeTenths, error: msg, txId: reservedTxId || '' };
    }

    const updateRes = await env.DB.prepare(
      `
      UPDATE users
      SET tokens = ((CAST(ROUND(tokens * 10, 0) AS INTEGER) - ?) / 10.0)
      WHERE id = ?
        AND CAST(ROUND(tokens * 10, 0) AS INTEGER) >= ?
      RETURNING CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths
      `
    )
      .bind(Number(costTenths), userId, Number(costTenths))
      .first();

    if (!updateRes) continue;

    const afterTenths = BigInt(String(updateRes?.tenths ?? 0));
    const beforeTenths2 = afterTenths + costTenths;
    const txId = reservedTxId || createTxId();
    try {
      if (reservedTxId) {
        await env.DB.prepare(
          "UPDATE balance_transactions SET balance_before_tenths = ?, balance_after_tenths = ?, status = 'succeeded', error = NULL WHERE id = ?"
        )
          .bind(Number(beforeTenths2), Number(afterTenths), txId)
          .run();
      } else {
        await env.DB.prepare(
          "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            txId,
            idKey || null,
            String(userId),
            'debit',
            Number(costTenths),
            Number(beforeTenths2),
            Number(afterTenths),
            'succeeded',
            null,
            meta ? JSON.stringify(meta) : null,
            ts
          )
          .run();
      }
    } catch {}

    try {
      await insertDoubleEntry(env, {
        txId,
        userId,
        userDeltaTenths: -costTenths,
        systemAccount: systemAccount || 'system_adjustment',
        systemDeltaTenths: costTenths
      });
    } catch {}

    const label = logLabel ? String(logLabel) : 'Debit';
    const msg = `${label} Rp ${costStr} – saldo menjadi Rp ${formatTenthsToString(afterTenths)}${reason ? ` (${reason})` : ''}`;
    try { await writeActivityLog(env, { userId, level: 'INFO', message: msg, timestampMs: ts }); } catch {}
    return { ok: true, userBalanceAfterTenths: afterTenths, txId };
  }

  const msg = "Gagal debit saldo: konflik concurrent update";
  try { await writeActivityLog(env, { userId, level: 'ERROR', message: msg, timestampMs: ts }); } catch {}
  try {
    if (reservedTxId) {
      await env.DB.prepare("UPDATE balance_transactions SET status = 'failed', error = ? WHERE id = ?").bind(msg, reservedTxId).run();
    }
  } catch {}
  return { ok: false, userBalanceAfterTenths: 0n, error: msg, txId: reservedTxId || '' };
}

export async function reverseBalanceTransaction(env, opts) {
  const { txId, adminId, reason } = opts || {};
  const id = toTrimmedString(txId);
  if (!id) return { ok: false, error: 'Missing txId' };
  const reversalKey = `reverse:${id}`;

  const existing = await getExistingTransactionByIdempotencyKey(env, reversalKey);
  if (existing && existing.id) {
    return { ok: String(existing.status) === 'succeeded', txId: String(existing.id) };
  }

  const original = await env.DB
    .prepare("SELECT id, user_id, type, amount_tenths, status FROM balance_transactions WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  if (!original || String(original.status) !== 'succeeded') return { ok: false, error: 'Original transaction not found or not succeeded' };
  if (String(original.type) !== 'charge') return { ok: false, error: 'Only charge transactions can be reversed' };

  const userId = String(original.user_id);
  const amount = BigInt(String(original.amount_tenths ?? 0));
  if (amount <= 0n) return { ok: false, error: 'Invalid original amount' };

  const ts = Date.now();
  const reverseTxId = createTxId();
  try {
    const beforeRow = await env.DB
      .prepare("SELECT CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths FROM users WHERE id = ? LIMIT 1")
      .bind(userId)
      .first();
    const beforeTenths = BigInt(String(beforeRow?.tenths ?? 0));

    const updateRes = await env.DB
      .prepare(
        `
        UPDATE users
        SET tokens = (
          (
            CASE
              WHEN CAST(ROUND(tokens * 10, 0) AS INTEGER) < 0 THEN 0
              ELSE CAST(ROUND(tokens * 10, 0) AS INTEGER)
            END
            + ?
          ) / 10.0
        )
        WHERE id = ?
          AND CAST(ROUND(tokens * 10, 0) AS INTEGER) = ?
        RETURNING CAST(ROUND(tokens * 10, 0) AS INTEGER) AS tenths
      `
      )
      .bind(Number(amount), userId, Number(beforeTenths))
      .first();

    if (!updateRes) {
      return { ok: false, error: 'Concurrent update conflict' };
    }

    const afterTenths = BigInt(String(updateRes?.tenths ?? 0));

    await env.DB.prepare(
      "INSERT INTO balance_transactions (id, idempotency_key, user_id, type, amount_tenths, balance_before_tenths, balance_after_tenths, status, error, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        reverseTxId,
        reversalKey,
        String(userId),
        'reversal',
        Number(amount),
        Number(beforeTenths),
        Number(afterTenths),
        'succeeded',
        null,
        JSON.stringify({ reversed_tx_id: id, admin_id: adminId || null, reason: reason || null }),
        ts
      )
      .run();

    await insertDoubleEntry(env, {
      txId: reverseTxId,
      userId,
      userDeltaTenths: amount,
      systemAccount: 'system_revenue',
      systemDeltaTenths: -amount
    });

    await writeActivityLog(env, {
      userId,
      level: 'INFO',
      message: `Rollback saldo Rp ${formatTenthsToString(amount)} – saldo menjadi Rp ${formatTenthsToString(afterTenths)}${reason ? ` (${reason})` : ''}`,
      timestampMs: ts
    });

    try {
      await env.DB.prepare("INSERT INTO admin_logs (admin_id, action, target_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(String(adminId || ''), 'balance_reverse', String(id))
        .run();
    } catch {}

    return { ok: true, txId: reverseTxId, userBalanceAfterTenths: afterTenths };
  } catch (e) {
    throw e;
  }
}
