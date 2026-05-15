/// <reference types="vite/client" />
import React, { useState, useEffect, Component, ErrorInfo } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Login from './pages/Login'
import VideoPlayerWindow from './pages/VideoPlayerWindow'
import { apiGetUserProfile, apiLicenseActivate, apiLicenseStatus, clearTokenLocal, getMachineHash, getTokenLocal, isValidToken, saveTokenLocal } from './api/backend'
import AdminPanel from './pages/AdminPanel'
import { getApiUrl } from './api/backend'
import CustomModal from './components/CustomModal'
import { appWindow, WebviewWindow } from '@tauri-apps/api/window'
import { clearBatchState } from './utils/batchLifecycle'
import { translations } from './utils/translations'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { getVersion as tauriGetVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/api/process'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'

const MODAL_EVENT_NAME = 'metabayn:modal';
const LAST_UPDATE_PROMPT_KEY = 'metabayn:lastUpdatePrompt:v1';
const LICENSE_OPEN_EVENT_NAME = 'metabayn:license:open';
const LICENSE_CHANGED_EVENT_NAME = 'metabayn:license:changed';

type ModalType = 'success' | 'error' | 'info' | 'warning';
type ModalEventDetail = { title: string; message: string; type: ModalType; afterClose?: () => void };

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

async function openInAppWeb(url: string, label: string, title: string, opts?: { mobile?: boolean }) {
  const u = String(url || '').trim()
  if (!u) return
  const mobile = !!opts?.mobile
  if (!isTauri) {
    try { window.open(u, '_blank', 'noopener,noreferrer') } catch {}
    return
  }
  try {
    const existing = WebviewWindow.getByLabel(label)
    if (existing) {
      try { await existing.setFocus() } catch {}
      return
    }
    new WebviewWindow(label, {
      url: u,
      title: title || 'Metabayn Store',
      width: mobile ? 520 : 980,
      height: mobile ? 720 : 720,
      minWidth: mobile ? 420 : 720,
      minHeight: 600,
      resizable: true,
      focus: true
    })
  } catch {}
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
      try {
        const msg = e?.reason instanceof Error ? e.reason.message : String(e?.reason ?? 'Unhandled promise rejection')
        console.error('[App] unhandledrejection:', e?.reason)
        window.dispatchEvent(new CustomEvent(MODAL_EVENT_NAME, { detail: { title: 'Error', message: msg, type: 'error' } }))
      } catch {}
    };
    const onError = (e: ErrorEvent) => {
      try {
        const msg = String((e as any)?.message ?? 'Unhandled error')
        console.error('[App] error:', e?.error || e)
        window.dispatchEvent(new CustomEvent(MODAL_EVENT_NAME, { detail: { title: 'Error', message: msg, type: 'error' } }))
      } catch {}
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
    if (!isTauri) {
      setUpdateGateDone(true);
      return;
    }
    if (page === 'video_player') {
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
  }, [page]);

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
      const emailLc = String(profile?.email || '').trim().toLowerCase();
      const adminFlag = !!(profile && (profile.is_admin === 1 || profile.is_admin === true || emailLc === 'metabayn@gmail.com'));
      const uid = profile?.id ?? profile?.user_id ?? '';
      const userIdStr = uid !== undefined && uid !== null ? String(uid) : '';
      const deviceHash = await getMachineHash().catch(() => '');
      setRedeemUserId(userIdStr);
      if (adminFlag) {
        setRedeemEligible(false);
        return;
      }
      const licenseRes = userIdStr && deviceHash
        ? await apiLicenseStatus(token, userIdStr, deviceHash).catch(() => null)
        : null;
      const active = !!(licenseRes && licenseRes.active);
      setRedeemEligible(!active);
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
    const handler = () => {
      if (!token) return;
      setRedeemError('');
      setRedeemCode('');
      setRedeemOpen(true);
    };
    window.addEventListener(LICENSE_OPEN_EVENT_NAME, handler as any);
    return () => window.removeEventListener(LICENSE_OPEN_EVENT_NAME, handler as any);
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
      setRedeemError(lang === 'id' ? 'Masukkan kode lisensi.' : 'Enter license code.');
      return;
    }
    if (!token) return;
    setRedeemLoading(true);
    setRedeemError('');
    try {
      const deviceHash = await getMachineHash();
      const userIdStr = redeemUserId;
      if (!userIdStr) throw new Error(lang === 'id' ? 'User ID tidak ditemukan.' : 'User ID not found.');
      const res = await apiLicenseActivate(token, code, userIdStr, deviceHash);
      setRedeemOpen(false);
      setRedeemEligible(false);
      setRedeemCode('');
      setRedeemError('');
      try {
        window.dispatchEvent(new CustomEvent(LICENSE_CHANGED_EVENT_NAME, { detail: { active: true } }));
      } catch {}
      setModalData({
        title: lang === 'id' ? 'Lisensi berhasil' : 'License activated',
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
            {page==='admin'&&<AdminPanel onBack={()=>setPage('dashboard')} lang={lang} />}
            
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
                {lang === 'id' ? 'Aktivasi Lisensi' : 'License Activation'}
              </div>
              <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                {lang === 'id'
                  ? 'Masukkan kode lisensi yang dikirim ke email Anda.\nJika ingin membeli lisensi untuk perangkat baru, klik tombol Beli Lisensi.'
                  : 'Enter the license code sent to your email.\nTo buy a new license for another device, click Buy License.'}
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <button
                  className="btn-click-anim"
                  onClick={() => { void openInAppWeb('http://lynk.id/metabayn/mxj5l2ydrd9g', 'metabayn-buy-license', 'Lisensi Metabayn', { mobile: true }) }}
                  disabled={redeemLoading}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'transparent',
                    color: '#fff',
                    border: '1px solid #3f3f46',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.6 : 1
                  }}
                >
                  {lang === 'id' ? 'Beli Lisensi' : 'Buy License'}
                </button>
                <button
                  className="btn-click-anim"
                  onClick={() => { void openInAppWeb('https://lynk.id/metabayn', 'metabayn-store', 'Metabayn Store', { mobile: true }) }}
                  disabled={redeemLoading}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'transparent',
                    color: '#a1a1aa',
                    border: '1px solid #27272a',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.6 : 1
                  }}
                >
                  {lang === 'id' ? 'Lihat Produk' : 'View Products'}
                </button>
              </div>
              <input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder={lang === 'id' ? 'Masukkan Kode Lisensi' : 'Enter License Code'}
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
                    setRedeemError('');
                    setRedeemCode('');
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
                  {lang === 'id' ? 'Tutup' : 'Close'}
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
                  {redeemLoading ? (lang === 'id' ? 'Mengaktifkan...' : 'Activating...') : (lang === 'id' ? 'Aktifkan' : 'Activate')}
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
