import assert from 'node:assert';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { isValidEmail, parsePurchase, matchProduct, parsePaidAtMs } from '../utils/lynkParser.js';

test('isValidEmail: valid and invalid cases', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('USER+tag@Example.co.id'), true);
  assert.equal(isValidEmail('bad@'), false);
  assert.equal(isValidEmail('noatsign.com'), false);
  assert.equal(isValidEmail('user@@example.com'), false);
});

test('parsePaidAtMs: accepts ISO, seconds, and ms', () => {
  const ms1 = parsePaidAtMs('2024-07-01T12:34:56Z');
  assert.ok(Number.isFinite(ms1) && ms1 > 0);
  const ms2 = parsePaidAtMs(1720000000);
  assert.ok(ms2 >= 1720000000 * 1000 - 1000 && ms2 <= 1720000000 * 1000 + 1000);
  const ms3 = parsePaidAtMs(1720000000123);
  assert.equal(ms3, 1720000000123);
});

test('matchProduct: matches full product title only', () => {
  const body1 = { data: { order_id: '851png1z505m' } };
  assert.equal(matchProduct(body1).matched, false);
  const body2 = { data: { message_data: { title: 'Metabayn - Smart Metadata Agent' } } };
  assert.equal(matchProduct(body2).matched, true);
  const body3 = { data: { message_data: { title: 'Other Product' } } };
  assert.equal(matchProduct(body3).matched, false);
});

test('parsePurchase: extracts email, status, paidAtMs, product match', () => {
  const body = {
    data: {
      status: 'PAID',
      paid_at: '2025-01-02T03:04:05Z',
      message_data: {
        customer: { email: 'Buyer@Example.com' },
        totals: { total: 125000, currency: 'idr' },
        title: 'Metabayn - Smart Metadata Agent'
      },
      order_id: 'order-123'
    },
    event_id: 'evt-1'
  };
  const p = parsePurchase(body);
  assert.equal(p.email, 'buyer@example.com');
  assert.equal(p.paymentStatus, 'paid');
  assert.ok(Number.isFinite(p.paidAtMs));
  assert.equal(p.productMatched, true);
  assert.equal(p.currency, 'IDR');
  assert.equal(p.orderId, 'order-123');
  assert.equal(p.eventId, 'evt-1');
});

test('parsePurchase: performance parsing 1000 payloads', async () => {
  const payload = {
    data: {
      status: 'PAID',
      paid_at: '2025-01-02T03:04:05Z',
      message_data: { customer: { email: 'buyer@example.com' }, title: 'Smart Metadata Agent' },
      order_id: 'order-xyz'
    },
    id: 'evt-xyz'
  };
  const list = new Array(1000).fill(0).map(() => JSON.parse(JSON.stringify(payload)));
  const t0 = Date.now();
  for (const b of list) parsePurchase(b);
  const dt = Date.now() - t0;
  assert.ok(dt < 1000);
});

