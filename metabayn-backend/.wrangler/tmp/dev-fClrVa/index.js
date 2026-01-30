var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// .wrangler/tmp/bundle-BR3Etl/checked-fetch.js
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
var urls;
var init_checked_fetch = __esm({
  ".wrangler/tmp/bundle-BR3Etl/checked-fetch.js"() {
    "use strict";
    urls = /* @__PURE__ */ new Set();
    __name(checkURL, "checkURL");
    globalThis.fetch = new Proxy(globalThis.fetch, {
      apply(target, thisArg, argArray) {
        const [request, init] = argArray;
        checkURL(request, init);
        return Reflect.apply(target, thisArg, argArray);
      }
    });
  }
});

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_checked_fetch();
    init_modules_watch_stub();
  }
});

// node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// src/lib/crypto.ts
var crypto_exports = {};
__export(crypto_exports, {
  createToken: () => createToken,
  hashPassword: () => hashPassword,
  verifyPassword: () => verifyPassword,
  verifyToken: () => verifyToken
});
async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  const hashHex = [...new Uint8Array(exported)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}
async function verifyPassword(password, stored) {
  const [saltHex, originalHash] = stored.split(":");
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  const hashHex = [...new Uint8Array(exported)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex === originalHash;
}
async function sign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify(data));
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${payload}.${signatureB64}`;
}
async function createToken(user, secret) {
  const payload = {
    sub: user.id,
    email: user.email,
    is_admin: user.is_admin || 0,
    exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
    // 7 hari
  };
  return sign(payload, secret);
}
async function verifyToken(token, secret) {
  try {
    const [header, payload, signature] = token.split(".");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const checkSig = signature.replace(/-/g, "+").replace(/_/g, "/");
    const signatureBin = Uint8Array.from(atob(checkSig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, signatureBin, enc.encode(`${header}.${payload}`));
    if (!valid) return null;
    const data = JSON.parse(atob(payload));
    if (Date.now() / 1e3 > data.exp) return null;
    return data;
  } catch (e) {
    return null;
  }
}
var init_crypto = __esm({
  "src/lib/crypto.ts"() {
    "use strict";
    init_checked_fetch();
    init_modules_watch_stub();
    __name(hashPassword, "hashPassword");
    __name(verifyPassword, "verifyPassword");
    __name(sign, "sign");
    __name(createToken, "createToken");
    __name(verifyToken, "verifyToken");
  }
});

// .wrangler/tmp/bundle-BR3Etl/middleware-loader.entry.ts
init_checked_fetch();
init_modules_watch_stub();

// .wrangler/tmp/bundle-BR3Etl/middleware-insertion-facade.js
init_checked_fetch();
init_modules_watch_stub();

// src/index.ts
init_checked_fetch();
init_modules_watch_stub();

// src/handlers/auth.ts
init_checked_fetch();
init_modules_watch_stub();
init_crypto();

// src/utils/email.ts
init_checked_fetch();
init_modules_watch_stub();
async function sendEmail(to, subject, html, env) {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is missing. Skipping email.");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "MetaBayn <onboarding@resend.dev>",
        // Use env var or default testing domain
        to: [to],
        subject,
        html
      })
    });
    if (!res.ok) {
      const error = await res.text();
      console.error("Resend API Error:", error);
    }
  } catch (e) {
    console.error("Failed to send email:", e);
  }
}
__name(sendEmail, "sendEmail");
function getTopupSuccessTemplate(amount, tokensAdded, currency = "IDR") {
  const formattedAmount = currency === "IDR" ? `Rp ${amount.toLocaleString("id-ID")}` : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return `
    <div style="font-family: sans-serif; padding: 20px;">
        <h2>Top-Up Token Successful</h2>
        <p>Hello,</p>
        <p>We have received your payment of <strong>${formattedAmount}</strong>.</p>
        <ul>
            <li>Tokens Added: <strong>${tokensAdded.toLocaleString()} Tokens</strong></li>
        </ul>
        <p>Your balance has been updated. Happy creating!</p>
    </div>
    `;
}
__name(getTopupSuccessTemplate, "getTopupSuccessTemplate");
function getManualApproveTemplate(name, amount, tokensAdded, currency = "IDR") {
  const formattedAmount = currency === "IDR" ? `Rp ${amount.toLocaleString("id-ID")}` : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return `
    <div style="font-family: sans-serif; padding: 20px;">
        <h2>Top-Up Successful (Manual Approval)</h2>
        <p>Hello ${name},</p>
        <p>Your transaction of <strong>${formattedAmount}</strong> has been manually confirmed by admin.</p>
        <p>Tokens added to your account: <strong>${tokensAdded.toLocaleString()}</strong></p>
        <p>Thank you for your patience!</p>
    </div>
    `;
}
__name(getManualApproveTemplate, "getManualApproveTemplate");
function getRegistrationTemplate(email, pass) {
  return `
    <div style="font-family: sans-serif; padding: 20px;">
        <h2>Welcome to MetaBayn!</h2>
        <p>Hello,</p>
        <p>Thank you for registering with MetaBayn.</p>
        <p>Here are your login details:</p>
        <ul>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>Password:</strong> ${pass}</li>
        </ul>
        <p>Please keep this information safe. Do not share your password with anyone.</p>
        <p>You have received <strong>20 Tokens (Bonus)</strong> as a new user.</p>
        <br>
        <p>Best regards,</p>
        <p>MetaBayn Team</p>
    </div>
    `;
}
__name(getRegistrationTemplate, "getRegistrationTemplate");

// src/handlers/auth.ts
async function handleRegister(req, env) {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return Response.json({ error: "Missing fields" }, { status: 400 });
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return Response.json({ error: "Invalid email format. Please check your email." }, { status: 400 });
  }
  const hashedPassword = await hashPassword(password);
  try {
    await env.DB.prepare("INSERT INTO users (email, password, tokens) VALUES (?, ?, ?)").bind(email, hashedPassword, 0).run();
    const emailHtml = getRegistrationTemplate(email, password);
    await sendEmail(email, "Welcome to MetaBayn - Your Login Details", emailHtml, env);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: "Email already exists" }, { status: 409 });
  }
}
__name(handleRegister, "handleRegister");
async function handleLogin(req, env) {
  const body = await req.json();
  const { email, password, device_hash } = body;
  if (!device_hash) return Response.json({ error: "Device Hash required" }, { status: 400 });
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return Response.json({ error: "Email not registered" }, { status: 401 });
  const valid = await verifyPassword(password, user.password);
  if (!valid) return Response.json({ error: "Incorrect password" }, { status: 401 });
  if (user.email === "metabayn@gmail.com") {
    user.is_admin = 1;
  }
  let currentDeviceHash = user.device_hash;
  if (!currentDeviceHash) {
    await env.DB.prepare("UPDATE users SET device_hash = ? WHERE id = ?").bind(device_hash, user.id).run();
  } else if (currentDeviceHash !== device_hash) {
    return Response.json({ error: "SECURITY ALERT: Account is bound to another device. Anti-cloning protection active." }, { status: 403 });
  }
  const token = await createToken(user, env.JWT_SECRET);
  return Response.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      tokens: user.tokens,
      is_admin: user.is_admin || 0
    }
  });
}
__name(handleLogin, "handleLogin");

// src/handlers/google.ts
init_checked_fetch();
init_modules_watch_stub();
init_crypto();
async function handleGoogleLogin(req, env) {
  const client_id = env.GOOGLE_OAUTH_CLIENT_ID;
  const workerUrl = "https://metabayn-backend.metabayn.workers.dev";
  const redirect_uri = `${workerUrl}/auth/google/callback`;
  const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&redirect_uri=${redirect_uri}&response_type=code&scope=email%20profile`;
  return Response.redirect(redirectUrl, 302);
}
__name(handleGoogleLogin, "handleGoogleLogin");
async function handleGoogleCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const workerUrl = "https://metabayn-backend.metabayn.workers.dev";
  const redirect_uri = `${workerUrl}/auth/google/callback`;
  if (!code) {
    return new Response("Missing code", { status: 400 });
  }
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri,
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return new Response(`Google Token Error: ${JSON.stringify(tokenData)}`, { status: 400 });
    }
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();
    if (!userData.email) {
      return new Response("Google User Info Error: Email not found", { status: 400 });
    }
    const email = userData.email;
    let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let isNewUser = false;
    let password = "";
    if (!user) {
      isNewUser = true;
      password = crypto.randomUUID().split("-").join("").slice(0, 12);
      const hashedPassword = await Promise.resolve().then(() => (init_crypto(), crypto_exports)).then((m) => m.hashPassword(password));
      const res = await env.DB.prepare("INSERT INTO users (email, password, tokens) VALUES (?, ?, ?) RETURNING *").bind(email, hashedPassword, 0).first();
      if (res) user = res;
    }
    if (user.email === "metabayn@gmail.com") {
      user.is_admin = 1;
    }
    const token = await createToken(user, env.JWT_SECRET);
    if (isNewUser) {
      const emailHtml = getRegistrationTemplate(email, password);
      env.RESEND_API_KEY && sendEmail(email, "Welcome to MetaBayn - Google Login", emailHtml, env).catch(console.error);
    }
    const deepLink = `metabayn://auth/success?token=${token}`;
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login Successful</title>
          <meta http-equiv="refresh" content="0;url=${deepLink}">
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #121212; color: white; }
            .card { background: #1e1e1e; padding: 2rem; border-radius: 8px; text-align: center; max-width: 400px; }
            code { display: block; background: #333; padding: 10px; margin: 10px 0; word-break: break-all; border-radius: 4px; }
            button { background: #6200ea; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
            button:hover { background: #3700b3; }
            .link { margin-top: 20px; color: #aaa; text-decoration: none; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Login Successful!</h2>
            <p>Welcome, ${email}</p>
            <p>Redirecting to app...</p>
            <p>If not redirected, copy the token below and paste it into the app.</p>
            <code id="token">${token}</code>
            <button onclick="copyToken()">Copy Token</button>
            <a href="${deepLink}" class="link">Click here to open App manually</a>
          </div>
          <script>
            function copyToken() {
              const token = document.getElementById('token').innerText;
              navigator.clipboard.writeText(token).then(() => {
                alert('Token copied!');
              });
            }
            // Try to redirect immediately
            window.location.href = "${deepLink}";
          <\/script>
        </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html" }
    });
  } catch (e) {
    return new Response(`Google Auth Error: ${e.message}`, { status: 500 });
  }
}
__name(handleGoogleCallback, "handleGoogleCallback");

// src/handlers/ai.ts
init_checked_fetch();
init_modules_watch_stub();

// src/config/models.ts
init_checked_fetch();
init_modules_watch_stub();
var MODEL_CONFIG = {
  "profit_multiplier_min": 1.6,
  "profit_multiplier_max": 1.8,
  "safety_buffer": 1.1,
  "usd_per_credit": 1e-4,
  "models": {
    "gpt-4o": {
      "provider": "openai",
      "input": 2.5,
      "output": 10,
      "official": true,
      "enabled": true
    },
    "gpt-4o-mini": {
      "provider": "openai",
      "input": 0.15,
      "output": 0.6,
      "official": true,
      "enabled": true
    },
    "gpt-4o-realtime": {
      "provider": "openai",
      "input": 5,
      "output": 20,
      "official": true,
      "enabled": false
    },
    "gpt-4-turbo": {
      "provider": "openai",
      "input": 10,
      "output": 30,
      "official": true,
      "enabled": true
    },
    "o1": {
      "provider": "openai",
      "input": 15,
      "output": 60,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-pro": {
      "provider": "gemini",
      "input": 1.25,
      "output": 10,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-flash": {
      "provider": "gemini",
      "input": 0.3,
      "output": 2.5,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-flash-lite": {
      "provider": "gemini",
      "input": 0.1,
      "output": 0.4,
      "official": true,
      "enabled": true
    },
    "gemini-1.5-pro": {
      "provider": "gemini",
      "input": 3.5,
      "output": 10.5,
      "official": false,
      "enabled": true
    },
    "gemini-1.5-flash": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.3,
      "official": false,
      "enabled": true
    },
    "gemini-1.5-flash-8b": {
      "provider": "gemini",
      "input": 0.0375,
      "output": 0.15,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-pro": {
      "provider": "gemini",
      "input": 3.5,
      "output": 10.5,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash": {
      "provider": "gemini",
      "input": 0.1,
      "output": 0.4,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash-lite": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.3,
      "official": false,
      "enabled": true
    },
    "gemini-pro": {
      "provider": "gemini",
      "input": 0.5,
      "output": 1.5,
      "official": false,
      "enabled": true
    }
  }
};

