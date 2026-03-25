import { handleLogin, handleRegister, handleGetMe, handleVerify, handleForgotPassword, handleResetPasswordPage } from './handlers/auth';
import { handleGenerate } from './handlers/ai';
import { handleCloudflareGenerate } from './handlers/cloudflareAi';
import { handleBalance, handleHistory, handleTopup } from './handlers/user';
import { handleAdminModelPrices, handleAdminConfig, handleAdminSyncUsdIdr, handleListUsers, handleUpdateSubscription, handleResetPassword, handleDeleteUser, handlePurgeNonAdminUsers, handleAdminUsersOverview, handleExportUsersCsv, handleAdminLynkPurchases, handleAdminLynkWebhookLogs, handleAdminCleanupOpenRouterKeys } from './handlers/admin';
import { handleUserUsage, handleExportUsageCsv, handleAuditCheck, handleAdminReverseBalance, handleAdminBalanceStressTest } from './handlers/adminReports';
import { handleRedeemVoucher, handleListVouchers, handleCreateVoucher, handleDeleteVoucher, handleBulkCreateVouchers, handleExtendVoucher, handleLynkIdWebhook } from './handlers/voucher';
import { listTopups, getTopupDetail, manualApproveTopup, deleteTopup, deleteAllTopups, getTopupStatistics, exportTopupCsv } from './handlers/adminTopup';
import { createPaypalPayment, handlePaypalWebhook, checkPaypalStatus, checkLastLynkIdTransaction, paymentSuccessPage, paymentCancelPage } from './handlers/payment';
import { verifyToken } from './lib/crypto';
import { Env } from './types';
import { getExchangeRate } from './utils/currency';
import { runValidationTests } from './tests/validationTest';
import { filterVisionModelPrices } from './utils/modelFilter.js';
import { handleLynkPurchaseWebhook, processLynkPurchaseRetries, expireBonusTokens } from './handlers/lynkPurchase';

export type { Env }; // Re-export for handlers if needed, though they should import from types

