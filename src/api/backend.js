import { invoke } from '@tauri-apps/api/tauri';
// Default fallback URL
const DEFAULT_API_URL = "https://metabayn-backend.metabayn.workers.dev";
// Helper to get the dynamic API URL from settings
export async function getApiUrl() {
    try {
        const s = await invoke('get_settings');
        // Remove trailing slash if present
        let url = s.server_url || DEFAULT_API_URL;
        // Fix for users with old default settings (localhost)
        if (url.includes("localhost:8787")) {
            url = DEFAULT_API_URL;
        }
        return url.replace(/\/$/, "");
    }
    catch (e) {
        console.error("Failed to get settings, using default URL", e);
        return DEFAULT_API_URL;
    }
}
// @deprecated Use getApiUrl() instead. Kept for backward compatibility if needed, but value is static.
export const API_URL = DEFAULT_API_URL;
// Helper untuk mendapatkan HWID dari Rust
export async function getMachineHash() {
    try {
        return await invoke('get_machine_hash');
    }
    catch (e) {
        console.error("Failed to get machine hash", e);
        return "unknown-device-hash";
    }
}
export async function apiRegister(email, password) {
    const baseUrl = await getApiUrl();
    const deviceHash = await getMachineHash();
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, device_hash: deviceHash })
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || "Registration failed");
    return data;
}
export async function apiLogin(email, password) {
    const deviceHash = await getMachineHash();
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, device_hash: deviceHash })
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || "Login failed");
    return data;
}
export async function apiGenerateAI(token, model, prompt) {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/ai/generate`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ model, prompt })
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || "AI Generation failed");
    return data;
}
export async function apiGetBalance(token) {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/token/balance`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || "Failed to fetch balance");
    return data;
}
export async function apiCreatePaypal(token, amount, type = 'token', userId, tokensPack) {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/payment/paypal/create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ amount, userId, type, tokensPack })
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        }
        catch {
            // Tangani respons non-JSON (misalnya "Not Found") dengan pesan yang lebih jelas
            if (!res.ok) {
                throw new Error(`Server error (${res.status}): ${text.substring(0, 120)}`);
            }
            throw new Error(`Invalid server response: ${text.substring(0, 120)}`);
        }
    }
    if (!res.ok)
        throw new Error((data && data.error) || `Payment creation failed (${res.status})`);
    return data;
}
export async function apiCheckPaypalStatus(token, transactionId) {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/payment/paypal/check`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ transactionId })
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        }
        catch {
            if (!res.ok) {
                throw new Error(`Server error (${res.status}): ${text.substring(0, 120)}`);
            }
            throw new Error(`Invalid server response: ${text.substring(0, 120)}`);
        }
    }
    if (!res.ok)
        throw new Error((data && data.error) || `Status check failed (${res.status})`);
    return data;
}
export async function apiRedeemVoucher(token, code, userId, deviceHash) {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/voucher/redeem`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ code, userId, deviceHash })
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || "Redeem failed");
    return data;
}
// --- Auth Helpers ---
export function isValidToken(token) {
    if (!token)
        return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return false;
        const payload = JSON.parse(atob(parts[1]));
        if (!payload.exp)
            return true; // No expiry? Assume valid or handle accordingly
        const exp = payload.exp * 1000; // Convert to ms
        return Date.now() < exp;
    }
    catch {
        return false;
    }
}
export function saveTokenLocal(token) {
    try {
        localStorage.setItem('auth_token', token);
    }
    catch { }
}
export function getTokenLocal() {
    try {
        return localStorage.getItem('auth_token');
    }
    catch {
        return null;
    }
}
export function clearTokenLocal() {
    try {
        localStorage.removeItem('auth_token');
    }
    catch { }
}