// src/utils/userRateLimiter.ts
init_checked_fetch();
init_modules_watch_stub();
var requestHistory = /* @__PURE__ */ new Map();
var RATE_LIMIT_MS = 100;
function checkRateLimit(userId) {
  const now = Date.now();
  const lastRequest = requestHistory.get(userId) || 0;
  if (now - lastRequest < RATE_LIMIT_MS) {
    return false;
  }
  requestHistory.set(userId, now);
  if (requestHistory.size > 5e3) {
    requestHistory.clear();
  }
  return true;
}
__name(checkRateLimit, "checkRateLimit");

// src/utils/concurrencyLock.ts
init_checked_fetch();
init_modules_watch_stub();
var activeJobs = /* @__PURE__ */ new Map();
var LOCK_TTL_MS = 60 * 1e3;
var lockTimestamps = /* @__PURE__ */ new Map();
function releaseLock(userId, lockId) {
  const userJobs = activeJobs.get(userId);
  if (userJobs) {
    userJobs.delete(lockId);
    lockTimestamps.delete(lockId);
    if (userJobs.size === 0) {
      activeJobs.delete(userId);
    }
  }
}
__name(releaseLock, "releaseLock");

// src/utils/aiQueue.ts
init_checked_fetch();
init_modules_watch_stub();
var queue = [];
var activeCount = 0;
var CONCURRENCY_LIMIT = 30;
function enqueue(task) {
  return new Promise((resolve, reject) => {
    const queueTimeout = setTimeout(() => {
      const index = queue.findIndex((i) => i.resolve === resolve);
      if (index !== -1) {
        queue.splice(index, 1);
        reject(new Error("Queue Timeout: System busy, please retry."));
      }
    }, 12e4);
    queue.push({
      task,
      resolve: /* @__PURE__ */ __name((val) => {
        clearTimeout(queueTimeout);
        resolve(val);
      }, "resolve"),
      reject: /* @__PURE__ */ __name((err) => {
        clearTimeout(queueTimeout);
        reject(err);
      }, "reject")
    });
    processQueue();
  });
}
__name(enqueue, "enqueue");
function processQueue() {
  while (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
    const item = queue.shift();
    if (item) {
      activeCount++;
      item.task().then((res) => {
        item.resolve(res);
      }).catch((err) => {
        item.reject(err);
      }).finally(() => {
        activeCount--;
        processQueue();
      });
    }
  }
}
__name(processQueue, "processQueue");

