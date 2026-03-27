/// <reference types="vite/client" />
import React, { useState, useEffect, Component, ErrorInfo } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Login from './pages/Login'
import VideoPlayerWindow from './pages/VideoPlayerWindow'
import { apiCheckLynkIdStatus, apiCheckPaypalStatus, apiGetUserProfile, apiRedeemVoucher, clearTokenLocal, getMachineHash, getTokenLocal, isValidToken, saveTokenLocal } from './api/backend'
import AdminPanel from './pages/AdminPanel'
import { getApiUrl } from './api/backend'
import CustomModal from './components/CustomModal'
import { appWindow } from '@tauri-apps/api/window'
import { clearBatchState } from './utils/batchLifecycle'
import { translations } from './utils/translations'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { getVersion as tauriGetVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/api/process'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'

const MODAL_EVENT_NAME = 'metabayn:modal';
const PENDING_PAYMENT_KEY = 'metabayn:pendingPayment:v1';
const LAST_PAYMENT_POPUP_TS_KEY = 'metabayn:lastPaymentPopupTs';
const LAST_UPDATE_PROMPT_KEY = 'metabayn:lastUpdatePrompt:v1';

type ModalType = 'success' | 'error' | 'info' | 'warning';
type ModalEventDetail = { title: string; message: string; type: ModalType; afterClose?: () => void };

type PendingPayment = {
  method: 'paypal' | 'lynkid';
  productType: 'token' | 'subscription';
  productId: string;
  packageLabel: string;
  durationLabel?: string;
  durationDays?: number;
  tokensExpected?: number;
  bonusTokensExpected?: number;
  amountIdr?: number;
  amountUsd?: number;
  transactionId?: string | number;
  since?: number;
  createdAt: number;
  snapshot?: {
    tokens: number;
    subscription_active: boolean;
    subscription_expiry: string | null;
  };
};

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getAppLang(): 'en' | 'id' {
  try {
    const v = localStorage.getItem('app_lang')
    return v === 'id' || v === 'en' ? v : 'en'
  } catch {
    return 'en'
  }
}

function extractEmailFromToken(token: string): string {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const parts = raw.split('.');
  if (parts.length !== 3) return '';
  try {
    const payloadB64Url = parts[1];
    const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadB64Url.length / 4) * 4, '=');
    const json = JSON.parse(atob(payloadB64));
    const candidates = [
      json?.email,
      json?.user?.email,
      json?.sub
    ].map((v: any) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    const email = candidates.find((v: string) => v.includes('@') && v.includes('.')) || '';
    return email;
  } catch {
    return '';
  }
}

function getPendingPayment(): PendingPayment | null {
  return safeParseJson<PendingPayment>(localStorage.getItem(PENDING_PAYMENT_KEY));
}

function clearPendingPayment() {
  try {
    localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {}
}

function getProcessedTxIds(): string[] {
  try {
    const raw = localStorage.getItem('processed_tx_ids');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x));
  } catch {
    return [];
  }
}

function markProcessedTxId(id: string) {
  const next = getProcessedTxIds();
  if (next.includes(id)) return;
  next.push(id);
  if (next.length > 20) next.splice(0, next.length - 20);
  try {
    localStorage.setItem('processed_tx_ids', JSON.stringify(next));
  } catch {}
}

function detectLynkIdSuccessFromProfile(pending: PendingPayment, profile: any, snapshot: NonNullable<PendingPayment['snapshot']>) {
  const tokensBefore = Number(snapshot.tokens || 0) || 0;
  const tokensNow = Number(profile?.tokens || 0) || 0;
  const tokenDiff = tokensNow - tokensBefore;

  if (pending.productType === 'token') {
    const expected = Number(pending.tokensExpected || 0) || 0;
    if (expected > 0 && tokenDiff >= expected) {
      return { ok: true as const, tokens_added: expected, amount_rp: 0, duration_days: 0, subscription_expiry: null };
    }
    return { ok: false as const };
  }

  const prevExpiryMs = snapshot.subscription_expiry ? new Date(snapshot.subscription_expiry).getTime() : 0;
  const newExpiryMs = profile?.subscription_expiry ? new Date(profile.subscription_expiry).getTime() : 0;
  const prevActive = !!snapshot.subscription_active;
  const newActive = !!(profile?.subscription_active === 1 || profile?.subscription_active === true);
  const expiryExtended = (newExpiryMs && newExpiryMs > prevExpiryMs) || (!prevActive && newActive);

  if (!expiryExtended) return { ok: false as const };

  const bonusExpected = Number(pending.bonusTokensExpected || 0) || 0;
  const bonusTokens = bonusExpected > 0 && tokenDiff >= bonusExpected ? bonusExpected : (tokenDiff > 0 ? tokenDiff : 0);
  const durationDays = Number(pending.durationDays || 0) || 0;

  return {
    ok: true as const,
    tokens_added: bonusTokens,
    amount_rp: 0,
    duration_days: durationDays,
    subscription_expiry: profile?.subscription_expiry ? String(profile.subscription_expiry) : null
  };
}

