import { invoke } from '@tauri-apps/api/tauri';

// Default fallback URL
const DEFAULT_API_URL = "https://metabayn-backend.metabayn.workers.dev";

// Helper to get the dynamic API URL from settings
export async function getApiUrl(): Promise<string> {
    // Check if running in browser context without Tauri
    // @ts-ignore
    if (typeof window !== 'undefined' && !window.__TAURI_IPC__) {
        return DEFAULT_API_URL;
    }

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

export async function apiGetUserProfile(token: string): Promise<any> {
    const baseUrl = await getApiUrl();
    const res = await fetch(`${baseUrl}/user/me`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch profile");
    return data;
}

export async function apiGetExchangeRate(): Promise<number> {
    try {
      const resp = await fetch('https://open.er-api.com/v6/latest/USD');
      if (resp.ok) {
        const data: any = await resp.json();
        const rate = data?.rates?.IDR;
        if (rate && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) return rate;
      }
    } catch {}
    return 17000;
}

export async function apiCreatePaypal(
  token: string,
  amount: number,
  type: 'token' | 'subscription' = 'token',
  userId?: string,
  tokensPack?: number,
  duration?: number
): Promise<any> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/payment/paypal/create`, {
	  method: "POST",
	  headers: { 
		  "Content-Type": "application/json",
		  "Authorization": `Bearer ${token}` 
	  },
	  body: JSON.stringify({ amount, userId, type, tokensPack, duration })
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

export async function apiCreatePaypalPayment(
  token: string,
  amountOrPayload: number | { amount: number; userId: string; type?: 'token' | 'subscription'; tokensPack?: number; duration?: number },
  type: 'token' | 'subscription' = 'token',
  userId?: string,
  tokensPack?: number,
  duration?: number
): Promise<any> {
  if (typeof amountOrPayload === 'number') {
    return apiCreatePaypal(token, amountOrPayload, type, userId, tokensPack, duration);
  }
  const payload = amountOrPayload;
  return apiCreatePaypal(
    token,
    payload.amount,
    payload.type === 'subscription' ? 'subscription' : 'token',
    payload.userId,
    payload.tokensPack,
    payload.duration
  );
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

export async function apiCheckLynkIdStatus(
	token: string,
	since: number,
	meta?: number | { amountIdr?: number; productType?: 'token' | 'subscription'; durationDays?: number; tokensExpected?: number }
): Promise<any> {
	const baseUrl = await getApiUrl();
	const payload =
		typeof meta === 'number'
			? { since, amountIdr: meta }
			: { since, ...(meta || {}) };
	const res = await fetch(`${baseUrl}/payment/lynkid/check`, {
	  method: "POST",
	  headers: {
		  "Content-Type": "application/json",
		  "Authorization": `Bearer ${token}`
	  },
	  body: JSON.stringify(payload)
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

	if (!res.ok) throw new Error((data && data.error) || `Lynk.id status check failed (${res.status})`);
	return data;
}

const downloadTextAsFile = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function apiGetAdminTransactions(token: string): Promise<any[]> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/topup/list?limit=200&page=1`, {
	  headers: { "Authorization": `Bearer ${token}` }
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || "Failed to fetch admin transactions");
	return Array.isArray(data?.transactions) ? data.transactions : (Array.isArray(data) ? data : []);
}

export async function apiManualApproveTopup(token: string, id: number | string): Promise<any> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/topup/manual-approve`, {
	  method: "POST",
	  headers: {
		  "Content-Type": "application/json",
		  "Authorization": `Bearer ${token}`
	  },
	  body: JSON.stringify({ id })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || "Manual approve failed");
	return data;
}

export async function apiUpdateTransactionStatus(token: string, id: number | string, status: 'success' | 'failed' | 'pending'): Promise<any> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/transactions/update`, {
	  method: "POST",
	  headers: {
		  "Content-Type": "application/json",
		  "Authorization": `Bearer ${token}`
	  },
	  body: JSON.stringify({ transaction_id: Number(id), status })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || "Update status failed");
	return data;
}

export async function apiDeleteAllTransactions(token: string): Promise<any> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/topup/delete-all`, {
	  method: "POST",
	  headers: { "Authorization": `Bearer ${token}` }
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || "Delete all transactions failed");
	return data;
}

export async function apiExportTopupCsv(token: string): Promise<void> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/topup/export-csv`, {
	  headers: { "Authorization": `Bearer ${token}` }
	});
	const text = await res.text();
	if (!res.ok) throw new Error(text.substring(0, 180) || "Export failed");
	downloadTextAsFile(text, 'topup_transactions.csv', 'text/csv');
}

export async function apiExportUsersCsv(token: string): Promise<void> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/users/export-csv`, {
	  headers: { "Authorization": `Bearer ${token}` }
	});
	const text = await res.text();
	if (!res.ok) throw new Error(text.substring(0, 180) || "Export failed");
	downloadTextAsFile(text, 'users.csv', 'text/csv');
}

export async function apiGetAdminLynkPurchases(token: string, opts?: { limit?: number; page?: number; status?: string; q?: string }): Promise<any> {
	const baseUrl = await getApiUrl();
	const url = new URL(`${baseUrl}/admin/lynk/purchases`);
	if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
	if (opts?.page) url.searchParams.set('page', String(opts.page));
	if (opts?.status) url.searchParams.set('status', String(opts.status));
	if (opts?.q) url.searchParams.set('q', String(opts.q));
	const res = await fetch(url.toString(), {
		headers: { "Authorization": `Bearer ${token}` }
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || "Failed to fetch Lynk purchases");
	return data;
}

export async function apiGetAdminLynkWebhookLogs(token: string, opts?: { limit?: number; page?: number; purchase_id?: string; ip?: string }): Promise<any> {
	const baseUrl = await getApiUrl();
	const url = new URL(`${baseUrl}/admin/lynk/logs`);
	if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
	if (opts?.page) url.searchParams.set('page', String(opts.page));
	if (opts?.purchase_id) url.searchParams.set('purchase_id', String(opts.purchase_id));
	if (opts?.ip) url.searchParams.set('ip', String(opts.ip));
	const res = await fetch(url.toString(), {
		headers: { "Authorization": `Bearer ${token}` }
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || "Failed to fetch Lynk webhook logs");
	return data;
}

export async function apiManualUpdateUser(
  token: string,
  userId: number | string,
  tokens?: number,
  subscriptionActive?: boolean,
  subscriptionDays?: number,
  subscriptionExpiryDate?: string
): Promise<any> {
	const baseUrl = await getApiUrl();
	const res = await fetch(`${baseUrl}/admin/users/update-manual`, {
	  method: "POST",
	  headers: {
		  "Content-Type": "application/json",
		  "Authorization": `Bearer ${token}`
	  },
	  body: JSON.stringify({
      user_id: userId,
      tokens,
      subscription_active: subscriptionActive,
      subscription_days: subscriptionDays,
      subscription_expiry_date: subscriptionExpiryDate
    })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || "Manual update user failed");
	return data;
}

export async function apiAdminListVouchers(token: string): Promise<any[]> {
  const baseUrl = await getApiUrl();
  const res = await fetch(`${baseUrl}/admin/vouchers`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch vouchers");
  return Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
}

export async function apiAdminCreateVoucher(
  token: string,
  payload: {
    code: string;
    type: 'token' | 'subscription' | 'license';
    amount?: number;
    duration_days?: number;
    max_usage?: number;
    expires_at?: string | null;
    allowed_emails?: string | null;
  }
): Promise<any> {
  const baseUrl = await getApiUrl();
  const res = await fetch(`${baseUrl}/admin/vouchers/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to create voucher");
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
