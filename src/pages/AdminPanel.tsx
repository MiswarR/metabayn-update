import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { 
    getApiUrl, getTokenLocal,
    apiExportUsersCsv,
    apiGetAdminLynkPurchases, apiGetAdminLynkWebhookLogs,
    apiAdminListVouchers, apiAdminCreateVoucher,
    apiAdminListLicenseSupport, apiAdminFindLynkPurchasesByEmail, apiAdminApproveLicenseSupport, apiAdminRejectLicenseSupport,
} from '../api/backend';

type UserItem = {
  id: number;
  email: string;
  tokens: number;
  bonus_tokens?: number;
  topup_tokens?: number;
  is_admin?: number | boolean;
  subscription_active?: number | boolean;
  subscription_expiry?: string | null;
  created_at?: string | null;
  last_request_at?: string | null;
  app_usage?: {
    cost_24h: number;
    cost_7d: number;
    cost_30d: number;
    req_24h: number;
    req_7d: number;
    req_30d: number;
  };
  openrouter_usage?: {
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    usage: number;
    limit_remaining: number | null;
    disabled: boolean;
  } | null;
};

const ConfirmModal = ({ title, message, onConfirm, onCancel, confirmText = "Confirm", cancelText = "Cancel", danger = false }: any) => (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
        <div style={{ background: '#18181b', padding: 24, borderRadius: 12, border: '1px solid #27272a', width: 400, maxWidth: '90%' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: 16 }}>{title}</h3>
            <p style={{ color: '#a1a1aa', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#e4e4e7', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>{cancelText}</button>
                <button onClick={onConfirm} style={{ background: danger ? '#dc2626' : '#4f46e5', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>{confirmText}</button>
            </div>
        </div>
    </div>
);

const Badge = ({ children, color = 'gray' }: { children: React.ReactNode, color?: 'gray'|'green'|'red'|'blue'|'orange' }) => {
    const colors = {
        gray: { bg: 'rgba(255,255,255,0.1)', text: '#a1a1aa', border: 'rgba(255,255,255,0.1)' },
        green: { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399', border: 'rgba(16, 185, 129, 0.2)' },
        red: { bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171', border: 'rgba(239, 68, 68, 0.2)' },
        blue: { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.2)' },
        orange: { bg: 'rgba(249, 115, 22, 0.2)', text: '#fb923c', border: 'rgba(249, 115, 22, 0.2)' },
    };
    const c = colors[color];
    return (
        <span style={{
            background: c.bg, color: c.text, border: `1px solid ${c.border}`,
            padding: '2px 8px', borderRadius: 999, fontSize: '11px', fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', lineHeight: 1.4
        }}>
            {children}
        </span>
    );
};

const IconButton = ({ icon, onClick, title, color = 'gray', disabled }: any) => {
    const [hover, setHover] = useState(false);
    const colors: any = {
        gray: { text: '#a1a1aa', hover: '#fff', bg: 'transparent', hoverBg: 'rgba(255,255,255,0.1)' },
        red: { text: '#f87171', hover: '#fca5a5', bg: 'rgba(239,68,68,0.1)', hoverBg: 'rgba(239,68,68,0.2)' },
        green: { text: '#34d399', hover: '#6ee7b7', bg: 'rgba(16,185,129,0.1)', hoverBg: 'rgba(16,185,129,0.2)' },
    };
    const c = colors[color] || colors.gray;

    return (
        <button
            onClick={onClick}
            title={title}
            disabled={disabled}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: hover && !disabled ? c.hoverBg : c.bg,
                color: hover && !disabled ? c.hover : c.text,
                border: 'none',
                borderRadius: 6,
                padding: 6,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
        >
            {icon}
        </button>
    );
};

const StatCard = ({ title, value, icon, color }: any) => (
    <div style={{
        background: '#18181b', border: '1px solid #27272a', borderRadius: 12, padding: 20,
        display: 'flex', alignItems: 'center', gap: 16, flex: 1
    }}>
        <div style={{
            width: 48, height: 48, borderRadius: 12, background: color, 
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
        }}>
            {icon}
        </div>
        <div>
            <div style={{ fontSize: '13px', color: '#a1a1aa', fontWeight: 500 }}>{title}</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#fff' }}>{value}</div>
        </div>
    </div>
);

// --- Main Page ---

export default function AdminPanel({ onBack, lang }: { onBack: () => void, lang: 'id' | 'en' }) {
  const isId = lang === 'id';
  const t = (id: string, en: string) => (isId ? id : en);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'info' | 'warn'; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [orCleanupLoading, setOrCleanupLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);
  const [configLoading, setConfigLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [form, setForm] = useState({
    profit_margin_percent: '50',
    usd_idr_rate: '',
    usd_idr_auto_sync: false,
    ai_unlimited_mode: true,
    ai_concurrency_limit: '5'
  });

  const [confirmAction, setConfirmAction] = useState<{
      title: string;
      message: string;
      onConfirm: () => void;
      danger?: boolean;
      confirmText?: string;
  } | null>(null);

  async function fetchUsers() {
    setLoading(true);
    setError('');
    setNotice(null);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) { setError(t('Tidak punya akses', 'Unauthorized')); setLoading(false); return; }
      const res = await fetch(`${apiUrl}/admin/users/overview`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const txt = await res.text();
        const isRouteNotFound = res.status === 404 && (txt || '').includes('Admin Route Not Found');
        const isMissingColumn = res.status >= 500 && (txt || '').includes('no such column');
        if (isRouteNotFound) {
          const res2 = await fetch(`${apiUrl}/admin/users/list`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res2.ok) {
            const txt2 = await res2.text();
            try { throw new Error(JSON.parse(txt2).error || txt2); } catch { throw new Error(txt2 || `HTTP ${res2.status}`); }
          }
          const data2 = await res2.json();
          setUsers(Array.isArray(data2?.results) ? data2.results : (Array.isArray(data2) ? data2 : []));
          setNotice({ type: 'warn', message: 'Backend belum update: fitur usage AI Gateway belum tersedia (fallback ke list).' });
          return;
        }
        if (isMissingColumn) {
          const res2 = await fetch(`${apiUrl}/admin/users/list`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res2.ok) {
            const txt2 = await res2.text();
            try { throw new Error(JSON.parse(txt2).error || txt2); } catch { throw new Error(txt2 || `HTTP ${res2.status}`); }
          }
          const data2 = await res2.json();
          setUsers(Array.isArray(data2?.results) ? data2.results : (Array.isArray(data2) ? data2 : []));
          setNotice({ type: 'warn', message: 'Skema DB backend belum update (kolom OpenRouter belum ada). Saya tampilkan list user (tanpa usage) dulu.' });
          return;
        }
        try { throw new Error(JSON.parse(txt).error || txt); } catch { throw new Error(txt || `HTTP ${res.status}`); }
      }
      const data = await res.json();
      setUsers(Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function cleanupOpenRouterKeys() {
    const confirmText = prompt(t(
      "Ketik CLEANUP untuk menghapus OpenRouter API key yang tidak terpakai (nama metabayn-...)",
      "Type CLEANUP to delete unused OpenRouter API keys (metabayn-...)"
    ));
    if (confirmText !== 'CLEANUP') return;
    setOrCleanupLoading(true);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) throw new Error(t('Tidak punya akses', 'Unauthorized'));
      const res = await fetch(`${apiUrl}/admin/openrouter/cleanup?limit=200`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const txt = await res.text();
      if (!res.ok) {
        try { throw new Error(JSON.parse(txt).error || txt); } catch { throw new Error(txt || `HTTP ${res.status}`); }
      }
      const data = (() => { try { return JSON.parse(txt); } catch { return null; } })();
      alert(t(
        `Cleanup OpenRouter selesai.\nDeleted: ${data?.deleted_count ?? '-'}\nFailed: ${data?.failed_count ?? '-'}`,
        `OpenRouter cleanup done.\nDeleted: ${data?.deleted_count ?? '-'}\nFailed: ${data?.failed_count ?? '-'}`
      ));
      await fetchUsers();
    } catch (e: any) {
      alert(t(
        `Cleanup OpenRouter gagal: ${String(e?.message || e)}`,
        `OpenRouter cleanup failed: ${String(e?.message || e)}`
      ));
    } finally {
      setOrCleanupLoading(false);
    }
  }

  async function fetchConfig() {
    setConfigLoading(true);
    setConfigStatus(null);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) throw new Error(t('Tidak punya akses', 'Unauthorized'));
      const res = await fetch(`${apiUrl}/admin/config`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cfg = (data && typeof data === 'object') ? data : {};
      setConfig(cfg);
      setForm({
        profit_margin_percent: String(cfg.profit_margin_percent ?? '50'),
        usd_idr_rate: String(cfg.usd_idr_rate ?? ''),
        usd_idr_auto_sync: !!cfg.usd_idr_auto_sync,
        ai_unlimited_mode: cfg.ai_unlimited_mode === undefined ? true : !!cfg.ai_unlimited_mode,
        ai_concurrency_limit: String(Math.max(1, Math.min(Number(cfg.ai_concurrency_limit ?? '5') || 5, 10)))
      });
    } catch (e: any) {
      setConfigStatus({ ok: false, message: String(e?.message || e) });
    } finally {
      setConfigLoading(false);
      setConfigLoaded(true);
    }
  }

  const [activeTab, setActiveTab] = useState<'users' | 'lynk' | 'vouchers' | 'support'>('users');

  const [lynkPurchases, setLynkPurchases] = useState<any[]>([]);
  const [lynkCounts, setLynkCounts] = useState<Record<string, number>>({});
  const [lynkLoading, setLynkLoading] = useState(false);
  const [lynkError, setLynkError] = useState('');
  const [lynkStatus, setLynkStatus] = useState<string>('');
  const [lynkQuery, setLynkQuery] = useState<string>('');
  const [lynkLogs, setLynkLogs] = useState<any[]>([]);
  const [lynkSelectedPurchaseId, setLynkSelectedPurchaseId] = useState<string>('');

  const [vouchers, setVouchers] = useState<any[]>([]);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState('');
  const [voucherCreating, setVoucherCreating] = useState(false);
  const [voucherStatus, setVoucherStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    max_usage: '1',
    expires_at: '',
    allowed_emails: ''
  });

  useEffect(() => {
      if (activeTab === 'lynk') fetchLynkPurchases();
      if (activeTab === 'vouchers') fetchVouchers();
      if (activeTab === 'support') fetchSupportRequests();
  }, [activeTab]);

  const [supportRequests, setSupportRequests] = useState<any[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [supportStatusFilter, setSupportStatusFilter] = useState<string>('pending');
  const [supportQuery, setSupportQuery] = useState<string>('');
  const [supportBusyId, setSupportBusyId] = useState<string>('');
  const [supportPurchasesMap, setSupportPurchasesMap] = useState<Record<string, any[]>>({});
  const [supportVoucherInput, setSupportVoucherInput] = useState<Record<string, string>>({});
  const [supportNewEmailInput, setSupportNewEmailInput] = useState<Record<string, string>>({});

  async function fetchSupportRequests() {
    setSupportLoading(true);
    setSupportError('');
    try {
      const token = getTokenLocal();
      if (!token) return;
      const data = await apiAdminListLicenseSupport(token, { status: supportStatusFilter, q: supportQuery || undefined, limit: 200 });
      const list = Array.isArray(data?.results) ? data.results : [];
      setSupportRequests(list);
      setSupportPurchasesMap({});
      setSupportVoucherInput({});
      setSupportNewEmailInput((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const r of list) {
          const id = String(r?.id || '');
          if (!id) continue;
          const existing = String(next[id] || '').trim();
          if (!existing) {
            const accountEmail = String(r?.account_email || '').trim();
            if (accountEmail) next[id] = accountEmail;
          }
        }
        return next;
      });
    } catch (e: any) {
      setSupportError(e?.message || String(e));
    } finally {
      setSupportLoading(false);
    }
  }

  async function findPurchasesForSupport(ticketId: string, email: string) {
    const tkn = getTokenLocal();
    if (!tkn) return;
    const id = String(ticketId || '');
    if (!id) return;
    setSupportBusyId(id);
    try {
      const data = await apiAdminFindLynkPurchasesByEmail(tkn, email, 50);
      const list = Array.isArray(data?.results) ? data.results : [];
      setSupportPurchasesMap((prev) => ({ ...prev, [id]: list }));
    } catch (e: any) {
      alert(t(`Gagal cari pembelian: ${String(e?.message || e)}`, `Search failed: ${String(e?.message || e)}`));
    } finally {
      setSupportBusyId('');
    }
  }

  async function approveSupport(ticketId: string) {
    const tkn = getTokenLocal();
    if (!tkn) return;
    const id = String(ticketId || '');
    const voucherCode = String(supportVoucherInput[id] || '').trim();
    const newEmail = String(supportNewEmailInput[id] || '').trim();
    if (!voucherCode || !newEmail) {
      alert(t('Voucher code dan email baru wajib diisi.', 'Voucher code and new email are required.'));
      return;
    }
    setSupportBusyId(id);
    try {
      await apiAdminApproveLicenseSupport(tkn, { ticket_id: id, voucher_code: voucherCode, new_email: newEmail, resend: true });
      await fetchSupportRequests();
    } catch (e: any) {
      alert(t(`Approve gagal: ${String(e?.message || e)}`, `Approve failed: ${String(e?.message || e)}`));
    } finally {
      setSupportBusyId('');
    }
  }

  async function rejectSupport(ticketId: string) {
    const tkn = getTokenLocal();
    if (!tkn) return;
    const id = String(ticketId || '');
    const note = prompt(t('Alasan penolakan (opsional):', 'Rejection reason (optional):')) || '';
    setSupportBusyId(id);
    try {
      await apiAdminRejectLicenseSupport(tkn, { ticket_id: id, admin_note: note });
      await fetchSupportRequests();
    } catch (e: any) {
      alert(t(`Reject gagal: ${String(e?.message || e)}`, `Reject failed: ${String(e?.message || e)}`));
    } finally {
      setSupportBusyId('');
    }
  }

  async function fetchVouchers() {
    setVoucherLoading(true);
    setVoucherError('');
    try {
      const token = getTokenLocal();
      if (!token) return;
      const data = await apiAdminListVouchers(token);
      const list = Array.isArray(data) ? data : [];
      setVouchers(list.filter((v: any) => String(v?.type || 'license').toLowerCase() === 'license'));
    } catch (e: any) {
      setVoucherError(e?.message || String(e));
    } finally {
      setVoucherLoading(false);
    }
  }

  async function createVoucher() {
    setVoucherCreating(true);
    setVoucherStatus(null);
    try {
      const token = getTokenLocal();
      if (!token) throw new Error('Unauthorized');
      const genCode = () => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let out = "";
        for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
        return out;
      };
      const code = (String(voucherForm.code || '').trim() ? String(voucherForm.code || '').trim().toUpperCase() : genCode());

      const maxUsageRaw = String(voucherForm.max_usage || '').trim();
      const maxUsageNum = maxUsageRaw ? Number(maxUsageRaw) : 1;
      if (!Number.isFinite(maxUsageNum) || maxUsageNum < 0) throw new Error('Max usage tidak valid.');

      const expiresRaw = String(voucherForm.expires_at || '').trim();
      const expiresAtIso = expiresRaw ? new Date(expiresRaw).toISOString() : null;
      if (expiresRaw && expiresAtIso === 'Invalid Date') throw new Error('Tanggal expiry tidak valid.');

      const allowedEmails = String(voucherForm.allowed_emails || '').trim();

      await apiAdminCreateVoucher(token, {
        code,
        type: 'license',
        max_usage: maxUsageNum,
        expires_at: expiresAtIso,
        allowed_emails: allowedEmails ? allowedEmails : null
      });

      setVoucherStatus({ ok: true, msg: t('Kode lisensi berhasil dibuat.', 'License code created.') });
      setVoucherForm(v => ({
        ...v,
        code: '',
        allowed_emails: ''
      }));
      await fetchVouchers();
    } catch (e: any) {
      setVoucherStatus({ ok: false, msg: e?.message || String(e) });
    } finally {
      setVoucherCreating(false);
    }
  }

  async function fetchLynkPurchases() {
    setLynkLoading(true);
    setLynkError('');
    try {
      const token = getTokenLocal();
      if (!token) return;
      const data = await apiGetAdminLynkPurchases(token, { limit: 200, page: 1, status: lynkStatus || undefined, q: lynkQuery || undefined });
      const list = Array.isArray(data?.purchases) ? data.purchases : [];
      setLynkPurchases(list);
      setLynkCounts((data?.counts && typeof data.counts === 'object') ? data.counts : {});
    } catch (e: any) {
      setLynkError(e?.message || String(e));
    } finally {
      setLynkLoading(false);
    }
  }

  async function fetchLynkLogs(purchaseId: string) {
    setLynkLoading(true);
    setLynkError('');
    try {
      const token = getTokenLocal();
      if (!token) return;
      const data = await apiGetAdminLynkWebhookLogs(token, { limit: 100, page: 1, purchase_id: purchaseId });
      const list = Array.isArray(data?.logs) ? data.logs : [];
      setLynkLogs(list);
    } catch (e: any) {
      setLynkError(e?.message || String(e));
    } finally {
      setLynkLoading(false);
    }
  }

  async function exportUsers() {
      try {
          const token = getTokenLocal();
          if (!token) return;
          await apiExportUsersCsv(token);
      } catch (e: any) {
          alert(`Export failed: ${e.message}`);
      }
  }

  async function saveConfig() {
    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const profit = Number(form.profit_margin_percent);
      if (!Number.isFinite(profit) || profit < 0 || profit > 200) {
        throw new Error('profit_margin_percent harus 0..200');
      }

      const rateStr = String(form.usd_idr_rate || '').trim();
      const rateNum = rateStr ? Number(rateStr) : NaN;
      if (rateStr && (!Number.isFinite(rateNum) || rateNum <= 0)) {
        throw new Error('usd_idr_rate harus angka > 0');
      }

      let conc = Number(form.ai_concurrency_limit);
      if (!Number.isFinite(conc)) conc = 5;
      conc = Math.max(1, Math.min(conc, 10));

      const payload: Record<string, any> = {
        profit_margin_percent: profit,
        usd_idr_auto_sync: !!form.usd_idr_auto_sync,
        ai_unlimited_mode: !!form.ai_unlimited_mode,
        ai_concurrency_limit: conc
      };
      if (rateStr) payload.usd_idr_rate = rateNum;

      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) throw new Error(t('Tidak punya akses', 'Unauthorized'));
      
      // Save local settings (important for app usage)
      try {
          await invoke('set_profit_margin', { margin: profit });
      } catch (e) {
          console.error("Failed to sync local profit margin:", e);
      }

      const res = await fetch(`${apiUrl}/admin/config`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      setConfigStatus({ ok: true, message: t('Pengaturan tersimpan.', 'Settings saved.') });
      await fetchConfig();
    } catch (e: any) {
      setConfigStatus({ ok: false, message: String(e?.message || e) });
    } finally {
      setConfigSaving(false);
    }
  }

  async function syncUsdIdrNow() {
    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) throw new Error('Unauthorized');
      const res = await fetch(`${apiUrl}/admin/usd-idr/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
      const data = JSON.parse(txt);
      if (data?.usd_idr_rate) {
        setForm(prev => ({ ...prev, usd_idr_rate: String(data.usd_idr_rate) }));
      }
      setConfigStatus({ ok: true, message: `Kurs USD/IDR diperbarui: ${Number(data?.usd_idr_rate || 0).toLocaleString()}` });
      await fetchConfig();
    } catch (e: any) {
      setConfigStatus({ ok: false, message: String(e?.message || e) });
    } finally {
      setConfigSaving(false);
    }
  }

  async function syncModelPrices(kind: 'official' | 'live') {
    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) throw new Error(t('Tidak punya akses', 'Unauthorized'));
      const path = kind === 'official' ? '/admin/model-prices/sync' : '/admin/model-prices/sync-live';
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
      let count: any = null;
      try { count = JSON.parse(txt)?.count; } catch {}
      setConfigStatus({ ok: true, message: t(`Sync harga model selesai${count ? ` (${count} model)` : ''}.`, `Model prices synced${count ? ` (${count} models)` : ''}.`) });
    } catch (e: any) {
      setConfigStatus({ ok: false, message: String(e?.message || e) });
    } finally {
      setConfigSaving(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { fetchConfig(); }, []);

  async function deleteUser(user: UserItem) {
    if (user.email === 'metabayn@gmail.com') return alert(t("Tidak bisa menghapus akun super admin.", "Cannot delete super admin account."));
    
    // Konfirmasi sudah dilakukan via Modal sebelum fungsi ini dipanggil
    setActionLoading(user.id);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) return;
      const res = await fetch(`${apiUrl}/admin/users/delete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id })
      });
      if (res.ok) await fetchUsers();
      else alert(t(`Gagal: ${await res.text()}`, `Failed: ${await res.text()}`));
    } catch (e: any) { alert(t(`Error: ${e.message}`, `Error: ${e.message}`)); }
    finally { setActionLoading(null); }
  }

  async function purgeNonAdminUsers() {
    const confirmText = prompt(t(
      "Ketik PURGE untuk menghapus semua user kecuali metabayn@gmail.com:",
      "Type PURGE to delete all users except metabayn@gmail.com:"
    ));
    if (confirmText !== 'PURGE') return;

    setPurgeLoading(true);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) return;
      const res = await fetch(`${apiUrl}/admin/users/purge`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const txt = await res.text();
      if (!res.ok) {
        if (res.status === 404 && (txt || '').includes('Admin Route Not Found')) {
          return alert(t(
            'Endpoint purge belum tersedia di backend yang sedang dipakai. Pastikan backend sudah dideploy versi terbaru.',
            'Purge endpoint is not available on the current backend. Deploy the latest backend version.'
          ));
        }
        return alert(t(`Gagal: ${txt}`, `Failed: ${txt}`));
      }
      await fetchUsers();
      try {
        const data = JSON.parse(txt);
        alert(t(
          `Purge selesai. Deleted: ${data.deleted_count}, Failed: ${data.failed_count}`,
          `Purge done. Deleted: ${data.deleted_count}, Failed: ${data.failed_count}`
        ));
      } catch {
        alert(t('Purge selesai.', 'Purge done.'));
      }
    } catch (e: any) { alert(t(`Error: ${e.message}`, `Error: ${e.message}`)); }
    finally { setPurgeLoading(false); }
  }

  async function resetPassword(user: UserItem) {
    if (!confirm(t(`Reset password untuk ${user.email}?`, `Reset password for ${user.email}?`))) return;
    const newPass = prompt(t("Masukkan password baru:", "Enter new password:"));
    if (!newPass || newPass.length < 6) return alert(t("Password minimal 6 karakter.", "Password must be at least 6 characters."));

    setActionLoading(user.id);
    try {
      const apiUrl = await getApiUrl();
      const token = getTokenLocal();
      if (!token) return;
      const res = await fetch(`${apiUrl}/admin/users/reset-password`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, new_password: newPass })
      });
      if (res.ok) alert(t(`Berhasil: password direset untuk ${user.email}`, `Success: password reset for ${user.email}`));
      else alert(t(`Gagal: ${await res.text()}`, `Failed: ${await res.text()}`));
    } catch (e: any) { alert(t(`Error: ${e.message}`, `Error: ${e.message}`)); } 
    finally { setActionLoading(null); }
  }

  const filtered = users.filter(u => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (u.email || '').toLowerCase().includes(q) || String(u.id).includes(q);
  });

  // Stats
  const totalUsers = users.length;
  const licensedUsers = users.filter(u => (Number((u as any)?.license_active_count ?? 0) || 0) > 0).length;
  const adminUsers = users.filter(u => !!u.is_admin).length;

  return (
    <div style={{ 
        height: '100vh', width: '100vw', background: '#09090b', color: '#e4e4e7',
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        button:not(:disabled):active { transform: scale(0.95); transition: transform 0.1s; }
        button { transition: transform 0.1s, background-color 0.2s; }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
      {/* Navbar */}
      <div style={{ 
          height: 64, borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', 
          padding: '0 24px', justifyContent: 'space-between', background: '#09090b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{ 
              background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', 
              display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            {isId ? 'Kembali' : 'Back'}
          </button>
          <div style={{ width: 1, height: 24, background: '#27272a' }}></div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#fff' }}>{isId ? 'Panel Admin' : 'Admin Panel'}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: '13px', color: '#71717a' }}>{isId ? 'Login sebagai Admin' : 'Logged in as Admin'}</div>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px 24px', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Error: {error}</span>
            <button onClick={() => { fetchUsers(); fetchConfig(); }} style={{ background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>{t('Coba lagi', 'Retry')}</button>
        </div>
      )}
      {notice && (
        <div style={{
          background: notice.type === 'warn' ? 'rgba(249, 115, 22, 0.12)' : 'rgba(59, 130, 246, 0.12)',
          borderBottom: notice.type === 'warn' ? '1px solid rgba(249, 115, 22, 0.25)' : '1px solid rgba(59, 130, 246, 0.25)',
          padding: '12px 24px',
          color: notice.type === 'warn' ? '#fb923c' : '#60a5fa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#e4e4e7', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>{t('Tutup', 'Close')}</button>
        </div>
      )}

      {/* Modals */}
      {confirmAction && (
          <ConfirmModal 
              title={confirmAction.title}
              message={confirmAction.message}
              confirmText={confirmAction.confirmText}
              danger={confirmAction.danger}
              onConfirm={confirmAction.onConfirm}
              onCancel={() => setConfirmAction(null)}
          />
      )}

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '32px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            
            {/* Stats Row */}
            <div style={{ display: 'flex', gap: 24, marginBottom: 32 }}>
                <StatCard 
                    title={isId ? "Total Pengguna" : "Total Users"} value={totalUsers} color="#4f46e5"
                    icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                />
                <StatCard 
                    title={isId ? "Lisensi Aktif" : "Licensed"} value={licensedUsers} color="#059669"
                    icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
                />
                <StatCard 
                    title="Admin" value={adminUsers} color="#52525b"
                    icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1l3 5 6 .5-4 4 1 6-6-3-6 3 1-6-4-4L9 6z"/></svg>}
                />
            </div>

            {/* Admin Settings */}
            <div style={{ marginBottom: 24, background: '#18181b', border: '1px solid #27272a', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #27272a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(59,130,246,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15l2 2 4-4"/><path d="M20 7h-9"/><path d="M20 11h-9"/><path d="M20 15h-9"/><path d="M4 7h3"/><path d="M4 11h3"/><path d="M4 15h3"/></svg>
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{t('Pengaturan Admin', 'Admin Settings')}</div>
                    <div style={{ color: '#71717a', fontSize: 12 }}>
                      {t('Profit, kurs, throttling, dan sinkronisasi harga.', 'Profit, exchange rate, throttling, and model price sync.')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setConfigOpen(v => !v)} style={{ background: '#27272a', border: '1px solid #3f3f46', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    {configOpen ? t('Tutup', 'Close') : t('Buka', 'Open')}
                  </button>
                </div>
              </div>

              {configOpen && (
                <div style={{ padding: 16 }}>
                  {!configLoaded ? (
                    <div style={{ color: '#71717a', fontSize: 13, padding: 6 }}>
                      {t('Memuat konfigurasi...', 'Loading config...')}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14 }}>
                        <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 8 }}>Profit Margin (%)</div>
                        <input
                          value={form.profit_margin_percent}
                          onChange={e => setForm(v => ({ ...v, profit_margin_percent: e.target.value }))}
                          inputMode="numeric"
                          style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none' }}
                        />
                        <div style={{ color: '#71717a', fontSize: 12, marginTop: 8 }}>
                          Multiplier: x{(1 + (Number(form.profit_margin_percent || 0) / 100)).toFixed(2)}
                        </div>
                      </div>
 
                      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ color: '#a1a1aa', fontSize: 12 }}>Kurs USD/IDR (token per $1)</div>
                          <button onClick={() => syncUsdIdrNow()} disabled={configSaving} style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', padding: '6px 10px', borderRadius: 10, cursor: configSaving ? 'wait' : 'pointer', fontWeight: 700, fontSize: 12 }}>
                            Sync Live
                          </button>
                        </div>
                        <input
                          value={form.usd_idr_rate}
                          onChange={e => setForm(v => ({ ...v, usd_idr_rate: e.target.value }))}
                          inputMode="numeric"
                          placeholder="contoh: 16300"
                          style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none', marginTop: 8 }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, color: '#e4e4e7', fontSize: 13 }}>
                          <input type="checkbox" checked={form.usd_idr_auto_sync} onChange={e => setForm(v => ({ ...v, usd_idr_auto_sync: e.target.checked }))} />
                          Auto Sync Kurs
                        </label>
                        <div style={{ color: '#71717a', fontSize: 12, marginTop: 6 }}>
                          Last update: {config?.usd_idr_rate_last_update ? new Date(Number(config.usd_idr_rate_last_update)).toLocaleString() : '-'}
                        </div>
                      </div>
 
                      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14 }}>
                        <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 8 }}>AI Concurrency</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, color: '#e4e4e7', fontSize: 13 }}>
                          <input type="checkbox" checked={form.ai_unlimited_mode} onChange={e => setForm(v => ({ ...v, ai_unlimited_mode: e.target.checked }))} />
                          Unlimited Mode
                        </label>
                        <input
                          value={form.ai_concurrency_limit}
                          onChange={e => {
                            const raw = e.target.value;
                            const n = Number(raw);
                            const clamped = !Number.isFinite(n) ? '' : String(Math.max(1, Math.min(n, 10)));
                            setForm(v => ({ ...v, ai_concurrency_limit: clamped }));
                          }}
                          type="number"
                          min={1}
                          max={10}
                          placeholder="contoh: 5"
                          style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none' }}
                        />
                        <div style={{ color: '#71717a', fontSize: 12, marginTop: 8 }}>
                          Unlimited akan override limit menjadi tinggi di runtime.
                        </div>
                      </div>
 
                      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14 }}>
                        <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 8 }}>Harga Model</div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button onClick={() => syncModelPrices('official')} disabled={configSaving} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', padding: '10px 12px', borderRadius: 10, cursor: configSaving ? 'wait' : 'pointer', fontWeight: 800, fontSize: 12 }}>
                            {t('Sync Resmi', 'Sync Official')}
                          </button>
                          <button onClick={() => syncModelPrices('live')} disabled={configSaving} style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)', color: '#fb923c', padding: '10px 12px', borderRadius: 10, cursor: configSaving ? 'wait' : 'pointer', fontWeight: 800, fontSize: 12 }}>
                            Sync Live
                          </button>
                        </div>
                        <div style={{ color: '#71717a', fontSize: 12, marginTop: 10 }}>
                          Sync akan mengisi tabel model_prices untuk kalkulasi biaya.
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
                    <div style={{ color: configStatus ? (configStatus.ok ? '#34d399' : '#f87171') : '#71717a', fontSize: 12 }}>
                      {configLoading ? t('Memuat konfigurasi...', 'Loading config...') : (configStatus ? (configStatus.ok ? `OK: ${configStatus.message}` : `${t('Gagal', 'Failed')}: ${configStatus.message}`) : '')}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => fetchConfig()} disabled={configLoading || configSaving} style={{ background: '#27272a', border: '1px solid #3f3f46', color: '#fff', padding: '10px 14px', borderRadius: 10, cursor: (configLoading || configSaving) ? 'wait' : 'pointer', fontWeight: 700, fontSize: 13 }}>
                        {t('Muat ulang', 'Reload')}
                      </button>
                      <button onClick={() => saveConfig()} disabled={configSaving} style={{ background: '#4f46e5', border: '1px solid rgba(99,102,241,0.6)', color: '#fff', padding: '10px 14px', borderRadius: 10, cursor: configSaving ? 'wait' : 'pointer', fontWeight: 800, fontSize: 13 }}>
                        {configSaving ? t('Menyimpan...', 'Saving...') : t('Simpan', 'Save')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 24, marginBottom: 24, borderBottom: '1px solid #27272a' }}>
                <button 
                    onClick={() => setActiveTab('users')}
                    style={{ 
                        background: 'transparent', border: 'none', 
                        borderBottom: activeTab === 'users' ? '2px solid #6366f1' : '2px solid transparent',
                        color: activeTab === 'users' ? '#fff' : '#a1a1aa',
                        padding: '12px 4px', cursor: 'pointer', fontWeight: 500, fontSize: 14
                    }}
                >
                    {t('Pengguna', 'Users')}
                </button>
                <button 
                    onClick={() => setActiveTab('lynk')}
                    style={{ 
                        background: 'transparent', border: 'none', 
                        borderBottom: activeTab === 'lynk' ? '2px solid #6366f1' : '2px solid transparent',
                        color: activeTab === 'lynk' ? '#fff' : '#a1a1aa',
                        padding: '12px 4px', cursor: 'pointer', fontWeight: 500, fontSize: 14
                    }}
                >
                    {t('Pembelian Lynk.id', 'Lynk Purchases')}
                </button>
                <button 
                    onClick={() => setActiveTab('vouchers')}
                    style={{ 
                        background: 'transparent', border: 'none', 
                        borderBottom: activeTab === 'vouchers' ? '2px solid #6366f1' : '2px solid transparent',
                        color: activeTab === 'vouchers' ? '#fff' : '#a1a1aa',
                        padding: '12px 4px', cursor: 'pointer', fontWeight: 500, fontSize: 14
                    }}
                >
                    {t('Kode Lisensi', 'License Codes')}
                </button>
                <button 
                    onClick={() => setActiveTab('support')}
                    style={{ 
                        background: 'transparent', border: 'none', 
                        borderBottom: activeTab === 'support' ? '2px solid #6366f1' : '2px solid transparent',
                        color: activeTab === 'support' ? '#fff' : '#a1a1aa',
                        padding: '12px 4px', cursor: 'pointer', fontWeight: 500, fontSize: 14
                    }}
                >
                    {t('Klaim Lisensi', 'License Claims')}
                </button>
            </div>

            {/* Users Tab */}
            {activeTab === 'users' && (
                <>
                    {/* Actions Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ position: 'relative', width: 320 }}>
                    <svg 
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" 
                        style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#71717a' }}
                    >
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                    </svg>
                    <input 
                        value={query} 
                        onChange={e => setQuery(e.target.value)} 
                        placeholder={t('Cari user via email / ID...', 'Search users by email or ID...')} 
                        style={{ 
                            width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', 
                            padding: '10px 12px 10px 40px', borderRadius: 8, fontSize: '14px', outline: 'none',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={e => e.currentTarget.style.borderColor = '#6366f1'}
                        onBlur={e => e.currentTarget.style.borderColor = '#27272a'}
                    />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        onClick={() => purgeNonAdminUsers()}
                        disabled={purgeLoading}
                        style={{
                            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171',
                            padding: '10px 16px', borderRadius: 8, cursor: purgeLoading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px', fontWeight: 600
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                        {purgeLoading ? t('Menghapus...', 'Purging...') : t('Hapus Non-Admin', 'Purge Non-Admin')}
                    </button>
                    <button
                        onClick={() => cleanupOpenRouterKeys()}
                        disabled={orCleanupLoading}
                        style={{
                            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399',
                            padding: '10px 16px', borderRadius: 8, cursor: orCleanupLoading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px', fontWeight: 600
                        }}
                        title={t(
                          "Hapus OpenRouter key metabayn-* yang tidak terpakai (tidak ada di DB users)",
                          "Delete unused metabayn-* OpenRouter keys (missing from users DB)"
                        )}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/><path d="M22 6 11 17l-1-1"/></svg>
                        {orCleanupLoading ? t('Membersihkan...', 'Cleaning...') : t('Cleanup OpenRouter', 'Cleanup OpenRouter')}
                    </button>
                    <button 
                        onClick={exportUsers} 
                        disabled={loading}
                        style={{ 
                            background: '#27272a', border: '1px solid #3f3f46', color: '#60a5fa', 
                            padding: '10px 16px', borderRadius: 8, cursor: loading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px', fontWeight: 500
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Export CSV
                    </button>
                    <button 
                        onClick={() => fetchUsers()} 
                        disabled={loading}
                        style={{ 
                            background: '#27272a', border: '1px solid #3f3f46', color: '#fff', 
                            padding: '10px 16px', borderRadius: 8, cursor: loading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px', fontWeight: 500
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        {t('Muat Ulang', 'Refresh')}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div style={{ background: '#18181b', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ background: '#27272a', textAlign: 'left' }}>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500 }}>{t('User', 'User')}</th>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500 }}>{t('Role', 'Role')}</th>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500 }}>{t('Lisensi', 'License')}</th>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500 }}>{t('Terdaftar', 'Registered')}</th>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500 }}>{t('Usage (OR/App)', 'Usage (OR/App)')}</th>
                            <th style={{ padding: '12px 24px', color: '#a1a1aa', fontWeight: 500, textAlign: 'right' }}>{t('Aksi', 'Actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && filtered.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center', color: '#71717a' }}>{isId ? 'Memuat...' : 'Loading...'}</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center', color: '#71717a' }}>{t('Tidak ada user.', 'No users found.')}</td></tr>
                        ) : (
                            filtered.map((u, i) => {
                                const isAdmin = !!u.is_admin;
                                const licenseCount = Number((u as any)?.license_active_count ?? 0) || 0;
                                const or = u.openrouter_usage;
                                const app = u.app_usage;
                                return (
                                    <tr key={u.id} style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid #27272a', transition: 'background 0.2s' }} 
                                        onMouseEnter={e => e.currentTarget.style.background = '#27272a'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={{ padding: '16px 24px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ color: '#fff', fontWeight: 500 }}>{u.email}</span>
                                                <span style={{ color: '#71717a', fontSize: '12px' }}>ID: #{u.id}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                {isAdmin ? <Badge color="orange">Admin</Badge> : <Badge color="gray">{t('User', 'User')}</Badge>}
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            {licenseCount > 0 ? <Badge color="green">{t('Aktif', 'Active')} · {licenseCount}</Badge> : <Badge color="gray">{t('Tidak ada', 'None')}</Badge>}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: '#71717a' }}>
                                            {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: '#a1a1aa', fontFamily: 'monospace', fontSize: 12 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <div style={{ fontFamily: 'sans-serif' }}>
                                                    <span style={{ color: or ? (or.disabled ? '#f59e0b' : '#4ade80') : '#f87171', fontWeight: 700 }}>
                                                        {or ? (or.disabled ? 'OR Key: Disabled' : 'OR Key: OK') : 'OR Key: Missing'}
                                                    </span>
                                                    {or && typeof or.limit_remaining === 'number' && Number.isFinite(or.limit_remaining) ? (
                                                        <span style={{ color: '#71717a' }}> · Remaining: {or.limit_remaining.toFixed(2)}</span>
                                                    ) : null}
                                                </div>
                                                <div>
                                                    Gateway D/W/M: ${or ? or.usage_daily.toFixed(2) : '0.00'} / ${or ? or.usage_weekly.toFixed(2) : '0.00'} / ${or ? or.usage_monthly.toFixed(2) : '0.00'}
                                                </div>
                                                <div>
                                                    App 24h: ${app ? app.cost_24h.toFixed(2) : '0.00'} ({app ? app.req_24h : 0}) · Last: {u.last_request_at ? new Date(u.last_request_at).toLocaleString() : '-'}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                                <IconButton 
                                                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                                                    onClick={() => resetPassword(u)}
                                                    title={t('Reset Password', 'Reset Password')}
                                                    disabled={actionLoading === u.id}
                                                />
                                                <IconButton 
                                                    color="red"
                                                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>}
                                                    onClick={() => setConfirmAction({
                                                        title: "Hapus User",
                                                        message: `Apakah Anda yakin ingin menghapus user ${u.email}? Tindakan ini tidak dapat dibatalkan.`,
                                                        danger: true,
                                                        confirmText: "Hapus",
                                                        onConfirm: () => {
                                                            deleteUser(u);
                                                            setConfirmAction(null);
                                                        }
                                                    })}
                                                    title={t('Hapus User', 'Delete User')}
                                                    disabled={actionLoading === u.id || u.email === 'metabayn@gmail.com'}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            </>
            )}

            {/* Lynk Purchases Tab */}
            {activeTab === 'lynk' && (
                <div style={{ background: '#18181b', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>{isId ? 'Pembelian Lynk.id' : 'Lynk.id Purchases'}</h3>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <select value={lynkStatus} onChange={e => setLynkStatus(e.target.value)} style={{ background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 6 }}>
                                <option value="">All</option>
                                <option value="voucher_pending">{t('Menunggu', 'Pending')}</option>
                                <option value="voucher_sent">{t('Terkirim', 'Sent')}</option>
                                <option value="activated">{t('Aktif', 'Activated')}</option>
                                <option value="failed">{t('Gagal', 'Failed')}</option>
                            </select>
                            <input 
                                value={lynkQuery}
                                onChange={e => setLynkQuery(e.target.value)}
                                placeholder={t('Cari email / order id', 'Search email / order id')}
                                style={{ background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 6 }}
                            />
                            <button className="btn-click-anim" onClick={fetchLynkPurchases} disabled={lynkLoading} style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                {lynkLoading ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <svg className="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                        Refreshing...
                                    </span>
                                ) : 'Refresh'}
                            </button>
                        </div>
                    </div>
                    {lynkError && <div style={{ padding: 16, color: '#f87171' }}>Error: {lynkError}</div>}
                    <div style={{ padding: 12, color: '#a1a1aa', display: 'flex', gap: 16 }}>
                        <div>Total: {lynkPurchases.length}</div>
                        {Object.keys(lynkCounts).length > 0 && (
                            <>
                                <div>{t('Menunggu', 'Pending')}: {lynkCounts.voucher_pending ?? 0}</div>
                                <div>{t('Terkirim', 'Sent')}: {lynkCounts.voucher_sent ?? 0}</div>
                                <div>{t('Aktif', 'Activated')}: {lynkCounts.activated ?? 0}</div>
                                <div>{t('Gagal', 'Failed')}: {lynkCounts.failed ?? 0}</div>
                            </>
                        )}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: '#27272a', textAlign: 'left' }}>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>ID</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Email</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Kode Lisensi', 'License Code')}</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Redeem</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Status</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Payment</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Purchase Time</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Retry</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Email Status</th>
                                    <th style={{ padding: '10px 16px', color: '#a1a1aa', textAlign: 'right' }}>{t('Aksi', 'Actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lynkLoading && lynkPurchases.length === 0 ? (
                                    <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{isId ? 'Memuat...' : 'Loading...'}</td></tr>
                                ) : lynkPurchases.length === 0 ? (
                                    <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{t('Tidak ada pembelian.', 'No purchases found.')}</td></tr>
                                ) : (
                                    lynkPurchases.map((p) => (
                                        <tr key={p.id} style={{ borderBottom: '1px solid #27272a' }}>
                                            <td style={{ padding: '10px 16px', color: '#71717a' }}>{p.id}</td>
                                            <td style={{ padding: '10px 16px', color: '#fff' }}>{p.email}</td>
                                            <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{p.voucher_code || '-'}</td>
                                            <td style={{ padding: '10px 16px' }}>
                                                {!p.voucher_code ? (
                                                    <span style={{ color: '#71717a' }}>-</span>
                                                ) : p.voucher_redeemed_at ? (
                                                    <Badge color="green">
                                                        Redeemed{p.voucher_redeemed_by_user_id ? ` · user ${p.voucher_redeemed_by_user_id}` : ''}
                                                    </Badge>
                                                ) : (
                                                    <Badge color="orange">Not yet</Badge>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px 16px' }}>
                                                {p.status === 'activated' ? <Badge color="green">Activated</Badge> : 
                                                (p.status === 'voucher_pending' || p.status === 'voucher_sent') ? <Badge color="orange">Pending</Badge> : 
                                                <Badge color="red">Failed</Badge>}
                                            </td>
                                            <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{p.payment_status || '-'}</td>
                                            <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{p.purchase_ts ? new Date(p.purchase_ts).toLocaleString() : '-'}</td>
                                            <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>
                                                {(p.failure_count || 0) > 0 ? `#${p.failure_count} · ${p.next_retry_at ? new Date(p.next_retry_at).toLocaleTimeString() : '-'}` : '-'}
                                            </td>
                                            <td style={{ padding: '10px 16px', color: p.email_status === 'failed' ? '#f87171' : '#a1a1aa' }}>
                                                {p.email_status ? `${p.email_status}${p.email_last_error ? ` · ${p.email_last_error}` : ''}` : '-'}
                                            </td>
                                            <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                                                <button 
                                                    className="btn-click-anim"
                                                    onClick={async () => { setLynkSelectedPurchaseId(p.id); await fetchLynkLogs(p.id); }}
                                                    style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                                                >
                                                    {t('Lihat Log', 'View Logs')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {lynkSelectedPurchaseId && (
                        <div style={{ borderTop: '1px solid #27272a', padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h4 style={{ margin: 0, color: '#fff' }}>Webhook Logs for {lynkSelectedPurchaseId}</h4>
                                <button className="btn-click-anim" onClick={() => setLynkSelectedPurchaseId('')} style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                    Close
                                </button>
                            </div>
                            <div style={{ overflowX: 'auto', marginTop: 12 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                    <thead>
                                        <tr style={{ background: '#0f0f12', textAlign: 'left' }}>
                                            <th style={{ padding: '8px 12px', color: '#a1a1aa' }}>Time</th>
                                            <th style={{ padding: '8px 12px', color: '#a1a1aa' }}>IP</th>
                                            <th style={{ padding: '8px 12px', color: '#a1a1aa' }}>Signature</th>
                                            <th style={{ padding: '8px 12px', color: '#a1a1aa' }}>Status</th>
                                            <th style={{ padding: '8px 12px', color: '#a1a1aa' }}>Error</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lynkLogs.length === 0 ? (
                                            <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#71717a' }}>{t('Tidak ada log.', 'No logs.')}</td></tr>
                                        ) : (
                                            lynkLogs.map((l: any) => (
                                                <tr key={l.id} style={{ borderBottom: '1px solid #27272a' }}>
                                                    <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>{new Date(l.received_at).toLocaleString()}</td>
                                                    <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>{l.ip || '-'}</td>
                                                    <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>
                                                        {typeof l.signature_status === 'number' ? (l.signature_status === 1 ? 'OK' : 'Invalid') : '-'}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>{l.status_code}</td>
                                                    <td style={{ padding: '8px 12px', color: '#f87171' }}>{l.error || '-'}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'support' && (
              <div style={{ background: '#18181b', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>{t('Klaim Lisensi', 'License Claims')}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={supportStatusFilter} onChange={e => setSupportStatusFilter(e.target.value)} style={{ background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 6 }}>
                      <option value="pending">{t('Menunggu', 'Pending')}</option>
                      <option value="approved">{t('Disetujui', 'Approved')}</option>
                      <option value="rejected">{t('Ditolak', 'Rejected')}</option>
                      <option value="all">All</option>
                    </select>
                    <input
                      value={supportQuery}
                      onChange={e => setSupportQuery(e.target.value)}
                      placeholder={t('Cari email / catatan', 'Search email / note')}
                      style={{ background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 6 }}
                    />
                    <button className="btn-click-anim" onClick={fetchSupportRequests} disabled={supportLoading} style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      {supportLoading ? (isId ? 'Memuat...' : 'Loading...') : 'Refresh'}
                    </button>
                  </div>
                </div>

                {supportError && <div style={{ padding: 16, color: '#f87171' }}>Error: {supportError}</div>}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#27272a', textAlign: 'left' }}>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>ID</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Email Akun', 'Account Email')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Email Pembelian', 'Purchase Email')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Produk', 'Product')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Catatan', 'Note')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Voucher', 'Voucher')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>{t('Email Baru', 'New Email')}</th>
                        <th style={{ padding: '10px 16px', color: '#a1a1aa', textAlign: 'right' }}>{t('Aksi', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supportLoading && supportRequests.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{isId ? 'Memuat...' : 'Loading...'}</td></tr>
                      ) : supportRequests.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{t('Tidak ada klaim.', 'No claims.')}</td></tr>
                      ) : (
                        supportRequests.map((r: any) => {
                          const id = String(r?.id || '');
                          const status = String(r?.status || '');
                          const busy = supportBusyId === id;
                          const purchases = supportPurchasesMap[id] || [];
                          return (
                            <React.Fragment key={id}>
                              <tr style={{ borderBottom: '1px solid #27272a', verticalAlign: 'top' }}>
                                <td style={{ padding: '10px 16px', color: '#71717a', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div>{id}</div>
                                    {status === 'pending' ? <Badge color="orange">Pending</Badge> : status === 'approved' ? <Badge color="green">Approved</Badge> : <Badge color="red">Rejected</Badge>}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 16px', color: '#fff' }}>{r?.account_email || '-'}</td>
                                <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{r?.purchase_email || '-'}</td>
                                <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{r?.product_code || '-'}</td>
                                <td style={{ padding: '10px 16px', color: '#a1a1aa', maxWidth: 280, whiteSpace: 'pre-wrap' }}>
                                  {r?.note || '-'}
                                  {r?.purchase_time_hint ? `\n${t('Waktu:', 'Time:')} ${r.purchase_time_hint}` : ''}
                                  {r?.amount_hint ? `\n${t('Nominal:', 'Amount:')} ${r.amount_hint}` : ''}
                                </td>
                                <td style={{ padding: '10px 16px' }}>
                                  <input
                                    value={supportVoucherInput[id] || ''}
                                    onChange={(e) => setSupportVoucherInput((prev) => ({ ...prev, [id]: e.target.value }))}
                                    disabled={busy || status !== 'pending'}
                                    placeholder="ABC123"
                                    style={{ width: 140, background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 12 }}
                                  />
                                </td>
                                <td style={{ padding: '10px 16px' }}>
                                  <input
                                    value={supportNewEmailInput[id] || ''}
                                    onChange={(e) => setSupportNewEmailInput((prev) => ({ ...prev, [id]: e.target.value }))}
                                    disabled={busy || status !== 'pending'}
                                    placeholder="email@domain.com"
                                    style={{ width: 200, background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 12 }}
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button
                                      className="btn-click-anim"
                                      onClick={() => findPurchasesForSupport(id, String(r?.purchase_email || ''))}
                                      disabled={busy}
                                      style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                    >
                                      {t('Cari', 'Find')}
                                    </button>
                                    <button
                                      className="btn-click-anim"
                                      onClick={() => approveSupport(id)}
                                      disabled={busy || status !== 'pending'}
                                      style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}
                                    >
                                      {t('Approve', 'Approve')}
                                    </button>
                                    <button
                                      className="btn-click-anim"
                                      onClick={() => rejectSupport(id)}
                                      disabled={busy || status !== 'pending'}
                                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}
                                    >
                                      {t('Reject', 'Reject')}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {purchases.length > 0 && (
                                <tr style={{ borderBottom: '1px solid #27272a' }}>
                                  <td colSpan={8} style={{ padding: '10px 16px' }}>
                                    <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 8 }}>
                                      {t('Hasil pencarian pembelian (klik voucher untuk mengisi):', 'Search results (click voucher to fill):')}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                      {purchases.map((p: any) => {
                                        const vc = String(p?.voucher_code || '').trim();
                                        return (
                                          <button
                                            key={String(p?.id || '') + vc}
                                            onClick={() => { if (vc) setSupportVoucherInput((prev) => ({ ...prev, [id]: vc })); }}
                                            style={{
                                              background: '#0f0f12',
                                              border: '1px solid #27272a',
                                              color: vc ? '#fff' : '#71717a',
                                              padding: '6px 10px',
                                              borderRadius: 999,
                                              cursor: vc ? 'pointer' : 'default',
                                              fontSize: 12
                                            }}
                                            title={String(p?.product_ref || '')}
                                            disabled={!vc}
                                          >
                                            {vc || '-'}
                                            {p?.purchase_ts ? ` · ${new Date(p.purchase_ts).toLocaleString()}` : ''}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'vouchers' && (
              <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, alignItems: 'start' }}>
                <div style={{ background: '#18181b', borderRadius: 12, border: '1px solid #27272a', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>{t('Buat Kode Lisensi', 'Create License Code')}</h3>
                    <button className="btn-click-anim" onClick={() => fetchVouchers()} disabled={voucherLoading} style={{ background: 'transparent', border: '1px solid #3f3f46', color: '#fff', padding: '6px 10px', borderRadius: 8, cursor: voucherLoading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700 }}>
                      {voucherLoading ? (isId ? 'Memuat...' : 'Loading...') : (isId ? 'Muat Ulang' : 'Refresh')}
                    </button>
                  </div>

                  {voucherStatus && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${voucherStatus.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`, background: voucherStatus.ok ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)', color: voucherStatus.ok ? '#34d399' : '#f87171', fontSize: 13 }}>
                      {voucherStatus.msg}
                    </div>
                  )}

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6 }}>Code</div>
                      <input
                        value={voucherForm.code}
                        onChange={e => setVoucherForm(v => ({ ...v, code: e.target.value }))}
                        placeholder="kosongkan untuk auto-generate"
                        style={{ width: '100%', background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none' }}
                      />
                    </div>

                    <div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6 }}>Max usage</div>
                      <input
                        value={voucherForm.max_usage}
                        onChange={e => setVoucherForm(v => ({ ...v, max_usage: e.target.value }))}
                        inputMode="numeric"
                        placeholder="contoh: 1"
                        style={{ width: '100%', background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none' }}
                      />
                      <div style={{ color: '#71717a', fontSize: 12, marginTop: 6 }}>0 = unlimited</div>
                    </div>

                    <div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6 }}>Expires at (optional)</div>
                      <input
                        value={voucherForm.expires_at}
                        onChange={e => setVoucherForm(v => ({ ...v, expires_at: e.target.value }))}
                        type="datetime-local"
                        style={{ width: '100%', background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 14, outline: 'none' }}
                      />
                    </div>

                    <div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6 }}>Allowed emails (optional)</div>
                      <textarea
                        value={voucherForm.allowed_emails}
                        onChange={e => setVoucherForm(v => ({ ...v, allowed_emails: e.target.value }))}
                        placeholder="email1@a.com, email2@b.com"
                        rows={3}
                        style={{ width: '100%', background: '#0f0f12', border: '1px solid #27272a', color: '#fff', padding: '10px 12px', borderRadius: 10, fontSize: 13, outline: 'none', resize: 'vertical' }}
                      />
                    </div>

                    <button
                      className="btn-click-anim"
                      onClick={() => createVoucher()}
                      disabled={voucherCreating}
                      style={{ width: '100%', padding: '10px 14px', backgroundColor: '#4f46e5', border: '1px solid rgba(99,102,241,0.6)', color: '#fff', borderRadius: 10, cursor: voucherCreating ? 'wait' : 'pointer', fontWeight: 800, fontSize: 13 }}
                    >
                      {voucherCreating ? t('Membuat...', 'Creating...') : t('Buat', 'Create')}
                    </button>
                  </div>
                </div>

                <div style={{ background: '#18181b', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
                  <div style={{ padding: '16px 24px', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>{t('Daftar Kode Lisensi', 'License Codes')}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#a1a1aa', fontSize: 12 }}>
                      <div>Total: {vouchers.length}</div>
                    </div>
                  </div>
                  {voucherError && <div style={{ padding: 16, color: '#f87171' }}>Error: {voucherError}</div>}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#27272a', textAlign: 'left' }}>
                          <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Code</th>
                          <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Allowed</th>
                          <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Usage</th>
                          <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Expires</th>
                          <th style={{ padding: '10px 16px', color: '#a1a1aa' }}>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {voucherLoading && vouchers.length === 0 ? (
                          <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{isId ? 'Memuat...' : 'Loading...'}</td></tr>
                        ) : vouchers.length === 0 ? (
                          <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>{t('Belum ada kode lisensi.', 'No license codes yet.')}</td></tr>
                        ) : (
                          vouchers.map((v: any) => (
                            <tr key={v.code} style={{ borderBottom: '1px solid #27272a' }}>
                              <td style={{ padding: '10px 16px', color: '#fff', fontWeight: 700, letterSpacing: 0.5 }}>{v.code}</td>
                              <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{String(v.allowed_emails || '-') || '-'}</td>
                              <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>
                                {String(v.current_usage ?? 0)} / {String(v.max_usage ?? 0)}
                              </td>
                              <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{v.expires_at ? new Date(v.expires_at).toLocaleString() : '-'}</td>
                              <td style={{ padding: '10px 16px', color: '#a1a1aa' }}>{v.created_at ? new Date(v.created_at).toLocaleString() : '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