function formatIdr(num: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
}

function formatUsd(num: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num);
}

function formatDate(isoOrDate: string | number | Date, lang: 'en' | 'id' = 'en') {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function inferSubscriptionLabel(durationDays?: number, lang: 'en' | 'id' = 'en') {
  const a = (translations as any)[lang]?.app || (translations as any)['en']?.app || {}
  if (!durationDays || durationDays <= 0) return a.subscriptionLabel || 'Subscription';
  if (durationDays === 30) return a.duration1Month || '1 Month';
  if (durationDays === 90) return a.duration3Months || '3 Months';
  if (durationDays === 180) return a.duration6Months || '6 Months';
  if (durationDays === 365) return a.duration1Year || '1 Year';
  return String(a.durationDays || '{value} Days').replace('{value}', String(durationDays));
}

function validatePayment(pending: PendingPayment, statusRes: any) {
  if (!pending || !statusRes) return { ok: true as const };

  const inferredType =
    statusRes?.type ??
    (statusRes?.duration_days && Number(statusRes.duration_days) > 0 ? 'subscription' :
     statusRes?.subscription_expiry || statusRes?.subscription_active ? 'subscription' : 'token');
  const statusType = inferredType === 'subscription' ? 'subscription' : 'token';
  const pendingType = pending.productType;
  if (statusType !== pendingType) return { ok: false as const, reason: `Product type mismatch (${pendingType} vs ${statusType})` };

  const tokensAddedRaw = typeof statusRes.tokens_added === 'number' ? statusRes.tokens_added : Number(statusRes.tokens_added);
  const tokensAdded = Number.isFinite(tokensAddedRaw) ? tokensAddedRaw : null;

  if (pendingType === 'token' && pending.tokensExpected && tokensAdded !== null && tokensAdded > 0) {
    if (tokensAdded !== pending.tokensExpected) return { ok: false as const, reason: `Token mismatch (${pending.tokensExpected} vs ${tokensAdded})` };
  }

  if (pendingType === 'subscription' && pending.durationDays) {
    const durationRaw = typeof statusRes.duration_days === 'number' ? statusRes.duration_days : Number(statusRes.duration_days);
    const duration = Number.isFinite(durationRaw) ? durationRaw : null;
    if (duration !== null && duration > 0 && duration !== pending.durationDays) {
      return { ok: false as const, reason: `Duration mismatch (${pending.durationDays} vs ${duration})` };
    }
  }

  const amountUsdRaw = typeof statusRes.amount_usd === 'number' ? statusRes.amount_usd : Number(statusRes.amount_usd);
  if (pending.method === 'paypal' && pending.amountUsd && Number.isFinite(amountUsdRaw) && amountUsdRaw > 0) {
    if (Math.abs(amountUsdRaw - pending.amountUsd) > 0.75) return { ok: false as const, reason: `Amount mismatch (${pending.amountUsd} vs ${amountUsdRaw})` };
  }

  const amountIdrRaw = typeof statusRes.amount_rp === 'number' ? statusRes.amount_rp : Number(statusRes.amount_rp);
  /* DISABLED PER USER REQUEST: "jika anda deteksi jumlah total pembelian maka jangan gunakan"
  if (pending.method === 'lynkid' && pending.amountIdr && Number.isFinite(amountIdrRaw) && amountIdrRaw > 0) {
    // Increased tolerance to 25000 to match backend and account for potential fee variations
    if (Math.abs(amountIdrRaw - pending.amountIdr) > 25000) {
        console.warn(`[App] Validation Failed: Amount mismatch. Expected ${pending.amountIdr}, Got ${amountIdrRaw}`);
        return { ok: false as const, reason: `Amount mismatch (${pending.amountIdr} vs ${amountIdrRaw})` };
    }
  }
  */

  return { ok: true as const };
}

function buildPaymentModalMessage(
  pending: PendingPayment,
  statusRes: any,
  userProfile: any | null
): { title: string; message: string; type: ModalType } {
  const lang = getAppLang()
  const a = (translations as any)[lang]?.app || (translations as any)['en']?.app || {}
  const fmt = (template: string, value: any) => String(template || '').replace('{value}', String(value ?? ''))
  const nf = new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US')
  const productType = (pending.productType || statusRes?.type) === 'subscription' ? 'subscription' : 'token';

  const amountUsdRaw = typeof statusRes?.amount_usd === 'number' ? statusRes.amount_usd : Number(statusRes?.amount_usd);
  const amountIdrRaw = typeof statusRes?.amount_rp === 'number' ? statusRes.amount_rp : Number(statusRes?.amount_rp);

  const paidUsd = Number.isFinite(amountUsdRaw) && amountUsdRaw > 0 ? amountUsdRaw : (pending.amountUsd || 0);
  const paidIdr = Number.isFinite(amountIdrRaw) && amountIdrRaw > 0 ? amountIdrRaw : (pending.amountIdr || 0);

  const tokensAddedRaw = typeof statusRes?.tokens_added === 'number' ? statusRes.tokens_added : Number(statusRes?.tokens_added);
  const tokensAdded = Number.isFinite(tokensAddedRaw) ? tokensAddedRaw : 0;

  const durationDaysRaw = typeof statusRes?.duration_days === 'number' ? statusRes.duration_days : Number(statusRes?.duration_days);
  const durationDays = Number.isFinite(durationDaysRaw) && durationDaysRaw > 0 ? durationDaysRaw : (pending.durationDays || 0);
  const durationLabel = pending.durationLabel || inferSubscriptionLabel(durationDays, lang);

  const isUsd = pending.method === 'paypal';

  if (productType === 'subscription') {
    const expiryIso = statusRes?.subscription_expiry || userProfile?.subscription_expiry || null;
    const startDate = new Date();
    const expiryDate = expiryIso ? new Date(expiryIso) : (durationDays > 0 ? new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000) : null);

    const lines: string[] = [];
    lines.push(a.subscriptionActivated || 'Subscription Activated!')
    lines.push(fmt(a.receiptPackage || 'Package: {value}', pending.packageLabel))
    lines.push(fmt(a.receiptDuration || 'Duration: {value}', durationLabel))
    lines.push(fmt(a.receiptStartDate || 'Start Date: {value}', formatDate(startDate, lang)))
    lines.push(fmt(a.receiptExpirationDate || 'Expiration Date: {value}', expiryDate ? formatDate(expiryDate, lang) : '-'))

    const bonusTokens = Number.isFinite(tokensAddedRaw) ? tokensAdded : (pending.bonusTokensExpected || 0);
    if (bonusTokens > 0) {
      lines.push(fmt(a.receiptBonusTokens || 'Bonus Tokens: {value}', nf.format(bonusTokens)))
    }

    if (isUsd) {
      if (paidUsd > 0) lines.push(fmt(a.receiptTotalPaid || 'Total Paid: {value}', formatUsd(paidUsd)));
    } else {
      if (paidIdr > 0) lines.push(fmt(a.receiptTotalPaid || 'Total Paid: {value}', formatIdr(paidIdr)));
    }

    return { title: a.receiptSuccessTitle || 'Success', message: lines.join('\n'), type: 'success' };
  }

  const expectedTokens = pending.tokensExpected || 0;
  const tokensForDisplay = tokensAdded > 0 ? tokensAdded : expectedTokens;

  const lines: string[] = [];
  lines.push(a.tokenTopUpSuccessful || 'Token Top-Up Successful!')
  lines.push(fmt(a.receiptPackage || 'Package: {value}', pending.packageLabel))
  lines.push(fmt(a.receiptTokensAdded || 'Tokens Added: {value}', nf.format(tokensForDisplay)))

  if (isUsd) {
    if (paidUsd > 0) lines.push(fmt(a.receiptTotalPaid || 'Total Paid: {value}', formatUsd(paidUsd)));
  } else {
    if (paidIdr > 0) lines.push(fmt(a.receiptTotalPaid || 'Total Paid: {value}', formatIdr(paidIdr)));
  }

  const newBalance = typeof userProfile?.tokens === 'number' ? userProfile.tokens : null;
  if (newBalance !== null) {
    lines.push(fmt(a.receiptTotalBalance || 'Total Balance: {value}', nf.format(newBalance)));
  }

  return { title: a.receiptSuccessTitle || 'Success', message: lines.join('\n'), type: 'success' };
}

