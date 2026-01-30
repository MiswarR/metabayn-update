import { handleLogin, handleRegister, handleGetMe, handleVerify } from './handlers/auth';
import { handleGenerate } from './handlers/ai';
import { handleBalance, handleHistory, handleTopup } from './handlers/user';
import { handleAdminModelPrices, handleAdminConfig, handleListUsers, handleUpdateSubscription, handleResetPassword, handleDeleteUser } from './handlers/admin';
import { handleUserUsage, handleExportUsageCsv } from './handlers/adminReports';
import { handleRedeemVoucher, handleListVouchers, handleCreateVoucher, handleDeleteVoucher, handleBulkCreateVouchers, handleExtendVoucher, handleLynkIdWebhook } from './handlers/voucher';
import { listTopups, getTopupDetail, manualApproveTopup, deleteTopup, getTopupStatistics, exportTopupCsv } from './handlers/adminTopup';
import { createPaypalPayment, handlePaypalWebhook, checkPaypalStatus, paymentSuccessPage, paymentCancelPage } from './handlers/payment';
import { verifyToken } from './lib/crypto';
import { Env } from './types';
import { getExchangeRate } from './utils/currency';

export type { Env }; // Re-export for handlers if needed, though they should import from types

export default {
  async scheduled(_event: any, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const autoRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_auto_sync'").first();
      let auto = false;
      if (autoRow && autoRow.value) {
        try { auto = JSON.parse(String(autoRow.value)) === true; } catch { auto = String(autoRow.value) === '1' || String(autoRow.value) === 'true'; }
      }

      if (!auto) return;

      const live = await getExchangeRate(env);
      if (live && typeof live === 'number' && live > 0) {
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind('usd_idr_rate', String(live)).run();
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind('usd_idr_rate_last_update', String(Date.now())).run();
      }
    } catch (e) {
      // Silent fail to avoid crashing scheduled event
      console.log('Scheduled rate sync failed:', e);
    }
  },
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
    };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const wrapCors = async (promise: Promise<Response>) => {
      const res = await promise;
      const headers = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    };

    try {
      // --- PUBLIC ROUTES (No Auth Required) ---
      if (path === '/auth/register' && method === 'POST') return await wrapCors(handleRegister(request, env));
      if (path === '/auth/login' && method === 'POST') return await wrapCors(handleLogin(request, env));
      if (path === '/auth/verify' && method === 'GET') return await handleVerify(request, env);
      if (path === '/integration/lynkid/webhook' && method === 'POST') return await wrapCors(handleLynkIdWebhook(request, env));
      if (path === '/payment/success' && method === 'GET') return await paymentSuccessPage(request, env);
      if (path === '/payment/cancel' && method === 'GET') return await paymentCancelPage(request, env);
      
      // Payment Webhooks (Must be public, verify signature inside handler)
      if (path === '/payment/paypal/webhook' && method === 'POST') return await wrapCors(handlePaypalWebhook(request, env));

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
                    const dbUser = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(decoded.id).first();
                    if (dbUser && dbUser.is_admin === 1) {
                        isAdmin = true;
                    }
                }
             }
          }

          if (!isAdmin) {
              return new Response(JSON.stringify({ error: 'Unauthorized Admin' }), { status: 401, headers: corsHeaders });
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
          if (path === '/admin/users') return await wrapCors(handleListUsers(request, env));
          if (path === '/admin/users/list') return await wrapCors(handleListUsers(request, env)); // Alias
          if (path === '/admin/users/subscription') return await wrapCors(handleUpdateSubscription(request, env));
          if (path === '/admin/users/reset-password') return await wrapCors(handleResetPassword(request, env));
          if (path === '/admin/users/delete') return await wrapCors(handleDeleteUser(request, env));

          // Admin Reports
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
          if (path === '/admin/topup/delete' && method === 'POST') return await wrapCors(deleteTopup(request, env));
          if (path === '/admin/topup/statistics' && method === 'GET') return await wrapCors(getTopupStatistics(request, env));
          if (path === '/admin/topup/export-csv' && method === 'GET') return await wrapCors(exportTopupCsv(request, env));
          
          return new Response('Admin Route Not Found', { status: 404, headers: corsHeaders });
      }

      // --- PROTECTED ROUTES MIDDLEWARE (User JWT) ---
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
      if ((path === '/token/balance' || path === '/user/balance') && method === 'GET') return await wrapCors(handleBalance(userId, env));
      if (path === '/token/topup' && method === 'POST') return await wrapCors(handleTopup(request, userId, env)); // Legacy/Simple topup
      if (path === '/history/list' && method === 'GET') return await wrapCors(handleHistory(userId, env));
      if (path === '/ai/generate' && method === 'POST') return await wrapCors(handleGenerate(request, userId, env));
      
      // Voucher Redemption
      if (path === '/voucher/redeem' && method === 'POST') return await wrapCors(handleRedeemVoucher(request, env));

      // Payment Creation Routes
      if (path === '/payment/paypal/create' && method === 'POST') return await wrapCors(createPaypalPayment(request, env));
      if (path === '/payment/paypal/check' && method === 'POST') return await wrapCors(checkPaypalStatus(request, env));

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  },
};
