import { Env } from '../types';
import { sendEmail, getLicenseVoucherTemplate, getLynkPurchasePendingActivationTemplate, getLynkPurchaseActivatedTemplate } from '../utils/email';
import { addUserTokens } from '../utils/userToken';
import { parsePurchase as parsePurchaseUtil, isValidEmail as isValidEmailUtil, matchProduct as matchProductUtil, normalizeEmail as normalizeEmailUtil } from '../utils/lynkParser.js';
import { applyBalanceDeltaTenths } from '../utils/balanceLedger.js';

type ParsedPurchase = {
  email: string;
  paymentStatus: string;
  paidAtMs: number | null;
  productMatched: boolean;
  productRef: string | null;
  orderId: string | null;
  eventId: string | null;
  amount: number | null;
  currency: string | null;
};

const PRODUCT_REF_SUBSTRINGS = ['851png1z505m','metabayn - smart metadata agent','smart metadata agent'];
function normalizeEmail(email: unknown) { return normalizeEmailUtil(String(email ?? '')); }
function isValidEmail(email: string) { return isValidEmailUtil(email); }

function readHeaderAny(headers: Headers, names: string[]) {
  for (const n of names) {
    const v = headers.get(n);
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

function toJsonSafe(value: any) {
  try { return JSON.stringify(value); } catch { return null; }
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function generateVoucherCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function ensureVoucherTables(env: Env) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS vouchers (
        code TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        max_usage INTEGER NOT NULL,
        current_usage INTEGER NOT NULL,
        expires_at TEXT,
        allowed_emails TEXT,
        type TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS voucher_claims (
        user_id TEXT NOT NULL,
        voucher_code TEXT NOT NULL,
        device_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_voucher_claims_user_code ON voucher_claims(user_id, voucher_code);").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_voucher_claims_device_code ON voucher_claims(device_hash, voucher_code);").run();
    await env.DB.prepare("DELETE FROM voucher_claims WHERE rowid NOT IN (SELECT MIN(rowid) FROM voucher_claims GROUP BY voucher_code);").run();
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_claims_code_unique ON voucher_claims(voucher_code);").run();
  } catch {}
}

async function hmacSha256Hex(secret: string, message: string) {
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function normalizeSignature(sig: string) {
  const s = String(sig || '').trim();
  const hex = s.startsWith('0x') ? s.slice(2) : s;
  if (/^[a-fA-F0-9]{64}$/.test(hex)) return hex.toLowerCase();
  try {
    const bin = atob(s);
    let out = '';
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
    if (out.length === 64) return out.toLowerCase();
  } catch {}
  return null;
}

function resolveWebhookSecret(env: Env) {
  const candidates = [
    env.LYNKID_WEBHOOK_SECRET,
    (env as any).LYNK_WEBHOOK_SECRET,
    (env as any).LYNKID_SECRET,
    (env as any).LYNKID_MERCHANT_KEY,
    (env as any).LYNK_MERCHANT_KEY
  ];
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (v) return v;
  }
  return null;
}

function extractWebhookAuth(req: Request) {
  const url = new URL(req.url);
  const secretQuery =
    url.searchParams.get('secret') ||
    url.searchParams.get('webhook_secret') ||
    url.searchParams.get('webhookSecret') ||
    url.searchParams.get('merchant_key') ||
    url.searchParams.get('merchantKey') ||
    url.searchParams.get('x-webhook-secret') ||
    url.searchParams.get('x-lynkid-webhook-secret') ||
    url.searchParams.get('x-lynkid-secret') ||
    url.searchParams.get('x-lynk-webhook-secret') ||
    url.searchParams.get('x-lynk-secret');
  const secretHeader = readHeaderAny(req.headers, [
    'authorization',
    'x-webhook-secret',
    'x-lynkid-webhook-secret',
    'x-lynkid-secret',
    'x-lynk-webhook-secret',
    'x-lynk-secret',
    'merchant-key',
    'merchant_key',
    'x-merchant-key',
    'x-merchant_key',
    'x-lynk-merchant-key',
    'x-lynk-merchant_key',
    'x-lynkid-merchant-key',
    'x-lynkid-merchant_key'
  ]);
  if (secretHeader && secretHeader.toLowerCase().startsWith('bearer ')) {
    return secretHeader.slice(7).trim();
  }
  return secretHeader || secretQuery || null;
}

function parsePaidAtMs(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value > 1_000_000_000_000) return Math.trunc(value);
    if (value > 1_000_000_000) return Math.trunc(value * 1000);
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    if (n > 1_000_000_000_000) return Math.trunc(n);
    if (n > 1_000_000_000) return Math.trunc(n * 1000);
  }
  const dt = new Date(s);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function findEmailInPayload(body: any) {
  const data = body?.data;
  const messageData =
    data?.message_data ??
    data?.messageData ??
    data?.payload?.message_data ??
    data?.payload?.messageData ??
    body?.message_data ??
    body?.messageData ??
    body?.payload?.message_data ??
    body?.payload?.messageData ??
    body;

  const candidates = [
    messageData?.customer?.email,
    messageData?.buyer?.email,
    messageData?.email,
    data?.customer?.email,
    data?.buyer?.email,
    data?.email,
    body?.customer?.email,
    body?.buyer?.email,
    body?.email
  ];
  for (const c of candidates) {
    const e = normalizeEmail(c);
    if (e) return e;
  }
  return '';
}

function findEmailRawInPayload(body: any) {
  const data = body?.data;
  const messageData =
    data?.message_data ??
    data?.messageData ??
    data?.payload?.message_data ??
    data?.payload?.messageData ??
    body?.message_data ??
    body?.messageData ??
    body?.payload?.message_data ??
    body?.payload?.messageData ??
    body;

  const candidates = [
    messageData?.customer?.email,
    messageData?.buyer?.email,
    messageData?.email,
    data?.customer?.email,
    data?.buyer?.email,
    data?.email,
    body?.customer?.email,
    body?.buyer?.email,
    body?.email
  ];
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  return '';
}

function matchProduct(body: any): { matched: boolean; ref: string | null } {
  const haystackParts: string[] = [];
  const push = (v: any) => {
    const s = String(v ?? '').trim();
    if (s) haystackParts.push(s);
  };

  push(body?.data?.order_id);
  push(body?.data?.orderId);
  push(body?.data?.product_url);
  push(body?.data?.productUrl);
  push(body?.data?.checkout_url);
  push(body?.data?.checkoutUrl);

  const md =
    body?.data?.message_data ??
    body?.data?.messageData ??
    body?.message_data ??
    body?.messageData ??
    body?.data?.payload?.message_data ??
    body?.data?.payload?.messageData ??
    body?.payload?.message_data ??
    body?.payload?.messageData;

  push(md?.title);
  push(md?.product?.title);
  push(md?.product?.name);

  const items = Array.isArray(md?.items) ? md.items : Array.isArray(body?.data?.items) ? body.data.items : [];
  for (const it of items) {
    push(it?.title);
    push(it?.name);
    push(it?.product_url);
    push(it?.productUrl);
    push(it?.link);
    push(it?.sku);
    push(it?.id);
  }

  const haystack = haystackParts.join(' ').toLowerCase();
  for (const s of PRODUCT_REF_SUBSTRINGS) {
    if (haystack.includes(s)) return { matched: true, ref: s };
  }
  return { matched: false, ref: null };
}

function parsePurchase(body: any): ParsedPurchase {
  const base = (parsePurchaseUtil(body) as any) || {};
  if (!base.productMatched) {
    const alt = matchProduct(body);
    if (alt.matched) {
      base.productMatched = true;
      if (!base.productRef) base.productRef = alt.ref;
    }
  }
  return base as ParsedPurchase;
}

async function ensureLynkPurchaseSchema(env: Env) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS lynk_purchases (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        provider TEXT NOT NULL,
        product_ref TEXT,
        email TEXT NOT NULL,
        voucher_code TEXT,
        payment_status TEXT,
        purchase_ts INTEGER,
        status TEXT NOT NULL,
        user_id TEXT,
        activated_at INTEGER,
        activation_started_at INTEGER,
        raw_payload TEXT,
        signature_status INTEGER,
        email_status TEXT,
        email_last_error TEXT,
        failure_count INTEGER DEFAULT 0,
        next_retry_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("ALTER TABLE lynk_purchases ADD COLUMN voucher_code TEXT;").run();
  } catch {}

  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        purchase_id TEXT UNIQUE,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      `
    ).run();
  } catch {}

  try {
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
  } catch {}

  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS lynk_webhook_logs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        idempotency_key TEXT,
        purchase_id TEXT,
        received_at INTEGER NOT NULL,
        ip TEXT,
        headers TEXT,
        body TEXT,
        auth_ok INTEGER,
        signature_status INTEGER,
        status_code INTEGER,
        error TEXT
      );
      `
    ).run();
  } catch {}

  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lynk_purchases_email_status ON lynk_purchases(email, status, deleted_at);").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lynk_purchases_status_retry ON lynk_purchases(status, next_retry_at, deleted_at);").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_bonus_grants_user_exp ON bonus_token_grants(user_id, expires_at, deleted_at);").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lynk_webhook_logs_received ON lynk_webhook_logs(received_at);").run();
  } catch {}
}