// Error Boundary Component to catch runtime errors
class ErrorBoundary extends Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const lang = getAppLang()
      const a = (translations as any)[lang]?.app || (translations as any)['en']?.app || {}
      return (
        <div style={{padding: 20, color: '#f44336', background: '#111', height: '100vh', overflow: 'auto'}}>
          <h2>{a.errorTitle || 'Something went wrong.'}</h2>
          <details style={{whiteSpace: 'pre-wrap'}}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button 
            onClick={() => window.location.reload()} 
            style={{marginTop: 20, padding: '10px 20px', background: '#333', color: '#fff', border: 'none', cursor: 'pointer'}}
          >
            {a.reloadApp || 'Reload App'}
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default function App(){
  const [token,setToken]=useState<string>('')
  const lang = getAppLang()
  const a = (translations as any)[lang]?.app || (translations as any)['en']?.app || {}
  
  // Initial state check for video player
  const [page,setPage]=useState<'login'|'dashboard'|'settings'|'admin'|'video_player'>(() => {
    if (window.location.search.includes('video_id=')) return 'video_player';
    return 'login';
  });

  const [isProcessing, setIsProcessing] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState(() => {
    try { return localStorage.getItem('metabayn:userEmail:v1') || '' } catch { return '' }
  })
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{ title: string; message: string; type: ModalType; afterClose?: () => void }>({
    title: '',
    message: '',
    type: 'info'
  });
  const modalAfterCloseRef = React.useRef<(() => void) | undefined>(undefined);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateInstallLoading, setUpdateInstallLoading] = useState(false);
  const [updateGateDone, setUpdateGateDone] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; date?: string; body?: string } | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const [redeemEligible, setRedeemEligible] = useState(false);
  const [redeemUserId, setRedeemUserId] = useState<string>('');
  const redeemPromptShownRef = React.useRef(false);
  const updateCheckedRef = React.useRef(false);
  const hotkeyRef = React.useRef<{ stage: 0 | 1; ts: number }>({ stage: 0, ts: 0 })
  const keysPressed = React.useRef(new Set<string>());
  
  // Skip booting screen for video player
  const [booting, setBooting] = useState(() => {
    if (window.location.search.includes('video_id=')) return false;
    return true;
  });

  useEffect(()=>{ 
    // Skip init if we are in video player mode
    if (page === 'video_player') return;

    init();
    
    // Safety timeout: force boot off after 5 seconds if backend hangs
    const timer = setTimeout(() => {
        setBooting(false);
    }, 5000);
    return () => clearTimeout(timer);
  },[])

  useEffect(() => {
    if (!isTauri) return
    let unlisten: null | (() => void) = null
    let disposed = false

    const cleanup = async (reason: string) => {
      try { clearBatchState() } catch {}
      try { await invoke('cancel_generate_metadata_batch') } catch {}
      try {
        await invoke('log_audit_event', {
          event_type: 'error',
          context: `Exit cleanup: ${reason}`.slice(0, 500),
          status: 'Ok'
        })
      } catch {}
    }

    ;(async () => {
      try {
        unlisten = await (appWindow as any).onCloseRequested(async () => {
          await cleanup('CloseRequested')
        })
      } catch {
        unlisten = null
      }
    })()

    const onBeforeUnload = () => {
      void cleanup('beforeunload')
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      if (disposed) return
      disposed = true
      window.removeEventListener('beforeunload', onBeforeUnload)
      try { unlisten && unlisten() } catch {}
    }
  }, [])
  
  useEffect(() => {
    // Listen for Deep Links
    if (!isTauri) return;
    import('@tauri-apps/api/event').then(({ listen }) => {
      const unlisten = listen('deep-link', (event: any) => {
        const url = event.payload as string;
        console.log('Deep Link received:', url);
        // Parse token: metabayn://auth?token=XYZ
        if (url.includes('token=')) {
           const extractedToken = url.split('token=')[1].split('&')[0];
           if (extractedToken) {
             setToken(extractedToken);
             setPage('dashboard');
             saveTokenLocal(extractedToken);
             if (isTauri) invoke('save_auth_token', { token: extractedToken }).catch(console.error);
           }
        }
      });
      return () => { unlisten.then(f => f()); };
    });
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const onUnhandled = (e: PromiseRejectionEvent) => {
      e.preventDefault();
    };
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    if (page === 'video_player') return;

    function isEditableTarget(t: EventTarget | null) {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if ((el as any).isContentEditable) return true;
      return false;
    }

    async function doLogout() {
      try { clearBatchState(); } catch {}
      if (isTauri) {
        try { await invoke('cancel_generate_metadata_batch'); } catch {}
      }
      try { await invoke('logout'); } catch {}
      try { clearTokenLocal(); } catch {}
      setToken('');
      setIsAdmin(false);
      setPage('login');
    }

    const onKeyDown = (e: KeyboardEvent) => {
        if (isEditableTarget(e.target)) return;
        const k = (e.key || '').toLowerCase();
        keysPressed.current.add(k);

        const hasShift = e.shiftKey;
        const hasCtrl = e.ctrlKey;
        const hasB = keysPressed.current.has('b');
        const hasY = keysPressed.current.has('y');

        if (hasShift && hasCtrl && hasB && hasY) {
            e.preventDefault();
            void doLogout();
        }
    };

    const onKeyUp = (e: KeyboardEvent) => {
        const k = (e.key || '').toLowerCase();
        keysPressed.current.delete(k);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    
    return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
    };
  }, [page]);

  useEffect(() => {
    async function fetchAdminFlag() {
      try {
        if (!token) { setIsAdmin(false); return; }
        const decoded = extractEmailFromToken(token);
        if (decoded) {
          setUserEmail(prev => prev || decoded);
          try { localStorage.setItem('metabayn:userEmail:v1', decoded); } catch {}
        }
        const apiUrl = await getApiUrl();
        const res = await fetch(`${apiUrl}/user/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const adminFlag = !!(data && (data.is_admin === 1 || data.is_admin === true));
          setIsAdmin(adminFlag);
          if (data && data.email) {
             const email = String(data.email);
             setUserEmail(email);
             try { localStorage.setItem('metabayn:userEmail:v1', email); } catch {}
          }
        } else {
          setIsAdmin(false);
          if (res.status === 401 || res.status === 403) {
            setUserEmail('');
            try { localStorage.removeItem('metabayn:userEmail:v1'); } catch {}
          }
        }
      } catch {
        setIsAdmin(false);
      }
    }
    fetchAdminFlag();
  }, [token]);

  useEffect(() => {
    if (!token) {
      setUpdateModalOpen(false);
      setUpdateInstallLoading(false);
      setUpdateGateDone(false);
      setUpdateInfo(null);
      updateCheckedRef.current = false;
      return;
    }
    if (!isTauri) {
      setUpdateGateDone(true);
      return;
    }
    if (updateCheckedRef.current) return;
    updateCheckedRef.current = true;

    let cancelled = false;
    ;(async () => {
      try {
        const res: any = await Promise.race([
          checkUpdate(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('update_timeout')), 6000))
        ]);
        if (cancelled) return;
        if (res && res.shouldUpdate) {
          const manifestVersion = res?.manifest?.version || res?.version || '';
          try {
            const curVer = await tauriGetVersion();
            if (manifestVersion && curVer && manifestVersion === curVer) {
              setUpdateGateDone(true);
              return;
            }
          } catch {}

          try {
            const raw = localStorage.getItem(LAST_UPDATE_PROMPT_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as { version: string; ts: number };
              if (parsed && parsed.version === manifestVersion && Date.now() - parsed.ts < 6 * 60 * 60 * 1000) {
                setUpdateGateDone(true);
                return;
              }
            }
          } catch {}

          const info = {
            version: manifestVersion || undefined,
            date: res?.manifest?.date || undefined,
            body: res?.manifest?.body || undefined
          };
          setUpdateInfo(info);
          try { localStorage.setItem(LAST_UPDATE_PROMPT_KEY, JSON.stringify({ version: info.version || '', ts: Date.now() })); } catch {}
          setUpdateModalOpen(true);
          return;
        }
      } catch {}
      if (!cancelled) setUpdateGateDone(true);
    })();

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token) {
      setRedeemEligible(false);
      setRedeemUserId('');
      redeemPromptShownRef.current = false;
      return;
    }
    let cancelled = false;
    ;(async () => {
      const profile: any = await apiGetUserProfile(token).catch(() => null);
      if (cancelled || !profile) return;
      const uid = profile?.id ?? profile?.user_id ?? '';
      const userIdStr = uid !== undefined && uid !== null ? String(uid) : '';
      const active = !!(profile?.subscription_active === 1 || profile?.subscription_active === true);
      const tokens = Number(profile?.tokens ?? 0) || 0;
      const redeemedKey = userIdStr ? `metabayn:redeemed_voucher:${userIdStr}` : '';
      const alreadyRedeemed = redeemedKey ? localStorage.getItem(redeemedKey) === '1' : false;
      const promptedKey = userIdStr ? `metabayn:voucher_prompted:${userIdStr}` : '';
      const alreadyPrompted = promptedKey ? localStorage.getItem(promptedKey) === '1' : false;
      const createdAtRaw = (profile as any)?.created_at;
      const createdAtSec = typeof createdAtRaw === 'number' ? createdAtRaw : Number(createdAtRaw);
      const createdAtMs = !isNaN(createdAtSec) && createdAtSec > 0 ? createdAtSec * 1000 : null;
      const isNewUser = createdAtMs !== null ? (Date.now() - createdAtMs) <= 48 * 60 * 60 * 1000 : false;
      setRedeemUserId(userIdStr);
      setRedeemEligible(!active && !alreadyRedeemed && !alreadyPrompted && (tokens <= 0 || isNewUser));
    })();

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!updateGateDone) return;
    if (updateModalOpen) return;
    if (modalOpen) return;
    if (redeemOpen) return;
    if (!redeemEligible) return;
    if (redeemPromptShownRef.current) return;
    redeemPromptShownRef.current = true;
    setRedeemError('');
    setRedeemCode('');
    try {
      if (redeemUserId) localStorage.setItem(`metabayn:voucher_prompted:${redeemUserId}`, '1');
    } catch {}
    setRedeemOpen(true);
  }, [token, updateGateDone, updateModalOpen, modalOpen, redeemOpen, redeemEligible, redeemUserId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const e = event as CustomEvent<ModalEventDetail>;
      const detail = e?.detail;
      if (!detail || !detail.title) return;
      modalAfterCloseRef.current = detail.afterClose;
      setModalData({
        title: detail.title,
        message: detail.message || '',
        type: detail.type || 'info',
        afterClose: detail.afterClose
      });
      setModalOpen(true);
    };

    window.addEventListener(MODAL_EVENT_NAME, handler as any);
    return () => window.removeEventListener(MODAL_EVENT_NAME, handler as any);
  }, []);

  useEffect(() => {
    if (!token) return;

    let interval: any;
    let running = false;

    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const pending = getPendingPayment();
        if (!pending) return;

        // DEBUG: Log polling attempt
        // console.log("[App] Polling payment status...", pending);

        const pendingSince = pending.since || pending.createdAt || Date.now();

        let statusRes: any = null;
        let profileForModal: any | null = null;

        if (pending.method === 'paypal' && pending.transactionId) {
          statusRes = await apiCheckPaypalStatus(token, pending.transactionId);
        } else if (pending.method === 'lynkid') {
          try {
            statusRes = await apiCheckLynkIdStatus(token, pendingSince, {
              productType: pending.productType,
              durationDays: pending.durationDays,
              tokensExpected: pending.tokensExpected
            });
          } catch (e) {
            statusRes = null;
          }

          if (statusRes && statusRes.status === 'paid') {
            profileForModal = await apiGetUserProfile(token).catch(() => null);
          } else if (pending.snapshot) {
            const profile = await apiGetUserProfile(token).catch(() => null);
            if (profile) {
              const detected = detectLynkIdSuccessFromProfile(pending, profile, pending.snapshot);
              if (detected.ok) {
                profileForModal = profile;
                statusRes = {
                  status: 'paid',
                  method: 'lynkid',
                  id: `lynkid-fallback:${pending.createdAt || pendingSince}`,
                  type: pending.productType,
                  tokens_added: detected.tokens_added,
                  amount_rp: detected.amount_rp,
                  duration_days: detected.duration_days,
                  created_at: new Date().toISOString(),
                  server_time: Date.now(),
                  subscription_expiry: detected.subscription_expiry || undefined
                };
              }
            }
          }
        } else {
          clearPendingPayment();
          return;
        }

        if (statusRes && statusRes.status === 'paid') {
          const txId = statusRes?.id ? String(statusRes.id) : `paid:${pending.method}:${pending.createdAt || pendingSince}`;
          if (getProcessedTxIds().includes(txId)) {
            clearPendingPayment();
            return;
          }
          markProcessedTxId(txId);

          // 2. Server-side Relative Time Check (Optional but good safety)
          // If server_time is provided, check if transaction is reasonably fresh (e.g. < 20 mins old)
          // This comparison is SERVER TIME vs SERVER TIME, so client clock doesn't matter.
          if (statusRes.server_time && statusRes.created_at) {
              const txTime = new Date(statusRes.created_at).getTime();
              const serverTime = statusRes.server_time;
              const ageMs = serverTime - txTime;
              // If transaction is older than 20 mins, it might be a stale one.
              // However, if the user just clicked "Buy" and we found a matching amount, maybe it IS the one?
              // Let's be safe: 30 minutes.
              if (ageMs > 30 * 60 * 1000) {
                  // Too old, probably from a previous session. Ignore.
                  // BUT: Only ignore if we are strict. 
                  // If we trust "pendingPayment" exists means user just clicked...
                  // Let's stick to the ID check as the primary guard.
                  // console.log("Transaction too old:", ageMs);
                  // return; // Uncomment to enforce freshness
              }
          }

          clearPendingPayment();

          const profile = profileForModal || await apiGetUserProfile(token).catch(() => null);
          if (pending.method === 'lynkid' && pending.snapshot && profile) {
            const detected = detectLynkIdSuccessFromProfile(pending, profile, pending.snapshot);
            if (detected.ok) {
              statusRes = {
                ...statusRes,
                type: pending.productType,
                tokens_added: detected.tokens_added,
                duration_days: detected.duration_days,
                subscription_expiry: detected.subscription_expiry || statusRes?.subscription_expiry
              };
            }
          }
          const validation = validatePayment(pending, statusRes);
          
          if (!validation.ok) {
            localStorage.setItem(LAST_PAYMENT_POPUP_TS_KEY, String(Date.now()));
            setModalData({
              title: 'Payment Verified (Validation Failed)',
              message: `Your payment is verified, but details don't match the selected product.\nReason: ${validation.reason}`,
              type: 'warning',
              afterClose: undefined
            });
            setModalOpen(true);
            return;
          }
          
          const modal = buildPaymentModalMessage(pending, statusRes, profile);
          localStorage.setItem(LAST_PAYMENT_POPUP_TS_KEY, String(Date.now()));
          setModalData({ 
            title: modal.title, 
            message: modal.message, 
            type: modal.type as any, 
            afterClose: undefined 
          });
          setModalOpen(true);

        } else if (statusRes?.paypal_status === 'CAPTURE_FAILED') {
          clearPendingPayment();
          localStorage.setItem(LAST_PAYMENT_POPUP_TS_KEY, String(Date.now()));
          setModalData({
            title: 'Payment Failed',
            message: `Payment Verification Failed.\nReason: ${statusRes?.error_details || 'Unknown error'}`,
            type: 'error',
            afterClose: undefined
          });
          setModalOpen(true);
        }
      } catch (e) {
        console.error('[App] Payment polling error:', e);
      } finally {
        running = false;
      }
    };

    poll();
    interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [token]);

  async function init(){
    const local = getTokenLocal() || '';
    if (isTauri) {
      try {
        const settings: any = await invoke('get_settings');
        const settingsToken = settings?.auth_token ? String(settings.auth_token) : '';

        const useSettingsToken = settingsToken && isValidToken(settingsToken);
        const useLocalToken = !useSettingsToken && local && isValidToken(local);
        const chosen = useSettingsToken ? settingsToken : (useLocalToken ? local : '');

        if (chosen) {
          setToken(chosen);
          setPage('dashboard');
          saveTokenLocal(chosen);
          if (chosen !== settingsToken) {
            invoke('save_auth_token', { token: chosen }).catch(() => {});
          }
        } else {
          if (settingsToken) invoke('logout').catch(() => {});
          clearTokenLocal();
          setPage('login');
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
        if (local && isValidToken(local)) {
          setToken(local);
          setPage('dashboard');
        } else {
          clearTokenLocal();
          setPage('login');
        }
      }
    } else {
      if (local && isValidToken(local)) {
        setToken(local);
        setPage('dashboard');
      } else {
        clearTokenLocal();
        setPage('login');
      }
    }
    setBooting(false);
  }

  async function runInstallUpdate() {
    if (!isTauri) return;
    setUpdateInstallLoading(true);
    try {
      try {
        const v = updateInfo?.version || '';
        if (v) localStorage.setItem(LAST_UPDATE_PROMPT_KEY, JSON.stringify({ version: v, ts: Date.now() }));
      } catch {}
      await installUpdate();
      await relaunch();
    } catch (e: any) {
      setUpdateInstallLoading(false);
      setUpdateGateDone(true);
      setModalData({
        title: lang === 'id' ? 'Update gagal' : 'Update failed',
        message: e?.message ? String(e.message) : String(e),
        type: 'error',
        afterClose: undefined
      });
      setModalOpen(true);
    }
  }

  async function runRedeemVoucher() {
    const code = redeemCode.trim();
    if (!code) {
      setRedeemError(lang === 'id' ? 'Masukkan kode voucher.' : 'Enter voucher code.');
      return;
    }
    if (!token) return;
    setRedeemLoading(true);
    setRedeemError('');
    try {
      const deviceHash = await getMachineHash();
      const userIdStr = redeemUserId;
      if (!userIdStr) throw new Error(lang === 'id' ? 'User ID tidak ditemukan.' : 'User ID not found.');
      const res = await apiRedeemVoucher(token, code, userIdStr, deviceHash);
      try {
        localStorage.setItem(`metabayn:redeemed_voucher:${userIdStr}`, '1');
      } catch {}
      setRedeemOpen(false);
      setRedeemEligible(false);
      setModalData({
        title: lang === 'id' ? 'Voucher berhasil' : 'Voucher redeemed',
        message: String(res?.message || ''),
        type: 'success',
        afterClose: undefined
      });
      setModalOpen(true);
    } catch (e: any) {
      setRedeemError(e?.message ? String(e.message) : String(e));
    } finally {
      setRedeemLoading(false);
    }
  }

  // TUI Boot Screen removed - restoring standard behavior
  if (booting) {
      return (
        <div style={{
            height: '100vh', 
            width: '100vw', 
            background: '#1a1a1a', 
            color: '#fff', 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center', 
            alignItems: 'center',
            fontSize: '18px',
            zIndex: 9999
        }}>
            <div>{a.loadingConfig || 'Loading Application Configuration...'}</div>
        </div>
      );
  }

  return (
    <ErrorBoundary>
      {page === 'video_player' ? (
        <VideoPlayerWindow />
      ) : (
      <div className="app">
        <div className="app-content" style={{flex: 1, overflow: 'hidden', position: 'relative'}}>
            
            {page === 'login' && (
                <Login onLogin={(t) => {
                    setToken(t);
                    setPage('dashboard');
                    saveTokenLocal(t);
                    if(isTauri) invoke('save_auth_token', { token: t }).catch(() => {});
                }} />
            )}

            {/* Keep Dashboard Alive except on login to fully stop active batch */}
            {token && (
            <div style={{display: page==='dashboard' ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden'}}>
                <Dashboard 
                    token={token} 
                    onSettings={()=>setPage('settings')} 
                    onProcessChange={setIsProcessing}
                    isActive={page==='dashboard'}
                    isAdmin={isAdmin}
                    userEmail={userEmail}
                    onOpenAdmin={()=>setPage('admin')}
                />
            </div>
            )}

            {page==='settings'&&<Settings onBack={()=>setPage('dashboard')} lang={lang} />}
            {page==='admin'&&<AdminPanel onBack={()=>setPage('dashboard')} />}
            
        </div>
        <CustomModal
          isOpen={updateModalOpen}
          title={lang === 'id' ? 'Update tersedia' : 'Update available'}
          message={
            (() => {
              const parts: string[] = [];
              if (lang === 'id') parts.push('Versi terbaru tersedia untuk Metabayn Studio.');
              else parts.push('A newer version of Metabayn Studio is available.');
              if (updateInfo?.version) parts.push((lang === 'id' ? `Versi: ${updateInfo.version}` : `Version: ${updateInfo.version}`));
              if (updateInfo?.body) parts.push(String(updateInfo.body));
              return parts.join('\n');
            })()
          }
          type="info"
          primaryLabel={lang === 'id' ? (updateInstallLoading ? 'Mengupdate...' : 'Update') : (updateInstallLoading ? 'Updating...' : 'Update')}
          secondaryLabel={lang === 'id' ? 'Nanti' : 'Later'}
          primaryDisabled={updateInstallLoading}
          secondaryDisabled={updateInstallLoading}
          onPrimary={() => { setUpdateModalOpen(false); void runInstallUpdate(); }}
          onSecondary={() => { setUpdateModalOpen(false); setUpdateGateDone(true); }}
          onClose={() => { setUpdateModalOpen(false); setUpdateGateDone(true); }}
        />
        {redeemOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}>
            <div style={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 16,
              padding: 22,
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)'
            }}>
              <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                {(translations as any)[lang]?.topup?.redeemTitle || 'Tukarkan Voucher'}
              </div>
              <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                {lang === 'id' ? 'Masukkan kode voucher yang dikirim ke email Anda.' : 'Enter the voucher code sent to your email.'}
              </div>
              <input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder={(translations as any)[lang]?.topup?.enterCode || 'Masukkan Kode'}
                disabled={redeemLoading}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: redeemError ? '1px solid #ef4444' : '1px solid #27272a',
                  color: '#fff',
                  padding: '12px 12px',
                  borderRadius: 10,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              {redeemError ? (
                <div style={{ color: '#f87171', fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {redeemError}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  className="btn-click-anim"
                  onClick={() => {
                    setRedeemOpen(false);
                    setRedeemEligible(false);
                  }}
                  disabled={redeemLoading}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: 'transparent',
                    color: '#fff',
                    border: '1px solid #3f3f46',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.6 : 1
                  }}
                >
                  Close
                </button>
                <button
                  className="btn-click-anim"
                  onClick={() => { void runRedeemVoucher(); }}
                  disabled={redeemLoading}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#fff',
                    color: '#000',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.7 : 1
                  }}
                >
                  {redeemLoading ? (lang === 'id' ? 'Redeeming...' : 'Redeeming...') : 'Redeem'}
                </button>
              </div>
            </div>
          </div>
        )}
        <CustomModal
          isOpen={modalOpen}
          title={modalData.title}
          message={modalData.message}
          type={modalData.type}
          onClose={() => {
            setModalOpen(false);
            const cb = modalAfterCloseRef.current;
            modalAfterCloseRef.current = undefined;
            if (cb) cb();
          }}
        />
      </div>
      )}
    </ErrorBoundary>
  )
}