// src/utils/providerThrottle.ts
init_checked_fetch();
init_modules_watch_stub();
var lastRequestTime = {
  openai: 0,
  gemini: 0
};
var INTERVALS = {
  openai: 100,
  // Reduced to 100ms
  gemini: 10
  // Reduced to 10ms (Flash is extremely fast, 100 RPM+ supported)
};
async function waitTurn(provider) {
  const now = Date.now();
  const last = lastRequestTime[provider] || 0;
  const interval = INTERVALS[provider] || 0;
  const timeSinceLast = now - last;
  if (timeSinceLast < interval) {
    const delay = interval - timeSinceLast;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastRequestTime[provider] = Date.now();
}
__name(waitTurn, "waitTurn");

// src/utils/tokenCostManager.ts
init_checked_fetch();
init_modules_watch_stub();
var SAFE_PRICES = {
  // Gemini 2.0 Flash Lite (The user's target)
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
  // Gemini 2.0 Flash
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  // Gemini Pro
  "gemini-1.5-pro": { input: 3.5, output: 10.5 },
  "gemini-2.0-pro": { input: 3.5, output: 10.5 },
  // GPT-4o
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Fallback default
  "default": { input: 0.1, output: 0.4 }
};
async function calculateTokenCost(inputTokens, outputTokens, userModel, env) {
  let price = SAFE_PRICES[userModel];
  try {
    const dbPrice = await env.DB.prepare("SELECT input_price, output_price, profit_multiplier FROM model_prices WHERE model_name = ? AND active = 1").bind(userModel).first();
    if (dbPrice) {
      price = {
        input: Number(dbPrice.input_price),
        output: Number(dbPrice.output_price)
      };
      console.log(`[Pricing] Using DB Price for ${userModel}: Input $${price.input}, Output $${price.output}`);
    }
  } catch (e) {
    console.warn(`[Pricing] Failed to fetch DB price for ${userModel}, using safe fallback.`, e);
  }
  if (!price) {
    if (userModel.includes("flash-lite") || userModel.includes("8b")) price = SAFE_PRICES["gemini-2.0-flash-lite"];
    else if (userModel.includes("flash")) price = SAFE_PRICES["gemini-2.0-flash"];
    else if (userModel.includes("mini")) price = SAFE_PRICES["gpt-4o-mini"];
    else if (userModel.includes("pro")) price = SAFE_PRICES["gemini-1.5-pro"];
    else if (userModel.includes("gpt-4o")) price = SAFE_PRICES["gpt-4o"];
    else price = SAFE_PRICES["default"];
    console.warn(`[Pricing] Model '${userModel}' not found in safe list. Using fallback price: Input $${price.input}/1M`);
  }
  const inputCostUSD = inputTokens / 1e6 * price.input;
  const outputCostUSD = outputTokens / 1e6 * price.output;
  const rawCostUSD = inputCostUSD + outputCostUSD;
  let profitMarginPercent = 60;
  try {
    const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
    if (config && config.value) {
      profitMarginPercent = Number(config.value);
    }
  } catch (e) {
    console.warn("[TokenCalc] Failed to fetch profit margin, using default 60%", e);
  }
  const PROFIT_MULTIPLIER = 1 + profitMarginPercent / 100;
  const finalCostUSD = rawCostUSD * PROFIT_MULTIPLIER;
  console.log(`[TokenCalc] Model: ${userModel}`);
  console.log(`[TokenCalc] Usage: ${inputTokens} In / ${outputTokens} Out`);
  console.log(`[TokenCalc] Base Price (1M): $${price.input} / $${price.output}`);
  console.log(`[TokenCalc] Raw Cost: $${rawCostUSD.toFixed(8)}`);
  console.log(`[TokenCalc] Profit Margin: ${profitMarginPercent}% (x${PROFIT_MULTIPLIER})`);
  console.log(`[TokenCalc] Final Cost: $${finalCostUSD.toFixed(8)}`);
  return finalCostUSD;
}
__name(calculateTokenCost, "calculateTokenCost");
async function recordTokenUsage(userId, userModel, actualModelUsed, inputTokens, outputTokens, cost, env) {
  try {
    await env.DB.prepare("INSERT INTO history (user_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?)").bind(userId, userModel, inputTokens, outputTokens, cost).run();
  } catch (e) {
    console.error("Failed to record history:", e);
  }
}
__name(recordTokenUsage, "recordTokenUsage");

// src/utils/tokenTopup.ts
init_checked_fetch();
init_modules_watch_stub();
var TOKEN_RATE_IDR_TO_CREDIT = 1;
var TOKEN_RATE_USD_TO_CREDIT = 16300;
var BONUS_IDR_TABLE = {
  1e5: 3,
  // Topup 100k -> Bonus 3%
  2e5: 5,
  // Topup 200k -> Bonus 5%
  5e5: 10
  // Topup 500k -> Bonus 10%
};
var BONUS_USD_TABLE = {
  10: 3,
  // $10 -> Bonus 3%
  20: 5,
  // $20 -> Bonus 5%
  50: 10
  // $50 -> Bonus 10%
};
async function getLiveUsdRate(env) {
  if (env) {
    try {
      const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
      if (config && config.value) {
        return Number(config.value);
      }
    } catch (e) {
      console.warn("[TokenTopup] Failed to fetch usd_idr_rate, using default", e);
    }
  }
  return 16300;
}
__name(getLiveUsdRate, "getLiveUsdRate");
function getTokenFromIDR(amountRp, rate = TOKEN_RATE_IDR_TO_CREDIT, bonusTable = BONUS_IDR_TABLE) {
  const tokensBase = Math.floor(amountRp * rate);
  const bonusPercent = getBonusPercent(amountRp, bonusTable);
  const tokensBonus = Math.floor(tokensBase * (bonusPercent / 100));
  const totalTokens = tokensBase + tokensBonus;
  return {
    amount: amountRp,
    currency: "IDR",
    tokensBase,
    bonusPercent,
    tokensBonus,
    totalTokens
  };
}
__name(getTokenFromIDR, "getTokenFromIDR");
function getTokenFromUSD(amountUsd, rate = TOKEN_RATE_USD_TO_CREDIT, bonusTable = BONUS_USD_TABLE) {
  const tokensBase = Math.floor(amountUsd * rate);
  const bonusPercent = getBonusPercent(amountUsd, bonusTable);
  const tokensBonus = Math.floor(tokensBase * (bonusPercent / 100));
  const totalTokens = tokensBase + tokensBonus;
  return {
    amount: amountUsd,
    currency: "USD",
    tokensBase,
    bonusPercent,
    tokensBonus,
    totalTokens
  };
}
__name(getTokenFromUSD, "getTokenFromUSD");
function getBonusPercent(amount, table) {
  const thresholds = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const threshold of thresholds) {
    if (amount >= threshold) {
      return table[threshold];
    }
  }
  return 0;
}
__name(getBonusPercent, "getBonusPercent");

// src/utils/modelFallback.ts
init_checked_fetch();
init_modules_watch_stub();
async function getFallbackChain(userModel, env) {
  return [userModel];
}
__name(getFallbackChain, "getFallbackChain");

