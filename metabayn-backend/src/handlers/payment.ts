import { Env } from '../types';
import { getTokenFromUSD, getTokenFromIDR, getLiveUsdRate } from '../utils/tokenTopup';
import { addUserTokens } from '../utils/userToken';
import { sendEmail, getTopupSuccessTemplate } from '../utils/email';

// --- PAYPAL HANDLERS (USD) ---

export async function createPaypalPayment(request: Request, env: Env): Promise<Response> {
  try {
    // amount here implies USD
    const body = await request.json() as { amount: number, userId: string, type?: string, tokensPack?: number };
    const amount = body.amount;
    let userId = String(body.userId);
    // Ensure userId is clean string (remove .0 if present from potential float conversion)
    if (!isNaN(Number(userId)) && userId.includes('.')) {
        userId = userId.split('.')[0];
    }
    const type = body.type === 'subscription' ? 'subscription' : 'token';
    const tokensPack = Number(body.tokensPack || 0) || 0;
    
    if (!amount || !userId) {
      return Response.json({ error: "Missing amount or userId" }, { status: 400 });
    }

    const rateUsd = await getLiveUsdRate(env);
    // 2. Hitung Token (USD) khusus untuk top up token
    // NORMALISASI: jika tokensPack dikirim dari frontend, gunakan nilai tetap tersebut
    const tokenCalc = type === 'token'
      ? (tokensPack > 0 ? { totalTokens: tokensPack } : getTokenFromUSD(amount, rateUsd))
      : { totalTokens: 0 } as any;
    
    // 3. Buat Transaksi Pending di DB
    const method = type === 'subscription' ? 'paypal_subscription' : 'paypal';
    const insertRes = await env.DB.prepare(
      "INSERT INTO topup_transactions (user_id, amount_usd, tokens_added, method, status) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(userId, amount, tokenCalc.totalTokens, method, 'pending').first();
    
    const transactionId = insertRes?.id;

    // 4. Panggil PayPal API (Real Implementation)
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error("PayPal Credentials missing in Server Config");
    }

    const isLive = env.PAYPAL_MODE === 'live';
    const baseUrl = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const auth = btoa(`${clientId}:${clientSecret}`);

    // 4.1. Get Access Token
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 
            'Authorization': `Basic ${auth}`, 
            'Content-Type': 'application/x-www-form-urlencoded' 
        },
        body: 'grant_type=client_credentials'
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("PayPal Token Error:", err);
        throw new Error("Failed to authenticate with PayPal");
    }

    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;

    // 4.2. Create Order
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${accessToken}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
                reference_id: String(transactionId),
                amount: { currency_code: 'USD', value: amount.toString() },
                description: type === 'subscription'
                  ? 'Metabayn API Subscription 30 Days'
                  : `TopUp ${tokenCalc.totalTokens} Tokens (Metabayn)`
            }],
            application_context: {
                return_url: 'https://metabayn-backend.metabayn.workers.dev/payment/success',
                cancel_url: 'https://metabayn-backend.metabayn.workers.dev/payment/cancel',
                brand_name: 'Metabayn App',
                user_action: 'PAY_NOW'
            }
        })
    });

    if (!orderRes.ok) {
        const err = await orderRes.text();
        console.error("PayPal Order Error:", err);
        throw new Error("Failed to create PayPal Order");
    }

    const orderData = await orderRes.json() as any;
    const approveLink = orderData.links.find((l: any) => l.rel === 'approve')?.href;
    const paypalOrderId = orderData.id;

    if (!approveLink) {
        throw new Error("No approval link returned from PayPal");
    }
    
    // Update payment_ref
    await env.DB.prepare("UPDATE topup_transactions SET payment_ref = ? WHERE id = ?")
      .bind(paypalOrderId, transactionId).run();

    return Response.json({
      status: "success",
      transactionId,
      tokensExpected: tokenCalc.totalTokens,
      paymentUrl: approveLink,
      type,
      debug_info: isLive ? "Live Mode" : "Sandbox Mode"
    });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function checkPaypalStatus(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { transactionId: number | string };
    const transactionId = body.transactionId;
    if (!transactionId) return Response.json({ error: "Missing transactionId" }, { status: 400 });

    // 1. Get Transaction from DB
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(transactionId).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });

    if (transaction.status === 'paid') {
        // For subscription payments, also return subscription info if available
        if (transaction.method === 'paypal_subscription') {
            const user = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?")
              .bind(transaction.user_id).first();
            return Response.json({
                status: 'paid',
                message: "Already paid",
                subscription_active: user?.subscription_active === 1,
                subscription_expiry: user?.subscription_expiry || null
            });
        }
        return Response.json({ status: 'paid', message: "Already paid" });
    }

    const orderId = transaction.payment_ref;
    if (!orderId) return Response.json({ error: "No PayPal Order ID found" }, { status: 400 });

    // 2. Auth PayPal
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("PayPal Credentials missing");

    const isLive = env.PAYPAL_MODE === 'live';
    const baseUrl = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const auth = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;

    // 3. Get Order Details
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!orderRes.ok) throw new Error("Failed to fetch PayPal Order");
    
    const orderData = await orderRes.json() as any;
    const paypalStatus = orderData.status; // CREATED, APPROVED, COMPLETED

    const isSubscription = transaction.method === 'paypal_subscription';

    // 4. If APPROVED, Capture it!
    if (paypalStatus === 'APPROVED') {
        const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!captureRes.ok) {
             const errText = await captureRes.text();
             console.error("Capture Failed:", errText);
             return Response.json({ status: 'pending', paypal_status: 'CAPTURE_FAILED' });
        }
        
        const captureData = await captureRes.json() as any;
        if (captureData.status === 'COMPLETED') {
            await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();

            if (isSubscription) {
                let durationDays = 30;
                const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?")
                  .bind(transaction.user_id).first();
                let newExpiryDate = new Date();
                if (currentUser && currentUser.subscription_expiry) {
                    const currentExpiry = new Date(currentUser.subscription_expiry as string);
                    if (currentExpiry > new Date()) {
                        newExpiryDate = currentExpiry;
                    }
                }
                newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
                const newExpiryIso = newExpiryDate.toISOString();

                await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                  .bind(newExpiryIso, transaction.user_id).run();

                return Response.json({
                    status: 'paid',
                    paypal_status: 'COMPLETED',
                    subscription_active: true,
                    subscription_expiry: newExpiryIso
                });
            }

            await addUserTokens(transaction.user_id as string, transaction.tokens_added as number, env);
            return Response.json({ status: 'paid', paypal_status: 'COMPLETED' });
        }
    } else if (paypalStatus === 'COMPLETED') {
         await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();

         if (isSubscription) {
             let durationDays = 30;
             const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?")
               .bind(transaction.user_id).first();
             let newExpiryDate = new Date();
             if (currentUser && currentUser.subscription_expiry) {
                 const currentExpiry = new Date(currentUser.subscription_expiry as string);
                 if (currentExpiry > new Date()) {
                     newExpiryDate = currentExpiry;
                 }
             }
             newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
             const newExpiryIso = newExpiryDate.toISOString();

             await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
               .bind(newExpiryIso, transaction.user_id).run();

             return Response.json({
                 status: 'paid',
                 paypal_status: 'COMPLETED',
                 subscription_active: true,
                 subscription_expiry: newExpiryIso
             });
         }

         await addUserTokens(transaction.user_id as string, transaction.tokens_added as number, env);
         return Response.json({ status: 'paid', paypal_status: 'COMPLETED' });
    }

    return Response.json({ status: transaction.status, paypal_status: paypalStatus });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handlePaypalWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // 1. SECURITY CHECK (Signature Verification)
    // In production, you MUST verify the PayPal signature header to ensure the request comes from PayPal.
    // See: https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
    
    // For now, we rely on the unique 'payment_ref' (Order ID) being present and in 'pending' status in our DB.
    // An attacker cannot easily guess a valid, pending Order ID.
    
    const data = await request.json() as any;
    
    if (data.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const orderId = data.resource.id; // PayPal Order ID
        const amountPaid = parseFloat(data.resource.amount.value); // Ensure we get actual paid amount
        
        // 3. Cari Transaksi
        const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE payment_ref = ?").bind(orderId).first();
        
        if (transaction && transaction.status === 'pending') {
            // Verify amount logic (Optional but recommended)
            // if (Math.abs(amountPaid - (transaction.amount_usd as number)) > 0.1) ...

            // 4. Update Status & Tambah Token
            await env.DB.prepare("UPDATE topup_transactions SET status = 'paid', amount_usd = ? WHERE id = ?")
                .bind(amountPaid, transaction.id).run();

            if (transaction.method === 'paypal_subscription') {
                let durationDays = 30;
                const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry, email FROM users WHERE id = ?")
                  .bind(transaction.user_id).first();

                let newExpiryDate = new Date();
                if (currentUser && currentUser.subscription_expiry) {
                    const currentExpiry = new Date(currentUser.subscription_expiry as string);
                    if (currentExpiry > new Date()) {
                        newExpiryDate = currentExpiry;
                    }
                }
                newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
                const newExpiryIso = newExpiryDate.toISOString();

                await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                  .bind(newExpiryIso, transaction.user_id).run();

                return Response.json({
                    status: "success",
                    method: "paypal_subscription",
                    amount_usd: amountPaid,
                    subscription_active: true,
                    subscription_expiry: newExpiryIso
                });
            }

            const newBalance = await addUserTokens(transaction.user_id as string, transaction.tokens_added as number, env);
            
            const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
            if (user && user.email) {
                const html = getTopupSuccessTemplate(amountPaid, transaction.tokens_added as number, 'USD');
                sendEmail(user.email as string, "Top Up Successful!", html, env);
            }

            return Response.json({ 
                status: "success", 
                method: "paypal",
                amount_usd: amountPaid,
                tokens_added: transaction.tokens_added,
                new_balance: newBalance
            });
        }
    }
    
    return Response.json({ status: "ignored" });

  } catch (e: any) {
    console.error("PayPal Webhook Error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function paymentSuccessPage(_req: Request, _env: Env): Promise<Response> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#4caf50;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}</script></head><body><div class="box"><h1>Payment Successful</h1><p>You can close this tab and return to the app.</p><p>If your balance has not updated yet, the app will check automatically.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export async function paymentCancelPage(_req: Request, _env: Env): Promise<Response> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Cancelled</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#ff7043;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}</script></head><body><div class="box"><h1>Payment Cancelled</h1><p>The transaction was not completed. You can close this tab and return to the app.</p><p>If you encounter issues with your payment, please contact the admin via WhatsApp at <a class="link" href="https://wa.me/628996701661" target="_blank" rel="noopener">+62 899 6701 661</a>.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// --- QRIS HANDLERS (IDR) ---

export async function createQrisPayment(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}

export async function checkQrisStatus(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}

export async function handleQrisCallback(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ error: "QRIS disabled" }, { status: 410 });
}