export default {
  async scheduled(_event: any, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const autoRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_auto_sync'").first();
      let auto = false;
      if (autoRow && autoRow.value) {
        try { auto = JSON.parse(String(autoRow.value)) === true; } catch { auto = String(autoRow.value) === '1' || String(autoRow.value) === 'true'; }
      }

      if (auto) {
        const live = await getExchangeRate(env);
        if (live && typeof live === 'number' && live > 0) {
          await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind('usd_idr_rate', String(live)).run();
          await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind('usd_idr_rate_last_update', String(Date.now())).run();
        }
      }

      const now = Date.now();
      try { await processLynkPurchaseRetries(env, now); } catch {}
      try { await expireBonusTokens(env, now); } catch {}
    } catch (e) {
      // Silent fail to avoid crashing scheduled event
      console.log('Scheduled rate sync failed:', e);
    }
  },
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let path = url.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    const method = request.method;

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key, x-webhook-secret, x-lynkid-webhook-secret, x-lynkid-secret, x-lynk-webhook-secret, x-lynk-secret, idempotency-key, x-idempotency-key, x-lynkid-signature, x-signature, signature",
    };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Test Route (Dev Only) - Protected by x-admin-key
    if (path === '/test/validation' && method === 'GET') {
        const adminKey = request.headers.get('x-admin-key') || '';
        if (!env.ADMIN_SECRET || adminKey !== env.ADMIN_SECRET) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }
        const result = await runValidationTests(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const wrapCors = async (promise: Promise<Response> | Response) => {
      try {
        const res = await promise;
        if (!res) throw new Error("No response from handler");
        const headers = new Headers(res.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      } catch (e: any) {
         const msg = e instanceof Error ? e.message : String(e);
         return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
      }
    };

    const routeLynkWebhook = async (req: Request): Promise<Response> => {
      return handleLynkIdWebhook(req, env);
    };

    const routeLynkPurchaseWebhook = async (req: Request): Promise<Response> => {
      return handleLynkPurchaseWebhook(req, env);
    };

    try {
      // --- PUBLIC ROUTES (No Auth Required) ---
      if (path === '/swagger.json' && method === 'GET') {
        const spec = {
          openapi: '3.0.3',
          info: { title: 'Metabayn Backend API', version: '1.0.0' },
          paths: {
            '/webhook/lynk-purchase': {
              post: {
                summary: 'Webhook Lynk.id: pembelian Metabayn - Smart Metadata Agent',
                description: 'Menerima notifikasi pembelian dari Lynk.id. Endpoint ini memakai auth token (secret) dan idempotency key.',
                security: [
                  { bearerAuth: [] },
                  { webhookSecret: [] }
                ],
                parameters: [
                  { name: 'idempotency-key', in: 'header', required: false, schema: { type: 'string' } },
                  { name: 'x-idempotency-key', in: 'header', required: false, schema: { type: 'string' } },
                  { name: 'x-lynkid-signature', in: 'header', required: false, schema: { type: 'string' } }
                ],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
                },
                responses: {
                  '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
                  '202': { description: 'Ignored (produk tidak cocok)', content: { 'application/json': { schema: { type: 'object' } } } },
                  '400': { description: 'Invalid JSON' },
                  '401': { description: 'Unauthorized' },
                  '422': { description: 'Invalid email' },
                  '429': { description: 'Rate limited' },
                  '500': { description: 'Server error' }
                }
              }
            }
          },
          components: {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer' },
              webhookSecret: { type: 'apiKey', in: 'header', name: 'x-webhook-secret' }
            }
          }
        };
        return new Response(JSON.stringify(spec), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (path === '/auth/register' && method === 'POST') return await wrapCors(handleRegister(request, env));
      if (path === '/auth/login' && method === 'POST') return await wrapCors(handleLogin(request, env));
      if (path === '/auth/forgot-password' && method === 'POST') return await wrapCors(handleForgotPassword(request, env));
      if (path === '/auth/reset-password' && (method === 'GET' || method === 'POST')) return await handleResetPasswordPage(request, env);
      if (path === '/auth/verify' && method === 'GET') return await handleVerify(request, env);
      if (path === '/webhook/lynk-purchase' && method === 'POST') return await wrapCors(routeLynkPurchaseWebhook(request));
      if (path === '/integration/lynkid/webhook' && method === 'GET') {
        return new Response(JSON.stringify({ ok: true, expected_method: 'POST', path }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (path === '/integration/lynkid/webhook' && method === 'POST') return await wrapCors(routeLynkWebhook(request));
      if (path === '/payment/lynkid/webhook' && method === 'POST') return await wrapCors(routeLynkWebhook(request));
      if (path === '/lynkid/webhook' && method === 'POST') return await wrapCors(routeLynkWebhook(request));
      if (path === '/payment/success' && method === 'GET') return await paymentSuccessPage(request, env);
      if (path === '/payment/cancel' && method === 'GET') return await paymentCancelPage(request, env);
      
      // DEBUG ROUTES (Temporary for investigation)
      if (path === '/debug/test-validation' && method === 'GET') {
          const { runValidationTests } = await import('./tests/validationTest');
          return new Response(JSON.stringify(await runValidationTests(env)), { headers: corsHeaders });
      }
      if (path === '/debug/lynkid-webhook' && method === 'GET') {
          const [webhookRow, processingRow] = await Promise.all([
            env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_lynkid_webhook'").first(),
            env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_lynkid_processing'").first()
          ]);
          const rawWebhook = (webhookRow as any)?.value as string | undefined;
          const rawProcessing = (processingRow as any)?.value as string | undefined;
          let webhook: any = rawWebhook || null;
          let processing: any = rawProcessing || null;
          try { if (typeof rawWebhook === 'string') webhook = JSON.parse(rawWebhook); } catch {}
          try { if (typeof rawProcessing === 'string') processing = JSON.parse(rawProcessing); } catch {}
          return new Response(JSON.stringify({ webhook, processing }), { headers: corsHeaders });
      }
      if (path === '/debug/lynkid-webhook-auth' && method === 'GET') {
          const [authRow, headersRow] = await Promise.all([
            env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_lynkid_webhook_auth'").first(),
            env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_lynkid_webhook_headers'").first()
          ]);
          const rawAuth = (authRow as any)?.value as string | undefined;
          const rawHeaders = (headersRow as any)?.value as string | undefined;
          let auth: any = rawAuth || null;
          let headers: any = rawHeaders || null;
          try { if (typeof rawAuth === 'string') auth = JSON.parse(rawAuth); } catch {}
          try { if (typeof rawHeaders === 'string') headers = JSON.parse(rawHeaders); } catch {}
          return new Response(JSON.stringify({ auth, headers }), { headers: corsHeaders });
      }
      if (path === '/debug/lynkid-config' && method === 'GET') {
            const configuredSecret =
              env.LYNKID_WEBHOOK_SECRET ||
              (env as any).LYNK_WEBHOOK_SECRET ||
              (env as any).LYNKID_SECRET ||
              (env as any).LYNKID_MERCHANT_KEY ||
              (env as any).LYNK_MERCHANT_KEY;
            const secretSource = env.LYNKID_WEBHOOK_SECRET
              ? 'LYNKID_WEBHOOK_SECRET'
              : (env as any).LYNK_WEBHOOK_SECRET
                ? 'LYNK_WEBHOOK_SECRET'
                : (env as any).LYNKID_SECRET
                  ? 'LYNKID_SECRET'
                  : (env as any).LYNKID_MERCHANT_KEY
                    ? 'LYNKID_MERCHANT_KEY'
                    : (env as any).LYNK_MERCHANT_KEY
                      ? 'LYNK_MERCHANT_KEY'
                      : 'none';
            return new Response(JSON.stringify({
                secret_configured: !!configuredSecret,
                secret_source: secretSource,
                secret_len: configuredSecret ? String(configuredSecret).length : 0
            }), { headers: corsHeaders });
       }
      if (path === '/debug/paypal-config' && method === 'GET') {
          const normalizeEnvSecret = (value: any) => {
              const trimmed = String(value ?? '').trim();
              if (trimmed.length >= 2) {
                  const first = trimmed[0];
                  const last = trimmed[trimmed.length - 1];
                  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
                      return trimmed.slice(1, -1).trim();
                  }
              }
              return trimmed;
          };
          const normalizePaypalCredential = (value: any) => {
              return normalizeEnvSecret(value).replace(/\s+/g, '');
          };
          const getEnvString = (keys: string[]) => {
              for (const k of keys) {
                  const v = (env as any)?.[k];
                  if (typeof v === 'string') {
                      const normalized = normalizeEnvSecret(v);
                      if (normalized) return normalized;
                  }
              }
              return undefined;
          };
          const getEnvStringWithKey = (keys: string[]) => {
              for (const k of keys) {
                  const v = (env as any)?.[k];
                  if (typeof v === 'string') {
                      const normalized = normalizePaypalCredential(v);
                      if (normalized) return { value: normalized, key: k };
                  }
              }
              return undefined;
          };

          const modeRaw = (getEnvString(['PAYPAL_MODE', 'PAYPAL_ENV']) || 'sandbox').toLowerCase();
          const mode = (modeRaw === 'live' || modeRaw === 'production') ? 'live' : 'sandbox';

          const idModeKeys = mode === 'live'
            ? ['PAYPAL_CLIENT_ID_LIVE', 'PAYPAL_LIVE_CLIENT_ID']
            : ['PAYPAL_CLIENT_ID_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_ID'];
          const secretModeKeys = mode === 'live'
            ? ['PAYPAL_CLIENT_SECRET_LIVE', 'PAYPAL_LIVE_CLIENT_SECRET']
            : ['PAYPAL_CLIENT_SECRET_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_SECRET'];
          const idGenericKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENTID'];
          const secretGenericKeys = ['PAYPAL_CLIENT_SECRET', 'PAYPAL_CLIENTSECRET'];

          const modeId = getEnvStringWithKey(idModeKeys);
          const modeSecret = getEnvStringWithKey(secretModeKeys);
          const genericId = getEnvStringWithKey(idGenericKeys);
          const genericSecret = getEnvStringWithKey(secretGenericKeys);

          const selected = (modeId?.value && modeSecret?.value)
            ? { clientId: modeId.value, clientSecret: modeSecret.value, clientIdSource: modeId.key, clientSecretSource: modeSecret.key }
            : (genericId?.value && genericSecret?.value)
              ? { clientId: genericId.value, clientSecret: genericSecret.value, clientIdSource: genericId.key, clientSecretSource: genericSecret.key }
              : null;

          return new Response(JSON.stringify({
              mode,
              selected_client_id_source: selected?.clientIdSource || null,
              selected_client_secret_source: selected?.clientSecretSource || null,
              selected_client_id_len: selected?.clientId ? String(selected.clientId).length : 0,
              selected_client_secret_len: selected?.clientSecret ? String(selected.clientSecret).length : 0,
              client_id_configured: !!(selected?.clientId),
              client_secret_configured: !!(selected?.clientSecret)
          }), { headers: corsHeaders });
      }
      if (path === '/debug/paypal-auth-test' && method === 'GET') {
          const normalizeEnvSecret = (value: any) => {
              const trimmed = String(value ?? '').trim();
              if (trimmed.length >= 2) {
                  const first = trimmed[0];
                  const last = trimmed[trimmed.length - 1];
                  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
                      return trimmed.slice(1, -1).trim();
                  }
              }
              return trimmed;
          };
          const normalizePaypalCredential = (value: any) => {
              return normalizeEnvSecret(value).replace(/\s+/g, '');
          };
          const getEnvString = (keys: string[]) => {
              for (const k of keys) {
                  const v = (env as any)?.[k];
                  if (typeof v === 'string') {
                      const normalized = normalizeEnvSecret(v);
                      if (normalized) return normalized;
                  }
              }
              return undefined;
          };
          const getEnvStringWithKey = (keys: string[]) => {
              for (const k of keys) {
                  const v = (env as any)?.[k];
                  if (typeof v === 'string') {
                      const normalized = normalizePaypalCredential(v);
                      if (normalized) return { value: normalized, key: k };
                  }
              }
              return undefined;
          };
          const readJsonSafe = async (res: Response) => {
              const text = await res.text().catch(() => '');
              if (!text) return { text: '', json: null as any };
              try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null as any }; }
          };

          const modeRaw = (getEnvString(['PAYPAL_MODE', 'PAYPAL_ENV']) || 'sandbox').toLowerCase();
          const mode = (modeRaw === 'live' || modeRaw === 'production') ? 'live' : 'sandbox';
          const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

          const idModeKeys = mode === 'live'
            ? ['PAYPAL_CLIENT_ID_LIVE', 'PAYPAL_LIVE_CLIENT_ID']
            : ['PAYPAL_CLIENT_ID_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_ID'];
          const secretModeKeys = mode === 'live'
            ? ['PAYPAL_CLIENT_SECRET_LIVE', 'PAYPAL_LIVE_CLIENT_SECRET']
            : ['PAYPAL_CLIENT_SECRET_SANDBOX', 'PAYPAL_SANDBOX_CLIENT_SECRET'];
          const idGenericKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENTID'];
          const secretGenericKeys = ['PAYPAL_CLIENT_SECRET', 'PAYPAL_CLIENTSECRET'];

          const modeId = getEnvStringWithKey(idModeKeys);
          const modeSecret = getEnvStringWithKey(secretModeKeys);
          const genericId = getEnvStringWithKey(idGenericKeys);
          const genericSecret = getEnvStringWithKey(secretGenericKeys);

          const selected = (modeId?.value && modeSecret?.value)
            ? { clientId: modeId.value, clientSecret: modeSecret.value, clientIdSource: modeId.key, clientSecretSource: modeSecret.key }
            : (genericId?.value && genericSecret?.value)
              ? { clientId: genericId.value, clientSecret: genericSecret.value, clientIdSource: genericId.key, clientSecretSource: genericSecret.key }
              : null;

          if (!selected?.clientId || !selected?.clientSecret) {
              return new Response(JSON.stringify({
                  mode,
                  base_url: baseUrl,
                  ok: false,
                  status: 500,
                  error: 'PayPal credential kosong',
                  selected_client_id_source: selected?.clientIdSource || null,
                  selected_client_secret_source: selected?.clientSecretSource || null
              }), { status: 500, headers: corsHeaders });
          }

          const auth = btoa(`${selected.clientId}:${selected.clientSecret}`);
          const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
              method: 'POST',
              headers: {
                  'Authorization': `Basic ${auth}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Accept': 'application/json',
                  'Accept-Language': 'en_US'
              },
              body: new URLSearchParams({ grant_type: 'client_credentials' }).toString()
          });
          const { text, json } = await readJsonSafe(tokenRes);
          return new Response(JSON.stringify({
              mode,
              base_url: baseUrl,
              ok: tokenRes.ok,
              status: tokenRes.status,
              paypal_debug_id: tokenRes.headers.get('paypal-debug-id'),
              error: json?.error || null,
              error_description: json?.error_description || null,
              response_snippet: (!json && text) ? text.slice(0, 200) : null,
              selected_client_id_source: selected.clientIdSource,
              selected_client_secret_source: selected.clientSecretSource,
              selected_client_id_len: String(selected.clientId).length,
              selected_client_secret_len: String(selected.clientSecret).length
          }), { headers: corsHeaders });
      }
       if (path === '/debug/topup-transactions/latest' && method === 'GET') {
           const txs = await env.DB.prepare("SELECT * FROM topup_transactions ORDER BY created_at DESC LIMIT 5").all();
           return new Response(JSON.stringify(txs.results), { headers: corsHeaders });
       }
 
       // Payment Webhooks (Must be public, verify signature inside handler)
      if (path === '/payment/paypal/webhook' && method === 'POST') return await wrapCors(handlePaypalWebhook(request, env));

      // SYSTEM ROUTES (Public for initialization/maintenance)
      if (path === '/health' && method === 'GET') return new Response("OK", { status: 200, headers: corsHeaders });
      if (path === '/system/agree-terms' && method === 'GET') {
          try {
            // Send 'agree' prompt to gated models
            const models = [
              '@cf/meta/llama-3.1-8b-instruct',
              '@cf/meta/llama-3.1-8b-instruct-fp8',
              '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
              '@cf/meta/llama-3.1-70b-instruct',
              '@cf/meta/llama-3.2-11b-vision-instruct',
              '@cf/meta/llama-3.2-1b-preview',
              '@cf/meta/llama-3.2-1b-instruct',
              '@cf/meta/llama-3.2-3b-instruct'
            ];
            const results = [];
            for (const m of models) {
               try {
                 await env.AI.run(m, { prompt: "agree" });
                 results.push({ model: m, status: "Agreed" });
               } catch (e: any) {
                 results.push({ model: m, status: "Error", error: e.message });
               }
            }
            return new Response(JSON.stringify({ success: true, results }), { headers: corsHeaders });
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
          }
      }

      // --- ADMIN ROUTES (Protected by ADMIN_SECRET OR Admin JWT) ---
      if (path.startsWith('/admin/')) {
          let isAdmin = false;
          
          // 1. Check x-admin-key
          const adminKey = request.headers.get('x-admin-key');
          if (env.ADMIN_SECRET && adminKey === env.ADMIN_SECRET) {
              isAdmin = true;
          }

          // 2. Check JWT if not already authenticated via key
          if (!isAdmin) {
             const authHeader = request.headers.get('Authorization');
             if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                const decoded = await verifyToken(token, env.JWT_SECRET);
                if (decoded) {
                    // Double check DB for latest admin status (in case token is old)
                    const dbUser = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(decoded.sub).first();
                    if (dbUser && dbUser.is_admin === 1) {
                        isAdmin = true;
                    }
                }
             }
          }

          if (!isAdmin) {
              return new Response(JSON.stringify({ error: 'Unauthorized Admin' }), { status: 401, headers: corsHeaders });
          }

          // Manual Update User (Moved up for priority)
          if ((path === '/admin/users/update-manual' || path === '/admin/users/update-manual/') && method === 'POST') {
            const { handleManualUpdateUser } = await import('./handlers/adminManualUpdate');
            return await wrapCors(handleManualUpdateUser(request, env));
          }

          // Existing Admin Routes
          if (path === '/admin/model-prices/sync' && method === 'POST') {
            const { handleSyncModelPrices } = await import('./handlers/admin');
            return await wrapCors(handleSyncModelPrices(request, env));
          }
          if (path === '/admin/model-prices/sync-live' && method === 'POST') {
            const { handleSyncLiveModelPrices } = await import('./handlers/admin');
            return await wrapCors(handleSyncLiveModelPrices(request, env));
          }
          if (path.startsWith('/admin/model-prices')) return await wrapCors(handleAdminModelPrices(request, env));
          if (path === '/admin/auth-logs') {
            const { handleAdminAuthLogs } = await import('./handlers/admin');
            return await wrapCors(handleAdminAuthLogs(request, env));
          }
          if (path === '/admin/config') return await wrapCors(handleAdminConfig(request, env));
          if (path === '/admin/usd-idr/sync' && method === 'POST') return await wrapCors(handleAdminSyncUsdIdr(request, env));
          if (path === '/admin/users') return await wrapCors(handleListUsers(request, env));
          if (path === '/admin/users/list') return await wrapCors(handleListUsers(request, env)); // Alias
          if (path === '/admin/users/overview' && method === 'GET') return await wrapCors(handleAdminUsersOverview(request, env));
          if (path === '/admin/openrouter/cleanup' && method === 'POST') return await wrapCors(handleAdminCleanupOpenRouterKeys(request, env));
          if (path === '/admin/users/export-csv' && method === 'GET') return await wrapCors(handleExportUsersCsv(request, env));
          if (path === '/admin/users/subscription') return await wrapCors(handleUpdateSubscription(request, env));
          if (path === '/admin/users/reset-password') return await wrapCors(handleResetPassword(request, env));
          if (path === '/admin/users/delete') return await wrapCors(handleDeleteUser(request, env));
          if (path === '/admin/users/purge' && method === 'POST') return await wrapCors(handlePurgeNonAdminUsers(request, env));
          if (path === '/admin/lynk/purchases' && method === 'GET') return await wrapCors(handleAdminLynkPurchases(request, env));
          if (path === '/admin/lynk/logs' && method === 'GET') return await wrapCors(handleAdminLynkWebhookLogs(request, env));

          // Admin Reports
          if (path === '/admin/audit-check' && method === 'GET') return await wrapCors(handleAuditCheck(request, env));
          if (path === '/admin/balance/reverse' && method === 'POST') return await wrapCors(handleAdminReverseBalance(request, env));
          if (path === '/admin/balance/stress-test' && method === 'POST') return await wrapCors(handleAdminBalanceStressTest(request, env));
          if (path.startsWith('/admin/users/') && path.endsWith('/usage') && method === 'GET') return await wrapCors(handleUserUsage(request, env));
          if (path === '/admin/users/export-usage' && method === 'GET') return await wrapCors(handleExportUsageCsv(request, env));

          // Voucher Admin Routes
          if (path === '/admin/vouchers' && method === 'GET') return await wrapCors(handleListVouchers(request, env));
          if (path === '/admin/vouchers/create' && method === 'POST') return await wrapCors(handleCreateVoucher(request, env));
  if (path === '/admin/vouchers/bulk-create' && method === 'POST') return await wrapCors(handleBulkCreateVouchers(request, env));
  if (path === '/admin/vouchers/extend' && method === 'POST') return await wrapCors(handleExtendVoucher(request, env));
          if (path === '/admin/vouchers/delete' && method === 'POST') return await wrapCors(handleDeleteVoucher(request, env));

          // Top-Up Admin Routes
          if (path === '/admin/topup/list' && method === 'GET') return await wrapCors(listTopups(request, env));
          if (path.startsWith('/admin/topup/detail/') && method === 'GET') return await wrapCors(getTopupDetail(request, env));
          if (path === '/admin/topup/manual-approve' && method === 'POST') return await wrapCors(manualApproveTopup(request, env));
          if (path === '/admin/topup/delete' && method === 'POST') {
            const { deleteTopup } = await import('./handlers/adminTopup');
            return await wrapCors(deleteTopup(request, env));
          }
          if (path === '/admin/transactions/update' && method === 'POST') {
            const { updateTransactionStatus } = await import('./handlers/adminTopup');
            return await wrapCors(updateTransactionStatus(request, env));
          }
          if (path === '/admin/topup/delete-all' && method === 'POST') return await wrapCors(deleteAllTopups(request, env));
          if (path === '/admin/topup/statistics' && method === 'GET') return await wrapCors(getTopupStatistics(request, env));
          if (path === '/admin/topup/export-csv' && method === 'GET') return await wrapCors(exportTopupCsv(request, env));
          
          return new Response('Admin Route Not Found', { status: 404, headers: corsHeaders });
      }

      // --- PROTECTED ROUTES MIDDLEWARE (User JWT) ---
      if (!env.JWT_SECRET || String(env.JWT_SECRET).trim().length < 8) {
        return new Response(JSON.stringify({ error: 'Server misconfigured: JWT_SECRET missing' }), { status: 500, headers: corsHeaders });
      }
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      const token = authHeader.split(' ')[1];
      const user = await verifyToken(token, env.JWT_SECRET);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Invalid Token' }), { status: 401, headers: corsHeaders });
      }

      // Inject user ID into request for handlers (simple passing via arg)
      const userId = user.sub;
      
      // --- AUTHENTICATED ROUTES ---
      if (path === '/user/me' && method === 'GET') return await wrapCors(handleGetMe(userId, env));
      if ((path === '/token/balance' || path === '/user/balance' || path === '/api/v1/wallet/token-balance') && method === 'GET') {
        return await wrapCors(handleBalance(userId, env));
      }
      if (path === '/token/topup' && method === 'POST') return await wrapCors(handleTopup(request, userId, env)); // Legacy/Simple topup
      if (path === '/history/list' && method === 'GET') return await wrapCors(handleHistory(userId, env));
      if (path === '/ai/generate' && method === 'POST') return await wrapCors(handleGenerate(request, userId, env));
      
      // OpenAI-compatible endpoints for Rust Client
      if ((path === '/v1/chat/completions' || path === '/chat/completions') && method === 'POST') return await wrapCors(handleGenerate(request, userId, env));
      if ((path === '/v1/models' || path === '/models') && method === 'GET') {
         return await wrapCors(Promise.resolve(new Response(JSON.stringify({
            object: "list",
            data: [
                { id: "gemini-2.0-flash-lite-preview-02-05", object: "model", created: 1677610602, owned_by: "google" },
                { id: "gpt-4o", object: "model", created: 1677610602, owned_by: "openai" }
            ]
         }), { headers: corsHeaders })));
      }

      // OpenRouter Key Info Proxy
      if ((path === '/v1/auth/key' || path === '/auth/key') && method === 'GET') {
          try {
            // Get user's OR Key
            const dbUser = await env.DB.prepare("SELECT or_api_key, tokens FROM users WHERE id = ?").bind(userId).first();
            let orKey = dbUser?.or_api_key as string;
            
            // If user has key, fetch real usage
            if (orKey) {
                const orRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
                    headers: { "Authorization": `Bearer ${orKey}` }
                });
                if (orRes.ok) {
                    const data = await orRes.json();
                    return await wrapCors(Promise.resolve(new Response(JSON.stringify(data), { headers: corsHeaders })));
                }
            }

            // Fallback: Simulate usage based on token balance
            // 1 Token = ~$0.00006 (approx)
            // Let's just return a "Server Managed" response
            const tokens = dbUser?.tokens as number || 0;
            const credit = tokens / 16000; // Rough conversion
            
            return await wrapCors(Promise.resolve(new Response(JSON.stringify({
                data: {
                    label: `Metabayn User (${tokens} tokens)`,
                    usage: 0, // We don't track cumulative usage here easily without complex query
                    limit: credit, // Show credit as limit? Or just null
                    is_limit_enabled: true
                }
            }), { headers: corsHeaders })));

          } catch (e: any) {
              return await wrapCors(Promise.resolve(new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })));
          }
      }
 
      if (path === '/cloudflare' && method === 'POST') return await wrapCors(handleCloudflareGenerate(request, userId, env));
      if (path === '/config/models' && method === 'GET') {
        try {
          const rows = await env.DB.prepare("SELECT provider, model_name, input_price, output_price, active FROM model_prices ORDER BY fallback_priority ASC").all();
          const results = Array.isArray(rows) ? rows : (rows.results || []);
          const nonOpenRouterRows = filterVisionModelPrices(
            results.filter((r: any) => String(r?.provider || '').toLowerCase() !== 'openrouter')
          );

          let openRouterRows: any[] = [];

          try {
            const openRouterKey =
              (env as any)?.OPENROUTER_API_KEY ||
              (env as any)?.OPENROUTER_MANAGEMENT_KEY ||
              (env as any)?.OPENROUTER_KEY;

            const headers: Record<string, string> = {};
            if (typeof openRouterKey === 'string' && openRouterKey.trim().length > 0) {
              headers.Authorization = `Bearer ${openRouterKey.trim()}`;
            }

            const orRes = await fetch('https://openrouter.ai/api/v1/models', {
              headers: Object.keys(headers).length ? headers : undefined
            });
            if (orRes.ok) {
              const orJson: any = await orRes.json().catch(() => null);
              const list = Array.isArray(orJson?.data) ? orJson.data : [];
              openRouterRows = list
                .filter((m: any) => {
                  const id = String(m?.id || '').trim();
                  if (!id || id === 'openrouter/free') return false;
                  const inputs = Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities : [];
                  return inputs.includes('image');
                })
                .map((m: any) => {
                  const prompt = Number(m?.pricing?.prompt);
                  const completion = Number(m?.pricing?.completion);
                  const inputPer1M = Number.isFinite(prompt) ? prompt * 1_000_000 : 0;
                  const outputPer1M = Number.isFinite(completion) ? completion * 1_000_000 : 0;
                  return {
                    provider: 'OpenRouter',
                    model_name: String(m?.id || '').trim(),
                    input_price: inputPer1M,
                    output_price: outputPer1M,
                    active: 1
                  };
                });
            }
          } catch {}

          if (openRouterRows.length === 0) {
            openRouterRows = filterVisionModelPrices(
              results.filter((r: any) => String(r?.provider || '').toLowerCase() === 'openrouter')
            );
          }

          const dedup = new Map<string, any>();
          for (const row of [...nonOpenRouterRows, ...openRouterRows]) {
            const key = `${String(row?.provider || '').toLowerCase()}:${String(row?.model_name || '')}`;
            if (!dedup.has(key)) dedup.set(key, row);
          }

          return await wrapCors(Promise.resolve(new Response(JSON.stringify({ success: true, data: Array.from(dedup.values()) }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } })));
        } catch (e: any) {
          return await wrapCors(Promise.resolve(new Response(JSON.stringify({ success: false, error: e.message, data: [] }), { status: 500, headers: corsHeaders })));
        }
      }
      
      // Voucher Redemption
      if (path === '/voucher/redeem' && method === 'POST') return await wrapCors(handleRedeemVoucher(request, env, userId));

      // Payment Creation Routes
      if (path === '/payment/paypal/create' && method === 'POST') return await wrapCors(createPaypalPayment(request, env));
      if (path === '/payment/paypal/check' && method === 'POST') return await wrapCors(checkPaypalStatus(request, env));
      if (path === '/payment/lynkid/check' && method === 'POST') return await wrapCors(checkLastLynkIdTransaction(request, userId, env));

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  },
};
