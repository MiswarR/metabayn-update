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

// .wrangler/tmp/bundle-scSQKP/checked-fetch.js
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
  ".wrangler/tmp/bundle-scSQKP/checked-fetch.js"() {
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
    exp: Math.floor(Date.now() / 1e3) + 3650 * 24 * 60 * 60
    // 10 tahun (Lifetime)
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

// src/handlers/admin.ts
var admin_exports = {};
__export(admin_exports, {
  handleAdminAuthLogs: () => handleAdminAuthLogs,
  handleAdminConfig: () => handleAdminConfig,
  handleAdminModelPrices: () => handleAdminModelPrices,
  handleDeleteUser: () => handleDeleteUser,
  handleListUsers: () => handleListUsers,
  handleResetPassword: () => handleResetPassword,
  handleSeedUsers: () => handleSeedUsers,
  handleSyncLiveModelPrices: () => handleSyncLiveModelPrices,
  handleSyncModelPrices: () => handleSyncModelPrices,
  handleUpdateSubscription: () => handleUpdateSubscription
});
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
async function handleListUsers(request, env) {
  try {
    const users = await env.DB.prepare("SELECT id, email, tokens, is_admin, created_at, subscription_active, subscription_expiry FROM users ORDER BY created_at DESC").all();
    const results = Array.isArray(users) ? users : users.results || [];
    const formattedUsers = results.map((user) => ({
      ...user,
      // D1 returns timestamps as numbers (seconds). JS Date needs milliseconds.
      created_at: user.created_at ? new Date(user.created_at * 1e3).toISOString() : null
    }));
    return Response.json(formattedUsers);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
async function handleUpdateSubscription(request, env) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  try {
    const body = await request.json();
    const { user_id, is_active, expiry_date } = body;
    if (!user_id) return Response.json({ error: "User ID required" }, { status: 400 });
    const activeVal = is_active ? 1 : 0;
    const result = await env.DB.prepare("UPDATE users SET subscription_active = ?, subscription_expiry = ? WHERE id = ?").bind(activeVal, expiry_date, user_id).run();
    if (result.meta && result.meta.changes === 0) {
      return Response.json({ success: false, error: "User not found or no changes made" });
    }
    return Response.json({ success: true, changes: result.meta.changes });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
async function handleResetPassword(request, env) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  try {
    const body = await request.json();
    const { user_id, new_password } = body;
    if (!user_id || !new_password) {
      return Response.json({ error: "User ID and new password are required" }, { status: 400 });
    }
    if (new_password.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const hashedPassword = await hashPassword(new_password);
    const result = await env.DB.prepare("UPDATE users SET password = ? WHERE id = ?").bind(hashedPassword, user_id).run();
    if (result.meta && result.meta.changes === 0) {
      return Response.json({ success: false, error: "User not found" });
    }
    return Response.json({ success: true, message: "Password updated successfully" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
async function handleDeleteUser(request, env) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  try {
    const body = await request.json();
    const { user_id } = body;
    if (!user_id) {
      return Response.json({ error: "User ID is required" }, { status: 400 });
    }
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(user_id).first();
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    if (user.email === "metabayn@gmail.com") {
      return Response.json({ error: "Cannot delete super admin account" }, { status: 403 });
    }
    await env.DB.prepare("DELETE FROM voucher_claims WHERE user_id = ?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM history WHERE user_id = ?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM topup_transactions WHERE user_id = ?").bind(String(user_id)).run();
    await env.DB.prepare("DELETE FROM auth_logs WHERE user_id = ?").bind(String(user_id)).run();
    const result = await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user_id).run();
    if (result.meta && result.meta.changes === 0) {
      return Response.json({ success: false, error: "User delete failed (0 changes)" });
    }
    return Response.json({ success: true, message: "User deleted successfully" });
  } catch (e) {
    console.error("Delete user error:", e);
    return Response.json({ error: "Delete failed: " + e.message }, { status: 500 });
  }
}
async function handleSeedUsers(request, env) {
  try {
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
    if (count && count.count > 0) {
      return Response.json({ message: "Users already exist", count: count.count });
    }
    const dummyUsers = [
      { email: "user1@example.com", tokens: 1e3, is_admin: 0, subscription_active: 0 },
      { email: "user2@example.com", tokens: 5e3, is_admin: 0, subscription_active: 1, subscription_expiry: new Date(Date.now() + 864e5 * 30).toISOString() },
      { email: "admin@metabayn.com", tokens: 999999, is_admin: 1, subscription_active: 1, subscription_expiry: new Date(Date.now() + 864e5 * 365).toISOString() },
      { email: "expired@example.com", tokens: 0, is_admin: 0, subscription_active: 1, subscription_expiry: new Date(Date.now() - 864e5).toISOString() },
      { email: "newuser@example.com", tokens: 100, is_admin: 0, subscription_active: 0 }
    ];
    const stmt = env.DB.prepare("INSERT INTO users (email, password, tokens, is_admin, subscription_active, subscription_expiry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const batch = dummyUsers.map(
      (u) => stmt.bind(u.email, "hashed_password_placeholder", u.tokens, u.is_admin, u.subscription_active, u.subscription_expiry || null, (/* @__PURE__ */ new Date()).toISOString())
    );
    await env.DB.batch(batch);
    return Response.json({ success: true, message: `Seeded ${dummyUsers.length} users` });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
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
async function handleAdminAuthLogs(request, env) {
  const method = request.method;
  if (method === "GET") {
    try {
      const logs = await env.DB.prepare("SELECT * FROM auth_logs ORDER BY timestamp DESC LIMIT 100").all();
      const results = Array.isArray(logs) ? logs : logs.results || [];
      return Response.json(results);
    } catch (e) {
      if (e.message.includes("no such table")) return Response.json([]);
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  if (method === "POST") {
    try {
      await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS auth_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email TEXT NOT NULL,
                action TEXT NOT NULL,
                ip_address TEXT,
                device_hash TEXT,
                timestamp INTEGER DEFAULT (unixepoch())
            )
          `).run();
      await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )
          `).run();
      return Response.json({ success: true, message: "Tables initialized (auth_logs, rate_limits)" });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
async function handleSyncModelPrices(request, env) {
  try {
    let profitPercent = 60;
    try {
      const cfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
      if (cfg && cfg.value) profitPercent = Number(cfg.value);
    } catch {
    }
    const profitMultiplier = 1 + profitPercent / 100;
    const OFFICIAL = [
      // OpenAI (Updated Dec 2025)
      { provider: "openai", model_name: "o1", input_price: 15, output_price: 60, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "o1-mini", input_price: 3, output_price: 12, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "o3-mini", input_price: 1.1, output_price: 4.4, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "gpt-4o", input_price: 2.5, output_price: 10, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "gpt-4o-mini", input_price: 0.15, output_price: 0.6, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "gpt-4.5-preview", input_price: 75, output_price: 150, active: 0, fallback_priority: 1 },
      { provider: "openai", model_name: "gpt-4-turbo", input_price: 10, output_price: 30, active: 1, fallback_priority: 1 },
      // OpenAI Legacy / Custom Aliases
      { provider: "openai", model_name: "gpt-4.1", input_price: 3, output_price: 12, active: 1, fallback_priority: 1 },
      { provider: "openai", model_name: "gpt-4o-realtime", input_price: 5, output_price: 20, active: 0, fallback_priority: 1 },
      { provider: "openai", model_name: "o1-preview", input_price: 15, output_price: 60, active: 0, fallback_priority: 1 },
      // Gemini
      { provider: "gemini", model_name: "gemini-3.0-flash-preview", input_price: 0.35, output_price: 3, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-3.0-pro-preview", input_price: 1.5, output_price: 8, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-3.0-ultra", input_price: 4, output_price: 12, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.5-ultra", input_price: 2.5, output_price: 12, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.5-pro", input_price: 1.25, output_price: 10, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.5-flash", input_price: 0.3, output_price: 2.5, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.5-flash-lite", input_price: 0.1, output_price: 0.4, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-ultra", input_price: 2.5, output_price: 12, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-pro", input_price: 3.5, output_price: 10.5, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-pro-exp-02-05", input_price: 3.5, output_price: 10.5, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-flash", input_price: 0.1, output_price: 0.4, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-flash-exp", input_price: 0.1, output_price: 0.4, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-flash-lite", input_price: 0.075, output_price: 0.3, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-2.0-flash-lite-preview-02-05", input_price: 0.075, output_price: 0.3, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-1.5-pro", input_price: 3.5, output_price: 10.5, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-1.5-flash", input_price: 0.075, output_price: 0.3, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-1.5-flash-8b", input_price: 0.0375, output_price: 0.15, active: 1, fallback_priority: 1 },
      { provider: "gemini", model_name: "gemini-pro", input_price: 0.5, output_price: 1.5, active: 1, fallback_priority: 1 }
    ];
    for (const p of OFFICIAL) {
      const existing = await env.DB.prepare("SELECT id FROM model_prices WHERE model_name = ?").bind(p.model_name).first();
      if (existing && existing.id) {
        await env.DB.prepare(`
          UPDATE model_prices 
          SET provider = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
          WHERE id = ?
        `).bind(p.provider, p.input_price, p.output_price, profitMultiplier, p.active, p.fallback_priority, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(p.provider, p.model_name, p.input_price, p.output_price, profitMultiplier, p.active, p.fallback_priority).run();
      }
    }
    return Response.json({ success: true, count: OFFICIAL.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
async function handleSyncLiveModelPrices(request, env) {
  try {
    let profitPercent = 60;
    try {
      const cfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'profit_margin_percent'").first();
      if (cfg && cfg.value) profitPercent = Number(cfg.value);
    } catch {
    }
    const profitMultiplier = 1 + profitPercent / 100;
    const upsert = /* @__PURE__ */ __name(async (provider, model_name, input_price, output_price, active = 1, fallback_priority = 1) => {
      const existing = await env.DB.prepare("SELECT id FROM model_prices WHERE model_name = ?").bind(model_name).first();
      if (existing && existing.id) {
        await env.DB.prepare(`
          UPDATE model_prices 
          SET provider = ?, input_price = ?, output_price = ?, profit_multiplier = ?, active = ?, fallback_priority = ?
          WHERE id = ?
        `).bind(provider, input_price, output_price, profitMultiplier, active, fallback_priority, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO model_prices (provider, model_name, input_price, output_price, profit_multiplier, active, fallback_priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(provider, model_name, input_price, output_price, profitMultiplier, active, fallback_priority).run();
      }
    }, "upsert");
    let count = 0;
    try {
      const res = await fetch("https://openai.com/api/pricing");
      const html = await res.text();
      const pick = /* @__PURE__ */ __name((name) => {
        const re = new RegExp(name + ".*?$([0-9.]+).*?$([0-9.]+)", "is");
        const m = html.match(re);
        if (m) return { in: Number(m[1]), out: Number(m[2]) };
        return null;
      }, "pick");
      const o4o = pick("gpt-4o");
      if (o4o) {
        await upsert("openai", "gpt-4o", o4o.in, o4o.out);
        count++;
      }
      const o4omini = pick("gpt-4o-mini");
      if (o4omini) {
        await upsert("openai", "gpt-4o-mini", o4omini.in, o4omini.out);
        count++;
      }
      const g41 = pick("gpt-4.1");
      if (g41) {
        await upsert("openai", "gpt-4.1", g41.in, g41.out);
        count++;
      }
      const o1 = pick("o1");
      if (o1) {
        await upsert("openai", "o1", o1.in, o1.out);
        count++;
      }
      const o3 = pick("o3");
      if (o3) {
        await upsert("openai", "o3", o3.in, o3.out);
        count++;
      }
      const o4mini = pick("o4-mini");
      if (o4mini) {
        await upsert("openai", "o4-mini", o4mini.in, o4mini.out);
        count++;
      }
    } catch {
    }
    try {
      const res = await fetch("https://ai.google.dev/pricing");
      const html = await res.text();
      const pick = /* @__PURE__ */ __name((name) => {
        const re = new RegExp(name + ".*?$([0-9.]+).*?$([0-9.]+)", "is");
        const m = html.match(re);
        if (m) return { in: Number(m[1]), out: Number(m[2]) };
        return null;
      }, "pick");
      const g15pro = pick("Gemini 1.5 Pro");
      if (g15pro) {
        await upsert("gemini", "gemini-1.5-pro", g15pro.in, g15pro.out);
        count++;
      }
      const g15flash = pick("Gemini 1.5 Flash");
      if (g15flash) {
        await upsert("gemini", "gemini-1.5-flash", g15flash.in, g15flash.out);
        count++;
      }
      const g15flash8b = pick("Flash-8B");
      if (g15flash8b) {
        await upsert("gemini", "gemini-1.5-flash-8b", g15flash8b.in, g15flash8b.out);
        count++;
      }
      const g20flash = pick("Gemini 2.0 Flash");
      if (g20flash) {
        await upsert("gemini", "gemini-2.0-flash", g20flash.in, g20flash.out);
        count++;
      }
      const g20flashlite = pick("Flash Lite");
      if (g20flashlite) {
        await upsert("gemini", "gemini-2.0-flash-lite", g20flashlite.in, g20flashlite.out);
        count++;
      }
      const g25pro = pick("Gemini 2.5 Pro");
      if (g25pro) {
        await upsert("gemini", "gemini-2.5-pro", g25pro.in, g25pro.out);
        count++;
      }
      const g25flash = pick("Gemini 2.5 Flash");
      if (g25flash) {
        await upsert("gemini", "gemini-2.5-flash", g25flash.in, g25flash.out);
        count++;
      }
    } catch {
    }
    if (count === 0) {
      const fallback = [
        ["openai", "gpt-4o", 5, 15],
        ["openai", "gpt-4o-mini", 0.15, 0.6],
        ["openai", "gpt-4.1", 5, 15],
        ["openai", "o1", 15, 60],
        ["openai", "o3", 4, 16],
        ["openai", "o4-mini", 0.2, 0.8],
        ["gemini", "gemini-1.5-pro", 3.5, 10.5],
        ["gemini", "gemini-1.5-flash", 0.075, 0.3],
        ["gemini", "gemini-1.5-flash-8b", 0.0375, 0.15],
        ["gemini", "gemini-2.0-flash", 0.1, 0.4],
        ["gemini", "gemini-2.0-flash-lite", 0.075, 0.3],
        ["gemini", "gemini-2.5-pro", 1.25, 10],
        ["gemini", "gemini-2.5-flash", 0.3, 2.5]
      ];
      for (const [prov, name, ip, op] of fallback) {
        await upsert(String(prov), String(name), Number(ip), Number(op));
      }
      count = fallback.length;
    }
    return Response.json({ success: true, count });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
var init_admin = __esm({
  "src/handlers/admin.ts"() {
    "use strict";
    init_checked_fetch();
    init_modules_watch_stub();
    init_crypto();
    __name(handleAdminModelPrices, "handleAdminModelPrices");
    __name(handleListUsers, "handleListUsers");
    __name(handleUpdateSubscription, "handleUpdateSubscription");
    __name(handleResetPassword, "handleResetPassword");
    __name(handleDeleteUser, "handleDeleteUser");
    __name(handleSeedUsers, "handleSeedUsers");
    __name(handleAdminConfig, "handleAdminConfig");
    __name(handleAdminAuthLogs, "handleAdminAuthLogs");
    __name(handleSyncModelPrices, "handleSyncModelPrices");
    __name(handleSyncLiveModelPrices, "handleSyncLiveModelPrices");
  }
});

// .wrangler/tmp/bundle-scSQKP/middleware-loader.entry.ts
init_checked_fetch();
init_modules_watch_stub();

// .wrangler/tmp/bundle-scSQKP/middleware-insertion-facade.js
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
    throw new Error("Email service not configured (RESEND_API_KEY missing)");
  }
  try {
    const from = env.EMAIL_FROM && env.EMAIL_FROM.includes("<") ? env.EMAIL_FROM : `Metabayn Studio <${env.EMAIL_FROM || "admin@albayn.site"}>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from,
        reply_to: "no-reply@albayn.site",
        to: [to],
        subject,
        html
      })
    });
    if (!res.ok) {
      const error = await res.text();
      console.error("Resend API Error:", error);
      throw new Error(`Email delivery failed: ${error}`);
    }
  } catch (e) {
    console.error("Failed to send email:", e);
    throw new Error(e.message || "Failed to send email");
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
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply.<br>
            For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
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
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply.<br>
            For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}
__name(getManualApproveTemplate, "getManualApproveTemplate");
function getVerificationTemplate(email, pass, confirmLink) {
  return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Welcome to Metabayn Studio!</h2>
        </div>
        <p>Hello,</p>
        <p>Thank you for registering. To activate your account, please click the button below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${confirmLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Verify Email Address</a>
        </div>

        <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
        <p style="font-size: 12px; color: #666; word-break: break-all;">${confirmLink}</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

        <p><strong>Your Account Credentials:</strong></p>
        <ul style="background: #f9f9f9; padding: 15px; border-radius: 4px; list-style: none;">
            <li style="margin-bottom: 8px;"><strong>Email:</strong> ${email}</li>
            <li><strong>Password:</strong> ${pass}</li>
        </ul>
        <p style="color: #d32f2f; font-size: 12px;">*Please keep this information safe. Do not share your password with anyone.</p>

        <br>
        <p>Best regards,</p>
        <p>Metabayn Studio Team</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply to this email.<br>
            For support and updates, please join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}
__name(getVerificationTemplate, "getVerificationTemplate");
function getWelcomeTemplate(email) {
  return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Verification Successful!</h2>
        </div>
        <p>Hello,</p>
        <p>Congratulations! Your email has been verified and your account is now active.</p>
        <p>You can now login to the Metabayn Studio application.</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

        <p><strong>Join Our Community</strong></p>
        <p>Connect with other users, get updates, and share your experience in our WhatsApp Group:</p>
        
        <div style="text-align: center; margin: 20px 0;">
            <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="background-color: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Join WhatsApp Group</a>
        </div>
        
        <br>
        <p>Best regards,</p>
        <p>Metabayn Studio Team</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply to this email.<br>
            For support and updates, please join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}
__name(getWelcomeTemplate, "getWelcomeTemplate");
function getPurchaseVoucherTemplate(email, voucherCode, type, value) {
  const title = type === "subscription" ? `${value} Days Subscription Voucher` : `${value.toLocaleString()} Tokens Voucher`;
  const description = type === "subscription" ? `You have successfully purchased a <strong>${value} Days Subscription</strong>.` : `You have successfully purchased <strong>${value.toLocaleString()} Tokens</strong>.`;
  return `
  <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px;">
           <h2 style="color: #333;">Payment Successful</h2>
      </div>
  
      <p>Hi ${email},</p>
      <p>
        Thank you for your purchase. We have received your payment from Lynk.id.
        ${description}
      </p>
  
      <h3>Your Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${voucherCode}
        </span>
      </div>
  
      <p style="color: #d32f2f; font-size: 12px; margin-top: -8px;">
        * This voucher is valid for one-time use only.
      </p>
  
      <h3>How to Redeem</h3>
      <ol>
        <li>Open <strong>Metabayn Studio</strong> app.</li>
        <li>Go to <strong>Voucher / Redeem</strong> menu.</li>
        <li>Enter the code above and click Redeem.</li>
      </ol>
  
      <br>
      <p>Best regards,</p>
      <p><strong>Metabayn Studio Team</strong></p>
  
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888; text-align: center;">
        This is an automated message, please do not reply.<br>
        For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
      </p>
  </div>
  `;
}
__name(getPurchaseVoucherTemplate, "getPurchaseVoucherTemplate");
function getWelcomeDualVoucherTemplate(email, tokenCode, amountTokens, subscriptionCode, durationDays) {
  return `
  <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px;">
           <h2 style="color: #333;">Thank You for Purchasing Metabayn Studio</h2>
      </div>

      <p>Hi ${email},</p>
      <p>
        As a welcome bonus, you receive <strong>$3</strong> worth of tokens and a <strong>${durationDays} Days API Key Subscription</strong>.
      </p>

      <h3>Your Token Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${tokenCode}
        </span>
      </div>
      <p>You will receive <strong>${amountTokens.toLocaleString()} Tokens</strong> after redeeming this voucher.</p>

      <h3>Your Subscription Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${subscriptionCode}
        </span>
      </div>
      <p>Redeem this voucher to activate <strong>${durationDays} Days</strong> of API Key mode subscription.</p>

      <p style="color: #d32f2f; font-size: 12px; margin-top: -8px;">
        * Each voucher is valid for one-time use only.
      </p>

      <h3>How to Redeem</h3>
      <ol>
        <li>Open <strong>Metabayn Studio</strong> app.</li>
        <li>Go to <strong>Voucher / Redeem</strong> menu.</li>
        <li>Enter the code above and click Redeem.</li>
      </ol>

      <br>
      <p>Best regards,</p>
      <p><strong>Metabayn Studio Team</strong></p>

      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888; text-align: center;">
        This is an automated message, please do not reply.<br>
        For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
      </p>
  </div>
  `;
}
__name(getWelcomeDualVoucherTemplate, "getWelcomeDualVoucherTemplate");

// src/handlers/auth.ts
async function handleRegister(req, env) {
  const body = await req.json();
  const { email, password, device_hash } = body;
  if (!email || !password || !device_hash) return Response.json({ error: "Missing fields" }, { status: 400 });
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return Response.json({ error: "Invalid email format. Please check your email." }, { status: 400 });
  }
  const hashedPassword = await hashPassword(password);
  const confirmToken = crypto.randomUUID();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1e3;
  try {
    let initialTokens = 48900;
    try {
      const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
      if (rateCfg && rateCfg.value) {
        const rate = Number(rateCfg.value);
        if (!isNaN(rate) && rate > 0) {
          initialTokens = Math.round(3 * rate);
        }
      }
    } catch (e) {
      console.error("Failed to fetch rate for initial balance, using default:", e);
    }
    if (!initialTokens || initialTokens <= 0) initialTokens = 48900;
    const existingDeviceUser = await env.DB.prepare("SELECT id FROM users WHERE device_hash = ?").bind(device_hash).first();
    if (existingDeviceUser) {
      initialTokens = 0;
    }
    await env.DB.prepare("INSERT INTO users (email, password, tokens, status, confirmation_token, confirmation_expires_at, device_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(email, hashedPassword, initialTokens, "pending", confirmToken, expiresAt, device_hash).run();
    const userIdResult = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!userIdResult) {
      throw new Error("Failed to retrieve user ID after registration.");
    }
    const newUserId = userIdResult.id;
    try {
      const workerUrl = "https://metabayn-backend.metabayn.workers.dev";
      const link = `${workerUrl}/auth/verify?token=${confirmToken}`;
      const emailHtml = getVerificationTemplate(email, password, link);
      await sendEmail(email, "Verify Your Email Address", emailHtml, env);
      await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, timestamp) VALUES (?, ?, 'sent', ?)").bind(email, "Verify Your Email Address", Date.now()).run();
    } catch (emailErr) {
      console.error("Email send failed, rolling back user registration:", emailErr);
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(newUserId).run();
      await env.DB.prepare("INSERT INTO email_logs (recipient, subject, status, error, timestamp) VALUES (?, ?, 'failed', ?, ?)").bind(email, "Verify Your Email Address", String(emailErr), Date.now()).run();
      const errorMessage = emailErr.message || String(emailErr);
      return Response.json({ error: `Registration failed (Email Service): ${errorMessage}` }, { status: 400 });
    }
    try {
      const newUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (newUser) {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        await env.DB.prepare("INSERT INTO auth_logs (user_id, email, action, ip_address, device_hash, timestamp) VALUES (?, ?, 'register', ?, ?, ?)").bind(newUser.id, email, ip, device_hash, Math.floor(Date.now() / 1e3)).run();
      }
    } catch (e) {
      console.error("Auth log failed:", e);
    }
    return Response.json({ success: true, message: "Registration successful. Please check your email to verify your account." });
  } catch (e) {
    console.error("Register Error:", e);
    if (e.message && e.message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "Email already exists" }, { status: 409 });
    }
    return Response.json({ error: "Registration failed: " + e.message }, { status: 500 });
  }
}
__name(handleRegister, "handleRegister");
async function handleVerify(req, env) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });
  const user = await env.DB.prepare("SELECT * FROM users WHERE confirmation_token = ?").bind(token).first();
  if (!user) {
    return new Response("Invalid or expired token.", { status: 400 });
  }
  if (user.confirmation_expires_at && user.confirmation_expires_at < Date.now()) {
    return new Response("Token expired. Please register again.", { status: 400 });
  }
  try {
    const emailHtml = getWelcomeTemplate(user.email);
    await sendEmail(user.email, "Verification Successful - Welcome to MetaBayn!", emailHtml, env);
    await env.DB.prepare("UPDATE users SET status = 'active', confirmation_token = NULL WHERE id = ?").bind(user.id).run();
  } catch (e) {
    console.error("Verification error:", e);
    await env.DB.prepare("UPDATE users SET status = 'active', confirmation_token = NULL WHERE id = ?").bind(user.id).run();
  }
  return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Account Activated</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #121212; color: #fff; }
          .container { text-align: center; padding: 40px; background: #1e1e1e; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
          h1 { color: #4caf50; }
          p { color: #aaa; }
        </style>
      </head>
      <body>
        <div class="container">
           <h1>Account Activated!</h1>
           <p>Your email has been verified successfully.</p>
           <p>You can now return to the MetaBayn app and login.</p>
        </div>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html" } });
}
__name(handleVerify, "handleVerify");
async function handleLogin(req, env) {
  const body = await req.json();
  const { email, password, device_hash } = body;
  if (!device_hash) return Response.json({ error: "Device Hash required" }, { status: 400 });
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return Response.json({ error: "Email not registered" }, { status: 401 });
  if (user.status === "pending") {
    return Response.json({ error: "Please verify your email address before logging in." }, { status: 403 });
  }
  const valid = await verifyPassword(password, user.password);
  if (!valid) return Response.json({ error: "Incorrect password" }, { status: 401 });
  if (user.email === "metabayn@gmail.com") {
    user.is_admin = 1;
  }
  if (user.subscription_active === 1 && user.subscription_expiry) {
    try {
      const expiryTime = new Date(user.subscription_expiry).getTime();
      if (Date.now() > expiryTime) {
        await env.DB.prepare("UPDATE users SET subscription_active = 0 WHERE id = ?").bind(user.id).run();
        user.subscription_active = 0;
      }
    } catch {
    }
  }
  try {
    const existing = await env.DB.prepare("SELECT DISTINCT device_hash FROM auth_logs WHERE user_id = ? AND device_hash IS NOT NULL AND device_hash != ''").bind(String(user.id)).all();
    const rows = Array.isArray(existing) ? existing : existing.results || [];
    const knownDevices = rows.map((r) => r.device_hash).filter((v) => typeof v === "string" && v.length > 0);
    const isKnown = knownDevices.includes(device_hash);
    if (!isKnown && knownDevices.length >= 3) {
      return Response.json({
        error: "This account has already been used on 3 different devices. Please contact support if you need to reset devices."
      }, { status: 403 });
    }
  } catch (e) {
    console.error("Device limit check failed", e);
  }
  let currentDeviceHash = user.device_hash;
  if (!currentDeviceHash) {
    await env.DB.prepare("UPDATE users SET device_hash = ? WHERE id = ?").bind(device_hash, user.id).run();
  } else if (currentDeviceHash !== device_hash) {
  }
  const token = await createToken(user, env.JWT_SECRET);
  try {
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    await env.DB.prepare("INSERT INTO auth_logs (user_id, email, action, ip_address, device_hash, timestamp) VALUES (?, ?, 'login', ?, ?, ?)").bind(user.id, user.email, ip, device_hash || "unknown", Math.floor(Date.now() / 1e3)).run();
  } catch {
  }
  return Response.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      tokens: user.tokens,
      is_admin: user.is_admin || 0,
      subscription_active: user.subscription_active,
      subscription_expiry: user.subscription_expiry
    }
  });
}
__name(handleLogin, "handleLogin");
async function handleGetMe(userId, env) {
  try {
    const user = await env.DB.prepare("SELECT id, email, tokens, is_admin, subscription_active, subscription_expiry FROM users WHERE id = ?").bind(userId).first();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });
    return Response.json(user);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleGetMe, "handleGetMe");

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
    "gpt-4.1": {
      "provider": "openai",
      "input": 3,
      "output": 12,
      "official": true,
      "enabled": true
    },
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
    "o3": {
      "provider": "openai",
      "input": 4,
      "output": 16,
      "official": true,
      "enabled": true
    },
    "o4-mini": {
      "provider": "openai",
      "input": 0.2,
      "output": 0.8,
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
    "gemini-2.5-ultra": {
      "provider": "gemini",
      "input": 2.5,
      "output": 12,
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
    "gemini-2.0-pro-exp-02-05": {
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
    "gemini-2.0-flash-exp": {
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
    "gemini-2.0-flash-lite-preview-02-05": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.3,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-ultra": {
      "provider": "gemini",
      "input": 2.5,
      "output": 12,
      "official": true,
      "enabled": true
    },
    "gemini-3.0-flash-preview": {
      "provider": "gemini",
      "input": 0.35,
      "output": 3,
      "official": false,
      "enabled": true
    },
    "gemini-3.0-pro-preview": {
      "provider": "gemini",
      "input": 1.5,
      "output": 8,
      "official": false,
      "enabled": true
    },
    "gemini-3.0-ultra": {
      "provider": "gemini",
      "input": 4,
      "output": 12,
      "official": true,
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
var RATE_LIMIT_MS = 10;
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
var CONCURRENCY_LIMIT = 100;
function enqueue(task) {
  return new Promise((resolve, reject) => {
    const queueTimeout = setTimeout(() => {
      const index = queue.findIndex((i) => i.resolve === resolve);
      if (index !== -1) {
        queue.splice(index, 1);
        reject(new Error("Queue Timeout: System busy, please retry."));
      }
    }, 1e4);
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
  openai: 10,
  gemini: 10,
  groq: 10
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
  "gemini-2.0-flash-lite-preview-02-05": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
  // Gemini 2.0 Flash
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-exp": { input: 0.1, output: 0.4 },
  // Gemini 1.5 Flash
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-001": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-002": { input: 0.075, output: 0.3 },
  // Gemini Pro
  "gemini-1.5-pro": { input: 3.5, output: 10.5 },
  "gemini-1.5-pro-001": { input: 3.5, output: 10.5 },
  "gemini-1.5-pro-002": { input: 3.5, output: 10.5 },
  "gemini-2.0-pro": { input: 3.5, output: 10.5 },
  "gemini-2.0-pro-exp-02-05": { input: 3.5, output: 10.5 },
  // Gemini 1.0
  "gemini-1.0-pro": { input: 0.5, output: 1.5 },
  // Gemini 2.5 (Hypothetical / Future)
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-ultra": { input: 2.5, output: 12 },
  // Gemini 3.0 (Preview)
  "gemini-3.0-flash-preview": { input: 0.35, output: 3 },
  "gemini-3.0-pro-preview": { input: 1.5, output: 8 },
  "gemini-3.0-ultra": { input: 4, output: 12 },
  // Gemini Ultra (2.0)
  "gemini-2.0-ultra": { input: 2.5, output: 12 },
  // GPT-4o
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // OpenAI Next Gen (Estimates)
  "gpt-4.1": { input: 2.5, output: 10 },
  "gpt-4.1-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1-distilled": { input: 1.1, output: 4.4 },
  "gpt-5.1": { input: 15, output: 60 },
  "gpt-5.1-mini": { input: 3, output: 12 },
  "gpt-5.1-instant": { input: 1.1, output: 4.4 },
  "o1": { input: 15, output: 60 },
  "o3": { input: 20, output: 80 },
  "o4-mini": { input: 0.5, output: 2 },
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
    else if (userModel.includes("flash") && (userModel.includes("1.5") || userModel.includes("001") || userModel.includes("002"))) price = SAFE_PRICES["gemini-1.5-flash"];
    else if (userModel.includes("flash")) price = SAFE_PRICES["gemini-2.0-flash"];
    else if (userModel.includes("mini")) price = SAFE_PRICES["gpt-4o-mini"];
    else if (userModel.includes("ultra")) price = SAFE_PRICES["gemini-2.5-ultra"];
    else if (userModel.includes("pro")) price = SAFE_PRICES["gemini-1.5-pro"];
    else if (userModel.includes("gpt-4o") || userModel.includes("gpt-4.1")) price = SAFE_PRICES["gpt-4o"];
    else if (userModel.includes("gpt-5") || userModel.includes("o1") || userModel.includes("o3")) price = SAFE_PRICES["gpt-5.1"];
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

// src/utils/currency.ts
init_checked_fetch();
init_modules_watch_stub();
var cachedRate = null;
var lastFetch = 0;
var CACHE_TTL = 3600 * 1e3;
var FALLBACK_RATE = 17e3;
async function getExchangeRate(env) {
  const now = Date.now();
  if (cachedRate && now - lastFetch < CACHE_TTL) {
    return cachedRate;
  }
  try {
    const resp = await fetch("https://open.er-api.com/v6/latest/USD");
    if (resp.ok) {
      const data = await resp.json();
      const rate = data.rates?.IDR;
      if (rate && typeof rate === "number") {
        cachedRate = rate;
        lastFetch = now;
        console.log(`Updated Exchange Rate: 1 USD = ${rate} IDR`);
        return rate;
      }
    }
  } catch (e) {
    console.error("Failed to fetch exchange rate:", e);
  }
  return cachedRate || FALLBACK_RATE;
}
__name(getExchangeRate, "getExchangeRate");

// src/utils/tokenTopup.ts
async function getLiveUsdRate(env) {
  if (!env) throw new Error("Env required to read usd_idr_rate");
  let auto = false;
  try {
    const autoRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_auto_sync'").first();
    if (autoRow && autoRow.value) {
      const v = String(autoRow.value);
      try {
        auto = JSON.parse(v) === true;
      } catch {
        auto = v === "1" || v === "true";
      }
    }
  } catch {
  }
  if (auto) {
    try {
      const live = await getExchangeRate(env);
      if (live && typeof live === "number" && live > 0) {
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind("usd_idr_rate", String(live)).run();
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind("usd_idr_rate_last_update", String(Date.now())).run();
        return live;
      }
    } catch {
    }
  }
  const config = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
  const rate = Number(config?.value);
  if (!rate || isNaN(rate) || rate <= 0) {
    try {
      const live = await getExchangeRate(env);
      if (live && typeof live === "number" && live > 0) return live;
    } catch {
    }
    throw new Error("USD/IDR rate not configured in Admin Settings (usd_idr_rate)");
  }
  return rate;
}
__name(getLiveUsdRate, "getLiveUsdRate");
function getTokenFromUSD(amountUsd, rate) {
  if (typeof rate !== "number" || rate <= 0) {
    throw new Error("USD/IDR rate missing. Set 'usd_idr_rate' in Admin Settings.");
  }
  const tokensBase = Math.floor(amountUsd * rate);
  const totalTokens = tokensBase;
  return {
    amount: amountUsd,
    currency: "USD",
    tokensBase,
    bonusPercent: 0,
    tokensBonus: 0,
    totalTokens
  };
}
__name(getTokenFromUSD, "getTokenFromUSD");

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
    const fallbackChain = [userModel];
    console.log(`[AI] Fallback chain for ${userModel}:`, fallbackChain);
    const aiTask = /* @__PURE__ */ __name(async () => {
      let lastError = null;
      const startTime = Date.now();
      const MAX_DURATION = 1e4;
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
          const selectionMode = !!body.selectionMode;
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
            const timeoutId = setTimeout(() => controller.abort(), 9e3);
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
            const timeoutId = setTimeout(() => controller.abort(), 9e3);
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
    const deductRes = await env.DB.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens").bind(deductAmount, userId, deductAmount).first();
    if (!deductRes || typeof deductRes.tokens !== "number") {
      const currentBal = await env.DB.prepare("SELECT tokens FROM users WHERE id = ?").bind(userId).first();
      return Response.json({
        error: "Insufficient balance. Process cancelled to prevent negative balance.",
        required_tokens: Math.ceil(deductAmount),
        user_balance: currentBal?.tokens || 0
      }, { status: 402 });
    }
    await recordTokenUsage(userId, userModel, usedModel, inputTokens, outputTokens, costFinal, env);
    const updatedUserTokens = deductRes.tokens;
    return Response.json({
      status: "success",
      model_chosen: userModel,
      model_used: usedModel,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost: costFinal,
      user_balance_after: updatedUserTokens,
      result: content,
      // Keep 'result' for backward compatibility or change to 'metadata' if desired, but 'result' is standard here
      metadata: {
        provider: body.useGroq ? "groq" : usedModel.startsWith("gpt") ? "openai" : "gemini",
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
  await env.DB.prepare("UPDATE users SET tokens = (CASE WHEN tokens < 0 THEN 0 ELSE tokens END) + ? WHERE id = ?").bind(amount, userId).run();
  return Response.json({ success: true, message: `Added ${amount} tokens` });
}
__name(handleTopup, "handleTopup");

// src/index.ts
init_admin();

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
async function handleListVouchers(_req, env) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString();
    const oldVouchers = await env.DB.prepare("SELECT code FROM vouchers WHERE expires_at IS NOT NULL AND expires_at < ?").bind(sevenDaysAgo).all();
    if (oldVouchers.results && oldVouchers.results.length > 0) {
      const codes = oldVouchers.results.map((v) => v.code);
      const placeholders = codes.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM voucher_claims WHERE voucher_code IN (${placeholders})`).bind(...codes).run();
      await env.DB.prepare(`DELETE FROM vouchers WHERE code IN (${placeholders})`).bind(...codes).run();
      console.log(`Cleaned up ${codes.length} expired vouchers`);
    }
  } catch (e) {
    console.error("Auto-cleanup error:", e);
  }
  const vouchers = await env.DB.prepare("SELECT * FROM vouchers ORDER BY created_at DESC").all();
  return Response.json(vouchers.results);
}
__name(handleListVouchers, "handleListVouchers");
async function handleExtendVoucher(req, env) {
  try {
    const body = await req.json();
    let { code, days } = body;
    if (!code || !days) {
      return Response.json({ error: "Missing code or days" }, { status: 400 });
    }
    code = code.toUpperCase().trim();
    const daysInt = parseInt(days);
    if (isNaN(daysInt) || daysInt < 1) {
      return Response.json({ error: "Invalid days value" }, { status: 400 });
    }
    const voucher = await env.DB.prepare("SELECT * FROM vouchers WHERE code = ?").bind(code).first();
    if (!voucher) {
      return Response.json({ error: "Voucher not found" }, { status: 404 });
    }
    const now = /* @__PURE__ */ new Date();
    let baseDate = now;
    if (voucher.expires_at) {
      const currentExpiry = new Date(voucher.expires_at);
      if (currentExpiry > now) {
        baseDate = currentExpiry;
      }
    }
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + daysInt);
    const newExpiryIso = newExpiry.toISOString();
    await env.DB.prepare("UPDATE vouchers SET expires_at = ? WHERE code = ?").bind(newExpiryIso, code).run();
    return Response.json({ success: true, message: `Voucher extended until ${newExpiryIso}`, new_expiry: newExpiryIso });
  } catch (e) {
    return Response.json({ error: "Extend Error: " + e.message }, { status: 500 });
  }
}
__name(handleExtendVoucher, "handleExtendVoucher");
async function handleCreateVoucher(req, env) {
  const body = await req.json();
  const { code, amount, max_usage, expires_at, allowed_emails, type, duration_days } = body;
  if (!code) {
    return Response.json({ error: "Missing voucher code" }, { status: 400 });
  }
  const voucherType = type || "token";
  if (voucherType === "token" && !amount) {
    return Response.json({ error: "Amount is required for token vouchers" }, { status: 400 });
  }
  if (voucherType === "subscription" && !duration_days) {
    return Response.json({ error: "Duration is required for subscription vouchers" }, { status: 400 });
  }
  try {
    await env.DB.prepare(
      "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, allowed_emails, type, duration_days, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)"
    ).bind(
      code.toUpperCase(),
      amount || 0,
      max_usage || 0,
      expires_at || null,
      allowed_emails || null,
      voucherType,
      duration_days || 0,
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    return Response.json({ success: true, message: "Voucher created" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(handleCreateVoucher, "handleCreateVoucher");
async function handleBulkCreateVouchers(req, env) {
  const body = await req.json();
  const { amount, quantity, max_usage, expires_at, type, duration_days } = body;
  const voucherType = type || "token";
  if (voucherType === "token" && (!amount || amount < 1)) {
    return Response.json({ error: "Invalid amount for token vouchers" }, { status: 400 });
  }
  if (voucherType === "subscription" && (!duration_days || duration_days < 1)) {
    return Response.json({ error: "Invalid duration for subscription vouchers" }, { status: 400 });
  }
  if (!quantity || quantity < 1) {
    return Response.json({ error: "Invalid quantity" }, { status: 400 });
  }
  const generateCode2 = /* @__PURE__ */ __name(() => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    const randomValues = new Uint8Array(6);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 6; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    return result;
  }, "generateCode");
  const generatedCodes = [];
  const stmts = [];
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const safeQuantity = Math.min(quantity, 500);
  for (let i = 0; i < safeQuantity; i++) {
    const code = generateCode2();
    generatedCodes.push(code);
    stmts.push(
      env.DB.prepare(
        "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)"
      ).bind(
        code,
        amount || 0,
        max_usage || 1,
        expires_at || null,
        voucherType,
        duration_days || 0,
        createdAt
      )
    );
  }
  try {
    const BATCH_SIZE = 50;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const batch = stmts.slice(i, i + BATCH_SIZE);
      await env.DB.batch(batch);
    }
    return Response.json({
      success: true,
      message: `${safeQuantity} vouchers created successfully`,
      codes: generatedCodes
    });
  } catch (e) {
    return Response.json({ error: "Failed to create vouchers (Code collision or DB error). Try again." + e.message }, { status: 500 });
  }
}
__name(handleBulkCreateVouchers, "handleBulkCreateVouchers");
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
    const stmts = [];
    let successMessage = "";
    let responseData = {};
    if (voucher.type === "subscription") {
      let durationDays = Number(voucher.duration_days);
      if (isNaN(durationDays) || durationDays < 1) durationDays = 30;
      const currentUser = await env.DB.prepare("SELECT subscription_expiry FROM users WHERE id = ?").bind(userId).first();
      let newExpiryDate = /* @__PURE__ */ new Date();
      if (currentUser && currentUser.subscription_expiry) {
        const currentExpiry = new Date(currentUser.subscription_expiry);
        if (currentExpiry > /* @__PURE__ */ new Date()) {
          newExpiryDate = currentExpiry;
        }
      }
      newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
      const newExpiryIso = newExpiryDate.toISOString();
      stmts.push(
        env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?").bind(newExpiryIso, userId)
      );
      successMessage = `Subscription activated! Valid until ${newExpiryDate.toLocaleDateString()}`;
      responseData = { subscription_active: true, subscription_expiry: newExpiryIso };
    } else {
      stmts.push(
        env.DB.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").bind(voucher.amount, userId)
      );
      successMessage = `Voucher redeemed! ${voucher.amount} tokens added.`;
      responseData = { amount_added: voucher.amount };
    }
    stmts.push(
      env.DB.prepare("INSERT INTO voucher_claims (user_id, voucher_code, device_hash) VALUES (?, ?, ?)").bind(userId, voucherCode, deviceHash),
      env.DB.prepare("UPDATE vouchers SET current_usage = current_usage + 1 WHERE code = ?").bind(voucherCode)
    );
    await env.DB.batch(stmts);
    if (maxUsage > 0 && currentUsage + 1 >= maxUsage) {
      await env.DB.prepare("DELETE FROM voucher_claims WHERE voucher_code = ?").bind(voucherCode).run();
      await env.DB.prepare("DELETE FROM vouchers WHERE code = ?").bind(voucherCode).run();
      console.log(`Voucher ${voucherCode} auto-deleted (Max usage reached)`);
    }
    return Response.json({
      success: true,
      message: successMessage,
      ...responseData
    });
  } catch (e) {
    console.error("Voucher Redeem Error:", e);
    return Response.json({ error: "Failed to redeem voucher. Please try again." }, { status: 500 });
  }
}
__name(handleRedeemVoucher, "handleRedeemVoucher");
async function handleLynkIdWebhook(req, env) {
  const url = new URL(req.url);
  const secretQuery = url.searchParams.get("secret");
  const secretHeader = req.headers.get("x-webhook-secret");
  const receivedSecret = secretHeader || secretQuery;
  if (!env.LYNKID_WEBHOOK_SECRET || receivedSecret !== env.LYNKID_WEBHOOK_SECRET) {
    return Response.json({ success: false, error: "Invalid webhook secret" }, { status: 401 });
  }
  let body;
  try {
    body = await req.json();
    try {
      await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").bind("last_lynkid_webhook", JSON.stringify(body)).run();
    } catch (logErr) {
      console.error("Failed to log webhook payload", logErr);
    }
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const event = body.event;
  const data = body.data;
  const messageData = data?.message_data;
  if (!event || event !== "payment.received") {
    return Response.json({ success: true, message: `Event '${event || "unknown"}' received but ignored` });
  }
  const email = messageData?.customer?.email;
  if (!email || typeof email !== "string") {
    return Response.json({ success: false, error: "Missing email in customer data" }, { status: 400 });
  }
  const items = messageData?.items || [];
  if (items.length === 0) {
    return Response.json({ success: false, error: "No items in transaction" }, { status: 400 });
  }
  const results = [];
  let totalTokensAdded = 0;
  let totalAmountRp = 0;
  for (const item of items) {
    const title = item.title || "";
    const price = Number(item.price) || 0;
    totalAmountRp += price;
    let voucherType = "token";
    let tokenAmount = 0;
    let subscriptionDuration = 0;
    let emailSubject = "Your Metabayn Studio Voucher";
    let isWelcomeBonus = false;
    let matched = false;
    const titleLower = title.toLowerCase();
    const normalizeTitle = /* @__PURE__ */ __name((s) => s.toLowerCase().replace(/–/g, "-").replace(/\s+/g, " ").trim(), "normalizeTitle");
    const TITLE_MAP = {
      [normalizeTitle("Metabayn \u2013 Smart Metadata Generator App for Images & Videos")]: { type: "license" },
      [normalizeTitle("Metabayn Token Voucher 20.000 \u2013 Credit Top-Up for Metadata Processing")]: { type: "token", amount: 2e4 },
      [normalizeTitle("Metabayn Token Voucher 50.000 \u2013 Credit Top-Up for Metadata Processing")]: { type: "token", amount: 5e4 },
      [normalizeTitle("Metabayn Token Voucher 100.000 \u2013 Credit Top-Up for Metadata Processing")]: { type: "token", amount: 1e5 },
      [normalizeTitle("Metabayn Token Voucher 150.000 \u2013 Credit Top-Up for Metadata Processing")]: { type: "token", amount: 15e4 },
      [normalizeTitle("Metabayn API Key Mode Subscription - 30 Days")]: { type: "subscription", duration: 30 },
      [normalizeTitle("Metabayn API Key Mode Subscription - 3 Months")]: { type: "subscription", duration: 90 },
      [normalizeTitle("Metabayn API Key Mode Subscription - 6 Months")]: { type: "subscription", duration: 180 },
      [normalizeTitle("Metabayn API Key Mode Subscription - 1 Year")]: { type: "subscription", duration: 365 }
    };
    const mapped = TITLE_MAP[normalizeTitle(title)];
    if (mapped) {
      matched = true;
      if (mapped.type === "license") {
        isWelcomeBonus = true;
        let welcomeAmountThreshold = 48900;
        try {
          const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
          if (rateCfg && rateCfg.value) {
            const rate = Number(rateCfg.value);
            if (!isNaN(rate) && rate > 0) welcomeAmountThreshold = Math.round(3 * rate);
          }
        } catch {
        }
        tokenAmount = welcomeAmountThreshold;
        emailSubject = "Your Metabayn Studio Welcome Vouchers";
      } else if (mapped.type === "token") {
        voucherType = "token";
        tokenAmount = mapped.amount || 0;
        emailSubject = `Your ${title}`;
      } else {
        voucherType = "subscription";
        subscriptionDuration = mapped.duration || 30;
        emailSubject = `Your ${title}`;
      }
    } else if (titleLower.includes("subscription") || titleLower.includes("langganan")) {
      voucherType = "subscription";
      matched = true;
      if (titleLower.includes("1 year") || titleLower.includes("tahun") || titleLower.includes("12 month")) {
        subscriptionDuration = 365;
        emailSubject = "Your 1 Year Subscription Voucher";
      } else if (titleLower.includes("3 month") || titleLower.includes("3 bulan")) {
        subscriptionDuration = 90;
        emailSubject = "Your 3 Months Subscription Voucher";
      } else {
        subscriptionDuration = 30;
        emailSubject = "Your 1 Month Subscription Voucher";
      }
    } else if (titleLower.includes("token")) {
      voucherType = "token";
      matched = true;
      emailSubject = `Your ${title}`;
      if (price >= 15e3 && price <= 29e3) tokenAmount = 2e4;
      else if (price >= 4e4 && price <= 7e4) tokenAmount = 55e3;
      else if (price >= 8e4 && price <= 13e4) tokenAmount = 12e4;
      else tokenAmount = price;
    } else if (normalizeTitle(title) === normalizeTitle("Metabayn \u2013 Smart Metadata Generator App for Images & Videos")) {
      isWelcomeBonus = true;
      matched = true;
      let welcomeAmountThreshold = 48900;
      try {
        const rateCfg = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_rate'").first();
        if (rateCfg && rateCfg.value) {
          const rate = Number(rateCfg.value);
          if (!isNaN(rate) && rate > 0) welcomeAmountThreshold = Math.round(3 * rate);
        }
      } catch {
      }
      tokenAmount = welcomeAmountThreshold;
      emailSubject = "Your Metabayn Studio Welcome Vouchers";
    } else {
      tokenAmount = price;
      emailSubject = "Your Token Voucher";
    }
    if (tokenAmount > 0 || subscriptionDuration > 0) {
      if (voucherType === "token") {
        totalTokensAdded += tokenAmount;
      }
      const expiresAt = /* @__PURE__ */ new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      let emailHtml = "";
      if (isWelcomeBonus) {
        const tokenCode = generateCode();
        const subscriptionCode = generateCode();
        await env.DB.prepare(
          "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
        ).bind(
          tokenCode,
          tokenAmount,
          expiresAt.toISOString(),
          "token",
          0,
          (/* @__PURE__ */ new Date()).toISOString()
        ).run();
        await env.DB.prepare(
          "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
        ).bind(
          subscriptionCode,
          0,
          expiresAt.toISOString(),
          "subscription",
          30,
          (/* @__PURE__ */ new Date()).toISOString()
        ).run();
        emailSubject = "Your Metabayn Studio Welcome Vouchers";
        emailHtml = getWelcomeDualVoucherTemplate(email, tokenCode, tokenAmount, subscriptionCode, 30);
        await sendEmail(email, emailSubject, emailHtml, env);
        results.push({ code: tokenCode, type: "token", amount: tokenAmount });
        results.push({ code: subscriptionCode, type: "subscription", amount: 30 });
      } else {
        const code = generateCode();
        await env.DB.prepare(
          "INSERT INTO vouchers (code, amount, max_usage, current_usage, expires_at, type, duration_days, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?)"
        ).bind(
          code,
          tokenAmount,
          expiresAt.toISOString(),
          voucherType,
          subscriptionDuration,
          (/* @__PURE__ */ new Date()).toISOString()
        ).run();
        emailHtml = getPurchaseVoucherTemplate(email, code, voucherType, voucherType === "subscription" ? subscriptionDuration : tokenAmount);
        await sendEmail(email, emailSubject, emailHtml, env);
        results.push({ code, type: voucherType, amount: tokenAmount || subscriptionDuration });
      }
    }
  }
  try {
    const orderId = data?.order_id || body.event_id || `lynkid-${Date.now()}`;
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    const userId = user ? String(user.id) : `email:${email}`;
    await env.DB.prepare(`
          INSERT INTO topup_transactions 
          (user_id, amount_rp, tokens_added, method, status, payment_ref, created_at) 
          VALUES (?, ?, ?, 'lynkid', 'paid', ?, ?)
      `).bind(
      userId,
      totalAmountRp,
      totalTokensAdded,
      orderId,
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    console.log(`Logged Lynk.id transaction for ${email} (User: ${userId}, Amount: ${totalAmountRp})`);
  } catch (txErr) {
    console.error("Failed to log Lynk.id transaction:", txErr);
  }
  return Response.json({ success: true, generated: results });
}
__name(handleLynkIdWebhook, "handleLynkIdWebhook");
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
__name(generateCode, "generateCode");

// src/handlers/adminTopup.ts
init_checked_fetch();
init_modules_watch_stub();

// src/utils/userToken.ts
init_checked_fetch();
init_modules_watch_stub();
async function addUserTokens(userId, tokens, env) {
  const res = await env.DB.prepare("UPDATE users SET tokens = (CASE WHEN tokens < 0 THEN 0 ELSE tokens END) + ? WHERE id = ? RETURNING tokens").bind(tokens, userId).first();
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
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (CASE 
          WHEN u.email IS NOT NULL THEN u.email 
          WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
          ELSE NULL 
        END LIKE ? OR t.user_id = ? OR ? IS NULL) 
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
    SELECT t.*, 
      CASE 
        WHEN u.email IS NOT NULL THEN u.email 
        WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
        ELSE NULL 
      END as user_email, 
      u.tokens as user_balance
    FROM topup_transactions t 
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
    WHERE 1=1 
      AND (t.method = ? OR ? IS NULL) 
      AND (t.status = ? OR ? IS NULL) 
      AND (CASE 
          WHEN u.email IS NOT NULL THEN u.email 
          WHEN t.user_id LIKE 'email:%' THEN SUBSTR(t.user_id, 7) 
          ELSE NULL 
        END LIKE ? OR t.user_id = ? OR ? IS NULL) 
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
    LEFT JOIN users u ON u.id = CAST(t.user_id AS INTEGER)
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
    const body = await request.json();
    const amount = body.amount;
    let userId = String(body.userId);
    if (!isNaN(Number(userId)) && userId.includes(".")) {
      userId = userId.split(".")[0];
    }
    const type = body.type === "subscription" ? "subscription" : "token";
    const tokensPack = Number(body.tokensPack || 0) || 0;
    if (!amount || !userId) {
      return Response.json({ error: "Missing amount or userId" }, { status: 400 });
    }
    const rateUsd = await getLiveUsdRate(env);
    const tokenCalc = type === "token" ? tokensPack > 0 ? { totalTokens: tokensPack } : getTokenFromUSD(amount, rateUsd) : { totalTokens: 0 };
    const method = type === "subscription" ? "paypal_subscription" : "paypal";
    const insertRes = await env.DB.prepare(
      "INSERT INTO topup_transactions (user_id, amount_usd, tokens_added, method, status) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(userId, amount, tokenCalc.totalTokens, method, "pending").first();
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
          description: type === "subscription" ? "Metabayn API Subscription 30 Days" : `TopUp ${tokenCalc.totalTokens} Tokens (Metabayn)`
        }],
        application_context: {
          return_url: "https://metabayn-backend.metabayn.workers.dev/payment/success",
          cancel_url: "https://metabayn-backend.metabayn.workers.dev/payment/cancel",
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
      type,
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
      if (transaction.method === "paypal_subscription") {
        const user = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?").bind(transaction.user_id).first();
        return Response.json({
          status: "paid",
          message: "Already paid",
          subscription_active: user?.subscription_active === 1,
          subscription_expiry: user?.subscription_expiry || null
        });
      }
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
    const isSubscription = transaction.method === "paypal_subscription";
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
        if (isSubscription) {
          let durationDays = 30;
          const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?").bind(transaction.user_id).first();
          let newExpiryDate = /* @__PURE__ */ new Date();
          if (currentUser && currentUser.subscription_expiry) {
            const currentExpiry = new Date(currentUser.subscription_expiry);
            if (currentExpiry > /* @__PURE__ */ new Date()) {
              newExpiryDate = currentExpiry;
            }
          }
          newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
          const newExpiryIso = newExpiryDate.toISOString();
          await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?").bind(newExpiryIso, transaction.user_id).run();
          return Response.json({
            status: "paid",
            paypal_status: "COMPLETED",
            subscription_active: true,
            subscription_expiry: newExpiryIso
          });
        }
        await addUserTokens(transaction.user_id, transaction.tokens_added, env);
        return Response.json({ status: "paid", paypal_status: "COMPLETED" });
      }
    } else if (paypalStatus === "COMPLETED") {
      await env.DB.prepare("UPDATE topup_transactions SET status = 'paid' WHERE id = ?").bind(transactionId).run();
      if (isSubscription) {
        let durationDays = 30;
        const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry FROM users WHERE id = ?").bind(transaction.user_id).first();
        let newExpiryDate = /* @__PURE__ */ new Date();
        if (currentUser && currentUser.subscription_expiry) {
          const currentExpiry = new Date(currentUser.subscription_expiry);
          if (currentExpiry > /* @__PURE__ */ new Date()) {
            newExpiryDate = currentExpiry;
          }
        }
        newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
        const newExpiryIso = newExpiryDate.toISOString();
        await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?").bind(newExpiryIso, transaction.user_id).run();
        return Response.json({
          status: "paid",
          paypal_status: "COMPLETED",
          subscription_active: true,
          subscription_expiry: newExpiryIso
        });
      }
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
        if (transaction.method === "paypal_subscription") {
          let durationDays = 30;
          const currentUser = await env.DB.prepare("SELECT subscription_active, subscription_expiry, email FROM users WHERE id = ?").bind(transaction.user_id).first();
          let newExpiryDate = /* @__PURE__ */ new Date();
          if (currentUser && currentUser.subscription_expiry) {
            const currentExpiry = new Date(currentUser.subscription_expiry);
            if (currentExpiry > /* @__PURE__ */ new Date()) {
              newExpiryDate = currentExpiry;
            }
          }
          newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);
          const newExpiryIso = newExpiryDate.toISOString();
          await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?").bind(newExpiryIso, transaction.user_id).run();
          return Response.json({
            status: "success",
            method: "paypal_subscription",
            amount_usd: amountPaid,
            subscription_active: true,
            subscription_expiry: newExpiryIso
          });
        }
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
async function paymentSuccessPage(_req, _env) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#4caf50;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}<\/script></head><body><div class="box"><h1>Payment Successful</h1><p>You can close this tab and return to the app.</p><p>If your balance has not updated yet, the app will check automatically.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
__name(paymentSuccessPage, "paymentSuccessPage");
async function paymentCancelPage(_req, _env) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Cancelled</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#121212;color:#fff}.box{background:#1e1e1e;padding:32px;border-radius:12px;text-align:center;max-width:520px}h1{color:#ff7043;margin:0 0 8px}p{color:#aaa;margin:6px 0}.btn{margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600}.link{color:#4fc3f7;text-decoration:none}</style><script>function returnToApp(){try{window.location.href='metabayn-studio://return'}catch(e){}setTimeout(function(){window.close()},800)}<\/script></head><body><div class="box"><h1>Payment Cancelled</h1><p>The transaction was not completed. You can close this tab and return to the app.</p><p>If you encounter issues with your payment, please contact the admin via WhatsApp at <a class="link" href="https://wa.me/628996701661" target="_blank" rel="noopener">+62 899 6701 661</a>.</p><button class="btn" onclick="returnToApp()">Return to App</button><p style="margin-top:10px"><a class="link" href="metabayn-studio://return">Open Metabayn Studio</a></p></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
__name(paymentCancelPage, "paymentCancelPage");

// src/index.ts
init_crypto();
var src_default = {
  async scheduled(_event, env, _ctx) {
    try {
      const autoRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'usd_idr_auto_sync'").first();
      let auto = false;
      if (autoRow && autoRow.value) {
        try {
          auto = JSON.parse(String(autoRow.value)) === true;
        } catch {
          auto = String(autoRow.value) === "1" || String(autoRow.value) === "true";
        }
      }
      if (!auto) return;
      const live = await getExchangeRate(env);
      if (live && typeof live === "number" && live > 0) {
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind("usd_idr_rate", String(live)).run();
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)\n").bind("usd_idr_rate_last_update", String(Date.now())).run();
      }
    } catch (e) {
      console.log("Scheduled rate sync failed:", e);
    }
  },
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
      if (path === "/auth/verify" && method === "GET") return await handleVerify(request, env);
      if (path === "/integration/lynkid/webhook" && method === "POST") return await wrapCors(handleLynkIdWebhook(request, env));
      if (path === "/payment/success" && method === "GET") return await paymentSuccessPage(request, env);
      if (path === "/payment/cancel" && method === "GET") return await paymentCancelPage(request, env);
      if (path === "/payment/paypal/webhook" && method === "POST") return await wrapCors(handlePaypalWebhook(request, env));
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
        if (path === "/admin/model-prices/sync" && method === "POST") {
          const { handleSyncModelPrices: handleSyncModelPrices2 } = await Promise.resolve().then(() => (init_admin(), admin_exports));
          return await wrapCors(handleSyncModelPrices2(request, env));
        }
        if (path === "/admin/model-prices/sync-live" && method === "POST") {
          const { handleSyncLiveModelPrices: handleSyncLiveModelPrices2 } = await Promise.resolve().then(() => (init_admin(), admin_exports));
          return await wrapCors(handleSyncLiveModelPrices2(request, env));
        }
        if (path.startsWith("/admin/model-prices")) return await wrapCors(handleAdminModelPrices(request, env));
        if (path === "/admin/auth-logs") {
          const { handleAdminAuthLogs: handleAdminAuthLogs2 } = await Promise.resolve().then(() => (init_admin(), admin_exports));
          return await wrapCors(handleAdminAuthLogs2(request, env));
        }
        if (path === "/admin/config") return await wrapCors(handleAdminConfig(request, env));
        if (path === "/admin/users") return await wrapCors(handleListUsers(request, env));
        if (path === "/admin/users/list") return await wrapCors(handleListUsers(request, env));
        if (path === "/admin/users/subscription") return await wrapCors(handleUpdateSubscription(request, env));
        if (path === "/admin/users/reset-password") return await wrapCors(handleResetPassword(request, env));
        if (path === "/admin/users/delete") return await wrapCors(handleDeleteUser(request, env));
        if (path.startsWith("/admin/users/") && path.endsWith("/usage") && method === "GET") return await wrapCors(handleUserUsage(request, env));
        if (path === "/admin/users/export-usage" && method === "GET") return await wrapCors(handleExportUsageCsv(request, env));
        if (path === "/admin/vouchers" && method === "GET") return await wrapCors(handleListVouchers(request, env));
        if (path === "/admin/vouchers/create" && method === "POST") return await wrapCors(handleCreateVoucher(request, env));
        if (path === "/admin/vouchers/bulk-create" && method === "POST") return await wrapCors(handleBulkCreateVouchers(request, env));
        if (path === "/admin/vouchers/extend" && method === "POST") return await wrapCors(handleExtendVoucher(request, env));
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
      if (path === "/user/me" && method === "GET") return await wrapCors(handleGetMe(userId, env));
      if ((path === "/token/balance" || path === "/user/balance") && method === "GET") return await wrapCors(handleBalance(userId, env));
      if (path === "/token/topup" && method === "POST") return await wrapCors(handleTopup(request, userId, env));
      if (path === "/history/list" && method === "GET") return await wrapCors(handleHistory(userId, env));
      if (path === "/ai/generate" && method === "POST") return await wrapCors(handleGenerate(request, userId, env));
      if (path === "/voucher/redeem" && method === "POST") return await wrapCors(handleRedeemVoucher(request, env));
      if (path === "/payment/paypal/create" && method === "POST") return await wrapCors(createPaypalPayment(request, env));
      if (path === "/payment/paypal/check" && method === "POST") return await wrapCors(checkPaypalStatus(request, env));
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

// .wrangler/tmp/bundle-scSQKP/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-scSQKP/middleware-loader.entry.ts
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