// src/lib/google-auth.ts
init_checked_fetch();
init_modules_watch_stub();
function pemToBinary(pem) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
__name(pemToBinary, "pemToBinary");
async function importPrivateKey(pem) {
  const binaryDer = pemToBinary(pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}
__name(importPrivateKey, "importPrivateKey");
function arrayBufferToBase64Url(buffer) {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(arrayBufferToBase64Url, "arrayBufferToBase64Url");
async function getGoogleAccessToken(clientEmail, privateKey, scopes = ["https://www.googleapis.com/auth/cloud-platform"]) {
  const now = Math.floor(Date.now() / 1e3);
  const exp = now + 3600;
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claimSet = {
    iss: clientEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp,
    iat: now
  };
  const encodedHeader = arrayBufferToBase64Url(
    new TextEncoder().encode(JSON.stringify(header))
  );
  const encodedClaimSet = arrayBufferToBase64Url(
    new TextEncoder().encode(JSON.stringify(claimSet))
  );
  const unsignedToken = `${encodedHeader}.${encodedClaimSet}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  const encodedSignature = arrayBufferToBase64Url(signature);
  const jwt = `${unsignedToken}.${encodedSignature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${errorText}`);
  }
  const data = await response.json();
  return data.access_token;
}
__name(getGoogleAccessToken, "getGoogleAccessToken");

// src/handlers/ai.ts
async function handleGenerate(req, userId, env) {
  if (!checkRateLimit(userId)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const lockId = null;
  try {
    const body = await req.json();
    const { model, prompt, messages, image, mimeType } = body;
    const userModel = model;
    console.log(`[AI] Checking balance for ${userId}...`);
    const user = await env.DB.prepare("SELECT tokens, is_admin FROM users WHERE id = ?").bind(userId).first();
    if (!user || user.tokens <= 0) {
      return Response.json({ error: "Insufficient balance. Please Top Up." }, { status: 402 });
    }
    const fallbackChain = await getFallbackChain(userModel, env);
    console.log(`[AI] Fallback chain for ${userModel}:`, fallbackChain);
    const aiTask = /* @__PURE__ */ __name(async () => {
      let lastError = null;
      const startTime = Date.now();
      const MAX_DURATION = 9e4;
      for (const currentModel of fallbackChain) {
        if (Date.now() - startTime > MAX_DURATION) {
          console.error(`[AI] Job timed out after ${MAX_DURATION}ms`);
          throw new Error("Job timed out.");
        }
        try {
          console.log(`[AI] Attempting model: ${currentModel}`);
          let currentProvider = "openai";
          let modelInfo = MODEL_CONFIG.models[currentModel];
          if (modelInfo) {
            currentProvider = modelInfo.provider;
          } else {
            if (currentModel.startsWith("gemini")) currentProvider = "gemini";
            else if (currentModel.startsWith("claude")) currentProvider = "anthropic";
          }
          console.log(`[AI] Provider Selection: Model=${currentModel} -> Provider=${currentProvider}`);
          await waitTurn(currentProvider);
          let content2 = "";
          let inputTokens2 = 0;
          let outputTokens2 = 0;
          if (currentProvider === "openai") {
            console.log(`[DEBUG] OpenAI Image Mode. Prompt len: ${prompt?.length}, Image len: ${image?.length}`);
            let msgs = messages;
            if (!msgs) {
              if (image) {
                msgs = [{
                  role: "user",
                  content: [
                    { type: "text", text: prompt && prompt.length > 5e4 ? prompt.substring(0, 1e3) + "... [TRUNCATED]" : prompt || "Describe this image" },
                    { type: "image_url", image_url: {
                      url: `data:${mimeType || "image/jpeg"};base64,${image}`,
                      detail: "low"
                    } }
                  ]
                }];
              } else {
                msgs = [{ role: "user", content: prompt }];
              }
            }
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6e4);
            try {
              const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: currentModel, messages: msgs }),
                signal: controller.signal
              });
              clearTimeout(timeoutId);
              const data = await res.json();
              if (!res.ok) {
                if (res.status >= 500 || res.status === 429) {
                  throw new Error(`[${res.status}] ${data.error?.message || "Provider Error"}`);
                }
                throw new Error(`NON_RETRYABLE: [${res.status}] ${data.error?.message}`);
              }
              content2 = data.choices[0].message.content;
              inputTokens2 = data.usage.prompt_tokens;
              outputTokens2 = data.usage.completion_tokens;
            } catch (e) {
              console.error(`[AI] OpenAI Error: ${e.message}`);
              clearTimeout(timeoutId);
              throw e;
            }
          } else if (currentProvider === "gemini") {
            let useVertex = false;
            if (env.GOOGLE_PROJECT_ID && env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
              useVertex = true;
            }
            let targetModel = currentModel;
            if (targetModel === "gemini-2.0-flash-lite") {
              targetModel = "gemini-2.0-flash-lite-preview-02-05";
            } else if (targetModel === "gemini-flash") {
              targetModel = "gemini-1.5-flash";
            }
            const parts = [{ text: prompt || "Describe this image" }];
            if (image) {
              parts.push({
                inline_data: {
                  mime_type: mimeType || "image/jpeg",
                  data: image
                }
              });
            }
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6e4);
            try {
              const callLegacyApi = /* @__PURE__ */ __name(async (modelId) => {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${env.GEMINI_API_KEY}`;
                return fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contents: [{ parts }] }),
                  signal: controller.signal
                });
              }, "callLegacyApi");
              let res;
              if (useVertex) {
                const accessToken = await getGoogleAccessToken(
                  env.GOOGLE_CLIENT_EMAIL,
                  env.GOOGLE_PRIVATE_KEY
                );
                const location = env.GOOGLE_LOCATION || "us-central1";
                let vertexModelId = targetModel;
                const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${env.GOOGLE_PROJECT_ID}/locations/${location}/publishers/google/models/${vertexModelId}:generateContent`;
                res = await fetch(vertexUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                  },
                  body: JSON.stringify({
                    contents: [{ role: "user", parts }]
                  }),
                  signal: controller.signal
                });
                if (res.status === 404 || res.status === 400) {
                  const errText = await res.text();
                  if (res.status === 404 || res.status === 400 && errText.includes("Publisher Model")) {
                    console.warn(`[AI] Vertex AI error for ${vertexModelId} (${res.status}): ${errText.substring(0, 100)}... Switching to Legacy API.`);
                    res = await callLegacyApi(targetModel);
                  } else {
                    throw new Error(`[${res.status}] Vertex AI Error: ${errText}`);
                  }
                }
              } else {
                res = await callLegacyApi(targetModel);
              }
              clearTimeout(timeoutId);
              const data = await res.json();
              if (!res.ok) {
                const errMsg = data.error?.message || JSON.stringify(data.error) || "Provider Error";
                if (res.status >= 500 || res.status === 429) {
                  throw new Error(`[${res.status}] ${errMsg}`);
                }
                throw new Error(`NON_RETRYABLE: [${res.status}] ${errMsg}`);
              }
              if (data.error) throw new Error(`[${res.status}] ${data.error.message}`);
              const candidate = data.candidates?.[0];
              if (!candidate) {
                if (data.promptFeedback?.blockReason) {
                  throw new Error(`Blocked by Safety Filters: ${data.promptFeedback.blockReason}`);
                }
                throw new Error("No response candidates from AI provider.");
              }
              if (candidate.finishReason === "SAFETY" || candidate.finishReason === "BLOCKLIST" || candidate.finishReason === "PROHIBITED_CONTENT") {
                throw new Error(`Blocked by Safety Filters (${candidate.finishReason})`);
              }
              if (!candidate.content?.parts?.[0]?.text) {
                throw new Error(`Empty response from AI (Finish Reason: ${candidate.finishReason || "Unknown"})`);
              }
              content2 = candidate.content.parts[0].text;
              inputTokens2 = data.usageMetadata?.promptTokenCount || Math.ceil((prompt || "").length / 4);
              outputTokens2 = data.usageMetadata?.candidatesTokenCount || Math.ceil(content2.length / 4);
            } catch (e) {
              console.error(`[AI] Gemini/Vertex Error: ${e.message}`);
              clearTimeout(timeoutId);
              throw e;
            }
          }
          return { content: content2, inputTokens: inputTokens2, outputTokens: outputTokens2, usedModel: currentModel };
        } catch (e) {
          console.error(`[AI] Error with model ${currentModel}:`, e.message);
          lastError = e;
          if (e.message.includes("NON_RETRYABLE")) {
            throw e;
          }
          continue;
        }
      }
      throw lastError || new Error("All model providers are temporarily busy.");
    }, "aiTask");
    let result;
    try {
      result = await enqueue(aiTask);
    } catch (e) {
      const msg = e.message.replace("NON_RETRYABLE: ", "");
      return Response.json({ error: msg }, { status: 502 });
    }
    const { content, inputTokens, outputTokens, usedModel } = result;
    let costFinal = 0;
    try {
      costFinal = await calculateTokenCost(inputTokens, outputTokens, userModel, env);
      console.log(`[Cost] Model: ${userModel}, In: ${inputTokens}, Out: ${outputTokens}, Cost: ${costFinal}`);
      if (costFinal > 0.25) {
        console.warn(`[Cost] Cost exceeded safety cap ($${costFinal}). Capping at $0.25.`);
        costFinal = 0.25;
      }
    } catch (e) {
      console.error("Pricing DB Error:", e);
      let profitMarginPercent = 60;
      try {
        const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
        if (config && config.value) {
          profitMarginPercent = Number(config.value);
        }
      } catch {
      }
      const profitMultiplier = 1 + profitMarginPercent / 100;
      const staticModel = MODEL_CONFIG.models[userModel];
      if (staticModel) {
        const costRaw = inputTokens / 1e6 * staticModel.input + outputTokens / 1e6 * staticModel.output;
        costFinal = costRaw * profitMultiplier;
        console.log(`[Cost Fallback] Model: ${userModel}, Raw: ${costRaw}, Multiplier: ${profitMultiplier}, Final: ${costFinal}`);
      } else {
        const safePrice = 5;
        costFinal = (inputTokens + outputTokens) / 1e6 * safePrice * profitMultiplier;
        console.log(`[Cost Extreme Fallback] Model: ${userModel}, Price: ${safePrice}, Final: ${costFinal}`);
      }
      if (costFinal > 0.25) {
        console.warn(`[Cost Fallback] Cost exceeded safety cap ($${costFinal}). Capping at $0.25.`);
        costFinal = 0.25;
      }
    }
    const currentRate = await getLiveUsdRate(env);
    const costInTokens = costFinal * currentRate;
    const deductAmount = Math.max(costInTokens, 1);
    console.log(`[AI] Deducting ${deductAmount} Tokens (from $${costFinal}) from User ${userId}...`);
    const upd = await env.DB.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ?").bind(deductAmount, userId).run();
    console.log(`[AI] Deduct result: Success=${upd.success}`);
    await recordTokenUsage(userId, userModel, usedModel, inputTokens, outputTokens, costFinal, env);
    const updatedUser = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
    return Response.json({
      status: "success",
      model_chosen: userModel,
      model_used: usedModel,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost: costFinal,
      user_balance_after: updatedUser?.tokens,
      result: content,
      // Keep 'result' for backward compatibility or change to 'metadata' if desired, but 'result' is standard here
      metadata: {
        provider: usedModel.startsWith("gpt") ? "openai" : "gemini",
        finish_reason: "stop"
        // Simplified
      }
    });
  } finally {
    if (lockId) releaseLock(userId, lockId);
  }
}
__name(handleGenerate, "handleGenerate");

// src/handlers/user.ts
init_checked_fetch();
init_modules_watch_stub();
async function handleBalance(userId, env) {
  const user = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
  const rate = await getLiveUsdRate(env);
  return Response.json({ balance: user?.tokens || 0, usd_rate: rate });
}
__name(handleBalance, "handleBalance");
async function handleHistory(userId, env) {
  const history = await env.DB.prepare("SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20").bind(userId).all();
  return Response.json(history.results);
}
__name(handleHistory, "handleHistory");
async function handleTopup(req, userId, env) {
  const body = await req.json();
  const { amount, secret_admin_key } = body;
  if (secret_admin_key !== "RAHASIA_ADMIN_TOPUP") {
    return Response.json({ error: "Unauthorized topup" }, { status: 403 });
  }
  await env.DB.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").bind(amount, userId).run();
  return Response.json({ success: true, message: `Added ${amount} tokens` });
}
__name(handleTopup, "handleTopup");

// src/handlers/admin.ts
init_checked_fetch();
init_modules_watch_stub();
async function handleAdminModelPrices(req, env) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split("/");
  const id = pathParts[3];
  if (method === "GET") {
    const results = await env.DB.prepare("SELECT * FROM model_prices ORDER BY fallback_priority ASC").all();
    return Response.json(results.results);
  }
  if (method === "POST") {
    const body = await req.json();
    const { provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority } = body;
    try {
      await env.DB.prepare(`
        INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(provider, model_name, input_price, output_price, profit_multiplier || 1.5, active !== void 0 ? active : 1, fallback_priority || 1).run();
      return Response.json({ success: true });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  if (method === "PUT" && id) {
    const body = await req.json();
    const { provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority } = body;
    try {
      await env.DB.prepare(`
        UPDATE model_prices 
        SET provider = ?, model_name = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
        WHERE id = ?
      `).bind(provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority, id).run();
      return Response.json({ success: true });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  if (method === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM model_prices WHERE id = ?").bind(id).run();
    return Response.json({ success: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
__name(handleAdminModelPrices, "handleAdminModelPrices");
async function handleListUsers(request, env) {
  try {
    const users = await env.DB.prepare("SELECT id, email, tokens, is_admin, created_at FROM users ORDER BY created_at DESC").all();
    return Response.json(users.results);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleListUsers, "handleListUsers");
async function handleAdminConfig(request, env) {
  const method = request.method;
  if (method === "GET") {
    const configs = await env.DB.prepare("SELECT * FROM app_config").all();
    const configMap = {};
    configs.results.forEach((row) => {
      try {
        configMap[row.key] = JSON.parse(row.value);
      } catch {
        configMap[row.key] = row.value;
      }
    });
    return Response.json(configMap);
  }
  if (method === "POST") {
    try {
      const body = await request.json();
      const batch = [];
      for (const [key, value] of Object.entries(body)) {
        const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
        batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind(key, valStr));
      }
      if (batch.length > 0) {
        await env.DB.batch(batch);
      }
      return Response.json({ success: true });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
__name(handleAdminConfig, "handleAdminConfig");

// src/handlers/adminReports.ts
init_checked_fetch();
init_modules_watch_stub();
async function handleUserUsage(req, env) {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const userId = pathParts[3];
  if (!userId) {
    return Response.json({ error: "User ID required" }, { status: 400 });
  }
  try {
    const results = await env.DB.prepare(`
      SELECT 
        date(timestamp, 'unixepoch') as day, 
        SUM(input_tokens) as total_input, 
        SUM(output_tokens) as total_output, 
        SUM(cost) as total_cost,
        COUNT(*) as request_count
      FROM history 
      WHERE user_id = ? 
      GROUP BY day 
      ORDER BY day DESC
    `).bind(userId).all();
    return Response.json(results.results);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleUserUsage, "handleUserUsage");
async function handleExportUsageCsv(req, env) {
  try {
    const results = await env.DB.prepare(`
      SELECT 
        u.email,
        u.id as user_id,
        date(h.timestamp, 'unixepoch') as day,
        SUM(h.input_tokens) as total_input,
        SUM(h.output_tokens) as total_output,
        SUM(h.cost) as total_cost,
        COUNT(h.id) as request_count
      FROM history h
      JOIN users u ON h.user_id = u.id
      GROUP BY u.id, day
      ORDER BY day DESC, u.email ASC
    `).all();
    const rows = results.results;
    const headers = ["Date", "User Email", "User ID", "Input Tokens", "Output Tokens", "Total Cost ($)", "Requests"];
    let csv = headers.join(",") + "\n";
    for (const row of rows) {
      csv += [
        row.day,
        row.email,
        row.user_id,
        row.total_input || 0,
        row.total_output || 0,
        (row.total_cost || 0).toFixed(6),
        // Cost is small usually
        row.request_count
      ].join(",") + "\n";
    }
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=user_usage_report.csv"
      }
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleExportUsageCsv, "handleExportUsageCsv");

// src/handlers/voucher.ts
init_checked_fetch();
init_modules_watch_stub();
async function handleListVouchers(req, env) {
  const vouchers = await env.DB.prepare("SELECT * FROM vouchers ORDER BY created_at DESC").all();
  return Response.json(vouchers.results);
}
__name(handleListVouchers, "handleListVouchers");
async function handleCreateVoucher(req, env) {
  const body = await req.json();
  const { code, amount, max_usage, expires_at, allowed_emails } = body;
  if (!code || !amount) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  try {
    await env.DB.prepare(
      "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)"
    ).bind(
      code.toUpperCase(),
      amount,
      max_usage || 0,
      expires_at || null,
      allowed_emails || null,
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    return Response.json({ success: true, message: "Voucher created" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleCreateVoucher, "handleCreateVoucher");
async function handleDeleteVoucher(req, env) {
  const body = await req.json();
  const { id } = body;
  await env.DB.prepare("DELETE FROM vouchers WHERE id = ?").bind(id).run();
  return Response.json({ success: true });
}
__name(handleDeleteVoucher, "handleDeleteVoucher");
async function handleRedeemVoucher(req, env) {
  const body = await req.json();
  const { userId, code, deviceHash } = body;
  if (!userId || !code || !deviceHash) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  const voucherCode = code.toUpperCase().trim();
  const voucher = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(voucherCode).first();
  if (!voucher) {
    return Response.json({ error: "Invalid voucher code" }, { status: 404 });
  }
  if (voucher.expires_at) {
    const now = /* @__PURE__ */ new Date();
    const expiry = new Date(voucher.expires_at);
    if (now > expiry) {
      return Response.json({ error: "Voucher has expired" }, { status: 410 });
    }
  }
  const maxUsage = voucher.max_usage;
  const currentUsage = voucher.current_usage;
  if (maxUsage > 0 && currentUsage >= maxUsage) {
    return Response.json({ error: "Voucher fully redeemed" }, { status: 410 });
  }
  if (voucher.allowed_emails) {
    const allowedList = voucher.allowed_emails.split(",").map((s) => s.trim().toLowerCase());
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
    if (!user || !allowedList.includes(user.email.toLowerCase())) {
      return Response.json({ error: "This voucher is not valid for your account" }, { status: 403 });
    }
  }
  const userClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE user_id = ? AND voucher_code = ?").bind(userId, voucherCode).first();
  if (userClaim) {
    return Response.json({ error: "You have already redeemed this voucher" }, { status: 409 });
  }
  const deviceClaim = await env.DB.prepare("SELECT * FROM voucher_claims WHERE device_hash = ? AND voucher_code = ?").bind(deviceHash, voucherCode).first();
  if (deviceClaim) {
    return Response.json({ error: "This device has already redeemed this voucher code" }, { status: 403 });
  }
  try {
    const stmts = [
      // A. Add Tokens to User
      env.DB.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").bind(voucher.amount, userId),
      // B. Record Claim
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      // C. Increment Usage
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    ];
    await env.DB.batch(stmts);
    return Response.json({
      success: true,
      message: `Voucher redeemed! ${voucher.amount} tokens added.`,
      amount_added: voucher.amount
    });
  } catch (e) {
    console.error("Voucher Redeem Error:", e);
    return Response.json({ error: "Failed to redeem voucher. Please try again." }, { status: 500 });
  }
}
__name(handleRedeemVoucher, "handleRedeemVoucher");

// src/handlers/adminTopup.ts
init_checked_fetch();
init_modules_watch_stub();

// src/utils/userToken.ts
init_checked_fetch();
init_modules_watch_stub();
async function addUserTokens(userId, tokens, env) {
  const res = await env.DB.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ? RETURNING tokens").bind(tokens, userId).first();
  return res?.tokens || 0;
}
__name(addUserTokens, "addUserTokens");

// src/handlers/adminTopup.ts
async function listTopups(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;
  const method = url.searchParams.get("method") || null;
  const status = url.searchParams.get("status") || null;
  const search = url.searchParams.get("search") || null;
  const dateFrom = url.searchParams.get("date_from") || "1970-01-01";
  const dateTo = url.searchParams.get("date_to") || "2099-12-31";
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM topup_transactions t
    LEFT JOIN users u ON CAST(u.id AS TEXT) = t.user_id 
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (u.email LIKE ? OR t.user_id = ? OR ? IS NULL) 
      AND (date(t.created_at) BETWEEN date(?) AND date(?))
  `;
  const searchLike = search ? `%${search}%` : null;
  const bindParams = [
    method,
    method,
    status,
    status,
    searchLike,
    search,
    search,
    dateFrom,
    dateTo
  ];
  const countRes = await env.DB.prepare(countQuery).bind(...bindParams).first();
  const total = countRes?.total || 0;
  const pageCount = Math.ceil(total / limit);
  const query = `
    SELECT t.*, u.email as user_email, u.tokens as user_balance
    FROM topup_transactions t 
    LEFT JOIN users u ON CAST(u.id AS TEXT) = t.user_id 
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (u.email LIKE ? OR t.user_id = ? OR ? IS NULL) 
      AND (date(t.created_at) BETWEEN date(?) AND date(?))
    ORDER BY t.created_at DESC 
    LIMIT ? OFFSET ?
  `;
  const results = await env.DB.prepare(query).bind(...bindParams, limit, offset).all();
  return Response.json({
    total,
    page,
    page_count: pageCount,
    transactions: results.results
  });
}
__name(listTopups, "listTopups");
async function getTopupDetail(request, env) {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();
  if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });
  const query = `
    SELECT t.*, u.email, u.tokens as current_balance
    FROM topup_transactions t 
    LEFT JOIN users u ON t.user_id = CAST(u.id AS TEXT)
    WHERE t.id = ?
  `;
  const transaction = await env.DB.prepare(query).bind(id).first();
  if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
  return Response.json(transaction);
}
__name(getTopupDetail, "getTopupDetail");
async function manualApproveTopup(request, env, adminId = "SYSTEM") {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(id).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status !== "pending") return Response.json({ error: "Transaction is not pending" }, { status: 400 });
    await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(id).run();
    const tokensAdded = transaction.tokens_added;
    await addUserTokens(transaction.user_id, tokensAdded, env);
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
    if (user && user.email) {
      const currency = transaction.method === "paypal" ? "USD" : "IDR";
      const amount = transaction.method === "paypal" ? transaction.amount_usd : transaction.amount_rp;
      const name = user.email.split("@")[0];
      const html = getManualApproveTemplate(name, amount, tokensAdded, currency);
      sendEmail(user.email, "Top-Up Token Anda Berhasil (Manual Approval)", html, env);
    }
    await env.DB.prepare("INSERT INTO admin_logs (admin_id, action, target_id) VALUES (?, ?, ?)").bind(adminId, "manual_approve", id).run();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(manualApproveTopup, "manualApproveTopup");
async function deleteTopup(request, env, adminId = "SYSTEM") {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "Missing ID" }, { status: 400 });
    const transaction = await env.DB.prepare("SELECT status FROM topup_transactions WHERE id = ?").bind(id).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status === "paid") return Response.json({ error: "Cannot delete PAID transaction" }, { status: 400 });
    await env.DB.prepare("DELETE FROM topup_transactions WHERE id = ?").bind(id).run();
    await env.DB.prepare("INSERT INTO admin_logs (admin_id, action, target_id) VALUES (?, ?, ?)").bind(adminId, "delete_transaction", id).run();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(deleteTopup, "deleteTopup");
async function getTopupStatistics(_request, env) {
  const totalStats = await env.DB.prepare(`
    SELECT 
      COUNT(*) as total_transactions,
      SUM(amount_rp) as total_rp,
      SUM(amount_usd) as total_usd,
      SUM(tokens_added) as total_tokens_given
    FROM topup_transactions
    WHERE status = 'paid'
  `).first();
  const methods = await env.DB.prepare(`
    SELECT method, COUNT(*) as count 
    FROM topup_transactions 
    WHERE status = 'paid' 
    GROUP BY method
  `).all();
  const top_methods = {};
  methods.results.forEach((r) => top_methods[r.method] = r.count);
  const dailyStats = await env.DB.prepare(`
    SELECT 
      DATE(created_at) as day,
      COUNT(*) as count,
      SUM(amount_rp) as total_rp,
      SUM(amount_usd) as total_usd,
      SUM(tokens_added) as total_tokens
    FROM topup_transactions
    WHERE status = 'paid'
    GROUP BY day
    ORDER BY day DESC
  `).all();
  return Response.json({
    total_transactions: totalStats?.total_transactions || 0,
    total_rp: totalStats?.total_rp || 0,
    total_usd: totalStats?.total_usd || 0,
    total_tokens_given: totalStats?.total_tokens_given || 0,
    top_methods,
    daily_stats: dailyStats.results
    // Changed key to daily_stats to be explicit
  });
}
__name(getTopupStatistics, "getTopupStatistics");
async function exportTopupCsv(_request, env) {
  const query = `
    SELECT t.id, t.user_id, u.email, t.amount_rp, t.amount_usd, t.tokens_added, t.method, t.status, t.payment_ref, t.created_at
    FROM topup_transactions t
    LEFT JOIN users u ON t.user_id = CAST(u.id AS TEXT)
    ORDER BY t.created_at DESC
  `;
  const results = await env.DB.prepare(query).all();
  const header = "id,user_id,user_email,amount_rp,amount_usd,tokens_added,method,status,payment_ref,created_at\n";
  const rows = results.results.map((r) => {
    return [
      r.id,
      r.user_id,
      r.email || "",
      r.amount_rp || 0,
      r.amount_usd || 0,
      r.tokens_added,
      r.method,
      r.status,
      r.payment_ref || "",
      r.created_at
    ].join(",");
  }).join("\n");
  return new Response(header + rows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=topup_transactions.csv"
    }
  });
}
__name(exportTopupCsv, "exportTopupCsv");

// src/handlers/payment.ts
init_checked_fetch();
init_modules_watch_stub();
async function createPaypalPayment(request, env) {
  try {
    const { amount, userId } = await request.json();
    if (!amount || !userId) {
      return Response.json({ error: "Missing amount or userId" }, { status: 400 });
    }
    const configRows = await env.DB.prepare("SELECT * FROM app_config WHERE key IN ('usd_idr_rate', 'TOKEN_RATE_USD', 'BONUS_USD_TABLE')").all();
    let rateUsd;
    let bonusTable;
    configRows.results.forEach((row) => {
      if (row.key === "usd_idr_rate") rateUsd = parseFloat(row.value);
      if (row.key === "BONUS_USD_TABLE") {
        try {
          bonusTable = JSON.parse(row.value);
        } catch {
        }
      }
    });
    if (!rateUsd) rateUsd = 16300;
    const tokenCalc = getTokenFromUSD(amount, rateUsd, bonusTable);
    const insertRes = await env.DB.prepare(
      "INSERT INTO topup_transactions (user_id, amount_usd, tokens_added, method, status) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(userId, amount, tokenCalc.totalTokens, "paypal", "pending").first();
    const transactionId = insertRes?.id;
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("PayPal Credentials missing in Server Config");
    }
    const isLive = env.PAYPAL_MODE === "live";
    const baseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const auth = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("PayPal Token Error:", err);
      throw new Error("Failed to authenticate with PayPal");
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: String(transactionId),
          amount: { currency_code: "USD", value: amount.toString() },
          description: `TopUp ${tokenCalc.totalTokens} Tokens (Metabayn)`
        }],
        application_context: {
          // Since this is a desktop app, we might rely on the user manually closing the browser or deep links.
          // For now, we point to a simple success page or a generic one.
          return_url: "https://metabayn.com/payment/success",
          cancel_url: "https://metabayn.com/payment/cancel",
          brand_name: "Metabayn App",
          user_action: "PAY_NOW"
        }
      })
    });
    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error("PayPal Order Error:", err);
      throw new Error("Failed to create PayPal Order");
    }
    const orderData = await orderRes.json();
    const approveLink = orderData.links.find((l) => l.rel === "approve")?.href;
    const paypalOrderId = orderData.id;
    if (!approveLink) {
      throw new Error("No approval link returned from PayPal");
    }
    await env.DB.prepare("UPDATE topup_transactions SET payment_ref = ? WHERE id = ?").bind(paypalOrderId, transactionId).run();
    return Response.json({
      status: "success",
      transactionId,
      tokensExpected: tokenCalc.totalTokens,
      paymentUrl: approveLink,
      debug_info: isLive ? "Live Mode" : "Sandbox Mode"
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(createPaypalPayment, "createPaypalPayment");
async function checkPaypalStatus(request, env) {
  try {
    const body = await request.json();
    const transactionId = body.transactionId;
    if (!transactionId) return Response.json({ error: "Missing transactionId" }, { status: 400 });
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(transactionId).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status === "paid") {
      return Response.json({ status: "paid", message: "Already paid" });
    }
    const orderId = transaction.payment_ref;
    if (!orderId) return Response.json({ error: "No PayPal Order ID found" }, { status: 400 });
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("PayPal Credentials missing");
    const isLive = env.PAYPAL_MODE === "live";
    const baseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const auth = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials"
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    if (!orderRes.ok) throw new Error("Failed to fetch PayPal Order");
    const orderData = await orderRes.json();
    const paypalStatus = orderData.status;
    if (paypalStatus === "APPROVED") {
      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!captureRes.ok) {
        const errText = await captureRes.text();
        console.error("Capture Failed:", errText);
        return Response.json({ status: "pending", paypal_status: "CAPTURE_FAILED" });
      }
      const captureData = await captureRes.json();
      if (captureData.status === "COMPLETED") {
        await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();
        await addUserTokens(transaction.user_id, transaction.tokens_added, env);
        return Response.json({ status: "paid", paypal_status: "COMPLETED" });
      }
    } else if (paypalStatus === "COMPLETED") {
      await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();
      await addUserTokens(transaction.user_id, transaction.tokens_added, env);
      return Response.json({ status: "paid", paypal_status: "COMPLETED" });
    }
    return Response.json({ status: transaction.status, paypal_status: paypalStatus });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(checkPaypalStatus, "checkPaypalStatus");
async function handlePaypalWebhook(request, env) {
  try {
    const data = await request.json();
    if (data.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = data.resource.id;
      const amountPaid = parseFloat(data.resource.amount.value);
      const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE payment_ref = ?").bind(orderId).first();
      if (transaction && transaction.status === "pending") {
        await env.DB.prepare("UPDATE topup_transactions SET status = 'paid', amount_usd = ? WHERE id = ?").bind(amountPaid, transaction.id).run();
        const newBalance = await addUserTokens(transaction.user_id, transaction.tokens_added, env);
        const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
        if (user && user.email) {
          const html = getTopupSuccessTemplate(amountPaid, transaction.tokens_added, "USD");
          sendEmail(user.email, "Top Up Successful!", html, env);
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
  } catch (e) {
    console.error("PayPal Webhook Error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handlePaypalWebhook, "handlePaypalWebhook");
async function createQrisPayment(request, env) {
  try {
    const { amount, userId } = await request.json();
    if (!amount || !userId) {
      return Response.json({ error: "Missing amount or userId" }, { status: 400 });
    }
    const configRows = await env.DB.prepare("SELECT * FROM app_config WHERE key IN ('TOKEN_RATE_IDR', 'BONUS_IDR_TABLE')").all();
    let rateIdr;
    let bonusTable;
    configRows.results.forEach((row) => {
      if (row.key === "TOKEN_RATE_IDR") rateIdr = parseFloat(row.value);
      if (row.key === "BONUS_IDR_TABLE") {
        try {
          bonusTable = JSON.parse(row.value);
        } catch {
        }
      }
    });
    const tokenCalc = getTokenFromIDR(amount, rateIdr, bonusTable);
    const insertRes = await env.DB.prepare(
      "INSERT INTO topup_transactions (user_id, amount_rp, tokens_added, method, status) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(userId, amount, tokenCalc.totalTokens, "qris", "pending").first();
    const transactionId = insertRes?.id;
    const orderId = `metabayn-${transactionId}-${Date.now()}`;
    const serverKey = env.MIDTRANS_SERVER_KEY;
    const isProduction = env.MIDTRANS_IS_PRODUCTION === "true";
    const baseUrl = isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
    if (!serverKey) {
      throw new Error("Midtrans Server Key is missing");
    }
    const auth = btoa(serverKey + ":");
    const midtransRes = await fetch(`${baseUrl}/v2/charge`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: {
          order_id: orderId,
          gross_amount: amount
          // Midtrans requires integer for IDR
        },
        qris: {
          acquirer: "gopay"
          // Optional, but good for testing
        }
      })
    });
    if (!midtransRes.ok) {
      const err = await midtransRes.text();
      console.error("Midtrans Error:", err);
      throw new Error("Failed to create QRIS transaction");
    }
    const midtransData = await midtransRes.json();
    let qrString = midtransData.qr_string;
    if (!qrString && midtransData.actions) {
      const qrAction = midtransData.actions.find((a) => a.name === "generate-qr-code");
      if (qrAction) qrString = qrAction.url;
    }
    if (!qrString) {
      qrString = "https://placehold.co/200x200?text=QR+Error";
    }
    await env.DB.prepare("UPDATE topup_transactions SET payment_ref = ? WHERE id = ?").bind(orderId, transactionId).run();
    return Response.json({
      status: "success",
      transactionId,
      tokensExpected: tokenCalc.totalTokens,
      qrString,
      // If it is a URL (starts with http), frontend should render <img src>
      // If it is raw data, frontend should render <QRCode value>
      isQrUrl: qrString.startsWith("http"),
      debug_info: isProduction ? "Production" : "Sandbox"
    });
  } catch (e) {
    console.error("QRIS Creation Error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(createQrisPayment, "createQrisPayment");
async function checkQrisStatus(request, env) {
  try {
    const body = await request.json();
    const transactionId = body.transactionId;
    if (!transactionId) return Response.json({ error: "Missing transactionId" }, { status: 400 });
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE id = ?").bind(transactionId).first();
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });
    if (transaction.status === "paid") return Response.json({ status: "paid" });
    const orderId = transaction.payment_ref;
    if (!orderId) return Response.json({ error: "No Order ID" }, { status: 400 });
    const serverKey = env.MIDTRANS_SERVER_KEY;
    const isProduction = env.MIDTRANS_IS_PRODUCTION === "true";
    const baseUrl = isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
    const auth = btoa(serverKey + ":");
    const res = await fetch(`${baseUrl}/v2/${orderId}/status`, {
      method: "GET",
      headers: { "Accept": "application/json", "Authorization": `Basic ${auth}` }
    });
    if (!res.ok) return Response.json({ status: "pending", midtrans_status: "error" });
    const data = await res.json();
    const transactionStatus = data.transaction_status;
    const fraudStatus = data.fraud_status;
    let isPaid = false;
    if (transactionStatus === "capture") {
      if (fraudStatus === "challenge") {
      } else if (fraudStatus === "accept") {
        isPaid = true;
      }
    } else if (transactionStatus === "settlement") {
      isPaid = true;
    }
    if (isPaid) {
      await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();
      await addUserTokens(transaction.user_id, transaction.tokens_added, env);
      return Response.json({ status: "paid" });
    }
    return Response.json({ status: "pending", midtrans_status: transactionStatus });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(checkQrisStatus, "checkQrisStatus");
async function handleQrisCallback(request, env) {
  try {
    const data = await request.json();
    const orderId = data.order_id;
    const transactionStatus = data.transaction_status;
    const fraudStatus = data.fraud_status;
    if (!orderId) return Response.json({ error: "No Order ID" }, { status: 400 });
    const transaction = await env.DB.prepare("SELECT * FROM topup_transactions WHERE payment_ref = ?").bind(orderId).first();
    if (!transaction || transaction.status === "paid") return Response.json({ message: "Ignored" });
    let isPaid = false;
    if (transactionStatus === "capture") {
      if (fraudStatus === "accept") isPaid = true;
    } else if (transactionStatus === "settlement") {
      isPaid = true;
    }
    if (isPaid) {
      await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transaction.id).run();
      await addUserTokens(transaction.user_id, transaction.tokens_added, env);
      const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(transaction.user_id).first();
      if (user && user.email) {
        const html = getTopupSuccessTemplate(transaction.amount_rp, transaction.tokens_added, "IDR");
        sendEmail(user.email, "Top Up Successful!", html, env);
      }
    }
    return Response.json({ status: "ok" });
  } catch (e) {
    return Response.json({ error: "Error" }, { status: 500 });
  }
}
__name(handleQrisCallback, "handleQrisCallback");

// src/index.ts
init_crypto();
var src_default = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key"
    };
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const wrapCors = /* @__PURE__ */ __name(async (promise) => {
      const res = await promise;
      const headers = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }, "wrapCors");
    try {
      if (path === "/auth/register" && method === "POST") return await wrapCors(handleRegister(request, env));
      if (path === "/auth/login" && method === "POST") return await wrapCors(handleLogin(request, env));
      if (path === "/auth/google" && method === "GET") return await handleGoogleLogin(request, env);
      if (path === "/auth/google/callback" && method === "GET") return await handleGoogleCallback(request, env);
      if (path === "/payment/paypal/webhook" && method === "POST") return await wrapCors(handlePaypalWebhook(request, env));
      if (path === "/payment/qris/callback" && method === "POST") return await wrapCors(handleQrisCallback(request, env));
      if (path.startsWith("/admin/")) {
        let isAdmin = false;
        const adminKey = request.headers.get("x-admin-key");
        if (env.ADMIN_SECRET && adminKey === env.ADMIN_SECRET) {
          isAdmin = true;
        }
        if (!isAdmin) {
          const authHeader2 = request.headers.get("Authorization");
          if (authHeader2 && authHeader2.startsWith("Bearer ")) {
            const token2 = authHeader2.split(" ")[1];
            const decoded = await verifyToken(token2, env.JWT_SECRET);
            if (decoded) {
              const dbUser = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?").bind(decoded.id).first();
              if (dbUser && dbUser.is_admin === 1) {
                isAdmin = true;
              }
            }
          }
        }
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Unauthorized Admin" }), { status: 401, headers: corsHeaders });
        }
        if (path.startsWith("/admin/model-prices")) return await wrapCors(handleAdminModelPrices(request, env));
        if (path === "/admin/config") return await wrapCors(handleAdminConfig(request, env));
        if (path === "/admin/users") return await wrapCors(handleListUsers(request, env));
        if (path === "/admin/users/list") return await wrapCors(handleListUsers(request, env));
        if (path.startsWith("/admin/users/") && path.endsWith("/usage") && method === "GET") return await wrapCors(handleUserUsage(request, env));
        if (path === "/admin/users/export-usage" && method === "GET") return await wrapCors(handleExportUsageCsv(request, env));
        if (path === "/admin/vouchers" && method === "GET") return await wrapCors(handleListVouchers(request, env));
        if (path === "/admin/vouchers/create" && method === "POST") return await wrapCors(handleCreateVoucher(request, env));
        if (path === "/admin/vouchers/delete" && method === "POST") return await wrapCors(handleDeleteVoucher(request, env));
        if (path === "/admin/topup/list" && method === "GET") return await wrapCors(listTopups(request, env));
        if (path.startsWith("/admin/topup/detail/") && method === "GET") return await wrapCors(getTopupDetail(request, env));
        if (path === "/admin/topup/manual-approve" && method === "POST") return await wrapCors(manualApproveTopup(request, env));
        if (path === "/admin/topup/delete" && method === "POST") return await wrapCors(deleteTopup(request, env));
        if (path === "/admin/topup/statistics" && method === "GET") return await wrapCors(getTopupStatistics(request, env));
        if (path === "/admin/topup/export-csv" && method === "GET") return await wrapCors(exportTopupCsv(request, env));
        return new Response("Admin Route Not Found", { status: 404, headers: corsHeaders });
      }
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const token = authHeader.split(" ")[1];
      const user = await verifyToken(token, env.JWT_SECRET);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid Token" }), { status: 401, headers: corsHeaders });
      }
      const userId = user.sub;
      if (path === "/token/balance" && method === "GET") return await wrapCors(handleBalance(userId, env));
      if (path === "/token/topup" && method === "POST") return await wrapCors(handleTopup(request, userId, env));
      if (path === "/history/list" && method === "GET") return await wrapCors(handleHistory(userId, env));
      if (path === "/ai/generate" && method === "POST") return await wrapCors(handleGenerate(request, userId, env));
      if (path === "/voucher/redeem" && method === "POST") return await wrapCors(handleRedeemVoucher(request, env));
      if (path === "/payment/paypal/create" && method === "POST") return await wrapCors(createPaypalPayment(request, env));
      if (path === "/payment/paypal/check" && method === "POST") return await wrapCors(checkPaypalStatus(request, env));
      if (path === "/payment/qris/create" && method === "POST") return await wrapCors(createQrisPayment(request, env));
      if (path === "/payment/qris/check" && method === "POST") return await wrapCors(checkQrisStatus(request, env));
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_checked_fetch();
init_modules_watch_stub();
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_checked_fetch();
init_modules_watch_stub();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-BR3Etl/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
init_checked_fetch();
init_modules_watch_stub();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-BR3Etl/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