test('lynkid webhook: pembelian pertama akun baru mengirim voucher email', { timeout: 60000 }, async (t) => {
  const logsDir = path.join(process.cwd(), '.wrangler', 'logs');
  await mkdir(logsDir, { recursive: true });
  process.env.WRANGLER_LOG_PATH = path.join(logsDir, 'wrangler-test.log');
  process.env.EXPERIMENTAL_MIDDLEWARE = 'false';
  const uniq = Date.now();

  const { unstable_dev } = await import('wrangler');
  const worker = await unstable_dev('src/index.ts', {
    local: true,
    experimental: { disableExperimentalWarning: true, forceLocal: true, disableDevRegistry: true, testMode: true },
    vars: {
      LYNKID_WEBHOOK_SECRET: 'test-lynkid-secret',
      ADMIN_SECRET: 'test-admin-secret',
      EMAIL_TEST_MODE: '1',
      RESEND_API_KEY: '',
      JWT_SECRET: 'test-jwt-secret-12345678'
    }
  });

  t.after(async () => {
    await worker.stop();
  });

  const payload = {
    event: 'payment.received',
    data: {
      status: 'PAID',
      order_id: `order-first-${Date.now()}`,
      message_data: {
        customer: { email: `newuser-${uniq}@example.com` },
        items: [
          { title: 'Metabayn - Smart Metadata Agent (Lifetime)', price: 49000 }
        ]
      }
    }
  };

  const resp = await worker.fetch('http://localhost/lynkid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lynkid-webhook-secret': 'test-lynkid-secret'
    },
    body: JSON.stringify(payload)
  });

  assert.equal(resp.status, 200);
  const json = await resp.json();
  assert.equal(json?.success, true);
  assert.ok(String(json?.purchase_id || '').length > 0);
  assert.equal(String(json?.idempotency_key || ''), String(payload.data.order_id));
  assert.equal(String(json?.version || ''), 'license_v1');

  const q = encodeURIComponent(payload.data.order_id);
  const adminResp = await worker.fetch(`http://localhost/admin/lynk/purchases?q=${q}`, {
    headers: { 'x-admin-key': 'test-admin-secret' }
  });
  assert.equal(adminResp.status, 200);
  const adminJson = await adminResp.json();
  assert.ok(Array.isArray(adminJson?.purchases));
  assert.ok(adminJson.purchases.length >= 1);

  const row = adminJson.purchases.find((p) => String(p?.idempotency_key || '') === String(payload.data.order_id));
  assert.ok(row);
  assert.equal(String(row.status), 'voucher_sent');
  assert.equal(String(row.email_status), 'test');
  assert.ok(String(row.voucher_code || '').length > 0);

  const deviceHash = `test-device-${uniq}-1`;
  const email = `newuser-${uniq}@example.com`;
  const password = 'Passw0rd!234';

  const regResp = await worker.fetch('http://localhost/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  assert.equal(regResp.status, 200);

  const loginResp = await worker.fetch('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  assert.equal(loginResp.status, 200);
  const loginJson = await loginResp.json();
  assert.ok(loginJson?.token);
  assert.ok(loginJson?.user?.id);

  const redeemResp = await worker.fetch('http://localhost/license/activate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${loginJson.token}`
    },
    body: JSON.stringify({ code: row.voucher_code, userId: String(loginJson.user.id), deviceHash })
  });
  assert.equal(redeemResp.status, 200);
  const redeemJson = await redeemResp.json();
  assert.equal(redeemJson?.success, true);

  const redeemAgainResp = await worker.fetch('http://localhost/license/activate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${loginJson.token}`
    },
    body: JSON.stringify({ code: row.voucher_code, userId: String(loginJson.user.id), deviceHash })
  });
  assert.equal(redeemAgainResp.status, 200);
  const redeemAgainJson = await redeemAgainResp.json();
  assert.equal(redeemAgainJson?.success, true);

  const otherDeviceHash = `test-device-${uniq}-2`;
  const redeemOtherDeviceResp = await worker.fetch('http://localhost/license/activate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${loginJson.token}`
    },
    body: JSON.stringify({ code: row.voucher_code, userId: String(loginJson.user.id), deviceHash: otherDeviceHash })
  });
  assert.equal(redeemOtherDeviceResp.status, 409);
  const redeemOtherDeviceJson = await redeemOtherDeviceResp.json();
  assert.equal(String(redeemOtherDeviceJson?.error_code || ''), 'license_already_used');

  const badDeviceHash = `test-device-${uniq}-3`;
  const badResp = await worker.fetch('http://localhost/license/activate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${loginJson.token}`
    },
    body: JSON.stringify({ code: 'AAAAAA', userId: String(loginJson.user.id), deviceHash: badDeviceHash })
  });
  assert.equal(badResp.status, 404);
  const badJson = await badResp.json();
  assert.equal(String(badJson?.error_code || ''), 'invalid_license');

  const adminResp2 = await worker.fetch(`http://localhost/admin/lynk/purchases?q=${q}`, {
    headers: { 'x-admin-key': 'test-admin-secret' }
  });
  assert.equal(adminResp2.status, 200);
  const adminJson2 = await adminResp2.json();
  const row2 = adminJson2.purchases.find((p) => String(p?.idempotency_key || '') === String(payload.data.order_id));
  assert.ok(row2);
  assert.ok(row2.voucher_redeemed_at);
  assert.equal(String(row2.voucher_redeemed_by_user_id || ''), String(loginJson.user.id));
});

