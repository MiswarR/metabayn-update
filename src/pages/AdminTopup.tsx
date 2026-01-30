import React, { useState, useEffect } from 'react';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';

import { API_URL } from '../api/backend';

const ADMIN_SECRET = "adminbayn";

interface Transaction {
  id: number;
  user_id: string;
  user_email: string;
  user_balance?: number;
  amount_rp: number | null;
  amount_usd: number | null;
  tokens_added: number;
  method: string;
  status: string;
  payment_ref: string;
  created_at: string;
}

interface Voucher {
  id: number;
  code: string;
  amount: number;
  max_usage: number;
  current_usage: number;
  expires_at: string | null;
  allowed_emails: string | null;
  created_at: string;
}

interface DailyStat {
  day: string;
  count: number;
  total_rp: number;
  total_usd: number;
  total_tokens: number;
}

interface AuthLog {
    id: number;
    user_id: string;
    email: string;
    action: string;
    ip_address: string;
    device_hash: string;
    timestamp: number;
}

const AdminTopup: React.FC<{token?:string, onBack?:()=>void, isProcessing?:boolean}> = ({token, onBack, isProcessing}) => {
  
  const [activeTab, setActiveTab] = useState<'transactions' | 'vouchers' | 'users' | 'settings' | 'prices' | 'auth_logs'>('transactions');
  const [appVersion, setAppVersion] = useState('4.4.4'); // Default to current known version

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(err => console.error("Failed to get version", err));
  }, []);

  // Data State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [users, setUsers] = useState<any[]>([]); // New Users State
  const [authLogs, setAuthLogs] = useState<AuthLog[]>([]); // Auth Logs State
  const [config, setConfig] = useState<any>({ profit_margin_percent: 60, usd_idr_rate: 0, usd_idr_auto_sync: false, usd_idr_rate_last_update: 0 });
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{text: string, type: 'success'|'error'|'info'} | null>(null);

  function showToast(text: string, type: 'success'|'error'|'info' = 'info'){
    setToast({ text, type })
    window.setTimeout(() => {
      setToast(cur => (cur && cur.text === text ? null : cur))
    }, 2200)
  }
  
  // Pagination State (Transactions)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const LIMIT = 20;

  // Filter State (Transactions)
  const [filter, setFilter] = useState({
    search: '',
    status: '',
    method: '',
    dateFrom: '',
    dateTo: ''
  });

  // Modal State
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showCreateVoucher, setShowCreateVoucher] = useState(false);
  const [showBulkCreateVoucher, setShowBulkCreateVoucher] = useState(false);
  const [bulkCreatedCodes, setBulkCreatedCodes] = useState<string[] | null>(null);
  const [extendModal, setExtendModal] = useState<{code:string, days:number} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // New Voucher Form
  const [newVoucher, setNewVoucher] = useState({
      code: '',
      amount: 20000,
      max_usage: 100,
      expires_at: '',
      allowed_emails: '',
      target_type: 'public', // 'public' | 'specific'
      is_bulk: false,
      quantity: 50,
      type: 'token', // 'token' | 'subscription'
      duration_days: 30
  });
  
  // Voucher Calc State
  const [voucherMode, setVoucherMode] = useState<'rupiah' | 'dollar'>('rupiah');
  const [voucherRupiah, setVoucherRupiah] = useState<number>(20000);
  const [voucherDollar, setVoucherDollar] = useState<number>(10);

  // Model Prices State
  const [modelPrices, setModelPrices] = useState<any[]>([]);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpEditing, setMpEditing] = useState<any | null>(null);
  const [priceFilter, setPriceFilter] = useState('all'); // Filter by provider

  const OFFICIAL_PRICES: any[] = [
    // OpenAI Models (Synced with Settings)
    { provider: 'openai', model_name: 'gpt-4.1', input_price: 2.50, output_price: 10.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-4.1-mini', input_price: 0.15, output_price: 0.60, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-4.1-distilled', input_price: 1.10, output_price: 4.40, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-5.1', input_price: 15.00, output_price: 60.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-5.1-mini', input_price: 3.00, output_price: 12.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-5.1-instant', input_price: 1.10, output_price: 4.40, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-4o', input_price: 2.50, output_price: 10.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'gpt-4o-mini', input_price: 0.15, output_price: 0.60, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'o1', input_price: 15.00, output_price: 60.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'openai', model_name: 'o3', input_price: 20.00, output_price: 80.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 }, // Est. High
    { provider: 'openai', model_name: 'o4-mini', input_price: 0.50, output_price: 2.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 }, // Est. Low
    { provider: 'openai', model_name: 'gpt-4-turbo', input_price: 10.00, output_price: 30.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },

    // Gemini Models (Synced with Settings)
    { provider: 'gemini', model_name: 'gemini-3.0-flash-preview', input_price: 0.35, output_price: 3.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-3.0-pro-preview', input_price: 1.50, output_price: 8.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-3.0-ultra', input_price: 4.00, output_price: 12.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.5-pro', input_price: 1.25, output_price: 10.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.5-flash', input_price: 0.30, output_price: 2.50, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.5-flash-lite', input_price: 0.10, output_price: 0.40, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.5-ultra', input_price: 2.50, output_price: 12.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.0-pro-exp-02-05', input_price: 3.50, output_price: 10.50, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.0-ultra', input_price: 2.50, output_price: 12.00, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.0-flash-exp', input_price: 0.10, output_price: 0.40, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-2.0-flash-lite-preview-02-05', input_price: 0.075, output_price: 0.30, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-1.5-pro-002', input_price: 3.50, output_price: 10.50, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-1.5-flash-002', input_price: 0.075, output_price: 0.30, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-1.5-flash-8b', input_price: 0.0375, output_price: 0.15, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-1.0-pro', input_price: 0.50, output_price: 1.50, profit_multiplier: 1.6, active: 1, fallback_priority: 1 },

    // Inactive / Legacy / Other (Not in Settings, but kept for DB consistency or fallback)
    { provider: 'openai', model_name: 'o1-mini', input_price: 3.00, output_price: 12.00, profit_multiplier: 1.6, active: 0, fallback_priority: 1 }, // Replaced by o4-mini? No, kept as legacy
    { provider: 'openai', model_name: 'o3-mini', input_price: 1.10, output_price: 4.40, profit_multiplier: 1.6, active: 0, fallback_priority: 1 }, // Replaced?
    { provider: 'gemini', model_name: 'gemini-1.5-pro', input_price: 3.50, output_price: 10.50, profit_multiplier: 1.6, active: 0, fallback_priority: 1 },
    { provider: 'gemini', model_name: 'gemini-1.5-flash', input_price: 0.075, output_price: 0.30, profit_multiplier: 1.6, active: 0, fallback_priority: 1 },
  ];

  // Constants (Should be dynamic, but fixed for now based on TopUpModal logic if not in config)
  // Logic: Rp 100.000 = 100.000 Tokens (implied 1:1 if we look at TopUpModal IDR options?)
  // Wait, TopUpModal: 100.000 IDR -> 100.000 Tokens (+3% bonus). 
  // So Base Rate is 1 IDR = 1 Token? 
  // Let's check TopUpModal again. 
  // manual: Rp 50.000.  If I pay 50k, do I get 50k tokens?
  // Yes, standard usually 1 IDR = 1 Token in this app context based on previous snippets?
  // Actually, let's look at `apiCreatePaypal`.
  // But for IDR manual, the admin manually approves.
  // In `TopUpModal`, `idrOptions` has value 50000. If user selects it, `amount` is 50000.
  // If method is manual, it sends whatsapp. Admin checks transfer.
  // When Admin creates voucher for Rp 20,000, it probably means 20,000 Tokens?
  // Let's assume 1 IDR = 1 Token for simplicity unless I see otherwise.
  // But wait, user said "amount tokennya pakai hitungan rupiah.. misalnya 20.000".
  // If 20.000 Rupiah = 20.000 Tokens, then it's 1:1.
  // I will add a conversion rate input just in case, or default to 1:1.
  // Let's look at config.usd_idr_rate (16300).
  // If 1 USD = 1000 Tokens (approx), then 1 Token = 16.3 Rupiah?
  // In TopUpModal: $10 = 10 Tokens? No, usually $10 = 10,000 Tokens?
  // Let's check `TopUpModal` USD options: value: 10. Label: $10.
  // If value 10 is passed to `apiCreatePaypal`, does it give 10 tokens? Unlikely.
  // It probably gives 10 * 1000 or something.
  // Let's assume the "Token Amount" in Voucher is the RAW token count added to balance.
  // If I want to sell 20.000 Rupiah worth of tokens.
  // If 1 Token = 1 Rupiah, then 20k Tokens.
  // I will add a helper text showing "Estimated Tokens: X" based on a rate.
  // I will assume 1 Token = 1 Rupiah for now as a default, but allow editing.

  const [usersList, setUsersList] = useState<any[]>([]); // For Users Tab
  const [usersLoading, setUsersLoading] = useState(false);
  
  // Usage Report State
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userUsage, setUserUsage] = useState<any[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  // Modals
  const [subModal, setSubModal] = useState<{id:number, email:string, is_active:boolean, expiry_date:string} | null>(null);
  const [resetPassModal, setResetPassModal] = useState<{id:number, email:string, new_pass:string} | null>(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{id:number, email:string} | null>(null);
  const [voucherDeleteModal, setVoucherDeleteModal] = useState<{id:number, code:string} | null>(null);

  const handleDeleteUser = async () => {
    if (!deleteConfirmModal) return;

    setIsSubmitting(true);
    try {
        const res = await fetch(`${API_URL}/admin/users/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({
                user_id: deleteConfirmModal.id
            })
        });
        const data = await res.json();
        if (data.success) {
            alert("User deleted successfully");
            setDeleteConfirmModal(null);
            fetchUsers(); // Refresh list
        } else {
            alert("Failed to delete user: " + (data.error || "Unknown error"));
        }
    } catch (e: any) {
        alert("Error: " + e.message);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPassModal || !resetPassModal.new_pass || resetPassModal.new_pass.length < 6) {
        alert("Password must be at least 6 characters");
        return;
    }

    if (!confirm(`Are you sure you want to reset password for ${resetPassModal.email}?`)) return;

    setIsSubmitting(true);
    try {
        const res = await fetch(`${API_URL}/admin/users/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({
                user_id: resetPassModal.id,
                new_password: resetPassModal.new_pass
            })
        });
        const data = await res.json();
        
        if (data.success) {
            alert("Password reset successfully");
            setResetPassModal(null);
        } else {
            alert("Failed to reset password: " + data.error);
        }
    } catch (e: any) {
        alert("Error: " + e.message);
    } finally {
        setIsSubmitting(false);
    }
  };

  const getHeaders = () => {
      const h: any = {};
      if (token) h['Authorization'] = `Bearer ${token}`;
      // Always send admin key if available to ensure admin access works
      // even if the token is from a regular user or expired but we have the secret
      if (ADMIN_SECRET) h['x-admin-key'] = ADMIN_SECRET;
      return h;
    };

  useEffect(() => {
    // Fetch config on mount to ensure rates are available
    fetchConfig();
  }, []);

  useEffect(() => {
    if (activeTab === 'transactions') {
        fetchStats();
        fetchTransactions();
    } else if (activeTab === 'settings') {
        fetchConfig();
    } else if (activeTab === 'users') {
        fetchUsers();
    } else if (activeTab === 'vouchers') {
        fetchVouchers();
    } else if (activeTab === 'prices') {
        fetchModelPrices();
    } else if (activeTab === 'auth_logs') {
        fetchAuthLogs();
    }
  }, [page, activeTab]); 

  // --- API CALLS ---

  const fetchAuthLogs = async () => {
    setLoading(true);
    try {
        const res = await fetch(`${API_URL}/admin/auth-logs`, { headers: getHeaders() });
        const data = await res.json();
        setAuthLogs(Array.isArray(data) ? data : []);
    } catch (e: any) {
        console.error("Error fetching auth logs: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    try {
        const res = await fetch(`${API_URL}/admin/config`, { headers: getHeaders() });
        const data = await res.json();
        if (data) {
            setConfig({
                profit_margin_percent: data.profit_margin_percent ?? 60,
                usd_idr_rate: data.usd_idr_rate ?? 0,
                usd_idr_auto_sync: !!data.usd_idr_auto_sync,
                usd_idr_rate_last_update: Number(data.usd_idr_rate_last_update || 0)
            });
        }
    } catch (e: any) {
        console.error("Error fetching config:", e);
    } finally {
        setLoading(false);
    }
  };

  const saveConfig = async () => {
    setIsSubmitting(true);
    try {
        console.log("Saving config:", config);
        const payload = {
            profit_margin_percent: Number(config.profit_margin_percent ?? 60),
            usd_idr_rate: Number(config.usd_idr_rate ?? 0),
            usd_idr_auto_sync: !!config.usd_idr_auto_sync
        };
        const res = await fetch(`${API_URL}/admin/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        console.log("Save config response:", text);
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error("Invalid server response: " + text.substring(0, 100));
        }

        if (data.success) {
            showToast("Settings saved successfully!", 'success');
            // Refresh config to ensure we have the latest from DB
            fetchConfig();
        } else {
            showToast("Failed to save settings: " + data.error, 'error');
        }
    } catch (e: any) {
        console.error("Save config error:", e);
        showToast("Error saving settings: " + e.message, 'error');
    } finally {
        setIsSubmitting(false);
    }
  };

  const fetchModelPrices = async () => {
    setMpLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/model-prices`, { headers: getHeaders() });
      const data = await res.json();
      setModelPrices(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Fetch model prices error:', e);
    } finally {
      setMpLoading(false);
    }
  };

  const upsertModelPrice = async (entry: any) => {
    setIsSubmitting(true);
    try {
      if (entry.id) {
        const res = await fetch(`${API_URL}/admin/model-prices/${entry.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({
            provider: entry.provider,
            model_name: entry.model_name,
            input_price: Number(entry.input_price),
            output_price: Number(entry.output_price),
            profit_multiplier: Number(entry.profit_multiplier ?? 1.6),
            active: entry.active ? 1 : 0,
            fallback_priority: Number(entry.fallback_priority ?? 1)
          })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Update failed');
      } else {
        const res = await fetch(`${API_URL}/admin/model-prices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({
            provider: entry.provider,
            model_name: entry.model_name,
            input_price: Number(entry.input_price),
            output_price: Number(entry.output_price),
            profit_multiplier: Number(entry.profit_multiplier ?? 1.6),
            active: entry.active ? 1 : 0,
            fallback_priority: Number(entry.fallback_priority ?? 1)
          })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Create failed');
      }
      setMpEditing(null);
      fetchModelPrices();
    } catch (e: any) {
      alert('Error saving model price: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteModelPrice = async (id: number) => {
    if (!confirm('Delete this model price?')) return;
    try {
      const res = await fetch(`${API_URL}/admin/model-prices/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Delete failed');
      fetchModelPrices();
    } catch (e: any) {
      alert('Error deleting: ' + e.message);
    }
  };

  const seedOfficialPrices = async () => {
    if (!confirm('Sync official prices from local config to backend?')) return;
    setIsSubmitting(true);
    
    try {
      // 1. Get current prices to know what to update vs create
      const resCur = await fetch(`${API_URL}/admin/model-prices`, { headers: getHeaders() });
      const current = await resCur.json();
      const currentMap = new Map();
      if (Array.isArray(current)) {
        current.forEach((c: any) => currentMap.set(`${c.provider}:${c.model_name}`, c.id));
      }

      // Delete Groq models if found (Cleanup)
      if (Array.isArray(current)) {
          const groqModels = current.filter((c:any) => c.provider === 'groq');
          for (const g of groqModels) {
              await fetch(`${API_URL}/admin/model-prices/${g.id}`, {
                  method: 'DELETE',
                  headers: getHeaders()
              });
          }
      }

      let count = 0;
      for (const model of OFFICIAL_PRICES) {
        const key = `${model.provider}:${model.model_name}`;
        const existingId = currentMap.get(key);
        
        const payload = {
            provider: model.provider,
            model_name: model.model_name,
            input_price: Number(model.input_price),
            output_price: Number(model.output_price),
            profit_multiplier: Number(model.profit_multiplier ?? 1.6),
            active: model.active ? 1 : 0,
            fallback_priority: Number(model.fallback_priority ?? 1)
        };

        if (existingId) {
            // Update
            await fetch(`${API_URL}/admin/model-prices/${existingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getHeaders() },
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            await fetch(`${API_URL}/admin/model-prices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getHeaders() },
                body: JSON.stringify(payload)
            });
        }
        count++;
      }

      alert(`Synced ${count} models successfully from frontend config.`);
      fetchModelPrices();
    } catch (e: any) {
      alert('Sync error: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/topup/statistics`, { headers: getHeaders() });
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error(e);
    }
  };

  const [subSaving, setSubSaving] = useState(false);
  const [subSuccess, setSubSuccess] = useState(false);

  const handleUpdateSub = async () => {
      if (!subModal) return;
      
      // Validation: If Active, must have future expiry
      if (subModal.is_active) {
          if (!subModal.expiry_date) {
              alert("Please set an expiry date for active subscription");
              return;
          }
          if (new Date(subModal.expiry_date) <= new Date()) {
              alert("Expiry date must be in the future");
              return;
          }
      }

      setSubSaving(true);
      setSubSuccess(false);
      try {
          const payload = {
              user_id: subModal.id,
              is_active: subModal.is_active,
              expiry_date: subModal.expiry_date
          };
          
          console.log("Updating subscription:", payload);

          const res = await fetch(`${API_URL}/admin/users/subscription`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getHeaders() },
              body: JSON.stringify(payload)
          });
          
          const data = await res.json();
          if (data.success) {
              setSubSuccess(true);
              // Show temporary success feedback
              const btn = document.getElementById('saveSubBtn');
              if (btn) btn.innerText = "Saved!";
              
              setTimeout(() => {
                setSubModal(null);
                setSubSuccess(false);
                fetchUsers();
              }, 1000);
          } else {
              alert("Error: " + data.error);
          }
      } catch (e: any) {
          alert("Error: " + e.message);
      } finally {
          setSubSaving(false);
      }
  };

  const handleSeedUsers = async () => {
    if (!confirm('Add dummy users for testing?')) return;
    setLoading(true);
    try {
        const res = await fetch(`${API_URL}/admin/users/seed`, { 
            method: 'POST',
            headers: getHeaders() 
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            fetchUsers();
        } else {
            if (data.message) alert(data.message); // e.g. "Users already exist"
            else alert("Error: " + data.error);
        }
    } catch (e: any) {
        alert("Error: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
        const res = await fetch(`${API_URL}/admin/users/list`, { headers: getHeaders() });
        const data = await res.json();
        if (Array.isArray(data)) setUsersList(data);
        else if (data.users) setUsersList(data.users);
        else if (data.results) setUsersList(data.results);
    } catch (e: any) {
        console.error("Error fetching users: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  const fetchUserUsage = async (userId: string) => {
    setUsageLoading(true);
    setUserUsage([]);
    try {
        const res = await fetch(`${API_URL}/admin/users/${userId}/usage`, { headers: getHeaders() });
        const data = await res.json();
        if (Array.isArray(data)) setUserUsage(data);
    } catch (e: any) {
        alert("Error fetching usage: " + e.message);
    } finally {
        setUsageLoading(false);
    }
  };

  const handleExportUsage = () => {
    // Add admin key to URL query param if needed, but usually headers are required.
    // Since window.open can't set headers easily, we might need a temporary token or use a signed URL.
    // However, if the backend checks 'x-admin-key' from query param as fallback, it works.
    // Let's assume standard auth for now or just rely on browser session if cookies were used (but they aren't).
    // Better approach: fetch blob and download.
    fetch(`${API_URL}/admin/users/export-usage`, { headers: getHeaders() })
      .then(res => res.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "user_usage_report.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(e => alert("Export failed: " + e.message));
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      let query = `?page=${page}&limit=${LIMIT}`;
      if (filter.search) query += `&search=${encodeURIComponent(filter.search)}`;
      if (filter.status) query += `&status=${filter.status}`;
      if (filter.method) query += `&method=${filter.method}`;
      if (filter.dateFrom) query += `&date_from=${filter.dateFrom}`;
      if (filter.dateTo) query += `&date_to=${filter.dateTo}`;

      const res = await fetch(`${API_URL}/admin/topup/list${query}`, { headers: getHeaders() });
      const data = await res.json();
      setTransactions(data.transactions || []);
      setTotalPages(data.page_count || 1);
    } catch (e: any) {
      alert("Error fetching data: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchVouchers = async () => {
      setLoading(true);
      try {
          const res = await fetch(`${API_URL}/admin/vouchers?_t=${new Date().getTime()}`, { headers: getHeaders() });
          const data = await res.json();
          if (Array.isArray(data)) setVouchers(data);
      } catch (e: any) {
          alert("Error fetching vouchers: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const handleCreateVoucherSubmit = async () => {
      // Validate
      if (newVoucher.type === 'token' && !newVoucher.amount) {
          alert("Amount is required for token vouchers");
          return;
      }

      if (newVoucher.type === 'subscription' && !newVoucher.duration_days) {
          alert("Duration is required for subscription vouchers");
          return;
      }

      if (newVoucher.is_bulk) {
          if (!newVoucher.quantity || newVoucher.quantity < 1) {
              alert("Quantity must be at least 1");
              return;
          }
      } else {
          if (!newVoucher.code) {
              alert("Code is required");
              return;
          }
      }

      setIsSubmitting(true);
      try {
          let endpoint = '/admin/vouchers/create';
          let payload: any = {
              type: newVoucher.type,
              max_usage: Number(newVoucher.max_usage),
              expires_at: newVoucher.expires_at ? new Date(newVoucher.expires_at).toISOString() : null,
          };

          if (newVoucher.type === 'token') {
              payload.amount = Number(newVoucher.amount);
          } else {
              payload.duration_days = Number(newVoucher.duration_days);
          }

          if (newVoucher.is_bulk) {
              endpoint = '/admin/vouchers/bulk-create';
              payload.quantity = Number(newVoucher.quantity);
          } else {
              payload.code = newVoucher.code;
              payload.allowed_emails = newVoucher.target_type === 'specific' ? newVoucher.allowed_emails : null;
          }
          
          console.log("Creating voucher(s):", payload);

          const res = await fetch(`${API_URL}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getHeaders() },
              body: JSON.stringify(payload)
          });
          
          const text = await res.text();
          console.log("Create voucher response:", text);

          let data;
          try {
              data = JSON.parse(text);
          } catch (e) {
              throw new Error("Invalid server response: " + text.substring(0, 100));
          }

          if (data.success) {
              if (newVoucher.is_bulk && data.codes) {
                  // Download CSV
                  const csvContent = "data:text/csv;charset=utf-8," + "CODE,TYPE,VALUE\n" + data.codes.map((c: string) => `${c},${newVoucher.type},${newVoucher.type === 'token' ? newVoucher.amount : newVoucher.duration_days + ' days'}`).join("\n");
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", `vouchers_${newVoucher.type}_${data.codes.length}pcs.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  
                  alert(`Successfully created ${data.codes.length} vouchers! CSV downloaded.`);
              } else {
                  alert("Voucher Created Successfully!");
              }

              setShowCreateVoucher(false);
              fetchVouchers();
              setNewVoucher({
                code: '',
                amount: 20000,
                max_usage: 100,
                expires_at: '',
                allowed_emails: '',
                target_type: 'public',
                is_bulk: false,
                quantity: 50,
                type: 'token',
                duration_days: 30
              });
          } else {
              alert("Error creating voucher: " + data.error);
          }
      } catch (e: any) {
          console.error("Create voucher error:", e);
          alert("Error creating voucher: " + e.message);
      } finally {
          setIsSubmitting(false);
      }
  };

  const deleteVoucher = async (id: number) => {
    if (!confirm("Are you sure you want to delete this voucher?")) return;
    try {
      const res = await fetch(`${API_URL}/admin/vouchers/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        fetchVouchers();
      } else {
        alert("Failed to delete voucher: " + data.error);
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleBulkCreate = async () => {
    // Validation
    if (newVoucher.type === 'token' && (!newVoucher.amount || newVoucher.amount < 1)) {
        alert("Please enter a valid amount for token vouchers");
        return;
    }
    if (newVoucher.type === 'subscription' && (!newVoucher.duration_days || newVoucher.duration_days < 1)) {
        alert("Please enter a valid duration for subscription vouchers");
        return;
    }
    if (!newVoucher.quantity || newVoucher.quantity < 1 || newVoucher.quantity > 500) {
        alert("Quantity must be between 1 and 500");
        return;
    }
    
    setIsSubmitting(true);
    try {
      const payload: any = {
        type: newVoucher.type,
        quantity: Number(newVoucher.quantity),
        max_usage: Number(newVoucher.max_usage),
        expires_at: newVoucher.expires_at ? new Date(newVoucher.expires_at).toISOString() : null
      };

      if (newVoucher.type === 'token') {
        payload.amount = Number(newVoucher.amount);
      } else {
        payload.duration_days = Number(newVoucher.duration_days);
      }

      const res = await fetch(`${API_URL}/admin/vouchers/bulk-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (data.success) {
        setBulkCreatedCodes(data.codes);
        fetchVouchers();
      } else {
        alert("Failed to create vouchers: " + data.error);
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtend = async () => {
      if (!extendModal) return;
      setIsSubmitting(true);
      try {
          console.log("Extending voucher:", extendModal);
          const res = await fetch(`${API_URL}/admin/vouchers/extend`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getHeaders() },
              body: JSON.stringify({
                  code: extendModal.code,
                  days: extendModal.days
              })
          });
          
          const text = await res.text();
          console.log("Extend response:", text);

          let data;
          try {
              data = JSON.parse(text);
          } catch (e) {
              // Handle non-JSON response (e.g. 404 Not Found HTML or text)
              throw new Error("Invalid server response (Check Backend): " + text.substring(0, 100));
          }

          if (data.success) {
              alert(data.message);
              setExtendModal(null);
              fetchVouchers();
          } else {
              alert("Failed to extend: " + (data.error || "Unknown error"));
          }
      } catch (e: any) {
          console.error("Extend error:", e);
          alert("Error: " + e.message);
      } finally {
          setIsSubmitting(false);
      }
  };

  const downloadBulkCSV = () => {
      if (!bulkCreatedCodes) return;
      const header = "CODE,TYPE,VALUE\n";
      const csvRows = bulkCreatedCodes.map(code => {
          const type = newVoucher.type;
          const value = type === 'token' ? newVoucher.amount : `${newVoucher.duration_days} days`;
          return `${code},${type},"${value}"`;
      });
      const csvContent = "data:text/csv;charset=utf-8," + header + csvRows.join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `vouchers_${newVoucher.type}_${bulkCreatedCodes.length}pcs.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const copyBulkCodes = () => {
      if (!bulkCreatedCodes) return;
      navigator.clipboard.writeText(bulkCreatedCodes.join("\n"));
      alert("Codes copied to clipboard!");
  };

  const handleDeleteVoucher = (id: number, code: string) => {
    setVoucherDeleteModal({ id, code });
  };

  const confirmDeleteVoucher = async () => {
      if (!voucherDeleteModal) return;
      const id = voucherDeleteModal.id;
      
      // Optimistic update: Remove immediately from UI
      const previousVouchers = [...vouchers];
      setVouchers(vouchers.filter(v => v.id !== id));
      setVoucherDeleteModal(null); // Close modal

      try {
          const res = await fetch(`${API_URL}/admin/vouchers/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        
        if (!data.success) {
            // Revert if failed
            setVouchers(previousVouchers);
            alert("Error: " + data.error);
        }
        // No need to fetchVouchers() if success, we already updated UI
      } catch (e: any) {
          setVouchers(previousVouchers);
          alert("Error: " + e.message);
      }
  };

  // --- ACTIONS ---

  const handleApplyFilter = () => {
    setPage(1); 
    fetchTransactions();
  };

  const handleApprove = async (id: number) => {
    if (!confirm("Are you sure you want to manually approve this transaction?")) return;
    try {
      const res = await fetch(`${API_URL}/admin/topup/manual-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        alert("Transaction Approved!");
        fetchTransactions();
        fetchStats();
        setSelectedTx(null); 
      } else {
        alert("Failed: " + data.error);
      }
    } catch (e) {
      alert("Error approving transaction");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this transaction? Cannot be undone.")) return;
    try {
      const res = await fetch(`${API_URL}/admin/topup/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        fetchTransactions();
        fetchStats();
      } else {
        alert("Failed: " + data.error);
      }
    } catch (e) {
      alert("Error deleting transaction");
    }
  };

  const handleExport = () => {
    window.open(`${API_URL}/admin/topup/export-csv`, '_blank');
  };

  // Derived Stats for "Today"
  const getTodayStats = () => {
    if (!stats || !stats.daily_stats) return null;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayStat = stats.daily_stats.find((d: DailyStat) => d.day === todayStr);
    return todayStat || { count: 0, total_rp: 0, total_usd: 0, total_tokens: 0 };
  };

  const todayStats = getTodayStats();

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
            <div style={{display:'flex', alignItems:'center', gap:20}}>
                <h1 style={{margin:0, fontSize:22}}>Admin Panel <span style={{fontSize:12, color:'#666', fontWeight:'normal'}}>(v{appVersion})</span></h1>
                {isProcessing && (
                    <div style={{display:'flex', alignItems:'center', gap:5, padding:'4px 8px', background:'rgba(76, 175, 80, 0.2)', border:'1px solid rgba(76, 175, 80, 0.4)', borderRadius:12}}>
                        <span style={{width:8, height:8, background:'#4caf50', borderRadius:'50%', animation:'pulse 1.5s infinite'}}></span>
                        <span style={{fontSize:10, color:'#4caf50'}}>Processing...</span>
                        <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }`}</style>
                    </div>
                )}
                <div style={styles.tabs}>
                <button 
                    style={activeTab === 'transactions' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('transactions')}
                >
                    Transactions
                </button>
                <button 
                    style={activeTab === 'vouchers' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('vouchers')}
                >
                    Vouchers
                </button>
                <button 
                    style={activeTab === 'users' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('users')}
                >
                    Users
                </button>
                <button 
                    style={activeTab === 'settings' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
                <button 
                    style={activeTab === 'prices' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('prices')}
                >
                    Prices
                </button>
                <button 
                    style={activeTab === 'auth_logs' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('auth_logs')}
                >
                    Auth Logs
                </button>
                </div>
            </div>
        <button onClick={onBack} style={styles.backBtn}>Back to Dashboard</button>
      </div>

      {activeTab === 'transactions' ? (
          <>
            {/* Stats Cards (Today) */}
            {todayStats && (
                <div style={styles.statsGrid}>
                <div style={styles.card}>
                    <h3>Transactions Today</h3>
                    <p style={styles.bigNum}>{todayStats.count}</p>
                </div>
                <div style={styles.card}>
                    <h3>Tokens Given</h3>
                    <p style={styles.bigNum}>{todayStats.total_tokens.toLocaleString()}</p>
                </div>
                <div style={styles.card}>
                    <h3>Income (IDR)</h3>
                    <p style={styles.bigNum}>Rp {todayStats.total_rp?.toLocaleString() || 0}</p>
                </div>
                <div style={styles.card}>
                    <h3>Income (USD)</h3>
                    <p style={styles.bigNum}>${todayStats.total_usd?.toLocaleString() || 0}</p>
                </div>
                </div>
            )}

            {/* Filter Bar */}
            <div style={styles.filterBar}>
                <input 
                type="text" 
                placeholder="User Email / ID" 
                value={filter.search}
                onChange={(e) => setFilter({...filter, search: e.target.value})}
                style={styles.input}
                />
                <select 
                value={filter.method} 
                onChange={(e) => setFilter({...filter, method: e.target.value})} 
                style={styles.select}
                >
                <option value="">All Methods</option>
                <option value="paypal">PayPal</option>
                <option value="qris">QRIS</option>
                </select>
                <select 
                value={filter.status} 
                onChange={(e) => setFilter({...filter, status: e.target.value})} 
                style={styles.select}
                >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
                </select>
                <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <span style={{fontSize:12}}>From:</span>
                    <input 
                    type="date" 
                    value={filter.dateFrom}
                    onChange={(e) => setFilter({...filter, dateFrom: e.target.value})}
                    style={styles.input}
                    />
                </div>
                <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <span style={{fontSize:12}}>To:</span>
                    <input 
                    type="date" 
                    value={filter.dateTo}
                    onChange={(e) => setFilter({...filter, dateTo: e.target.value})}
                    style={styles.input}
                    />
                </div>
                <button onClick={handleApplyFilter} style={styles.btnPrimary}>Apply Filter</button>
                <button onClick={handleExport} style={styles.btnOutline}>Export CSV</button>
            </div>

            {/* Table */}
            <div style={styles.tableContainer}>
                {loading ? <div style={{padding:20, textAlign:'center'}}>Loading...</div> : (
                <>
                <table style={styles.table}>
                    <thead>
                    <tr style={{background:'#111', borderBottom:'2px solid #333'}}>
                        <th style={{...styles.th, width: '5%'}}>ID</th>
                        <th style={{...styles.th, width: '15%'}}>User Email</th>
                        <th style={{...styles.th, width: '8%'}}>Method</th>
                        <th style={{...styles.th, width: '12%'}}>Amount</th>
                        <th style={{...styles.th, width: '10%'}}>Tokens</th>
                        <th style={{...styles.th, width: '10%'}}>Remaining</th>
                        <th style={{...styles.th, width: '10%'}}>Status</th>
                        <th style={{...styles.th, width: '15%'}}>Date</th>
                        <th style={{...styles.th, width: '15%'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {transactions.length === 0 ? (
                        <tr><td colSpan={9} style={{padding:20, textAlign:'center', color:'#888'}}>No transactions found</td></tr>
                    ) : (
                        transactions.map((tx) => (
                            <tr 
                              key={tx.id} 
                              style={{
                                borderBottom:'1px solid #333',
                                backgroundColor: tx.status === 'paid' 
                                  ? 'rgba(40,167,69,0.06)'
                                  : tx.status === 'failed'
                                  ? 'rgba(220,53,69,0.08)'
                                  : 'rgba(255,193,7,0.04)'
                              }}
                            >
                            <td style={styles.td}>#{tx.id}</td>
                            <td style={styles.td}>
                                <div style={{fontWeight:500}}>{tx.user_email}</div>
                                <div style={{fontSize:11, color:'#888'}}>{tx.user_id.substring(0,8)}...</div>
                            </td>
                            <td style={styles.td}>{tx.method.toUpperCase()}</td>
                            <td style={styles.td}>
                                {tx.method.toLowerCase().startsWith('paypal') && tx.amount_usd != null
                                  ? `$${tx.amount_usd}`
                                  : tx.amount_rp != null
                                  ? `Rp ${tx.amount_rp.toLocaleString()}`
                                  : '-'}
                            </td>
                            <td style={styles.td}>+{tx.tokens_added.toLocaleString()}</td>
                            <td style={styles.td}>{tx.user_balance ? tx.user_balance.toLocaleString() : '-'}</td>
                            <td style={styles.td}>
                                <span style={{
                                ...styles.badge, 
                                backgroundColor: tx.status === 'paid' ? '#28a745' : tx.status === 'pending' ? '#ffc107' : '#dc3545',
                                color: tx.status === 'pending' ? '#333' : '#fff'
                                }}>
                                {tx.status}
                                </span>
                            </td>
                            <td style={styles.td}>{new Date(tx.created_at).toLocaleString()}</td>
                            <td style={styles.td}>
                                <div style={{display:'flex', gap:5}}>
                                    <button onClick={() => setSelectedTx(tx)} style={styles.btnSmall}>Detail</button>
                                    {tx.status === 'pending' && (
                                    <button onClick={() => handleApprove(tx.id)} style={{...styles.btnSmall, background:'#28a745', color:'#fff'}}>Approve</button>
                                    )}
                                    {tx.status === 'failed' && (
                                    <button onClick={() => handleDelete(tx.id)} style={{...styles.btnSmall, background:'#dc3545', color:'#fff'}}>Delete</button>
                                    )}
                                </div>
                            </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
                </>
                )}
            </div>

            {/* Pagination */}
            <div style={styles.pagination}>
                <button 
                    disabled={page <= 1} 
                    onClick={() => setPage(p => p - 1)}
                    style={{...styles.pageBtn, opacity: page <= 1 ? 0.5 : 1}}
                >
                    Previous
                </button>
                <span style={{fontWeight:'bold'}}>Page {page} of {totalPages}</span>
                <button 
                    disabled={page >= totalPages} 
                    onClick={() => setPage(p => p + 1)}
                    style={{...styles.pageBtn, opacity: page >= totalPages ? 0.5 : 1}}
                >
                    Next
                </button>
            </div>
          </>
      ) : activeTab === 'vouchers' ? (
          <>
            {/* VOUCHER MANAGEMENT */}
            <div style={{display:'flex', justifyContent:'flex-end', marginBottom:20, gap: 10}}>
                <button onClick={() => setShowCreateVoucher(true)} style={styles.btnPrimary}>+ Create New Voucher</button>
                <button onClick={() => setShowBulkCreateVoucher(true)} style={{...styles.btnPrimary, background: '#6f42c1'}}>+ Generate Massal Voucher</button>
            </div>

            <div style={styles.tableContainer}>
                {loading ? <div style={{padding:20, textAlign:'center'}}>Loading...</div> : (
                <table style={styles.table}>
                    <thead>
                        <tr style={{background:'#f8f9fa', borderBottom:'2px solid #eee'}}>
                            <th style={{...styles.th, width: '20%'}}>Code</th>
                            <th style={{...styles.th, width: '15%'}}>Value</th>
                            <th style={{...styles.th, width: '10%'}}>Usage</th>
                            <th style={{...styles.th, width: '20%'}}>Expiry</th>
                            <th style={{...styles.th, width: '20%'}}>Target</th>
                            <th style={{...styles.th, width: '15%'}}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vouchers.length === 0 ? (
                             <tr><td colSpan={6} style={{padding:20, textAlign:'center', color:'#888'}}>No vouchers found</td></tr>
                        ) : (
                            vouchers.map((v: any) => {
                                const isExpired = v.expires_at && new Date(v.expires_at) < new Date();
                                const rowStyle = {
                                    borderBottom: '1px solid #333',
                                    backgroundColor: isExpired ? 'rgba(255,255,255,0.03)' : 'transparent',
                                    opacity: isExpired ? 0.7 : 1
                                };
                                const textStyle = { color: isExpired ? '#777' : '#eee' };

                                return (
                                <tr key={v.id} style={rowStyle}>
                                    <td style={{...styles.td, fontWeight:'bold', fontFamily:'monospace', fontSize:14, color: isExpired ? '#777' : '#fff'}}>{v.code}</td>
                                    <td style={{...styles.td, ...textStyle}}>
                                        {v.type === 'subscription' 
                                            ? `${v.duration_days} Days` 
                                            : v.amount.toLocaleString()
                                        }
                                        <span style={{fontSize:10, color: v.type === 'subscription' ? '#03a9f4' : '#ffc107', marginLeft:5, fontWeight:'bold', border:`1px solid ${v.type === 'subscription' ? '#03a9f4' : '#ffc107'}`, padding:'1px 4px', borderRadius:4}}>
                                            {v.type === 'subscription' ? 'SUB' : 'TOKEN'}
                                        </span>
                                    </td>
                                    <td style={{...styles.td, ...textStyle}}>{v.current_usage} / {v.max_usage === 0 ? '∞' : v.max_usage}</td>
                                    <td style={{...styles.td, ...textStyle}}>
                                        {v.expires_at ? new Date(v.expires_at).toLocaleDateString() : 'No Expiry'}
                                        {isExpired && <span style={{fontSize:10, color:'#ff4444', marginLeft:5, fontWeight:'bold', border:'1px solid #ff4444', padding:'1px 4px', borderRadius:4}}>EXPIRED</span>}
                                    </td>
                                    <td style={styles.td}>
                                        {v.allowed_emails ? (
                                            <span title={v.allowed_emails} style={{fontSize:12, background: isExpired ? '#222' : '#333', color: isExpired ? '#666' : '#ccc', padding:'2px 6px', borderRadius:4, border:'1px solid #444'}}>Specific</span>
                                        ) : (
                                            <span style={{fontSize:12, background: isExpired ? '#222' : 'rgba(40, 167, 69, 0.2)', color: isExpired ? '#666' : '#4caf50', padding:'2px 6px', borderRadius:4, border: isExpired ? '1px solid #444' : '1px solid #28a745'}}>Public</span>
                                        )}
                                    </td>
                                    <td style={styles.td}>
                                        <div style={{display:'flex', gap:5}}>
                                            <button onClick={() => handleDeleteVoucher(v.id, v.code)} style={{...styles.btnSmall, background:'#c62828', color:'#fff', opacity: isExpired ? 0.5 : 1}}>Del</button>
                                            {isExpired && (
                                                <button 
                                                    onClick={() => setExtendModal({code: v.code, days: 7})} 
                                                    style={{...styles.btnSmall, background:'#ffc107', color:'#000', fontWeight:'bold', opacity: 1}}
                                                    title="Extend Validity (Grace Period)"
                                                >
                                                    Extend
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
                )}
            </div>
          </>
      ) : activeTab === 'users' ? (
          <>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:20}}>
                <button onClick={handleSeedUsers} style={{...styles.btnOutline, color: '#666', borderColor: '#ccc'}}>+ Seed Dummy Users</button>
                <button onClick={handleExportUsage} style={styles.btnOutline}>Export Usage Report (CSV)</button>
            </div>
            <div style={styles.tableContainer}>
                {loading ? <div style={{padding:20, textAlign:'center'}}>Loading...</div> : (
                <table style={styles.table}>
                    <thead>
                        <tr style={{background:'#f8f9fa', borderBottom:'2px solid #eee'}}>
                            <th style={{...styles.th, width: '5%'}}>ID</th>
                            <th style={{...styles.th, width: '25%'}}>Email</th>
                            <th style={{...styles.th, width: '15%'}}>Balance</th>
                            <th style={{...styles.th, width: '10%'}}>Sub. Status</th>
                            <th style={{...styles.th, width: '15%'}}>Sub. Expiry</th>
                            <th style={{...styles.th, width: '15%'}}>Created At</th>
                            <th style={{...styles.th, width: '15%'}}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usersList.length === 0 ? (
                             <tr><td colSpan={7} style={{padding:20, textAlign:'center', color:'#888'}}>No users found</td></tr>
                        ) : (
                            usersList.map((u: any) => (
                                <tr key={u.id} style={{borderBottom:'1px solid #eee'}}>
                                    <td style={styles.td}>#{u.id}</td>
                                    <td style={styles.td}>{u.email}</td>
                                    <td style={styles.td}>{u.balance ? u.balance.toLocaleString() : u.tokens ? u.tokens.toLocaleString() : 0}</td>
                                    <td style={styles.td}>
                                        <span style={{
                                            padding: '2px 6px', borderRadius: 4, fontSize: 11,
                                            background: u.subscription_active ? '#e8f5e9' : '#ffebee',
                                            color: u.subscription_active ? '#2e7d32' : '#c62828'
                                        }}>
                                            {u.subscription_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={styles.td}>{u.subscription_expiry ? new Date(u.subscription_expiry).toLocaleDateString() : '-'}</td>
                                    <td style={styles.td}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                                    <td style={styles.td}>
                                        <button 
                                            onClick={() => {
                                                setSelectedUser(u);
                                                fetchUserUsage(u.id);
                                            }} 
                                            style={{...styles.btnSmall, marginRight: 5}}
                                        >
                                            Usage
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSubModal({
                                                    id: u.id,
                                                    email: u.email,
                                                    is_active: !!u.subscription_active,
                                                    expiry_date: u.subscription_expiry || ''
                                                });
                                            }}
                                            style={{...styles.btnSmall, background: '#2196f3', color: 'white', border: 'none', marginRight: 5}}
                                        >
                                            Sub
                                        </button>
                                        <button
                                            onClick={() => {
                                                setResetPassModal({
                                                    id: u.id,
                                                    email: u.email,
                                                    new_pass: ''
                                                });
                                            }}
                                            style={{...styles.btnSmall, background: '#ff9800', color: 'white', border: 'none', marginRight: 5}}
                                        >
                                            Pass
                                        </button>
                                        <button
                                            onClick={() => {
                                                setDeleteConfirmModal({
                                                    id: u.id,
                                                    email: u.email
                                                });
                                            }}
                                            style={{...styles.btnSmall, background: '#f44336', color: 'white', border: 'none'}}
                                        >
                                            Del
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                )}
            </div>
          </>
      ) : activeTab === 'settings' ? (
          <>
            {/* SETTINGS MANAGEMENT */}
            <div style={{maxWidth: 600, margin: '0 auto', background: '#1a1a1a', padding: 30, borderRadius: 8, border: '1px solid #333'}}>
                <h2 style={{marginTop: 0, borderBottom: '1px solid #333', paddingBottom: 15, marginBottom: 20}}>Global Configuration</h2>
                
                <div style={{marginBottom: 20}}>
                    <label style={styles.label}>Profit Margin (%)</label>
                    <div style={{fontSize: 12, color: '#888', marginBottom: 5}}>
                        Added to the base cost of AI models. E.g., 60% means Cost + (Cost * 0.6).
                    </div>
                    <input 
                        type="number" 
                        style={styles.inputFull} 
                        value={config.profit_margin_percent}
                        onChange={e => setConfig({...config, profit_margin_percent: Number(e.target.value)})}
                    />
                </div>

                <div style={{marginBottom: 20}}>
                    <label style={styles.label}>USD to IDR Rate</label>
                    <div style={{fontSize: 12, color: '#888', marginBottom: 5}}>
                        Digunakan untuk konversi TopUp dan tampilan biaya dalam IDR.
                    </div>
                    <input 
                        type="number" 
                        style={styles.inputFull} 
                        value={config.usd_idr_rate}
                        onChange={e => setConfig({...config, usd_idr_rate: Number(e.target.value)})}
                    />
                    <div style={{marginTop: 10, display:'flex', alignItems:'center', gap:8}}>
                        <input 
                            type="checkbox" 
                            checked={!!config.usd_idr_auto_sync}
                            onChange={e => setConfig({...config, usd_idr_auto_sync: e.target.checked})}
                        />
                        <span style={{fontSize: 12, color:'#aaa'}}>Auto-sync kurs USD→IDR saat aplikasi dibuka (refresh ~1 jam)</span>
                    </div>
                    <div style={{fontSize: 12, color:'#888', marginTop:8}}>
                        Terakhir diperbarui: {config.usd_idr_rate_last_update ? new Date(Number(config.usd_idr_rate_last_update)).toLocaleString() : '-'}
                    </div>
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 30}}>
                    <button 
                        onClick={saveConfig} 
                        disabled={isSubmitting}
                        style={{...styles.btnPrimary, padding: '10px 24px', opacity: isSubmitting ? 0.7 : 1}}
                    >
                        {isSubmitting ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
          </>
      ) : activeTab === 'auth_logs' ? (
          <>
            <div style={{display:'flex', justifyContent:'flex-end', marginBottom:20}}>
                <button onClick={fetchAuthLogs} style={styles.btnOutline}>Refresh Logs</button>
            </div>
            <div style={styles.tableContainer}>
                {loading ? <div style={{padding:20, textAlign:'center'}}>Loading...</div> : (
                <table style={styles.table}>
                    <thead>
                        <tr style={{background:'#f8f9fa', borderBottom:'2px solid #eee'}}>
                            <th style={{...styles.th, width: '5%'}}>ID</th>
                            <th style={{...styles.th, width: '15%'}}>Timestamp</th>
                            <th style={{...styles.th, width: '20%'}}>Email</th>
                            <th style={{...styles.th, width: '10%'}}>Action</th>
                            <th style={{...styles.th, width: '15%'}}>IP Address</th>
                            <th style={{...styles.th, width: '20%'}}>Device Hash</th>
                            <th style={{...styles.th, width: '15%'}}>User ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        {authLogs.length === 0 ? (
                             <tr><td colSpan={7} style={{padding:20, textAlign:'center', color:'#888'}}>No logs found</td></tr>
                        ) : (
                            authLogs.map((log) => (
                                <tr key={log.id} style={{borderBottom:'1px solid #eee'}}>
                                    <td style={styles.td}>#{log.id}</td>
                                    <td style={styles.td}>{new Date(log.timestamp * 1000).toLocaleString()}</td>
                                    <td style={styles.td}>{log.email}</td>
                                    <td style={styles.td}>
                                        <span style={{
                                            padding: '2px 6px', borderRadius: 4, fontSize: 11,
                                            background: log.action === 'login' ? '#e3f2fd' : '#e8f5e9',
                                            color: log.action === 'login' ? '#1565c0' : '#2e7d32'
                                        }}>
                                            {log.action.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style={styles.td}>{log.ip_address}</td>
                                    <td style={{...styles.td, fontFamily:'monospace', fontSize:11}}>{log.device_hash ? log.device_hash.substring(0, 16) + '...' : '-'}</td>
                                    <td style={{...styles.td, fontFamily:'monospace', fontSize:11}}>{log.user_id ? log.user_id.substring(0, 8) + '...' : '-'}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                )}
            </div>
          </>
      ) : (
          <>
            {/* MODEL PRICES MANAGEMENT */}
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:20, alignItems:'center'}}>
              <div style={{display:'flex', gap:10}}>
                  <button onClick={() => setMpEditing({ provider: 'openai', model_name: '', input_price: 0, output_price: 0, profit_multiplier: 1.6, active: 1, fallback_priority: 1 })} style={styles.btnPrimary}>+ Add Model Price</button>
                  <select 
                    value={priceFilter} 
                    onChange={e => setPriceFilter(e.target.value)}
                    style={{padding: '8px 12px', borderRadius: 6, border: '1px solid #444', background: '#222', color: '#fff'}}
                  >
                    <option value="all">All Providers</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="groq">Groq</option>
                  </select>
              </div>
              <div style={{display:'flex', gap:10}}>
                <button onClick={seedOfficialPrices} disabled={isSubmitting} style={styles.btnOutline}>{isSubmitting ? 'Seeding...' : 'Seed Official Prices'}</button>
                <button onClick={async ()=>{
                  if (!confirm('Sync live prices from OpenAI & Gemini?')) return;
                  setIsSubmitting(true);
                  try {
                    const res = await fetch(`${API_URL}/admin/model-prices/sync-live`, { method:'POST', headers: getHeaders() });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || 'Sync failed');
                    alert(`Live synced ${data.count} models`);
                    fetchModelPrices();
                  } catch(e:any) { alert('Sync error: ' + e.message); } finally { setIsSubmitting(false); }
                }} style={styles.btnOutline}>{isSubmitting ? 'Syncing...' : 'Sync Live Prices'}</button>
              </div>
            </div>

            <div style={{...styles.tableContainer, maxHeight: '600px', overflowY: 'auto'}}>
              {mpLoading ? (
                <div style={{padding:20, textAlign:'center'}}>Loading...</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr style={{background:'#f8f9fa', borderBottom:'2px solid #eee'}}>
                      <th style={{...styles.th, width: '10%'}}>Provider</th>
                      <th style={{...styles.th, width: '25%'}}>Model</th>
                      <th style={{...styles.th, width: '15%'}}>Input $/1M</th>
                      <th style={{...styles.th, width: '15%'}}>Output $/1M</th>
                      <th style={{...styles.th, width: '10%'}}>Active</th>
                      <th style={{...styles.th, width: '10%'}}>Priority</th>
                      <th style={{...styles.th, width: '15%'}}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelPrices.length === 0 ? (
                      <tr><td colSpan={7} style={{padding:20, textAlign:'center', color:'#888'}}>No model prices</td></tr>
                    ) : (
                      modelPrices
                        .filter(mp => priceFilter === 'all' || mp.provider === priceFilter)
                        .map((mp: any) => (
                        <tr key={mp.id} style={{borderBottom:'1px solid #eee'}}>
                          <td style={styles.td}>{mp.provider}</td>
                          <td style={{...styles.td, fontFamily:'monospace'}}>{mp.model_name}</td>
                          <td style={styles.td}>${Number(mp.input_price).toFixed(2)}</td>
                          <td style={styles.td}>${Number(mp.output_price).toFixed(2)}</td>
                          <td style={styles.td}>{mp.active === 1 ? 'Yes' : 'No'}</td>
                          <td style={styles.td}>{mp.fallback_priority}</td>
                          <td style={styles.td}>
                            <div style={{display:'flex', gap:6}}>
                              <button onClick={() => setMpEditing(mp)} style={styles.btnSmall}>Edit</button>
                              <button onClick={() => deleteModelPrice(mp.id)} style={{...styles.btnSmall, background:'#dc3545', color:'#fff'}}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {mpEditing && (
              <div style={styles.modalOverlay}>
                <div style={{...styles.modalContent, width: 600}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0}}>{mpEditing.id ? 'Edit Model Price' : 'Add Model Price'}</h2>
                    <button onClick={() => setMpEditing(null)} style={styles.closeBtn}>✕</button>
                  </div>

                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:15}}>
                    <div>
                      <label style={styles.label}>Provider</label>
                      <select value={mpEditing.provider} onChange={e => setMpEditing({...mpEditing, provider: e.target.value})} style={styles.inputFull}>
                        <option value="openai">OpenAI</option>
                        <option value="gemini">Gemini</option>
                      </select>
                    </div>
                    <div>
                      <label style={styles.label}>Model Name</label>
                      <input type="text" value={mpEditing.model_name} onChange={e => setMpEditing({...mpEditing, model_name: e.target.value})} style={styles.inputFull} />
                    </div>
                    <div>
                      <label style={styles.label}>Input Price ($/1M)</label>
                      <input type="number" step="0.001" value={mpEditing.input_price} onChange={e => setMpEditing({...mpEditing, input_price: Number(e.target.value)})} style={styles.inputFull} />
                    </div>
                    <div>
                      <label style={styles.label}>Output Price ($/1M)</label>
                      <input type="number" step="0.001" value={mpEditing.output_price} onChange={e => setMpEditing({...mpEditing, output_price: Number(e.target.value)})} style={styles.inputFull} />
                    </div>
                    <div>
                      <label style={styles.label}>Active</label>
                      <select value={mpEditing.active ? 1 : 0} onChange={e => setMpEditing({...mpEditing, active: Number(e.target.value) === 1})} style={styles.inputFull}>
                        <option value={1}>Yes</option>
                        <option value={0}>No</option>
                      </select>
                    </div>
                    <div>
                      <label style={styles.label}>Fallback Priority</label>
                      <input type="number" value={mpEditing.fallback_priority ?? 1} onChange={e => setMpEditing({...mpEditing, fallback_priority: Number(e.target.value)})} style={styles.inputFull} />
                    </div>
                  </div>

                  <div style={{display:'flex', justifyContent:'flex-end', marginTop: 20}}>
                    <button onClick={() => upsertModelPrice(mpEditing)} disabled={isSubmitting} style={{...styles.btnPrimary, padding: '10px 24px'}}>{isSubmitting ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            )}
          </>
      )}

      {/* Detail Modal (Transaction) */}
      {selectedTx && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <h2 style={{margin:0}}>Transaction Detail #{selectedTx.id}</h2>
                <button onClick={() => setSelectedTx(null)} style={styles.closeBtn}>✕</button>
            </div>
            
            <div style={styles.modalGrid}>
                <div style={styles.modalRow}>
                    <strong>User Email:</strong> <span>{selectedTx.user_email}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>User ID:</strong> <span style={{fontSize:12, fontFamily:'monospace'}}>{selectedTx.user_id}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Current Balance:</strong> <span>{selectedTx.user_balance?.toLocaleString() || 0} tokens</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Date:</strong> <span>{new Date(selectedTx.created_at).toLocaleString()}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Method:</strong> <span>{selectedTx.method.toUpperCase()}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Status:</strong> 
                    <span style={{
                          ...styles.badge, 
                          backgroundColor: selectedTx.status === 'paid' ? '#28a745' : selectedTx.status === 'pending' ? '#ffc107' : '#dc3545',
                          color: selectedTx.status === 'pending' ? '#333' : '#fff'
                    }}>{selectedTx.status}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Amount:</strong> 
                    <span>{selectedTx.method === 'paypal' ? `$${selectedTx.amount_usd}` : `Rp ${selectedTx.amount_rp?.toLocaleString()}`}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Tokens Added:</strong> <span>{selectedTx.tokens_added.toLocaleString()}</span>
                </div>
                <div style={styles.modalRow}>
                    <strong>Payment Ref:</strong> <span style={{fontSize:12, fontFamily:'monospace'}}>{selectedTx.payment_ref || '-'}</span>
                </div>
            </div>

            <div style={{marginTop:30, display:'flex', justifyContent:'flex-end', gap:10}}>
                <button onClick={() => setSelectedTx(null)} style={styles.btnOutline}>Close</button>
                {selectedTx.status === 'pending' && (
                    <button onClick={() => handleApprove(selectedTx.id)} style={{...styles.btnPrimary, background:'#28a745'}}>Manual Approve</button>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Create Voucher Modal */}
      {showCreateVoucher && (
          <div style={styles.modalOverlay}>
              <div style={styles.modalContent}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0}}>Create New Voucher</h2>
                    <button onClick={() => setShowCreateVoucher(false)} style={styles.closeBtn}>✕</button>
                </div>
                
                <div style={{display:'flex', flexDirection:'column', gap:15}}>
                    
                    {/* Mode Toggle */}
                    <div style={{display:'flex', gap:15, borderBottom:'1px solid #eee', paddingBottom:15}}>
                        <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight: !newVoucher.is_bulk ? 'bold' : 'normal'}}>
                            <input 
                                type="radio" 
                                name="isBulk" 
                                checked={!newVoucher.is_bulk}
                                onChange={() => setNewVoucher({...newVoucher, is_bulk: false})}
                            />
                            Single Custom Code
                        </label>
                        <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight: newVoucher.is_bulk ? 'bold' : 'normal'}}>
                            <input 
                                type="radio" 
                                name="isBulk" 
                                checked={newVoucher.is_bulk}
                                onChange={() => setNewVoucher({...newVoucher, is_bulk: true, max_usage: 1})}
                            />
                            Bulk Generate (Random)
                        </label>
                    </div>

                    {!newVoucher.is_bulk ? (
                        <div>
                            <label style={styles.label}>Voucher Code</label>
                            <input 
                                type="text" 
                                style={styles.inputFull} 
                                placeholder="e.g. WELCOME2025"
                                value={newVoucher.code}
                                onChange={e => setNewVoucher({...newVoucher, code: e.target.value.toUpperCase()})}
                            />
                        </div>
                    ) : (
                        <div>
                            <label style={styles.label}>Quantity (Jumlah)</label>
                            <input 
                                type="number" 
                                style={styles.inputFull} 
                                value={newVoucher.quantity}
                                onChange={e => setNewVoucher({...newVoucher, quantity: Number(e.target.value)})}
                                min={1}
                                max={500}
                            />
                            <small style={{color:'#666'}}>Max 500 per batch. Auto-generated 6-char codes.</small>
                        </div>
                    )}
                    <div>
                        <label style={styles.label}>Input Mode</label>
                        <div style={{display:'flex', gap:15, marginBottom:10}}>
                            <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
                                <input 
                                    type="radio" 
                                    name="voucherMode" 
                                    checked={voucherMode === 'rupiah'}
                                    onChange={() => {
                                        setVoucherMode('rupiah');
                                        setNewVoucher({...newVoucher, amount: voucherRupiah});
                                    }}
                                />
                                Rupiah (IDR)
                            </label>
                            <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
                                <input 
                                    type="radio" 
                                    name="voucherMode" 
                                    checked={voucherMode === 'dollar'}
                                    onChange={() => {
                                        setVoucherMode('dollar');
                                        const tokens = Math.floor(voucherDollar * (config.usd_idr_rate || 0));
                                        setNewVoucher({...newVoucher, amount: tokens});
                                    }}
                                />
                                Dollar (USD)
                            </label>
                        </div>

                        {voucherMode === 'rupiah' ? (
                            <>
                                <label style={styles.label}>Rupiah Amount</label>
                                <input 
                                    type="number" 
                                    style={styles.inputFull} 
                                    value={voucherRupiah}
                                    onChange={e => {
                                        const val = Number(e.target.value);
                                        setVoucherRupiah(val);
                                        setNewVoucher({...newVoucher, amount: val});
                                    }}
                                />
                                <div style={{fontSize: 12, color: '#888', marginTop: 5}}>
                                    Token Amount: <b>{voucherRupiah.toLocaleString()}</b> (1 IDR = 1 Token)
                                </div>
                            </>
                        ) : (
                            <>
                                <label style={styles.label}>Dollar Amount</label>
                                <input 
                                    type="number" 
                                    style={styles.inputFull} 
                                    value={voucherDollar}
                                    onChange={e => {
                                        const val = Number(e.target.value);
                                        setVoucherDollar(val);
                                        const tokens = Math.floor(val * (config.usd_idr_rate || 0));
                                        setNewVoucher({...newVoucher, amount: tokens});
                                    }}
                                />
                                <div style={{fontSize: 12, color: '#888', marginTop: 5}}>
                                    Token Amount: <b>{Math.floor(voucherDollar * (config.usd_idr_rate || 0)).toLocaleString()}</b> (Rate: 1 USD = {(config.usd_idr_rate || 0).toLocaleString()} IDR)
                                </div>
                            </>
                        )}
                    </div>
                    <div>
                        <label style={styles.label}>Max Usage Limit</label>
                        <input 
                            type="number" 
                            style={styles.inputFull} 
                            value={newVoucher.max_usage}
                            onChange={e => setNewVoucher({...newVoucher, max_usage: Number(e.target.value)})}
                        />
                        <small style={{color:'#666'}}>0 = Unlimited</small>
                    </div>
                    <div>
                        <label style={styles.label}>Expiration Date (Optional)</label>
                        <input 
                            type="datetime-local" 
                            style={styles.inputFull} 
                            value={newVoucher.expires_at}
                            onChange={e => setNewVoucher({...newVoucher, expires_at: e.target.value})}
                        />
                    </div>
                    
                    <div style={{borderTop:'1px solid #eee', paddingTop:15}}>
                        <label style={styles.label}>Target Users</label>
                        <div style={{display:'flex', gap:15, marginBottom:10}}>
                            <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
                                <input 
                                    type="radio" 
                                    name="target" 
                                    checked={newVoucher.target_type === 'public'}
                                    onChange={() => setNewVoucher({...newVoucher, target_type: 'public'})}
                                />
                                Public (Anyone)
                            </label>
                            <label style={{cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
                                <input 
                                    type="radio" 
                                    name="target" 
                                    checked={newVoucher.target_type === 'specific'}
                                    onChange={() => setNewVoucher({...newVoucher, target_type: 'specific'})}
                                />
                                Specific Emails
                            </label>
                        </div>
                        
                        {newVoucher.target_type === 'specific' && (
                            <textarea
                                style={{...styles.inputFull, height:80, fontFamily:'monospace'}}
                                placeholder="email1@example.com, email2@example.com"
                                value={newVoucher.allowed_emails}
                                onChange={e => setNewVoucher({...newVoucher, allowed_emails: e.target.value})}
                            />
                        )}
                    </div>

                    <div style={{marginTop:20, display:'flex', justifyContent:'flex-end', gap:10}}>
                        <button onClick={() => setShowCreateVoucher(false)} style={styles.btnOutline} disabled={isSubmitting}>Cancel</button>
                        <button 
                            onClick={handleCreateVoucherSubmit} 
                            style={{...styles.btnPrimary, opacity: isSubmitting ? 0.7 : 1, cursor: isSubmitting ? 'not-allowed' : 'pointer'}}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Creating...' : 'Create Voucher'}
                        </button>
                    </div>
                </div>
              </div>
          </div>
      )}

      {resetPassModal && (
        <div style={styles.modalOverlay}>
            <div style={{...styles.modalContent, width: 400}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h3 style={{margin:0}}>Reset Password</h3>
                    <button onClick={() => setResetPassModal(null)} style={styles.closeBtn}>✕</button>
                </div>
                
                <div style={{marginBottom:15}}>
                    <label style={{display:'block', marginBottom:5, fontWeight:500}}>User</label>
                    <div style={{padding:8, background:'#f5f5f5', borderRadius:4, fontSize:13}}>{resetPassModal.email}</div>
                </div>

                <div style={{marginBottom:20}}>
                    <label style={{display:'block', marginBottom:5, fontWeight:500}}>New Password</label>
                    <input 
                        type="text" 
                        style={styles.inputFull}
                        placeholder="Enter new password"
                        value={resetPassModal.new_pass}
                        onChange={e => setResetPassModal({...resetPassModal, new_pass: e.target.value})}
                    />
                    <small style={{color:'#666'}}>Minimum 6 characters</small>
                </div>

                <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                    <button onClick={() => setResetPassModal(null)} style={styles.btnOutline}>Cancel</button>
                    <button 
                        onClick={handleResetPassword}
                        disabled={isSubmitting}
                        style={{...styles.btnPrimary, background:'#ff9800', opacity: isSubmitting ? 0.7 : 1}}
                    >
                        {isSubmitting ? 'Saving...' : 'Reset Password'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {subModal && (
        <div style={styles.modalOverlay}>
            <div style={{...styles.modalContent, width: 400}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h3 style={{margin:0}}>Manage Subscription</h3>
                    <button onClick={() => setSubModal(null)} style={styles.closeBtn}>✕</button>
                </div>
                {subSuccess && (
                    <div style={{marginBottom:15, padding:10, background:'#d4edda', color:'#155724', borderRadius:4, textAlign:'center'}}>
                        Subscription updated successfully!
                    </div>
                )}
                <div style={{marginBottom:15}}>
                    <label style={{display:'block', marginBottom:5, fontSize:12, color:'#888'}}>User</label>
                    <div style={{fontWeight:'bold'}}>{subModal.email}</div>
                </div>
                <div style={{marginBottom:15}}>
                    <label style={{display:'block', marginBottom:5, fontSize:12, color:'#888'}}>Status</label>
                    <div style={{display:'flex', gap:10}}>
                        <label style={{display:'flex', alignItems:'center', gap:5, cursor:'pointer'}}>
                            <input 
                                type="radio" 
                                checked={subModal.is_active} 
                                onChange={() => {
                                    // Auto-set 30 days if enabling and no date set
                                    let newDate = subModal.expiry_date;
                                    if (!newDate || new Date(newDate) <= new Date()) {
                                        const d = new Date();
                                        d.setDate(d.getDate() + 30);
                                        newDate = d.toISOString();
                                    }
                                    setSubModal({...subModal, is_active: true, expiry_date: newDate});
                                }} 
                                disabled={subSaving}
                            /> 
                            <span style={{color: '#28a745', fontWeight: subModal.is_active ? 'bold' : 'normal'}}>Active</span>
                        </label>
                        <label style={{display:'flex', alignItems:'center', gap:5, cursor:'pointer'}}>
                            <input 
                                type="radio" 
                                checked={!subModal.is_active} 
                                onChange={() => setSubModal({...subModal, is_active: false})} 
                                disabled={subSaving}
                            /> 
                            <span style={{color: '#dc3545', fontWeight: !subModal.is_active ? 'bold' : 'normal'}}>Inactive</span>
                        </label>
                    </div>
                </div>
                <div style={{marginBottom:20}}>
                    <label style={{display:'block', marginBottom:5, fontSize:12, color:'#888'}}>Expiry Date (Local Time)</label>
                    <input 
                        type="datetime-local" 
                        value={subModal.expiry_date ? new Date(new Date(subModal.expiry_date).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}
                        onChange={(e) => setSubModal({...subModal, expiry_date: new Date(e.target.value).toISOString()})}
                        style={{width:'100%', padding:8, borderRadius:4, border:'1px solid #ddd', background:'#222', color:'#fff'}}
                        disabled={!subModal.is_active || subSaving}
                    />
                    {subModal.is_active && subModal.expiry_date && (
                        <div style={{fontSize:11, color:'#888', marginTop:6}}>
                            Duration: {Math.max(0, Math.ceil((new Date(subModal.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))} Days remaining
                        </div>
                    )}
                    {subModal.is_active && (
                        <div style={{fontSize:11, color:'#888', marginTop:6, display:'flex', gap:10}}>
                            Quick Set: 
                            <button onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 7);
                                setSubModal({...subModal, expiry_date: d.toISOString()});
                            }} disabled={subSaving} style={{textDecoration:'underline', border:'none', background:'none', color: subSaving ? '#666' : '#2196f3', cursor: subSaving ? 'not-allowed' : 'pointer', padding:0}}>+7 Days</button>
                            <button onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 30);
                                setSubModal({...subModal, expiry_date: d.toISOString()});
                            }} disabled={subSaving} style={{textDecoration:'underline', border:'none', background:'none', color: subSaving ? '#666' : '#2196f3', cursor: subSaving ? 'not-allowed' : 'pointer', padding:0}}>+30 Days</button>
                            <button onClick={() => {
                                const d = new Date();
                                d.setFullYear(d.getFullYear() + 1);
                                setSubModal({...subModal, expiry_date: d.toISOString()});
                            }} disabled={subSaving} style={{textDecoration:'underline', border:'none', background:'none', color: subSaving ? '#666' : '#2196f3', cursor: subSaving ? 'not-allowed' : 'pointer', padding:0}}>+1 Year</button>
                        </div>
                    )}
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                    <button onClick={() => setSubModal(null)} style={styles.btnOutline} disabled={subSaving}>Cancel</button>
                    <button id="saveSubBtn" onClick={handleUpdateSub} disabled={subSaving} style={{...styles.btnPrimary, opacity: subSaving ? 0.7 : 1}}>
                        {subSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Usage Report Modal */}
      {selectedUser && (
        <div style={styles.modalOverlay}>
          <div style={{...styles.modalContent, maxWidth: 800}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <h2 style={{margin:0}}>Usage Report: {selectedUser.email}</h2>
                <button onClick={() => setSelectedUser(null)} style={styles.closeBtn}>✕</button>
            </div>
            
            <div style={{maxHeight: 500, overflowY: 'auto'}}>
                {usageLoading ? <div style={{padding:20, textAlign:'center'}}>Loading Usage Data...</div> : (
                    <table style={styles.table}>
                        <thead>
                            <tr style={{background:'#f8f9fa', borderBottom:'2px solid #eee'}}>
                                <th style={{...styles.th, width: '20%'}}>Date</th>
                                <th style={{...styles.th, width: '15%'}}>Input Tokens</th>
                                <th style={{...styles.th, width: '15%'}}>Output Tokens</th>
                                <th style={{...styles.th, width: '15%'}}>Cost (USD)</th>
                                <th style={{...styles.th, width: '20%'}}>Cost (IDR)</th>
                                <th style={{...styles.th, width: '15%'}}>Requests</th>
                            </tr>
                        </thead>
                        <tbody>
                            {userUsage.length === 0 ? (
                                <tr><td colSpan={6} style={{padding:20, textAlign:'center', color:'#888'}}>No usage history found</td></tr>
                            ) : (
                                userUsage.map((row: any, i) => (
                                    <tr key={i} style={{borderBottom:'1px solid #eee'}}>
                                        <td style={styles.td}>{row.day}</td>
                                        <td style={styles.td}>{row.total_input?.toLocaleString()}</td>
                                        <td style={styles.td}>{row.total_output?.toLocaleString()}</td>
                                        <td style={styles.td}>${row.total_cost ? row.total_cost.toFixed(4) : '0.00'}</td>
                                        <td style={styles.td}>{(config.usd_idr_rate && config.usd_idr_rate > 0) ? `Rp ${Math.floor((row.total_cost || 0) * config.usd_idr_rate).toLocaleString()}` : 'Rp N/A'}</td>
                                        <td style={styles.td}>{row.request_count}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            <div style={{marginTop:20, display:'flex', justifyContent:'flex-end'}}>
                <button onClick={() => setSelectedUser(null)} style={styles.btnOutline}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0, color:'#f44336'}}>Delete User</h2>
                    <button onClick={() => setDeleteConfirmModal(null)} style={styles.closeBtn}>✕</button>
                </div>
                
                <div style={{marginBottom:20}}>
                    <p style={{margin:0, fontSize:14, lineHeight:1.5}}>
                        Are you sure you want to delete user <strong>{deleteConfirmModal.email}</strong>?
                    </p>
                    <p style={{margin:'10px 0 0', fontSize:12, color:'#f44336', fontWeight:'bold'}}>
                        This action cannot be undone. All user data, including tokens and usage history, will be permanently removed.
                    </p>
                </div>

                <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                    <button onClick={() => setDeleteConfirmModal(null)} style={styles.btnOutline} disabled={isSubmitting}>Cancel</button>
                    <button onClick={handleDeleteUser} disabled={isSubmitting} style={{...styles.btnPrimary, background: '#f44336', opacity: isSubmitting ? 0.7 : 1}}>
                        {isSubmitting ? 'Deleting...' : 'Delete User'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Bulk Create Voucher Modal */}
      {showBulkCreateVoucher && (
        <div style={styles.modalOverlay}>
            <div style={{...styles.modalContent, maxWidth: 600}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0}}>Generate Voucher Massal</h2>
                    <button onClick={() => { setShowBulkCreateVoucher(false); setBulkCreatedCodes(null); }} style={styles.closeBtn}>✕</button>
                </div>

                {!bulkCreatedCodes ? (
                    <div style={styles.modalGrid}>
                         <div style={styles.modalRow}>
                            <label style={styles.label}>Voucher Type</label>
                            <select 
                                value={newVoucher.type}
                                onChange={(e) => setNewVoucher({...newVoucher, type: e.target.value as 'token' | 'subscription'})}
                                style={styles.input}
                            >
                                <option value="token">Token</option>
                                <option value="subscription">Subscription</option>
                            </select>
                        </div>

                        {newVoucher.type === 'token' ? (
                            <div style={styles.modalRow}>
                                <label style={styles.label}>Nominal Token (Amount)</label>
                                <input 
                                    type="number" 
                                    value={newVoucher.amount}
                                    onChange={(e) => setNewVoucher({...newVoucher, amount: Number(e.target.value)})}
                                    style={styles.input}
                                />
                            </div>
                        ) : (
                            <div style={styles.modalRow}>
                                <label style={styles.label}>Duration (Days)</label>
                                <input 
                                    type="number" 
                                    value={newVoucher.duration_days}
                                    onChange={(e) => setNewVoucher({...newVoucher, duration_days: Number(e.target.value)})}
                                    style={styles.input}
                                />
                            </div>
                        )}

                        <div style={styles.modalRow}>
                            <label style={styles.label}>Jumlah Voucher (Qty)</label>
                            <input 
                                type="number" 
                                value={newVoucher.quantity}
                                onChange={(e) => setNewVoucher({...newVoucher, quantity: Number(e.target.value)})}
                                style={styles.input}
                                min="1"
                                max="500"
                            />
                        </div>
                        <div style={styles.modalRow}>
                            <label style={styles.label}>Max Usage (Per Voucher)</label>
                            <input 
                                type="number" 
                                value={newVoucher.max_usage}
                                onChange={(e) => setNewVoucher({...newVoucher, max_usage: Number(e.target.value)})}
                                style={styles.input}
                                placeholder="0 for unlimited"
                            />
                        </div>
                        <div style={styles.modalRow}>
                            <label style={styles.label}>Expiry Date (Optional)</label>
                            <input 
                                type="datetime-local" 
                                value={newVoucher.expires_at}
                                onChange={(e) => setNewVoucher({...newVoucher, expires_at: e.target.value})}
                                style={styles.input}
                            />
                        </div>

                        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20, gap:10}}>
                            <button onClick={() => setShowBulkCreateVoucher(false)} style={styles.btnOutline} disabled={isSubmitting}>Cancel</button>
                            <button onClick={handleBulkCreate} disabled={isSubmitting} style={{...styles.btnPrimary, background: '#6f42c1', opacity: isSubmitting ? 0.7 : 1}}>
                                {isSubmitting ? 'Generating...' : 'Generate Codes'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div style={{background:'#d4edda', color:'#155724', padding:15, borderRadius:4, marginBottom:20, textAlign:'center'}}>
                            <strong>Success!</strong> {bulkCreatedCodes.length} vouchers created.
                        </div>
                        
                        <div style={{marginBottom:20}}>
                            <label style={styles.label}>Generated Codes:</label>
                            <textarea 
                                readOnly 
                                value={bulkCreatedCodes.join("\n")}
                                style={{width:'100%', height:200, background:'#111', color:'#0f0', border:'1px solid #333', padding:10, fontFamily:'monospace', fontSize:12}} 
                            />
                        </div>

                        <div style={{display:'flex', justifyContent:'space-between', gap:10}}>
                            <button onClick={copyBulkCodes} style={styles.btnOutline}>Copy All Codes</button>
                            <div style={{display:'flex', gap:10}}>
                                <button onClick={downloadBulkCSV} style={{...styles.btnPrimary, background:'#28a745'}}>Download CSV</button>
                                <button onClick={() => { setShowBulkCreateVoucher(false); setBulkCreatedCodes(null); }} style={styles.btnPrimary}>Done</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* Create Single Voucher Modal */}
      {showCreateVoucher && (
        <div style={styles.modalOverlay}>
            <div style={{...styles.modalContent, maxWidth: 600}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0}}>Create New Voucher</h2>
                    <button onClick={() => setShowCreateVoucher(false)} style={styles.closeBtn}>✕</button>
                </div>

                <div style={{display: 'flex', flexDirection: 'column', gap: 15}}>
                    
                    {/* Voucher Type */}
                    <div>
                        <label style={styles.label}>Voucher Type</label>
                        <select 
                            value={newVoucher.type}
                            onChange={(e) => setNewVoucher({...newVoucher, type: e.target.value as 'token' | 'subscription'})}
                            style={styles.inputFull}
                        >
                            <option value="token">Token</option>
                            <option value="subscription">Subscription</option>
                        </select>
                    </div>

                    {/* Conditional Fields */}
                    {newVoucher.type === 'token' ? (
                        <div>
                            <label style={styles.label}>Token Amount</label>
                            <input 
                                type="number" 
                                value={newVoucher.amount}
                                onChange={(e) => setNewVoucher({...newVoucher, amount: Number(e.target.value)})}
                                style={styles.inputFull}
                            />
                        </div>
                    ) : (
                        <div>
                            <label style={styles.label}>Duration (Days)</label>
                            <input 
                                type="number" 
                                value={newVoucher.duration_days}
                                onChange={(e) => setNewVoucher({...newVoucher, duration_days: Number(e.target.value)})}
                                style={styles.inputFull}
                            />
                        </div>
                    )}

                    {/* Voucher Code */}
                    <div>
                        <label style={styles.label}>Voucher Code</label>
                        <input 
                            type="text" 
                            value={newVoucher.code}
                            onChange={(e) => setNewVoucher({...newVoucher, code: e.target.value.toUpperCase()})}
                            style={styles.inputFull}
                            placeholder="e.g., PROMO2024"
                        />
                    </div>

                    {/* Max Usage */}
                    <div>
                        <label style={styles.label}>Max Usage</label>
                        <input 
                            type="number" 
                            value={newVoucher.max_usage}
                            onChange={(e) => setNewVoucher({...newVoucher, max_usage: Number(e.target.value)})}
                            style={styles.inputFull}
                            placeholder="0 for unlimited"
                        />
                    </div>

                    {/* Expiry Date */}
                    <div>
                        <label style={styles.label}>Expiry Date (Optional)</label>
                        <input 
                            type="datetime-local" 
                            value={newVoucher.expires_at}
                            onChange={(e) => setNewVoucher({...newVoucher, expires_at: e.target.value})}
                            style={styles.inputFull}
                        />
                    </div>

                    {/* Target Type */}
                    <div>
                        <label style={styles.label}>Target Audience</label>
                        <select 
                            value={newVoucher.target_type}
                            onChange={(e) => setNewVoucher({...newVoucher, target_type: e.target.value as 'public' | 'specific'})}
                            style={styles.inputFull}
                        >
                            <option value="public">Public</option>
                            <option value="specific">Specific Emails</option>
                        </select>
                    </div>

                    {/* Allowed Emails (Conditional) */}
                    {newVoucher.target_type === 'specific' && (
                        <div>
                            <label style={styles.label}>Allowed Emails (comma-separated)</label>
                            <textarea 
                                value={newVoucher.allowed_emails}
                                onChange={(e) => setNewVoucher({...newVoucher, allowed_emails: e.target.value})}
                                style={{...styles.inputFull, height: 60}}
                                placeholder="user1@example.com, user2@example.com"
                            />
                        </div>
                    )}
                </div>

                <div style={{display:'flex', justifyContent:'flex-end', marginTop:20, gap:10}}>
                    <button onClick={() => setShowCreateVoucher(false)} style={styles.btnOutline} disabled={isSubmitting}>Cancel</button>
                    <button onClick={handleCreateVoucherSubmit} disabled={isSubmitting} style={{...styles.btnPrimary, opacity: isSubmitting ? 0.7 : 1}}>
                        {isSubmitting ? 'Creating...' : 'Create Voucher'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Voucher Delete Modal - Moved outside activeTab to ensure visibility */}
      {voucherDeleteModal && (
          <div style={{...styles.modalOverlay, zIndex: 9999}}>
              <div style={{...styles.modalContent, width: 350}}>
                  <div style={{textAlign:'center', marginBottom:20}}>
                      <div style={{fontSize:40, marginBottom:10}}>⚠️</div>
                      <h3 style={{margin:0, color:'#dc3545'}}>Confirm Deletion</h3>
                  </div>
                  <div style={{textAlign:'center', marginBottom:25, lineHeight:1.5}}>
                      Are you sure you want to delete voucher <br/>
                      <strong style={{fontFamily:'monospace', fontSize:16, background:'#333', padding:'2px 6px', borderRadius:4}}>{voucherDeleteModal.code}</strong>?
                      <br/><br/>
                      <span style={{fontSize:12, color:'#888'}}>This action cannot be undone.</span>
                  </div>
                  <div style={{display:'flex', justifyContent:'center', gap:15}}>
                      <button onClick={() => setVoucherDeleteModal(null)} style={{...styles.btnOutline, width:100}}>Cancel</button>
                      <button onClick={confirmDeleteVoucher} style={{...styles.btnPrimary, background:'#dc3545', width:100}}>Delete</button>
                  </div>
              </div>
          </div>
      )}

      {/* Extend Voucher Modal - Moved outside activeTab */}
      {extendModal && (
          <div style={{...styles.modalOverlay, zIndex: 9999}}>
              <div style={{...styles.modalContent, width: 400}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                      <h3 style={{margin:0}}>Extend Voucher Validity</h3>
                      <button onClick={() => setExtendModal(null)} style={styles.closeBtn}>✕</button>
                  </div>
                  <div style={{marginBottom:15}}>
                      <label style={styles.label}>Voucher Code</label>
                      <input 
                          type="text" 
                          value={extendModal.code} 
                          disabled 
                          style={{...styles.input, opacity:0.7, cursor:'not-allowed'}}
                      />
                  </div>
                  <div style={{marginBottom:20}}>
                      <label style={styles.label}>Extend By (Days)</label>
                      <div style={{display:'flex', gap:10}}>
                          {[7, 30, 90, 365].map(d => (
                              <button 
                                  key={d}
                                  onClick={() => setExtendModal({...extendModal, days: d})}
                                  style={{
                                      ...styles.btnOutline, 
                                      flex:1,
                                      borderColor: extendModal.days === d ? '#28a745' : '#444',
                                      background: extendModal.days === d ? 'rgba(40, 167, 69, 0.1)' : 'transparent',
                                      color: extendModal.days === d ? '#28a745' : '#ccc'
                                  }}
                              >
                                  {d} Days
                              </button>
                          ))}
                      </div>
                      <div style={{marginTop:10}}>
                          <input 
                              type="number" 
                              value={extendModal.days}
                              onChange={(e) => setExtendModal({...extendModal, days: Number(e.target.value)})}
                              style={styles.input}
                              placeholder="Custom days"
                          />
                      </div>
                  </div>
                  <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                      <button onClick={() => setExtendModal(null)} style={styles.btnOutline}>Cancel</button>
                      <button onClick={handleExtend} disabled={isSubmitting} style={{...styles.btnPrimary, background:'#28a745'}}>
                          {isSubmitting ? 'Extending...' : 'Confirm Extension'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const styles: any = {
  container: { padding: '15px', fontFamily: 'Segoe UI, sans-serif', width: '100%', margin: '0 auto', color: '#eee', background: '#0f0f0f', minHeight: '100vh', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' },
  backBtn: { padding: '6px 12px', cursor: 'pointer', background: '#333', border: '1px solid #444', borderRadius: 4, color: '#eee', whiteSpace: 'nowrap', fontSize: '11px' },
  
  // CHANGED: flexWrap to 'wrap' to avoid horizontal scroll, removed overflowX, smaller padding/gap
  tabs: { display: 'flex', gap: 5, background:'#1a1a1a', padding:4, borderRadius:8, border: '1px solid #333', flexWrap: 'wrap', alignItems: 'center', maxWidth: '100%' },
  tab: { padding: '6px 12px', cursor: 'pointer', border: 'none', background: 'transparent', borderRadius: 6, fontWeight: 500, color:'#888', flexShrink: 0, transition: 'all 0.2s', fontSize: '11px' },
  tabActive: { padding: '6px 12px', cursor: 'pointer', border: 'none', background: '#2196f3', borderRadius: 6, fontWeight: 600, color:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.5)', flexShrink: 0, transition: 'all 0.2s', fontSize: '11px' },

  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '15px' },
  card: { padding: '10px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', backgroundColor: '#1a1a1a', textAlign:'center', border: '1px solid #333' },
  bigNum: { fontSize: '16px', fontWeight: 'bold', margin: '4px 0 0 0', color: '#fff' },
  
  filterBar: { display: 'flex', flexWrap:'wrap', gap: '8px', marginBottom: '15px', background:'#1a1a1a', padding:10, borderRadius:8, boxShadow:'0 1px 3px rgba(0,0,0,0.2)', border: '1px solid #333' },
  input: { padding: '6px', borderRadius: '4px', border: '1px solid #444', minWidth: 120, background: '#0f0f0f', color: '#fff', fontSize: '11px' },
  inputFull: { padding: '8px', borderRadius: '4px', border: '1px solid #444', width: '100%', boxSizing:'border-box', background: '#0f0f0f', color: '#fff', fontSize: '11px' },
  label: { display:'block', marginBottom:4, fontWeight:500, fontSize:11, color: '#ccc' },
  select: { padding: '6px', borderRadius: '4px', border: '1px solid #444', background: '#0f0f0f', color: '#fff', fontSize: '11px' },
  btnPrimary: { padding: '6px 12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' },
  btnOutline: { padding: '6px 12px', backgroundColor: 'transparent', border: '1px solid #007bff', color: '#007bff', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' },
  
  tableContainer: { overflowX: 'auto', overflowY: 'auto', maxHeight: '65vh', backgroundColor: '#1a1a1a', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', minHeight:300, border: '1px solid #333' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' },
  th: { padding: 8, textAlign: 'left', fontWeight: '600', color: '#aaa', borderBottom: '1px solid #333', background: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  td: { padding: 8, verticalAlign: 'middle', borderBottom: '1px solid #333', color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  badge: { padding: '2px 6px', borderRadius: '10px', fontSize: '9px', fontWeight:'bold', textTransform: 'uppercase' },
  
  btnSmall: { padding: '2px 6px', fontSize: '10px', cursor: 'pointer', backgroundColor: '#444', color: '#eee', border: 'none', borderRadius: '4px' },
  
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 15, fontSize: '11px' },
  pageBtn: { padding: '6px 12px', cursor: 'pointer', background: '#333', border: '1px solid #444', borderRadius: 4, color: '#eee', fontSize: '11px' },

  modalOverlay: { position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.7)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 },
  modalContent: { background:'#1a1a1a', padding:20, borderRadius:8, width:450, maxWidth:'90%', boxShadow:'0 5px 15px rgba(0,0,0,0.5)', maxHeight:'90vh', overflowY:'auto', color: '#eee', border: '1px solid #333' },
  closeBtn: { background:'none', border:'none', fontSize:18, cursor:'pointer', color: '#aaa' },
  modalGrid: { display:'flex', flexDirection:'column', gap:8 },
  modalRow: { display:'flex', justifyContent:'space-between', borderBottom:'1px solid #333', paddingBottom:4 }
};

export default AdminTopup;