async function rateLimitWebhook(env: Env, key: string, maxPerMinute: number) {
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS webhook_rate_limits (
        key TEXT PRIMARY KEY,
        minute_bucket INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
      `
    ).run();
  } catch {}

  const now = Date.now();
  const bucket = Math.floor(now / 60000);
  const k = `lynk_purchase:${key}`;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO webhook_rate_limits (key, minute_bucket, count) VALUES (?, ?, 0)")
      .bind(k, bucket)
      .run();
    await env.DB.prepare(
      `
      UPDATE webhook_rate_limits
      SET count = CASE WHEN minute_bucket = ? THEN count + 1 ELSE 1 END,
          minute_bucket = ?
      WHERE key = ?
      `
    )
      .bind(bucket, bucket, k)
      .run();
    const row: any = await env.DB.prepare("SELECT count, minute_bucket FROM webhook_rate_limits WHERE key = ?").bind(k).first();
    const c = Number(row?.count ?? 0);
    const b = Number(row?.minute_bucket ?? bucket);
    if (b !== bucket) return { ok: true, remaining: maxPerMinute - 1 };
    return { ok: c <= maxPerMinute, remaining: Math.max(0, maxPerMinute - c) };
  } catch {
    return { ok: true, remaining: maxPerMinute };
  }
}

async function notifyAdmin(env: Env, subject: string, html: string) {
  const cfg = (env as any)?.ADMIN_ALERT_EMAIL;
  const target = String(cfg ?? '').trim();
  if (target) {
    try { await sendEmail(target, subject, html, env); } catch {}
    return;
  }
  try {
    const row: any = await env.DB.prepare("SELECT email FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1").first();
    const email = String(row?.email ?? '').trim();
    if (email) {
      try { await sendEmail(email, subject, html, env); } catch {}
    }
  } catch {}
}

export async function handleLynkPurchaseWebhook(req: Request, env: Env) {
  await ensureLynkPurchaseSchema(env);

  const requestId = crypto.randomUUID();
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || 'unknown';

  const rate = await rateLimitWebhook(env, ip, 100);
  if (!rate.ok) {
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', NULL, NULL, ?, ?, ?, NULL, 0, NULL, 429, ?)"
      )
        .bind(requestId, Date.now(), ip, toJsonSafe(Object.fromEntries(req.headers.entries())), 'rate_limited')
        .run();
    } catch {}
    return Response.json({ success: false, error: 'rate_limited' }, { status: 429 });
  }

  const configuredSecret = resolveWebhookSecret(env);
  const receivedSecret = extractWebhookAuth(req);
  const authOk = !!configuredSecret && !!receivedSecret && receivedSecret === configuredSecret;
  if (!authOk) {
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', NULL, NULL, ?, ?, ?, NULL, 0, NULL, 401, ?)"
      )
        .bind(requestId, Date.now(), ip, toJsonSafe(Object.fromEntries(req.headers.entries())), 'invalid_webhook_secret')
        .run();
    } catch {}
    return Response.json({ success: false, error: 'invalid_webhook_secret' }, { status: 401 });
  }

  const rawBody = await req.text();
  let body: any = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', NULL, NULL, ?, ?, ?, ?, 1, NULL, 400, ?)"
      )
        .bind(requestId, Date.now(), ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), 'invalid_json')
        .run();
    } catch {}
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = parsePurchase(body);
  const idKey =
    readHeaderAny(req.headers, ['idempotency-key', 'x-idempotency-key']) ||
    String(body?.event_id ?? body?.eventId ?? body?.data?.order_id ?? body?.data?.orderId ?? '').trim() ||
    null;
  const computedKey = idKey || (await sha256Hex(rawBody || requestId));
  const purchaseId = `lynk_${(await sha256Hex(computedKey)).slice(0, 32)}`;

  const signatureHeader = readHeaderAny(req.headers, ['x-lynkid-signature', 'x-signature', 'signature']);
  let signatureStatus: number | null = null;
  if (signatureHeader) {
    signatureStatus = 0;
    const n = normalizeSignature(signatureHeader);
    if (n && configuredSecret) {
      const expected = await hmacSha256Hex(configuredSecret, rawBody);
      signatureStatus = expected === n ? 1 : 0;
      if (signatureStatus !== 1) {
        try {
          await env.DB.prepare(
            "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', ?, ?, ?, ?, ?, ?, 1, 0, 401, ?)"
          )
            .bind(requestId, computedKey, purchaseId, Date.now(), ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), 'invalid_signature')
            .run();
        } catch {}
        return Response.json({ success: false, error: 'invalid_signature' }, { status: 401 });
      }
    }
  } else {
    signatureStatus = -1;
  }

  const email = normalizeEmail(parsed.email);
  if (!email || !isValidEmail(email)) {
    const emailRaw = findEmailRawInPayload(body) || String(parsed?.email ?? '').trim();
    const emailForDb = (emailRaw || 'unknown').slice(0, 254);
    const now = Date.now();
    try {
      await env.DB.prepare(
        `
        INSERT INTO lynk_purchases (
          id, idempotency_key, provider, product_ref, email, payment_status, purchase_ts, status,
          raw_payload, signature_status, email_status, email_last_error, last_error, created_at, updated_at, deleted_at
        )
        VALUES (?, ?, 'lynkid', ?, ?, ?, ?, 'pending_activation', ?, ?, 'failed', 'invalid_email', 'invalid_email', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          updated_at = excluded.updated_at,
          raw_payload = excluded.raw_payload,
          payment_status = excluded.payment_status,
          purchase_ts = COALESCE(excluded.purchase_ts, lynk_purchases.purchase_ts),
          signature_status = excluded.signature_status,
          email = excluded.email,
          email_status = 'failed',
          email_last_error = 'invalid_email',
          last_error = 'invalid_email'
        `
      )
        .bind(
          purchaseId,
          computedKey,
          parsed.productRef,
          emailForDb,
          parsed.paymentStatus || null,
          parsed.paidAtMs || null,
          rawBody.slice(0, 20000),
          signatureStatus,
          now,
          now
        )
        .run();
    } catch {}
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', ?, ?, ?, ?, ?, ?, 1, ?, 422, ?)"
      )
        .bind(requestId, computedKey, purchaseId, now, ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), signatureStatus, 'invalid_email')
        .run();
    } catch {}
    try {
      await notifyAdmin(
        env,
        'Pembelian Lynk.id terdeteksi email invalid',
        `<div>purchase_id: ${purchaseId}<br/>email_raw: ${emailForDb}<br/>error: invalid_email</div>`
      );
    } catch {}
    return Response.json({ success: false, error: 'invalid_email' }, { status: 422 });
  }

  if (!parsed.productMatched) {
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', ?, ?, ?, ?, ?, ?, 1, ?, 202, ?)"
      )
        .bind(requestId, computedKey, purchaseId, Date.now(), ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), signatureStatus, 'product_not_matched')
        .run();
    } catch {}
    return Response.json({ success: true, ignored: true, reason: 'product_not_matched' }, { status: 202 });
  }

  const now = Date.now();
  await ensureVoucherTables(env);
  const licenseDurationDays = 30;
  const licenseBonusTokens = 50000;
  const voucherExpiresAtIso = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await env.DB.prepare(
      `
      INSERT INTO lynk_purchases (
        id, idempotency_key, provider, product_ref, email, voucher_code, payment_status, purchase_ts, status,
        raw_payload, signature_status, created_at, updated_at, deleted_at, email_status
      )
      VALUES (?, ?, 'lynkid', ?, ?, NULL, ?, ?, 'voucher_pending', ?, ?, ?, ?, NULL, 'pending')
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        raw_payload = excluded.raw_payload,
        payment_status = excluded.payment_status,
        purchase_ts = COALESCE(excluded.purchase_ts, lynk_purchases.purchase_ts),
        signature_status = excluded.signature_status
      `
    )
      .bind(
        purchaseId,
        computedKey,
        parsed.productRef,
        email,
        parsed.paymentStatus || null,
        parsed.paidAtMs || null,
        rawBody.slice(0, 20000),
        signatureStatus,
        now,
        now
      )
      .run();
  } catch (e: any) {
    const msg = String(e?.message || e);
    try {
      await env.DB.prepare(
        "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', ?, ?, ?, ?, ?, ?, 1, ?, 500, ?)"
      )
        .bind(requestId, computedKey, purchaseId, now, ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), signatureStatus, msg.slice(0, 1000))
        .run();
    } catch {}
    await notifyAdmin(env, 'Webhook Lynk.id gagal (DB insert)', `<div>purchase_id: ${purchaseId}<br/>error: ${msg}</div>`);
    return Response.json({ success: false, error: 'db_error' }, { status: 500, headers: { 'Retry-After': '5' } });
  }

  try {
    await env.DB.prepare(
      "INSERT INTO lynk_webhook_logs (id, provider, idempotency_key, purchase_id, received_at, ip, headers, body, auth_ok, signature_status, status_code, error) VALUES (?, 'lynkid', ?, ?, ?, ?, ?, ?, 1, ?, 200, NULL)"
    )
      .bind(requestId, computedKey, purchaseId, now, ip, toJsonSafe(Object.fromEntries(req.headers.entries())), rawBody.slice(0, 20000), signatureStatus)
      .run();
  } catch {}

  try {
    let voucherCode = '';
    try {
      const row: any = await env.DB.prepare("SELECT voucher_code FROM lynk_purchases WHERE id = ? LIMIT 1").bind(purchaseId).first();
      voucherCode = String(row?.voucher_code ?? '').trim();
    } catch {}

    if (!voucherCode) {
      for (let i = 0; i < 6 && !voucherCode; i++) {
        const candidate = generateVoucherCode();
        try {
          await env.DB.prepare(
            "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, NULL, 'license', ?, ?)"
          )
            .bind(candidate, licenseBonusTokens, voucherExpiresAtIso, licenseDurationDays, new Date(now).toISOString())
            .run();
          voucherCode = candidate;
        } catch {}
      }
      if (voucherCode) {
        try {
          await env.DB.prepare("UPDATE lynk_purchases SET voucher_code = ?, updated_at = ? WHERE id = ?")
            .bind(voucherCode, Date.now(), purchaseId)
            .run();
        } catch {}
      }
    }

    if (!voucherCode) {
      await env.DB.prepare(
        "UPDATE lynk_purchases SET email_status = 'failed', email_last_error = 'voucher_generation_failed', failure_count = failure_count + 1, next_retry_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(Date.now() + 60_000, Date.now(), purchaseId)
        .run();
      await notifyAdmin(env, 'Generate voucher Lynk.id gagal', `<div>purchase_id: ${purchaseId}<br/>email: ${email}<br/>error: voucher_generation_failed</div>`);
      return Response.json({ success: false, error: 'voucher_generation_failed' }, { status: 500, headers: { 'Retry-After': '5' } });
    }

    const subject = 'Kode Voucher Metabayn - Smart Metadata Agent';
    const html = getLicenseVoucherTemplate(email, voucherCode, licenseDurationDays, licenseBonusTokens);
    await sendEmail(email, subject, html, env);
    await env.DB.prepare("UPDATE lynk_purchases SET email_status = 'sent', email_last_error = NULL, status = 'voucher_sent', next_retry_at = NULL, updated_at = ? WHERE id = ?")
      .bind(Date.now(), purchaseId)
      .run();
  } catch (e: any) {
    const msg = String(e?.message || e);
    try {
      await env.DB.prepare(
        "UPDATE lynk_purchases SET email_status = 'failed', email_last_error = ?, failure_count = failure_count + 1, next_retry_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(msg.slice(0, 1000), Date.now() + 60_000, Date.now(), purchaseId)
        .run();
    } catch {}
    try {
      await notifyAdmin(env, 'Email voucher Lynk.id gagal', `<div>purchase_id: ${purchaseId}<br/>email: ${email}<br/>error: ${msg}</div>`);
    } catch {}
  }

  return Response.json({ success: true, purchase_id: purchaseId, idempotency_key: computedKey });
}

export async function applyPendingLynkPurchasesForUser(env: Env, userId: string, email: string, trigger: 'login' | 'register' | 'verify' | 'webhook') {
  await ensureLynkPurchaseSchema(env);
  const normEmail = normalizeEmail(email);
  if (!normEmail || !isValidEmail(normEmail)) return { applied: 0 };

  const now = Date.now();
  const purchasesRes = await env.DB.prepare(
    `
    SELECT id, status
    FROM lynk_purchases
    WHERE lower(email) = lower(?)
      AND deleted_at IS NULL
      AND status = 'pending_activation'
    ORDER BY purchase_ts ASC, created_at ASC
    LIMIT 50
    `
  )
    .bind(normEmail)
    .all();

  const purchases = Array.isArray(purchasesRes?.results) ? purchasesRes.results : [];
  let applied = 0;

  for (const p of purchases) {
    const purchaseId = String(p?.id || '').trim();
    if (!purchaseId) continue;

    const activationStart = now;
    const endAt = now + 30 * 24 * 60 * 60 * 1000;
    const subId = `sub_${(await sha256Hex(`${purchaseId}:${userId}`)).slice(0, 32)}`;
    const grantId = `grant_${(await sha256Hex(`${purchaseId}:${userId}`)).slice(0, 32)}`;

    try {
      const lockRes: any = await env.DB.prepare(
        `
        UPDATE lynk_purchases
        SET activation_started_at = ?,
            user_id = ?,
            updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND status = 'pending_activation'
          AND activation_started_at IS NULL
        `
      )
        .bind(activationStart, userId, now, purchaseId)
        .run();
      if (!(lockRes?.meta?.changes > 0)) continue;

      const userRow: any = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ? LIMIT 1").bind(userId).first();
      let base = new Date(activationStart);
      const currentExpiry = userRow?.subscription_expiry ? new Date(String(userRow.subscription_expiry)) : null;
      if (currentExpiry && currentExpiry.getTime() > Date.now()) base = currentExpiry;
      base.setDate(base.getDate() + 30);
      const newExpiryIso = base.toISOString();

      await env.DB.prepare(
        `
        INSERT OR IGNORE INTO user_subscriptions (id, user_id, source, purchase_id, start_at, end_at, created_at, deleted_at)
        VALUES (?, ?, 'lynk_purchase', ?, ?, ?, ?, NULL)
        `
      )
        .bind(subId, userId, purchaseId, activationStart, endAt, now)
        .run();

      await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
        .bind(newExpiryIso, userId)
        .run();

      const grantInsertRes: any = await env.DB.prepare(
        `
        INSERT OR IGNORE INTO bonus_token_grants (id, user_id, source, purchase_id, amount_tenths, remaining_tenths, expires_at, created_at, deleted_at)
        VALUES (?, ?, 'lynk_purchase', ?, ?, ?, ?, ?, NULL)
        `
      )
        .bind(grantId, userId, purchaseId, 50000 * 10, 50000 * 10, new Date(newExpiryIso).getTime(), now)
        .run();

      if (grantInsertRes?.meta?.changes > 0) {
        await addUserTokens(userId, 50000, env, {
          logLabel: 'Bonus token',
          reason: 'Pembelian Metabayn',
          idempotencyKey: `lynk_purchase_bonus:${purchaseId}`,
          meta: { kind: 'bonus', source: 'lynk_purchase', purchase_id: purchaseId, expires_at: newExpiryIso, trigger }
        });
      }

      await env.DB.prepare(
        "UPDATE lynk_purchases SET status = 'activated', user_id = ?, activated_at = ?, activation_started_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(userId, now, activationStart, now, purchaseId)
        .run();

      applied++;

      try {
        const subject = 'Langganan Metabayn aktif';
        const html = getLynkPurchaseActivatedTemplate(normEmail, newExpiryIso, 50000);
        await sendEmail(normEmail, subject, html, env);
      } catch {}
    } catch (e: any) {
      const msg = String(e?.message || e);
      try {
        const row: any = await env.DB.prepare("SELECT failure_count FROM lynk_purchases WHERE id = ?").bind(purchaseId).first();
        const fc = Number(row?.failure_count ?? 0) + 1;
        const waitMs = Math.min(60 * 60 * 1000, 2000 * (2 ** Math.min(10, fc)));
        await env.DB.prepare(
          "UPDATE lynk_purchases SET last_error = ?, failure_count = ?, next_retry_at = ?, activation_started_at = NULL, updated_at = ? WHERE id = ?"
        )
          .bind(msg.slice(0, 1000), fc, Date.now() + waitMs, Date.now(), purchaseId)
          .run();
      } catch {}
      await notifyAdmin(env, 'Aktivasi Lynk.id gagal', `<div>purchase_id: ${purchaseId}<br/>user_id: ${userId}<br/>error: ${msg}</div>`);
    }
  }

  return { applied };
}

export async function processLynkPurchaseRetries(env: Env, nowMs: number) {
  await ensureLynkPurchaseSchema(env);
  const rows = await env.DB.prepare(
    `
    SELECT id, email, email_status, email_last_error, raw_payload, status
    FROM lynk_purchases
    WHERE deleted_at IS NULL
      AND next_retry_at IS NOT NULL
      AND next_retry_at <= ?
    ORDER BY next_retry_at ASC
    LIMIT 50
    `
  )
    .bind(nowMs)
    .all();

  const list = Array.isArray(rows?.results) ? rows.results : [];
  for (const r of list) {
    const purchaseId = String(r?.id || '');
    const email = normalizeEmail(r?.email);
    if (!email || !isValidEmail(email)) continue;
    try {
      let resendOk = true;
      if (String(r?.email_status || '') === 'failed') {
        resendOk = false;
        try {
          const status = String(r?.status || '');
          if (status === 'voucher_pending' || status === 'voucher_sent') {
            await ensureVoucherTables(env);
            let voucherCode = '';
            try {
              const row: any = await env.DB.prepare("SELECT voucher_code FROM lynk_purchases WHERE id = ? LIMIT 1").bind(purchaseId).first();
              voucherCode = String(row?.voucher_code ?? '').trim();
            } catch {}
            if (!voucherCode) {
              const now = Date.now();
              const voucherExpiresAtIso = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
              for (let i = 0; i < 6 && !voucherCode; i++) {
                const candidate = generateVoucherCode();
                try {
                  await env.DB.prepare(
                    "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, NULL, 'license', 30, ?)"
                  )
                    .bind(candidate, 50000, voucherExpiresAtIso, new Date(now).toISOString())
                    .run();
                  voucherCode = candidate;
                } catch {}
              }
              if (voucherCode) {
                try {
                  await env.DB.prepare("UPDATE lynk_purchases SET voucher_code = ?, updated_at = ? WHERE id = ?")
                    .bind(voucherCode, Date.now(), purchaseId)
                    .run();
                } catch {}
              }
            }
            if (!voucherCode) {
              throw new Error('voucher_generation_failed');
            }
            const subject = 'Kode Voucher Metabayn - Smart Metadata Agent';
            const html = getLicenseVoucherTemplate(email, voucherCode, 30, 50000);
            await sendEmail(email, subject, html, env);
            await env.DB.prepare(
              "UPDATE lynk_purchases SET email_status = 'sent', email_last_error = NULL, next_retry_at = NULL, status = 'voucher_sent', updated_at = ? WHERE id = ?"
            )
              .bind(Date.now(), purchaseId)
              .run();
          } else {
            const subject = 'Pembelian Metabayn diterima';
            const html = getLynkPurchasePendingActivationTemplate(email);
            await sendEmail(email, subject, html, env);
            await env.DB.prepare(
              "UPDATE lynk_purchases SET email_status = 'sent', email_last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
            )
              .bind(Date.now(), purchaseId)
              .run();
          }
          resendOk = true;
        } catch (e: any) {
          const msg = String(e?.message || e);
          const row: any = await env.DB.prepare("SELECT failure_count FROM lynk_purchases WHERE id = ?").bind(purchaseId).first();
          const fc = Number(row?.failure_count ?? 0) + 1;
          const waitMs = Math.min(60 * 60 * 1000, 2000 * (2 ** Math.min(10, fc)));
          await env.DB.prepare(
            "UPDATE lynk_purchases SET email_status = 'failed', email_last_error = ?, failure_count = ?, next_retry_at = ?, updated_at = ? WHERE id = ?"
          )
            .bind(msg.slice(0, 1000), fc, Date.now() + waitMs, Date.now(), purchaseId)
            .run();
        }
      }

      if (String(r?.status || '') === 'pending_activation') {
        const userRow: any = await env.DB.prepare("SELECT id, status FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(email).first();
        if (userRow && String(userRow.status || 'active') !== 'pending') {
          await applyPendingLynkPurchasesForUser(env, String(userRow.id), email, 'login');
          await env.DB.prepare("UPDATE lynk_purchases SET next_retry_at = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), purchaseId).run();
        } else {
          if (resendOk) {
            await env.DB.prepare("UPDATE lynk_purchases SET next_retry_at = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), purchaseId).run();
          }
        }
      }
    } catch {}
  }
}

export async function expireBonusTokens(env: Env, nowMs: number) {
  await ensureLynkPurchaseSchema(env);
  try {
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS bonus_expire_runs (
        id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL
      );
      `
    ).run();
  } catch {}

  const rows = await env.DB.prepare(
    `
    SELECT g.id, g.user_id, g.purchase_id, g.remaining_tenths
    FROM bonus_token_grants g
    WHERE g.deleted_at IS NULL
      AND g.remaining_tenths > 0
      AND g.expires_at <= ?
    ORDER BY g.expires_at ASC
    LIMIT 200
    `
  )
    .bind(nowMs)
    .all();
  const list = Array.isArray(rows?.results) ? rows.results : [];
  for (const r of list) {
    const grantId = String(r?.id || '');
    const userId = String(r?.user_id || '');
    const remaining = BigInt(String(r?.remaining_tenths ?? 0));
    if (!grantId || !userId || remaining <= 0n) continue;
    const txKey = `bonus_expire:${grantId}`;
    try {
      const out = await applyBalanceDeltaTenths(env as any, {
        userId,
        deltaTenths: -remaining,
        idempotencyKey: txKey,
        logLabel: 'Bonus token expired',
        reason: 'Langganan berakhir',
        systemAccount: 'system_bonus_expired',
        meta: { kind: 'bonus_expire', grant_id: grantId, purchase_id: String(r?.purchase_id || ''), amount_tenths: Number(remaining) }
      });

      await env.DB.prepare("UPDATE bonus_token_grants SET remaining_tenths = 0 WHERE id = ?").bind(grantId).run();

      if (!out?.ok) {
        await notifyAdmin(env, 'Expire bonus token gagal', `<div>grant_id: ${grantId}<br/>user_id: ${userId}<br/>error: ${String(out?.error || 'unknown')}</div>`);
      }
    } catch {}
  }
}
