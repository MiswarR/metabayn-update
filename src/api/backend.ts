import { invoke } from '@tauri-apps/api/tauri';

// Default fallback URL
const DEFAULT_API_URL = "https://metabayn-backend.metabayn.workers.dev";

// Helper to get the dynamic API URL from settings
export async function getApiUrl(): Promise<string> {
    try {
        const s = await invoke<any>('get_settings');
        // Remove trailing slash if present
        let url = s.server_url || DEFAULT_API_URL;
        
        // Fix for users with old default settings (localhost)
        if (url.includes("localhost:8787")) {
            url = DEFAULT_API_URL;
        }

        return url.replace(/\/$/, "");
    } catch (e) {
        console.error("Failed to get settings, using default URL", e);
        return DEFAULT_API_URL;
    }
}

// @deprecated Use getApiUrl() instead. Kept for backward compatibility if needed, but value is static.
export const API_URL = DEFAULT_API_URL;

export interface User {
  id: number;
  email: string;
  tokens: number;
}

export interface AuthResponse {
  token: string;
  user: User;
  error?: string;
}

export interface AIResponse {
  result: string;
  usage: { input: number; output: number };
  cost: number;
  remaining: number;
  error?: string;
}

// Helper untuk mendapatkan HWID dari Rust
export async function getMachineHash(): Promise<string> {
  try {
    return await invoke<string>('get_machine_hash');
  } catch (e) {
    console.error("Failed to get machine hash", e);
    return "unknown-device-hash";
  }
}

export async function apiRegister(email: string, password: string): Promise<any> {
  const baseUrl = await getApiUrl();
  const deviceHash = await getMachineHash();
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  return data;
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  const deviceHash = await getMachineHash();
  const baseUrl = await getApiUrl();
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, device_hash: deviceHash })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data;
}

export async function apiGenerateAI(token: string, model: string, prompt: string): Promise<any> {
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
  if (!res.ok) throw new Error(data.error || "AI Generation failed");
  return data;
}

export async function apiGetBalance(token: string): Promise<any> {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/token/balance`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch balance");
    return data;
}

export async function apiCreatePaypal(token: string, amount: number, type: 'token' | 'subscription' = 'token', userId?: string, tokensPack?: number): Promise<any> {
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
	let data: any = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			// Tangani respons non-JSON (misalnya "Not Found") dengan pesan yang lebih jelas
			if (!res.ok) {
				throw new Error(`Server error (${res.status}): ${text.substring(0, 120)}`);
			}
			throw new Error(`Invalid server response: ${text.substring(0, 120)}`);
		}
	}

	if (!res.ok) throw new Error((data && data.error) || `Payment creation failed (${res.status})`);
	return data;
}

export async function apiCheckPaypalStatus(token: string, transactionId: string | number): Promise<any> {
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
	let data: any = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			if (!res.ok) {
				throw new Error(`Server error (${res.status}): ${text.substring(0, 120)}`);
			}
			throw new Error(`Invalid server response: ${text.substring(0, 120)}`);
		}
	}

	if (!res.ok) throw new Error((data && data.error) || `Status check failed (${res.status})`);
	return data;
}
  
export async function apiRedeemVoucher(token: string, code: string, userId: string, deviceHash: string): Promise<any> {
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
    if (!res.ok) throw new Error(data.error || "Redeem failed");
    return data;
}

// --- Auth Helpers ---

export function isValidToken(token: string): boolean {
    if (!token) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1]));
        if (!payload.exp) return true; // No expiry? Assume valid or handle accordingly
        const exp = payload.exp * 1000; // Convert to ms
        return Date.now() < exp;
    } catch {
        return false;
    }
}

export function saveTokenLocal(token: string) {
    try { localStorage.setItem('auth_token', token); } catch {}
}

export function getTokenLocal(): string | null {
    try { return localStorage.getItem('auth_token'); } catch { return null; }
}

export function clearTokenLocal() {
    try { localStorage.removeItem('auth_token'); } catch {}
}