test('lynkid webhook: produk topup diabaikan (deprecated)', { timeout: 60000 }, async (t) => {
  const logsDir = path.join(process.cwd(), '.wrangler', 'logs');
  await mkdir(logsDir, { recursive: true });
  process.env.WRANGLER_LOG_PATH = path.join(logsDir, 'wrangler-test.log');
  process.env.EXPERIMENTAL_MIDDLEWARE = 'false';
  const uniq = Date.now();

  const { unstable_dev } = await import('wrangler');
  const worker = await unstable_dev('src/index.ts', {
    local: true,
    experimental: { disableExperimentalWarning: true, forceLocal: true, disableDevRegistry: true, testMode: true },
    vars: {
      LYNKID_WEBHOOK_SECRET: 'test-lynkid-secret',
      ADMIN_SECRET: 'test-admin-secret',
      EMAIL_TEST_MODE: '1',
      RESEND_API_KEY: '',
      JWT_SECRET: 'test-jwt-secret-12345678'
    }
  });

  t.after(async () => {
    await worker.stop();
  });

  const deviceHash = `test-device-${uniq}`;
  const email = `topup-${uniq}@example.com`;
  const password = 'Passw0rd!234';

  const regResp = await worker.fetch('http://localhost/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  assert.equal(regResp.status, 200);

  const loginResp = await worker.fetch('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  assert.equal(loginResp.status, 200);
  const loginJson = await loginResp.json();
  assert.ok(loginJson?.token);
  assert.ok(loginJson?.user?.id);

  const balBeforeResp = await worker.fetch('http://localhost/token/balance', {
    headers: { 'Authorization': `Bearer ${loginJson.token}` }
  });
  assert.equal(balBeforeResp.status, 200);
  const balBeforeJson = await balBeforeResp.json();
  const beforeTokens = Number(balBeforeJson?.tokens ?? balBeforeJson?.balance ?? 0);

  const orderId = `order-topup-${uniq}`;
  const payload = {
    event: 'payment.received',
    data: {
      status: 'PAID',
      order_id: orderId,
      message_data: {
        customer: { email },
        items: [
          { title: 'Metabayn Token 20.000 – Credit Top-Up for Metadata Processing', price: 22500 }
        ]
      }
    }
  };

  const resp = await worker.fetch('http://localhost/lynkid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lynkid-webhook-secret': 'test-lynkid-secret'
    },
    body: JSON.stringify(payload)
  });

  assert.equal(resp.status, 202);
  const json = await resp.json();
  assert.equal(json?.success, true);
  assert.equal(json?.ignored, true);
  assert.equal(String(json?.reason || ''), 'product_not_matched');
  assert.equal(String(json?.version || ''), 'license_v1');

  const balAfterResp = await worker.fetch('http://localhost/token/balance', {
    headers: { 'Authorization': `Bearer ${loginJson.token}` }
  });
  assert.equal(balAfterResp.status, 200);
  const balAfterJson = await balAfterResp.json();
  const afterTokens = Number(balAfterJson?.tokens ?? balAfterJson?.balance ?? 0);
  assert.equal(afterTokens, beforeTokens);
});

test('lynkid webhook: license tanpa items memakai title fallback', { timeout: 60000 }, async (t) => {
  const logsDir = path.join(process.cwd(), '.wrangler', 'logs');
  await mkdir(logsDir, { recursive: true });
  process.env.WRANGLER_LOG_PATH = path.join(logsDir, 'wrangler-test.log');
  process.env.EXPERIMENTAL_MIDDLEWARE = 'false';
  const uniq = Date.now();

  const { unstable_dev } = await import('wrangler');
  const worker = await unstable_dev('src/index.ts', {
    local: true,
    experimental: { disableExperimentalWarning: true, forceLocal: true, disableDevRegistry: true, testMode: true },
    vars: {
      LYNKID_WEBHOOK_SECRET: 'test-lynkid-secret',
      ADMIN_SECRET: 'test-admin-secret',
      EMAIL_TEST_MODE: '1',
      RESEND_API_KEY: '',
      JWT_SECRET: 'test-jwt-secret-12345678'
    }
  });

  t.after(async () => {
    await worker.stop();
  });

  const email = `titleonly-${uniq}@example.com`;
  const orderId = `order-titleonly-${uniq}`;
  const payload = {
    event: 'payment.received',
    data: {
      status: 'PAID',
      order_id: orderId,
      message_data: {
        customer: { email },
        totals: { total: 149000, currency: 'idr' },
        title: 'Metabayn - Smart Metadata Agent'
      }
    }
  };

  const resp = await worker.fetch('http://localhost/lynkid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lynkid-webhook-secret': 'test-lynkid-secret'
    },
    body: JSON.stringify(payload)
  });

  assert.equal(resp.status, 200);
  const json = await resp.json();
  assert.equal(json?.success, true);
  assert.ok(String(json?.purchase_id || '').length > 0);
  assert.equal(String(json?.idempotency_key || ''), String(orderId));
  assert.equal(String(json?.version || ''), 'license_v1');

  const q = encodeURIComponent(orderId);
  const adminResp = await worker.fetch(`http://localhost/admin/lynk/purchases?q=${q}`, {
    headers: { 'x-admin-key': 'test-admin-secret' }
  });
  assert.equal(adminResp.status, 200);
  const adminJson = await adminResp.json();
  const row = adminJson.purchases.find((p) => String(p?.idempotency_key || '') === String(orderId));
  assert.ok(row);
  assert.equal(String(row.status), 'voucher_sent');
  assert.equal(String(row.email_status), 'test');
  assert.ok(String(row.voucher_code || '').length > 0);
});
