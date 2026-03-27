import React, { useEffect, useState, useRef } from 'react'
import appIconUrl from '@icons/icon.svg'
import { invoke } from '@tauri-apps/api/tauri'
import { open as shellOpen } from '@tauri-apps/api/shell'
import { open as dialogOpen } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { getVersion as tauriGetVersion } from '@tauri-apps/api/app'
import ProgressBar from '../components/ProgressBar'
import LogPanel from '../components/LogPanel'
import Settings from './Settings'
import HelpGuide from '../components/HelpGuide'
import TopUp from './TopUp'
import { getApiUrl, clearTokenLocal, apiGetUserProfile } from '../api/backend'
import { decryptApiKey } from '../utils/crypto'
import { formatTokenBalance, resolveGatewayBalanceAfter } from '../utils/gatewayBalance'
import { invokeWithTimeout } from '../utils/invokeWithTimeout'
import { translations } from '../utils/translations'
import { clearBatchState, loadBatchState, markBatchInterrupted, saveBatchState, type BatchFileStatus, type BatchStateV1 } from '../utils/batchLifecycle'
import { isVisionLikeModelId } from '../utils/modelVisionFilter'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'
const MODAL_EVENT_NAME = 'metabayn:modal';
const PENDING_PAYMENT_KEY = 'metabayn:pendingPayment:v1';
const LAST_PAYMENT_POPUP_TS_KEY = 'metabayn:lastPaymentPopupTs';

function emitModal(detail: { title: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; afterClose?: () => void }) {
  window.dispatchEvent(new CustomEvent(MODAL_EVENT_NAME, { detail }));
}

export default function Dashboard({token,onSettings,onProcessChange,isActive,isAdmin,userEmail,onOpenAdmin}:{token:string,onSettings:()=>void,onProcessChange?:(isProcessing:boolean)=>void,isActive?:boolean,isAdmin?:boolean,userEmail?:string,onOpenAdmin?:()=>void}){
  const [lang, setLang] = useState<'en' | 'id'>(() => {
    try {
      const v = localStorage.getItem('app_lang')
      return v === 'id' || v === 'en' ? v : 'en'
    } catch {
      return 'en'
    }
  })
  const t = (translations as any)[lang] || (translations as any)['en']
  const formatLogText = React.useCallback((template: string, vars?: Record<string, any>) => {
    const v = vars || {}
    return String(template || '').replace(/\{(\w+)\}/g, (_: string, key: string) => {
      const val = v[key]
      return val === undefined || val === null ? '' : String(val)
    })
  }, [])
  const pl = React.useCallback((key: string, vars?: Record<string, any>) => {
    const template = t?.dashboard?.processLog?.[key] || ''
    return formatLogText(template, vars)
  }, [t, formatLogText])
  const localizeBackendError = React.useCallback((text: string) => {
    const raw = String(text || '')
    if (lang !== 'id') return raw
    return raw
      .replace(/^API Error \(HTTP ([^)]+)\):/i, 'Kesalahan API (HTTP $1):')
      .replace(/^Direct API Error \(HTTP ([^,]+), URL: ([^)]+)\):/i, 'Kesalahan API Langsung (HTTP $1, URL: $2):')
      .replace(/^Direct API Network Error:/i, 'Kesalahan Jaringan API Langsung:')
      .replace(/^Missing API key/i, 'Kunci API belum ada')
  }, [lang])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const isResizing = useRef(false);
  const [logs,setLogs]=useState<any[]>([])
  const pushLog = React.useCallback((entry: any) => {
    setLogs(prev => {
      const next = [...prev, entry]
      if (next.length > 2000) next.splice(0, next.length - 2000)
      return next
    })
  }, [])
  const [progress,setProgress]=useState<number>(0)
  const [stats,setStats]=useState({total:0,done:0,success:0,failed:0,rejected:0})
  const [stopped,setStopped]=useState(false)
  const stoppedRef = React.useRef(false);
  const [showHelp, setShowHelp] = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)
  const [showSubAlert, setShowSubAlert] = useState(false)
  const [userProfile, setUserProfile] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('metabayn:userProfileCache:v1')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch {
      return null
    }
  })
  const [showDupModal, setShowDupModal] = useState(false)
  const [dupInputDir, setDupInputDir] = useState<string>('')
  const [dupAutoDelete, setDupAutoDelete] = useState<boolean>(true)
  const [dupThreshold, setDupThreshold] = useState<number>(3)
  const [dupRunning, setDupRunning] = useState<boolean>(false)
  const [criticalError, setCriticalError] = useState<string | null>(null)
  const criticalErrorRef = useRef<string | null>(null);
  const [profitMargin, setProfitMargin] = useState<number>(50);

  const subscriptionExpiryTs = (() => {
    const raw = (userProfile as any)?.subscription_expiry
    if (!raw) return null
    const ts = new Date(String(raw)).getTime()
    return Number.isFinite(ts) ? ts : null
  })()
  const subscriptionActive = !!(userProfile as any)?.subscription_active && (subscriptionExpiryTs === null || subscriptionExpiryTs > Date.now())
  const subscriptionExpiryLabel = (() => {
    if (!subscriptionExpiryTs) return null
    const d = new Date(subscriptionExpiryTs)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear())
    return `${dd}/${mm}/${yy}`
  })()
  const [gatewayEnabled, setGatewayEnabled] = useState<boolean>(false);
  const autoResumeTriedRef = useRef(false);
  const isGeneratingRef = useRef(false)
  const prevTokenRef = useRef<string>(token || '')
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [auditFilter, setAuditFilter] = useState<'all' | 'error' | 'security'>('all')
  const [auditLoading, setAuditLoading] = useState(false)

  useEffect(() => {
    // Fetch settings to get profit margin
    invoke<any>('get_settings').then(s => {
        if (s && typeof s.profit_margin_percent === 'number') {
            setProfitMargin(s.profit_margin_percent);
        }
        const isGateway = resolveGatewayFromSettings(s)
        setGatewayEnabled(isGateway)
    }).catch(console.error);
  }, []);

  useEffect(() => {
    try {
      if (!userProfile) return
      const minimal = {
        id: (userProfile as any)?.id,
        email: (userProfile as any)?.email,
        tokens: (userProfile as any)?.tokens,
        subscription_active: (userProfile as any)?.subscription_active,
        subscription_expiry: (userProfile as any)?.subscription_expiry
      }
      localStorage.setItem('metabayn:userProfileCache:v1', JSON.stringify(minimal))
    } catch {}
  }, [userProfile])

  const showModal = (title: string, message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
      emitModal({ title, message, type });
  };

  const resolveGatewayFromSettings = (s: any): boolean => {
    const provider = String(s?.ai_provider || '').trim().toLowerCase()
    const mode = String(s?.connection_mode || '').trim().toLowerCase()
    if (mode === 'direct') return false
    if (provider === 'openrouter') return true
    return mode === 'gateway' || mode === 'server'
  }

  // Notification State
  const [notification, setNotification] = useState<{title: string, message: string, type: 'success' | 'info' | 'error'} | null>(null)
  const prevProfileRef = useRef<any>(null)

  // Sync state to ref
  useEffect(() => {
    criticalErrorRef.current = criticalError;
  }, [criticalError]);

  useEffect(() => {
    if (!isTauri) return
    if (!criticalError) return
    invoke('log_audit_event', {
      event_type: 'error',
      context: String(criticalError).slice(0, 500),
      status: 'Critical'
    }).catch(() => {})
  }, [criticalError])

  const loadAuditLogs = async () => {
    if (!isTauri) return
    setAuditLoading(true)
    try {
      const rows = await invoke<any[]>('read_audit_logs', { limit: 200 })
      setAuditLogs(Array.isArray(rows) ? rows : [])
    } catch {
      setAuditLogs([])
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    if (!showMonitoring) return
    void loadAuditLogs()
    const t = setInterval(() => {
      void loadAuditLogs()
    }, 5000)
    return () => clearInterval(t)
  }, [showMonitoring])

  useEffect(() => {
    const prevToken = prevTokenRef.current
    if (prevToken === token) return
    const switchedAccount = Boolean(prevToken) && Boolean(token) && prevToken !== token
    const loggedOut = Boolean(prevToken) && !token
    prevTokenRef.current = token || ''
    autoResumeTriedRef.current = false
    if ((switchedAccount || loggedOut) && isGeneratingRef.current) {
      stopProcessSystem(switchedAccount ? 'Akun berganti' : 'Logout')
      clearBatchState()
    }
  }, [token])

  // Monitor Profile Changes for Notifications
  useEffect(() => {
    if (!userProfile) return;
    const prev = prevProfileRef.current;
    
    // DISABLED: Logic moved to App.tsx to prevent double popups
    if (false && prev) {
        const diff = userProfile.tokens - prev.tokens;
        const pending = (() => {
          try {
            const raw = localStorage.getItem(PENDING_PAYMENT_KEY);
            if (!raw) return null;
            try { return JSON.parse(raw as string) as any; } catch { return null; }
          } catch { return null; }
        })();
        const pendingCreatedAt =
          pending && typeof pending.createdAt === 'number' && Number.isFinite(pending.createdAt)
            ? pending.createdAt
            : 0;
        const lastTs = (() => {
          try { return Number(localStorage.getItem(LAST_PAYMENT_POPUP_TS_KEY) || 0); } catch { return 0; }
        })();
        const suppressRecentPaymentPopup = lastTs && (Date.now() - lastTs) < 20000;
        
        // 2. Check Subscription Extended/Activated
        const prevExpiry = prev.subscription_expiry ? new Date(prev.subscription_expiry).getTime() : 0;
        const newExpiry = userProfile.subscription_expiry ? new Date(userProfile.subscription_expiry).getTime() : 0;
        
        // If active AND (was inactive OR expiry extended)
        if (userProfile.subscription_active && (!prev.subscription_active || newExpiry > prevExpiry)) {
             console.log("[Dashboard] Subscription activation detected via profile sync");
             
             // Check if pending payment is "stale" (older than 3 minutes)
             // If stale, we show the generic popup as a fallback because App.tsx might be stuck/failed.
             const isPendingStale = pendingCreatedAt > 0 && (Date.now() - pendingCreatedAt > 180000);
             
             if (showTopUp && !isPendingStale) {
                 console.log("[Dashboard] Suppressing duplicate subscription popup because TopUp is open");
                 prevProfileRef.current = userProfile;
                 return;
             }
             if ((pending && !isPendingStale) || suppressRecentPaymentPopup) {
                 console.log("[Dashboard] Suppressing subscription popup because payment flow is handling it");
                 prevProfileRef.current = userProfile;
                 return;
             }
             const dateStr = new Date(userProfile.subscription_expiry).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { 
                 weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
             });
             
             let bonusMsg = "";
             if (diff > 0) {
                 bonusMsg = lang === 'id' 
                    ? `\nBonus Token: ${diff.toLocaleString()}`
                    : `\nBonus Tokens: ${diff.toLocaleString()}`;
             }

             const msg = lang === 'id'
                ? `Langganan Diaktifkan!\nBerlaku hingga: ${dateStr}${bonusMsg}`
                : `Subscription Activated!\nValid until: ${dateStr}${bonusMsg}`;
                
             showModal(lang === 'id' ? "Sukses" : "Success", msg, "success");
        } 
        // 1. Check Token Increase (Only if not handled by subscription)
        else if (diff > 100) { 
             console.log("[Dashboard] Token increase detected:", diff);
             
             // Check if pending payment is "stale" (older than 3 minutes)
             const isPendingStale = pendingCreatedAt > 0 && (Date.now() - pendingCreatedAt > 180000);

             if (showTopUp && !isPendingStale) {
                 console.log("[Dashboard] Suppressing duplicate token popup because TopUp is open");
                 prevProfileRef.current = userProfile;
                 return;
             }
             if ((pending && !isPendingStale) || suppressRecentPaymentPopup) {
                 console.log("[Dashboard] Suppressing token popup because payment flow is handling it");
                 prevProfileRef.current = userProfile;
                 return;
             }
             const msg = lang === 'id' 
                ? `Pembelian Token Berhasil!\nToken Ditambahkan: ${diff.toLocaleString()}\nTotal Saldo: ${userProfile.tokens.toLocaleString()}`
                : `Token Purchase Successful!\nTokens Added: ${diff.toLocaleString()}\nTotal Balance: ${userProfile.tokens.toLocaleString()}`;
             showModal(lang === 'id' ? "Sukses" : "Success", msg, "success");
        }
    }
    
    prevProfileRef.current = userProfile;
  }, [userProfile, lang, showTopUp]);
  
  useEffect(() => {
    console.log("Dashboard mounted. Token present:", !!token);
  }, []);

  // Listen for CSV Generation Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('csv_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};

      if (typeof payload === 'string') {
          logItem = { text: `[${pl('tagCsvGen')}] ${payload}`, color: '#aaa' };
      } else if (typeof payload === 'object') {
          // Map backend status to colors
          let color = '#aaa';
          if (payload.status === 'success') color = '#4caf50';
          else if (payload.status === 'error') color = '#f44336';
          else if (payload.status === 'processing') color = '#888';
          else if (payload.status === 'skipped') color = '#ff9800';

          logItem = {
              text: `[${pl('tagCsvGen')}] ${payload.text}`,
              detail: payload.detail,
              color: color,
              // If processing, maybe animate?
              animating: payload.status === 'processing',
              file: payload.file,
              status: payload.status
          };
      }

      setLogs(prev => {
          // Update existing log if file matches and previous status was processing
          if (payload.file) {
             const idx = prev.findIndex(l => l.file === payload.file && l.status === 'processing');
             if (idx >= 0) {
                 const newLogs = [...prev];
                 newLogs[idx] = { ...newLogs[idx], ...logItem };
                 return newLogs;
             }
          }
          return [...prev, logItem];
      });
    });
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Listen for Duplicate Detection Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('dup_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};
      if (typeof payload === 'string') {
        logItem = { text: `[${pl('tagDuplicate')}] ${payload}`, color: '#aaa' };
      } else if (typeof payload === 'object') {
        let color = '#aaa';
        if (payload.status === 'success') color = '#4caf50';
        else if (payload.status === 'error') color = '#f44336';
        else if (payload.status === 'processing') color = '#888';
        else if (payload.status === 'skipped') color = '#ff9800';
        else if (payload.status === 'deleted') color = '#ff9800';
        logItem = {
          text: `[${pl('tagDuplicate')}] ${payload.text}`,
          detail: payload.detail,
          color,
          animating: payload.status === 'processing',
          file: payload.file,
          status: payload.status
        };
      }
      setLogs(prev => {
        if ((payload as any).file) {
          const idx = prev.findIndex(l => l.file === (payload as any).file && l.status === 'processing');
          if (idx >= 0) {
            const newLogs = [...prev];
            newLogs[idx] = { ...newLogs[idx], ...logItem };
            return newLogs;
          }
        }
        return [...prev, logItem];
      });
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, []);

  // Listen for AI Cluster Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('ai_cluster_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};
      let color = '#d8b4fe'; // Light Purple

      if (typeof payload === 'string') {
          logItem = { text: `[${pl('tagAiCluster')}] ${payload}`, color: color };
      } else if (typeof payload === 'object') {
          if (payload.status === 'success') color = '#4caf50';
                else if (payload.status === 'error') color = '#f44336';
                else if (payload.status === 'processing') color = '#aaa'; // Standard Grey for consistency
                
                logItem = {
                    text: `[${pl('tagAiCluster')}] ${payload.text}`,
                    detail: payload.detail,
                    color: color,
                    animating: payload.status === 'processing',
                    file: payload.file,
                    status: payload.status
                };
            }

            setLogs(prev => {
                if ((payload as any).file) {
             const idx = prev.findIndex(l => l.file === (payload as any).file && l.status === 'processing');
             if (idx >= 0) {
                 const newLogs = [...prev];
                 newLogs[idx] = { ...newLogs[idx], ...logItem };
                 return newLogs;
             }
          }
          return [...prev, logItem];
      });
    });
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Listen for Tools Logs (e.g., Metadata Removal)
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('tools_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};
      if (typeof payload === 'string') {
        logItem = { text: `[${pl('tagTools')}] ${payload}`, color: '#aaa' };
      } else if (typeof payload === 'object') {
        let color = '#aaa';
        if (payload.status === 'success') color = '#4caf50';
        else if (payload.status === 'error') color = '#f44336';
        else if (payload.status === 'processing') color = '#888';
        else if (payload.status === 'skipped') color = '#ff9800';
        logItem = {
          text: `[${pl('tagTools')}] ${payload.text}`,
          detail: payload.detail,
          color,
          animating: payload.status === 'processing',
          file: payload.file,
          status: payload.status
        };
      }
      setLogs(prev => {
        if ((payload as any).file) {
          const idx = prev.findIndex(l => l.file === (payload as any).file && l.status === 'processing');
          if (idx >= 0) {
            const newLogs = [...prev];
            newLogs[idx] = { ...newLogs[idx], ...logItem };
            return newLogs;
          }
        }
        return [...prev, logItem];
      });
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  
  // Re-scan when returning to dashboard (isActive becomes true)
  useEffect(() => {
      if (isActive) {
          handleRescan();
      }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return
    if (autoResumeTriedRef.current) return
    const st = loadBatchState()
    autoResumeTriedRef.current = true
    if (!st) return
    if (st.running) {
      markBatchInterrupted()
      pushLog({text: pl('previousBatchInterrupted'), color:'#ff9800'})
    }
  }, [isActive])

  // Background Keep-Alive (Prevent Throttling)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const folderRetryCount = useRef(0);

  function enableKeepAlive() {
      // Disabled to prevent overheating / high CPU usage
      /*
      try {
          if (!audioCtxRef.current) {
              const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
              audioCtxRef.current = new AudioContext();
          }
          if (audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume();
          }
          
          if (!oscillatorRef.current) {
              const osc = audioCtxRef.current!.createOscillator();
              const gain = audioCtxRef.current!.createGain();
              gain.gain.value = 0.0001; // Silent but active
              osc.connect(gain);
              gain.connect(audioCtxRef.current!.destination);
              osc.start();
              oscillatorRef.current = osc;
          }
      } catch (e) {
          console.error("Failed to enable keep-alive", e);
      }
      */
  }

  function disableKeepAlive() {
      try {
          if (oscillatorRef.current) {
              oscillatorRef.current.stop();
              oscillatorRef.current.disconnect();
              oscillatorRef.current = null;
          }
      } catch (e) {}
  }
  
  // TopUp State Removed
  
  useEffect(()=>{ 
      handleRescan(); // Auto-scan on load
      if(token) {
        apiGetUserProfile(token).then(p => {
            setUserProfile(p);
        }).catch(e => console.error("Profile fetch error", e));
      }
      
      const onFocus = () => {
          if (token) {
            apiGetUserProfile(token).then(setUserProfile).catch(console.error);
          }
      };
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
  },[token, isActive])
  
  // User email fetch removed (Server Mode removed)

  useEffect(()=>{
    if(token) {
        if (!isTauri) return;
        Promise.all([
          import('@tauri-apps/api/window').then(mod => mod.appWindow),
          tauriGetVersion().catch(() => null)
        ]).then(([appWindow, v]) => {
          const ver = v ? String(v) : '';
          appWindow.setTitle(ver ? `Metabayn Studio v${ver}` : `Metabayn Studio`);
        }).catch(() => {});
    }
  },[token]);

  useEffect(() => {
    if (!isTauri) return;
    Promise.all([
      import('@tauri-apps/api/window').then(mod => mod.appWindow),
      tauriGetVersion().catch(() => null)
    ]).then(([appWindow, v]) => {
      const ver = v ? String(v) : '';
      appWindow.setTitle(ver ? `Metabayn Studio v${ver}` : `Metabayn Studio`);
    }).catch(() => {});
  }, []);

  useEffect(()=>{
    function onDown(e: KeyboardEvent) { 
      if (e.key === 'Escape') setShowLogs(false);
    }
    window.addEventListener('keydown', onDown);
    return () => {
      window.removeEventListener('keydown', onDown);
    };
  },[])

  async function scan(path:string): Promise<string[]>{
    // setLogs(l=>[...l, {text:'Scanning folder...', color:'#666'}])
    const r=await invoke<any>('scan_folder',{ input: path })
    const arr=r.files||[]; 
    setStats(s=>({...s,total:arr.length}))
    return arr
  }

    async function handleRescan() {
     try {
         const s=await invoke<any>('get_settings');
         if(s.input_folder) {
             // setLogs(l=>[...l, {text:'Refreshing file count...', color:'#aaa'}])
             const files = await scan(s.input_folder);
             setLogs(l=>[...l, {text: pl('rescanCompleteFound', { count: files.length }), color:'#4caf50'}])
         }
     } catch(e) {}
  }

  async function start(isAutoRetry: boolean | any = false){
    const isRetry = typeof isAutoRetry === 'boolean' ? isAutoRetry : false;
    if (!isRetry) folderRetryCount.current = 0;
    isGeneratingRef.current = true

    if(onProcessChange) onProcessChange(true);
    enableKeepAlive();
    try {
        setStats({total:0, done:0, success:0, failed:0, rejected:0});
    setLogs(l=>[...l, {text: pl('scanning'), color:'#aaa'}])
    setProgress(0)
    setStopped(false); stoppedRef.current = false;
    setCriticalError(null);
    
    const s=await invoke<any>('get_settings');
    const isGateway = resolveGatewayFromSettings(s);
    setGatewayEnabled(isGateway);

    if (userProfile) {
        if (!userProfile.subscription_active) {
            setShowSubAlert(true);
            return;
        }
        if (isGateway && (userProfile.tokens || 0) <= 0) {
            const t = translations[lang] || translations['en'];
            alert(t.settings.insufficientTokens || "Insufficient tokens. Please Top Up.");
            setShowTopUp(true);
            return;
        }
    }
    setLogs(l=>[...l, {text: pl('folder', { path: s.input_folder||'(None)' }), color:'#aaa'}])

    // --- FIX: Define batchTimestamp and ensureCsvHeader here so they are available to processFile ---
    const now = new Date();
    const batchTimestamp = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getFullYear()).slice(2)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    const csvInitPromises = new Map<string, Promise<void>>();

    const ensureCsvHeader = async (path: string, type: 'metabayn'|'shutterstock') => {
        if (!csvInitPromises.has(path)) {
            const p = (async () => {
                try {
                    const exists = await invoke<boolean>('file_exists', { path }).catch(()=>false);
                    if (!exists) {
                         const row = type === 'metabayn' 
                            ? ["SourceFile","Title","Description","Keywords"]
                            : ["Filename","Description","Keywords","Categories","Editorial","Mature Content","Illustration"];
                         await invoke('append_csv', { path, row });
                    }
                } catch(e) { console.error("CSV Header Error", e); }
            })();
            csvInitPromises.set(path, p);
        }
        await csvInitPromises.get(path);
    };

    // Helper: Reuse existing CSV if found (ignoring timestamp) to allow resuming
    const resolvedCsvMap = new Map<string, string>();
    const getCsvPath = async (baseDir: string, type: 'metabayn'|'shutterstock', suffix: string): Promise<string> => {
        const key = `${baseDir}|${type}|${suffix}`;
        if (resolvedCsvMap.has(key)) return resolvedCsvMap.get(key)!;

        const suffixPattern = `-${type}${suffix}.csv`.toLowerCase();
        let finalName = `${batchTimestamp}-${type}${suffix}.csv`;

        try {
            const res = await invoke<any>('scan_csv_files', { input: baseDir });
            const files: string[] = res.files || [];
            const matches = files
                .map(f => f.split(/[\\/]/).pop() || '')
                .filter(n => n.toLowerCase().endsWith(suffixPattern));
            
            if (matches.length > 0) {
                matches.sort();
                finalName = matches[matches.length - 1];
            }
        } catch (e) {}

        const fullPath = baseDir + finalName;
        resolvedCsvMap.set(key, fullPath);
        return fullPath;
    };
    // -----------------------------------------------------------------------------------------------

    // Tentukan mode koneksi berdasarkan provider:
    // - OpenRouter (AI Gateway): server-managed key, TIDAK butuh API key lokal
    // - Standard AI (Gemini/OpenAI): Direct mode dan butuh API key lokal
    let directApiKey = '';
    if (!isGateway) {
      try {
        const savedKey = localStorage.getItem('metabayn_api_key_enc');
        const savedIv = localStorage.getItem('metabayn_api_key_iv');
        if (!savedKey || !savedIv) {
          setLogs(l=>[...l, {text: pl('apiKeyMissing'), color:'#f44336'}]);
          return;
        }
        directApiKey = (await decryptApiKey(savedKey, savedIv)).trim();
        if (!directApiKey) {
          setLogs(l=>[...l, {text: pl('apiKeyEmpty'), color:'#f44336'}]);
          return;
        }
        setLogs(l=>[...l, {text: pl('directModeEnabled', { provider: String(s.ai_provider||'AI') }), color:'#4caf50', hidden:true}]);
      } catch (e:any) {
        setLogs(l=>[...l, {text: pl('failedReadApiKey'), detail: String(e), color:'#f44336'}]);
        return;
      }
    } else {
      setLogs(l=>[...l, {text: pl('gatewayModeEnabled'), color:'#4caf50', hidden:true}]);
    }
    
    // --- FIX: CSV Headers are now initialized on-demand inside processFile ---
    /* 
    try {
        // Legacy CSV Init removed to support dynamic timestamped filenames
    } catch(e) { console.error("CSV Init Error", e); }
    */
    // ------------------------------------------------------------------

    const normalizeModelForProvider = (provider: string, model: string): string => {
      const p = String(provider || '');
      let m = String(model || '').trim();
      if (p === 'OpenAI') {
        if (m.includes('/')) m = m.split('/').pop() || m;
      }
      return m;
    }

    const rawModel = String(s.default_model ?? '').trim();
    if (!rawModel) {
      setLogs(l=>[...l, {text: pl('modelNotSelected'), color:'#f44336'}]);
      stopProcessSystem(pl('modelNotSelectedDetail'));
      return;
    }

    const effectiveModel =
      String(s.ai_provider || '') === 'OpenAI'
        ? normalizeModelForProvider('OpenAI', rawModel)
        : rawModel;

    if ((String(s.ai_provider || '') === 'OpenAI' || String(s.ai_provider || '') === 'Gemini') && !isVisionLikeModelId(effectiveModel)) {
      pushLog({ text: pl('modelNotVisionSupported', { model: effectiveModel }), color: '#f44336' })
      stopProcessSystem(pl('modelNotVisionSupportedDetail'))
      return
    }

    const batchKey = [
      String(s.input_folder || ''),
      String(s.output_folder || ''),
      String(!!s.overwrite),
      String(!!s.selection_enabled),
      String(s.selection_order || ''),
      String(s.ai_provider || ''),
      String(s.connection_mode || ''),
      String(isGateway ? 'gateway' : 'direct'),
      effectiveModel
    ].join('|')

    const existing = isRetry ? loadBatchState() : null
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const nowMs = Date.now()
    const initialState: BatchStateV1 = {
      version: 1,
      running: true,
      runId,
      batchKey,
      completed: (existing?.batchKey === batchKey && existing?.completed && typeof existing.completed === 'object') ? existing.completed : {},
      startedAt: existing?.batchKey === batchKey && typeof existing.startedAt === 'number' ? existing.startedAt : nowMs,
      updatedAt: nowMs
    }
    saveBatchState(initialState)

    const markFileStatus = (file: string, status: BatchFileStatus) => {
      try {
        const cur = loadBatchState()
        if (!cur || cur.batchKey !== batchKey || cur.runId !== runId) return
        cur.completed = cur.completed || {}
        cur.completed[file] = status
        cur.updatedAt = Date.now()
        saveBatchState(cur)
      } catch {}
    }

    const markBatchStopped = () => {
      try {
        const cur = loadBatchState()
        if (!cur || cur.batchKey !== batchKey || cur.runId !== runId) return
        cur.running = false
        cur.updatedAt = Date.now()
        saveBatchState(cur)
      } catch {}
    }

    const allFiles = await scan(String(s.input_folder||''))
    
    // Add file count check
    if (allFiles.length === 0) {
       pushLog({text: pl('noSupportedFiles'), color:'#ff9800'})
       return
    }

    const shouldSkip = (file: string): boolean => {
      const st = (initialState.completed || {})[file]
      return st === 'success' || st === 'rejected' || st === 'skipped'
    }

    const successStart = allFiles.filter(f => initialState.completed?.[f] === 'success').length
    const rejectedStart = allFiles.filter(f => initialState.completed?.[f] === 'rejected').length
    const skippedStart = allFiles.filter(f => initialState.completed?.[f] === 'skipped').length
    const initialDone = successStart + rejectedStart + skippedStart

    const fileList = allFiles.filter(f => !shouldSkip(f))
    const totalCount = allFiles.length

    if (initialDone > 0) {
      pushLog({text: pl('resumeProgress', { done: initialDone, total: totalCount }), color:'#ff9800'})
    }
    
    // RESET STATS AT START
    setStats({total: totalCount, done: initialDone, success: successStart, failed: 0, rejected: rejectedStart});
    setProgress(totalCount > 0 ? Math.round((initialDone/totalCount)*100) : 0)
    
    pushLog({id: 'starting', text: pl('foundFilesStarting', { count: totalCount }), color:'#fff', animating: true})

    const CONCURRENCY = Math.max(1, Math.min(Number(s.max_threads || 8), 10));
     
     const activePromises: Promise<any>[] = [];
    
    let i=initialDone // shared counter for progress
    let filesStayingInInputCount = 0; // Tracks files that were processed but remain in input (failed, skipped, or failed to delete)

    const processFile = async (file: string) => {
        const currentFileName = file.split(/[\\/]/).pop();
        let finalStatus: BatchFileStatus | null = null;

        if(stoppedRef.current || criticalErrorRef.current) return;
        
        let fileRemoved = false;
        const logId = `${file}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        // SKIP LOGIC: Check if output file exists (respect selection-approved folder)
        if (s.output_folder && !s.overwrite) {
             const sep = String(s.output_folder).includes('\\') ? '\\' : '/';
             const baseDir = String(s.output_folder).endsWith(sep) ? s.output_folder : s.output_folder + sep;
             const approvedPath = (s.selection_enabled ? (baseDir + 'approved' + sep) : baseDir) + currentFileName;
             const rejectedPath = (s.selection_enabled ? (baseDir + 'rejected' + sep) : baseDir) + currentFileName;
             
             try {
                const existsApproved = await invoke<boolean>('file_exists', { path: approvedPath });
                const existsRejected = await invoke<boolean>('file_exists', { path: rejectedPath });
                if (existsApproved || existsRejected) {
                     pushLog({text: pl('skippedAlreadyExists', { name: currentFileName }), color:'#888'});
                     finalStatus = 'skipped'
                     markFileStatus(file, 'skipped')
                     i++; 
                     setStats(st=>({...st, done: i})); 
                     setProgress(Math.round((i/totalCount)*100));
                     filesStayingInInputCount++; // Skipped files remain in input
                     return;
                 }
             } catch(e) {}
        }

        const startTime = Date.now();
        pushLog({id: logId, text: pl('processing', { name: currentFileName }), color:'#888', animating: true}); 

        try {
            // Stop 'Starting...' animation if it's still running
            setLogs(l => l.map(x => x.id === 'starting' ? { ...x, animating: false } : x));

            const pickActualModel = (g: any): string => {
              const v = String((g && (g.vision_model || g.text_model || g.source || g.gen_provider)) || '').trim();
              return v || 'unknown';
            }

            const reqPayload: any = {
              files: [file],
              model: effectiveModel,
              token: token || '',
              retries: Number(s.retry_count ?? 3),
              title_min_words: Number(s.title_min_words || 5),
              title_max_words: Number(s.title_max_words || 13),
              description_min_chars: Number(s.description_min_chars || 80),
              description_max_chars: Number(s.description_max_chars !== undefined ? s.description_max_chars : 200),
              keywords_min_count: Number(s.keywords_min_count || 35),
              keywords_max_count: Number(s.keywords_max_count || 49),
              banned_words: String(s.banned_words || ''),
              max_threads: Number(s.max_threads || 4),
              provider: String(s.ai_provider || ''),
              request_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
            };
            if (isGateway) {
              reqPayload.connection_mode = 'gateway';
              reqPayload.api_key = '';
            } else {
              reqPayload.connection_mode = 'direct';
              reqPayload.api_key = directApiKey;
            }
            const res = await invokeWithTimeout<any[]>(invoke, 'generate_metadata_batch', { req: reqPayload }, 180000)

            const getCostUsd = (g: any): number | null => {
              const n = Number((g as any)?.cost ?? (g as any)?.cost_usd)
              if (!Number.isFinite(n) || n <= 0) return null
              return n
            }

            const applyGatewayBalanceUpdate = async (g: any): Promise<{ balanceAfter: number | null; deducted: number | null; stopped: boolean }> => {
              if (!token || !isGateway) return { balanceAfter: null, deducted: null, stopped: false }

              const deducted = (g as any).app_tokens_deducted ?? (g as any).tokens_deducted
              const hasBalanceAfter = Number.isFinite(Number((g as any).app_balance_after)) || Number.isFinite(Number((g as any).user_balance_after))
              let balanceAfter = hasBalanceAfter ? resolveGatewayBalanceAfter(g, Number(userProfile?.tokens || 0)) : null

              if (balanceAfter === null && typeof deducted === 'number' && Number.isFinite(deducted) && deducted > 0) {
                setUserProfile((prev: any) => {
                  balanceAfter = resolveGatewayBalanceAfter(g, Number(prev?.tokens || 0))
                  if (typeof balanceAfter === 'number' && Number.isFinite(balanceAfter)) {
                    return { ...prev, tokens: balanceAfter }
                  }
                  return prev
                })
              }

              if (typeof balanceAfter === 'number' && Number.isFinite(balanceAfter)) {
                setUserProfile((prev: any) => ({ ...prev, tokens: balanceAfter }))
                if (balanceAfter <= 0) {
                  pushLog({text: pl('tokensExhaustedStop'), color:'#f44336'})
                  stopProcessSystem(pl('tokensExhaustedDetail'))
                  return { balanceAfter, deducted: typeof deducted === 'number' ? deducted : null, stopped: true }
                }
                return { balanceAfter, deducted: typeof deducted === 'number' ? deducted : null, stopped: false }
              }

              try {
                const fresh = await apiGetUserProfile(token)
                const freshTokens = Number((fresh as any)?.tokens)
                if (Number.isFinite(freshTokens)) {
                  setUserProfile((prev: any) => ({ ...prev, ...fresh, tokens: freshTokens }))
                  if (freshTokens <= 0) {
                    pushLog({text: pl('tokensExhaustedStop'), color:'#f44336'})
                    stopProcessSystem(pl('tokensExhaustedDetail'))
                    return { balanceAfter: freshTokens, deducted: null, stopped: true }
                  }
                  return { balanceAfter: freshTokens, deducted: null, stopped: false }
                }
              } catch {}

              return { balanceAfter: null, deducted: null, stopped: false }
            }
            
            for(const g of res){
                const fileName = g.file.split(/[\\/]/).pop();

                const balanceUpdate = await applyGatewayBalanceUpdate(g)
                if (balanceUpdate.stopped) break

                if (isGateway) {
                  const costUsd = getCostUsd(g)
                  const reqId = String((g as any)?.request_id || (g as any)?.metabayn?.request_id || '').trim()
                  const appUsed = Number((g as any)?.app_tokens_deducted ?? (g as any)?.tokens_deducted)
                  const balanceAfter = Number((g as any)?.app_balance_after ?? (g as any)?.user_balance_after)
                  const finalBalance = Number.isFinite(balanceAfter) ? balanceAfter : (Number.isFinite(Number(balanceUpdate.balanceAfter)) ? Number(balanceUpdate.balanceAfter) : null)
                  const line = [
                    `[${new Date().toISOString()}]`,
                    `request_id=${reqId || '-'}`,
                    `file=${fileName}`,
                    `cost_usd=${costUsd && Number.isFinite(costUsd) ? costUsd.toFixed(6) : '0.000000'}`,
                    `deducted=${Number.isFinite(appUsed) ? appUsed : 0}`,
                    `balance_after=${finalBalance !== null ? finalBalance : 'unknown'}`
                  ].join(' ')
                  invoke<string>('append_cost_log', { line }).catch(() => {})
                }

                if (g.source === 'error' || g.title === 'ERROR' || g.selection_status === 'rejected') {
                    const isRejection = String(g.description).startsWith('Rejected:') || g.selection_status === 'rejected';
                    finalStatus = isRejection ? 'rejected' : 'failed'
                    
                    // Construct detail with token stats for rejected/failed files
                    let detailMsg = localizeBackendError((g as any).description);
                    if (g.input_tokens !== undefined) {
                        detailMsg += `\n\n${pl('generationStatsTitle')}`;
                        const actualModel = pickActualModel(g);
                        detailMsg += `\n${pl('model', { model: actualModel })}`;
                        const inTok = typeof g.input_tokens === 'number' && Number.isFinite(g.input_tokens) ? g.input_tokens : 0
                        const outTok = typeof g.output_tokens === 'number' && Number.isFinite(g.output_tokens) ? g.output_tokens : 0
                        detailMsg += `\n${pl('inOut', { inTok, outTok })}`;

                        if (isGateway) {
                          const costUsd = getCostUsd(g)
                          if (costUsd) {
                            detailMsg += `\n${pl('costUsd', { cost: costUsd.toFixed(6) })}`
                          }
                          const appUsed = (g as any).app_tokens_deducted
                          if (typeof appUsed === 'number' && Number.isFinite(appUsed)) {
                            detailMsg += `\n${pl('appTokensUsed', { tokens: appUsed })}`
                          }
                        }
                        
                        if (g.selection_status) {
                             detailMsg += `\n${pl('selection', { status: g.selection_status })}`;
                        }
                    }

                    setLogs(l => l.map(x => x.id === logId ? { 
                        ...x, 
                        text: isRejection ? `[${t.dashboard.reject}] ${fileName}` : `[${t.dashboard.failed}] ${fileName}`, 
                        detail: detailMsg, 
                        color: isRejection ? '#ff9800' : '#f44336', 
                        animating: false 
                    } : x));
                    
                    if (!isRejection) {
                         setStats(st=>({...st, failed: st.failed+1}));
                    } else {
                         setStats(st=>({...st, rejected: st.rejected+1}));
                         try {
                             if (s.selection_enabled && s.output_folder) {
                                 const sep = String(s.output_folder).includes('\\') ? '\\' : '/';
                                 const baseDir = String(s.output_folder).endsWith(sep) ? s.output_folder : s.output_folder + sep;
                                 const failList = Array.isArray((g as any).failed_checks) ? (g as any).failed_checks : [];
                                 const mainReason = String((g as any).reason || g.description || 'Rejected');
                                 await invoke('move_file_to_rejected', {
                                    filePath: g.file,
                                    outputFolder: baseDir,
                                    reasons: failList,
                                    mainReason: mainReason
                                });
                                 fileRemoved = true;
                                 pushLog({text: pl('movedToRejected', { name: fileName }), color:'#ff9800', hidden:true});
                             }
                         } catch(e) {
                             pushLog({text: pl('warningMoveRejectedFailed', { name: fileName }), detail: String(e||''), color:'#ff9800'});
                         }
                    }
                    // filesStayingInInputCount will be incremented in finally block since fileRemoved is false
                    
                    if (String(g.description).includes('Too Many Requests') || String(g.description).includes('Rate limit')) {
                        pushLog({text: pl('rateLimitContinuing'), color:'#ff9800', hidden:true});
                    }
                     continue;
                }

                pushLog({text: pl('writingXmp', { name: fileName }), color:'#aaa', hidden: true})
                
                let targetFile = g.file;
                let doDeleteOriginal = false;
                let outputFileName = fileName;
                
                if (s.output_folder) {
                    const sep = String(s.output_folder).includes('\\') ? '\\' : '/';
                    const baseDir = String(s.output_folder).endsWith(sep) ? s.output_folder : s.output_folder + sep;
                    const status = (g.selection_status || '').toLowerCase();
                    const sanitizeReason = (v: any) => String(v || '').toLowerCase().replace(/[^a-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
                    const failed = Array.isArray(g.failed_checks) ? g.failed_checks : [];
                    // Removed subdirectory logic, now just rename based on reason
                    
                    let outDir = baseDir;
                    
                    if (s.selection_enabled) {
                        if (status === 'rejected') {
                             outDir = baseDir + 'rejected' + sep;
                             
                             // MAPPING LOGIC: Convert long AI failure strings to short tags
                             const mapFailureToTag = (fail: string): string => {
                                 const f = fail.toLowerCase();
                                 
                                 // Brand/Watermark
                            if (f.includes('trademarked logo') || f.includes('brand logo') || f.includes('specific trademarked logo') || f.includes('brand_logo')) return 'Brand_Logo';
                            if (f.includes('watermark') || f.includes('copyright stamp')) return 'Watermark';
                            
                            // Quality
                            if (f.includes('blurry') || f.includes('blur') || f.includes('out of focus')) return 'Blurry';
                            if (f.includes('pixelated') || f.includes('low resolution') || f.includes('low quality')) return 'Low_Quality';
                            if (f.includes('artifact') || f.includes('distortion')) return 'Artifacts';

                            // Text
                            if (f.includes('gibberish')) return 'Text_Gibberish';
                            if (f.includes('non-english')) return 'Text_Non_English';
                            if (f.includes('irrelevant')) return 'Text_Irrelevant';
                            if (f.includes('relevant-text') || f.includes('relevant_text')) return 'Text_Relevant';
                            if (f.includes('text') || f.includes('words') || f.includes('letters') || f.includes('overlay')) return 'Text_Overlay';
                             
                            // Human
                            if (f.includes('human')) {
                                     if (f.includes('full body') || f.includes('full_body')) return 'Human_Full_Body';
                                     if (f.includes('no head') || f.includes('no_head')) return 'Human_No_Head';
                                     if (f.includes('partial body (perfect') || f.includes('partial_perfect')) return 'Human_Partial_Perfect';
                                     if (f.includes('partial body (defect') || f.includes('partial_defect')) return 'Human_Partial_Defect';
                                     if (f.includes('back view') || f.includes('back_view')) return 'Human_Back_View';
                                     if (f.includes('unclear') || f.includes('distorted') || f.includes('alien')) return 'Human_Distorted';
                                     if (f.includes('face only') || f.includes('face_only')) return 'Human_Face_Only';
                                     if (f.includes('nudity') || f.includes('nsfw') || f.includes('sexual')) return 'Human_NSFW';
                                     return 'Human_Presence'; // Fallback
                                 }
                                 
                                 // Animal
                                 if (f.includes('animal')) {
                                     if (f.includes('full body') || f.includes('full_body')) return 'Animal_Full_Body';
                                     if (f.includes('no head') || f.includes('no_head')) return 'Animal_No_Head';
                                     if (f.includes('partial body (perfect') || f.includes('partial_perfect')) return 'Animal_Partial_Perfect';
                                     if (f.includes('partial body (defect') || f.includes('partial_defect')) return 'Animal_Partial_Defect';
                                     if (f.includes('back view') || f.includes('back_view')) return 'Animal_Back_View';
                                     if (f.includes('unclear') || f.includes('distorted') || f.includes('alien')) return 'Animal_Distorted';
                                     if (f.includes('face only') || f.includes('face_only')) return 'Animal_Face_Only';
                                     if (f.includes('nudity') || f.includes('genitals')) return 'Animal_NSFW';
                                     return 'Animal_Presence';
                                 }
                                 
                                 // Fallback for short codes (Vision Prompt or others)
                                 if (f.includes('full_body_perfect')) return 'Full_Body_Perfect';
                                 if (f.includes('no_head')) return 'No_Head';
                                 if (f.includes('partial_perfect')) return 'Partial_Perfect';
                                 if (f.includes('partial_defect')) return 'Partial_Defect';
                                 if (f.includes('back_view')) return 'Back_View';
                                 if (f.includes('unclear_hybrid')) return 'Distorted';
                                 if (f.includes('face_only')) return 'Face_Only';
                                 if (f.includes('nudity_nsfw')) return 'NSFW';
                                 
                                 if (f.includes('deformed')) return 'Deformed_Object';
                                 if (f.includes('unrecognizable')) return 'Unrecognizable';
                                 if (f.includes('famous')) return 'Famous_Trademark';

                                 // If no match, try to use the first 2-3 words if it's not too long, else ignore
                                 const words = f.split(/[^a-z0-9]+/);
                                 if (words.length > 0 && words.length < 4) return words.join('_');
                                 
                                 return ''; 
                             };

                             // Rename to reason
                             // If failed_checks is empty, try to use reason text if available
                             let failList = failed;
                             if (failList.length === 0 && g.reason) {
                                 // Try to parse reason if it contains keywords
                                 failList = [g.reason];
                             }

                             let reasonStr = failList.map(mapFailureToTag).filter(Boolean).join('_');
                             
                             // If no mapped tags from failed_checks, try mapping the main reason
                             if (!reasonStr && (g as any).reason) {
                                 const rTag = mapFailureToTag((g as any).reason);
                                 if (rTag) reasonStr = rTag;
                             }

                             if (!reasonStr) {
                                 const raw = failList[0] || (g as any).reason || 'Rejected';
                                 reasonStr = sanitizeReason(raw);
                                 if (reasonStr.length > 50) reasonStr = reasonStr.substring(0, 50);
                             }
                             const ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
                             outputFileName = reasonStr + ext;
                             
                             // Handle collision: reason.ext, reason (2).ext, etc.
                             // We check existence and increment.
                             let counter = 1;
                             let checkName = outputFileName;
                             try {
                                 // Simple check loop (max 1000 to prevent infinite hang)
                                 for(let c=0; c<1000; c++) {
                                     const exists = await invoke<boolean>('file_exists', { path: outDir + checkName });
                                     if (!exists) break;
                                     counter++;
                                     checkName = `${reasonStr} (${counter})${ext}`;
                                 }
                                 outputFileName = checkName;
                             } catch(e) {}
                             
                        } else {
                             outDir = baseDir + 'approved' + sep;
                        }
                    }

                    targetFile = outDir + outputFileName;
                    if (targetFile !== g.file) {
                        doDeleteOriginal = true;
                    }
                }

                let writeSuccess = false;
                let renamedPath: string | null = null;
                const autoEmbed = (s as any).auto_embed !== false;

                if(g.file.toLowerCase().match(/\.(mp4|mov|mkv|avi|webm)$/)){
                    try{ 
                        renamedPath = await invokeWithTimeout<string | null>(invoke, 'write_video_metadata',{ req:{ file:g.file, output_file: targetFile, title:g.title, description:g.description, keywords:g.keywords, overwrite: !!s.overwrite, auto_embed: autoEmbed, category: g.category||"" } }, 60000);
                        writeSuccess = true;
                    } catch(e:any){ 
                        setStats(st=>({...st,failed:st.failed+1}));
                        setLogs(l => l.map(x => x.id === logId ? { ...x, text: pl('failedWrite', { name: fileName }), detail: localizeBackendError(String(e)), color:'#f44336', animating: false } : x));
                    }
                } else {
                    try{ 
                        renamedPath = await invokeWithTimeout<string | null>(invoke, 'write_image_metadata',{ req:{ file:g.file, output_file: targetFile, title:g.title, description:g.description, keywords:g.keywords, creator:'Metabayn', copyright:'Metabayn Studio', overwrite: !!s.overwrite, auto_embed: autoEmbed, category: g.category||"" } }, 60000);
                        writeSuccess = true;
                    } catch(e:any){ 
                        setStats(st=>({...st,failed:st.failed+1}));
                        setLogs(l => l.map(x => x.id === logId ? { ...x, text: pl('failedWrite', { name: fileName }), detail: localizeBackendError(String(e)), color:'#f44336', animating: false } : x));
                    }
                }

                if (renamedPath) {
                    const sep = renamedPath.includes('\\') ? '\\' : '/';
                    outputFileName = renamedPath.split(sep).pop() || outputFileName;
                }
                
                if (writeSuccess) {
                    if ((g.selection_status || '').toLowerCase() === 'rejected') {
                         setStats(st=>({...st, rejected: st.rejected+1}));
                         finalStatus = 'rejected'
                    } else {
                         setStats(st=>({...st,success:st.success+1}));
                         finalStatus = 'success'
                    }
                    
                    // Format detailed log with token usage
                    const tokenDetail = (() => {
                        let msg = pl('generationStatsTitle');
                        const actualModel = pickActualModel(g);
                        msg += `\n${pl('model', { model: actualModel })}`;
                        const inTok = typeof g.input_tokens === 'number' && Number.isFinite(g.input_tokens) ? g.input_tokens : 0
                        const outTok = typeof g.output_tokens === 'number' && Number.isFinite(g.output_tokens) ? g.output_tokens : 0
                        msg += `\n${pl('inOut', { inTok, outTok })}`;

                        const appUsed = (g as any).app_tokens_deducted
                        if (typeof appUsed === 'number' && Number.isFinite(appUsed)) {
                          msg += `\n${pl('appTokensUsed', { tokens: appUsed })}`
                        }
                        const costUsd = getCostUsd(g)
                        if (costUsd) {
                          msg += `\n${pl('costUsd', { cost: costUsd.toFixed(6) })}`
                        }
                        
                        msg += `\n${pl('selection', { status: g.selection_status || 'n/a' })}`;
                        return msg;
                    })();
                    
                    // Update existing log in-place
                    const isRejected = (g.selection_status || '').toLowerCase() === 'rejected';
                    setLogs(l => l.map(x => x.id === logId ? { 
                        ...x, 
                        text: isRejected ? `[${t.dashboard.reject}] ${fileName}` : `[${t.dashboard.success}] ${fileName}`, 
                        detail: tokenDetail, // Add detail for the modal log
                        color: isRejected ? '#ff9800' : '#4caf50', 
                        animating: false 
                    } : x));
                    
                    if (doDeleteOriginal) {
                        try {
                            const exists = await invoke<boolean>('file_exists', { path: g.file });
                            if (exists) {
                                await invoke('delete_file', { path: g.file });
                                fileRemoved = true;
                                setStats(st=>({...st, total: st.total > 0 ? st.total - 1 : 0}));
                            }
                        } catch(e) {
                            console.error("Failed to delete original", e);
                            const msg = String(e || '');
                            if (msg && !/os error\s*2|entity not found|not found/i.test(msg)) {
                                pushLog({text: pl('warningDeleteOriginalFailed', { name: fileName }), detail: msg, color:'#ff9800'});
                            }
                        }
                    }

                if ((s.output_folder || s.csv_path) && s.generate_csv !== false) {
                    const isRejected = (g.selection_status || '').toLowerCase() === 'rejected';
                    const statusSuffix = s.selection_enabled 
                        ? (isRejected ? '-reject' : '-approve')
                        : '';
                    const folderName = s.selection_enabled
                        ? (isRejected ? 'rejected' : 'approved')
                        : '';
                    
                    let baseDir = String(s.csv_path || s.output_folder || '');
                    // If csv_path is a file (ends with .csv), use its parent dir
                    if (baseDir.toLowerCase().endsWith('.csv')) {
                         baseDir = baseDir.substring(0, baseDir.lastIndexOf(baseDir.includes('\\') ? '\\' : '/'));
                    }
                    
                    const sep = baseDir.includes('\\') ? '\\' : '/';
                    if (!baseDir.endsWith(sep)) baseDir += sep;
                    
                    const finalDir = (s.selection_enabled && folderName) ? (baseDir + folderName + sep) : baseDir;
                    
                    const mbPath = await getCsvPath(finalDir, 'metabayn', statusSuffix);
                    const ssPath = await getCsvPath(finalDir, 'shutterstock', statusSuffix);
                    
                    try {
                        // Metabayn CSV
                        await ensureCsvHeader(mbPath, 'metabayn');
                        const row=[outputFileName,g.title,g.title,g.keywords.join(',')];
                        await invoke('append_csv',{ path: mbPath, row });
                        
                        // Shutterstock CSV
                        await ensureCsvHeader(ssPath, 'shutterstock');
                        const rowSS=[outputFileName,g.title,g.keywords.join(','),g.category||"","No","No","No"];
                        await invoke('append_csv',{ path: ssPath, row: rowSS });
                    } catch(e) {
                        console.error("CSV Write Error", e);
                        const n = mbPath.split(/[\\/]/).pop();
                        pushLog({text: pl('warningWriteCsvFailed', { name: n }), color:'#ff9800'});
                    }
                }
                }
            }
        } catch(e:any) {
            // No throttling or sleeps on failure; continue at max speed
            const fileName = file.split(/[\\/]/).pop();
            const msg = String(e || '');
            if (msg.includes(' timeout')) {
              stopProcessSystem(pl('timeoutDetail'))
            }
            const isCancelled = msg.includes('CANCELLED_BY_USER');
            finalStatus = finalStatus || (isCancelled ? 'skipped' : 'failed');
            if (!isCancelled) {
              setLogs(l => l.map(x => x.id === logId ? { ...x, text: pl('systemError', { name: fileName }), detail: localizeBackendError(msg), color:'#f44336', animating: false } : x));
              setStats(st=>({...st, failed: st.failed+1}));
            } else {
              setLogs(l => l.map(x => x.id === logId ? { ...x, text: pl('cancelled', { name: fileName }), detail: '', color:'#ff9800', animating: false } : x));
            }
            invoke('log_audit_event', {
              event_type: 'error',
              context: `Batch error: ${String(fileName || '')}\n${String(e || '').slice(0, 800)}`,
              status: 'Failed'
            }).catch(() => {})
        } finally {
            // Stop animation for this file
            if (!fileRemoved) filesStayingInInputCount++;
            if (finalStatus) markFileStatus(file, finalStatus)
            setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
            i++; setStats(st=>({...st,done:i})); setProgress(Math.round((i/totalCount)*100));
        }
    };

    for(const file of fileList){
      if(stoppedRef.current || criticalErrorRef.current) break; 
      if(stoppedRef.current) break;
      
      const p = processFile(file);
      activePromises.push(p);
      
      p.finally(() => {
          const idx = activePromises.indexOf(p);
          if (idx > -1) activePromises.splice(idx, 1);
      });

      while (activePromises.length >= CONCURRENCY) {
          if (stoppedRef.current || criticalErrorRef.current) break;
          await Promise.race(activePromises);
      }
    }
    
    const remaining = [...activePromises];
    if (remaining.length) await Promise.allSettled(remaining);
    pushLog({text: stoppedRef.current ? pl('stoppedBatch') : pl('doneText'), color: stoppedRef.current ? '#ff5722' : '#4caf50'})
    
    // Auto-rescan to update file count
    if (!stoppedRef.current && s.input_folder) {
        pushLog({text: pl('updatingFileCount'), color:'#aaa'});
        const left = await scan(s.input_folder);
        pushLog({text: pl('remainingFiles', { count: left.length }), color:'#4caf50'});
    }
    
    setStopped(false); stoppedRef.current = false;
    markBatchStopped()
    if (!stoppedRef.current && i >= totalCount) clearBatchState()

    } catch (e) {
        console.error("Process Error", e);
        pushLog({text: pl('processInterrupted'), detail: String(e), color:'#f44336'});
        try {
          const cur = loadBatchState()
          if (cur && cur.batchKey) {
            cur.running = false
            cur.updatedAt = Date.now()
            saveBatchState(cur)
          }
        } catch {}
    } finally {
        isGeneratingRef.current = false
        if(onProcessChange) onProcessChange(false);
        disableKeepAlive();
    }
  }
  function stopProcess(){ 
      setStopped(true); 
      stoppedRef.current = true;
      try {
        const cur = loadBatchState()
        if (cur) {
          cur.running = false
          cur.updatedAt = Date.now()
          saveBatchState(cur)
        }
      } catch {}
      pushLog({text: pl('stoppedByUser'), color:'#ff5722'});
  }

  function stopProcessSystem(detail?: string){
      setStopped(true);
      stoppedRef.current = true;
      try {
        const cur = loadBatchState()
        if (cur) {
          cur.running = false
          cur.updatedAt = Date.now()
          saveBatchState(cur)
        }
      } catch {}
      pushLog({text: pl('stoppedBySystem', { detail: detail ? ` (${detail})` : '' }), color:'#ff5722'});
  }

  function handleStartClick() {
    const st = loadBatchState()
    return start(!!st)
  }

  async function generateCSV(){
    if (!isTauri) { setLogs(l=>[...l,{text: pl('csvGenTauriOnly'), color:'#ff9800'}]); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: pl('selectInputFolderImagesVideos')
        });
        if (!inputDir) return;

        // Fetch settings
        const s = await invoke<any>('get_settings');

        // Prepare API Key (Always Direct Mode)
        let apiKey = "";
        
        try {
            const savedKey = localStorage.getItem('metabayn_api_key_enc');
            const savedIv = localStorage.getItem('metabayn_api_key_iv');
            if (savedKey && savedIv) {
                apiKey = (await decryptApiKey(savedKey, savedIv)).trim();
            }
        } catch(e) { console.error("Failed to decrypt API Key", e); }

        // Log: Start (Grey color, animating)
        const logId = Date.now();
        setLogs(l => [...l, { id: logId, text: pl('csvGenGeneratingFrom', { path: inputDir }), color: '#aaa', animating: true }]);
        
        // Output folder is same as input folder
        const res = await invoke('generate_csv_from_folder', { input_folder: inputDir, output_folder: inputDir, inputFolder: inputDir, outputFolder: inputDir, api_key: apiKey, apiKey: apiKey, token });
        
        // Log: Success (Update previous log to stop animation, add new success log)
        setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
        setLogs(l => [...l, { text: pl('csvGenSuccess', { result: res }), color: '#4caf50' }]);
    } catch (e) {
        setLogs(l => l.map(x => x.animating ? { ...x, animating: false } : x)); // Stop all animations
        setLogs(l => [...l, { text: pl('csvGenFailed', { error: String(e) }), color: '#f44336' }]);
    }
  }
  async function openDupConfig(){
    setShowDupModal(true)
    // Removed log to avoid confusion when opening config
  }

  async function pickDupFolder(){
    if (!isTauri) { setLogs(l=>[...l,{text: pl('duplicateTauriOnly'), color:'#ff9800'}]); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: pl('selectFolderImagesVideos') });
    if (inputDir) setDupInputDir(String(inputDir))
  }

  async function runDupScan(){
    if (!isTauri) { setLogs(l=>[...l,{text: pl('duplicateTauriOnly'), color:'#ff9800'}]); return }
    if (!dupInputDir) {
      setLogs(l=>[...l,{text: pl('duplicateNoFolderSelected'), color:'#ff9800'}])
      return
    }
    try {
      setDupRunning(true)
      const logId = Date.now();
      setLogs(l => [...l, { id: logId, text: pl('duplicateStartingScan', { path: dupInputDir }), color: '#aaa', animating: true }]);
      console.log("[Duplicate] Invoking command with:", { input_folder: dupInputDir, auto_delete: dupAutoDelete, threshold: dupThreshold });
      const res = await invoke<string>('detect_duplicate_images', { input_folder: dupInputDir, inputFolder: dupInputDir, auto_delete: dupAutoDelete, autoDelete: dupAutoDelete, threshold: dupThreshold });
      console.log("[Duplicate] Result:", res);
      setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
      setLogs(l => [...l, { text: pl('duplicateCompleted', { result: res }), color: '#4caf50' }]);
    } catch (e) {
      console.error("[Duplicate] Error:", e);
      setLogs(l => l.map(x => x.animating ? { ...x, animating: false } : x));
      setLogs(l => [...l, { text: pl('duplicateFailed', { error: String(e) }), color: '#f44336' }]);
    } finally {
      setDupRunning(false)
    }
  }

  async function runAiCluster(){
    if (!isTauri) { setLogs(l=>[...l,{text: pl('aiClusterTauriOnly'), color:'#ff9800'}]); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: translations[lang].dashboard.aiClusterTitle
        });
        if (!inputDir) return;

        // Log: Start
        const logId = Date.now();
        setLogs(l => [...l, { id: logId, text: pl('aiClusterStarting', { path: inputDir, threshold: '0.85' }), color: '#aaa', animating: true }]);
        
        // Threshold hardcoded to 0.85 for now as per python script default
        const res = await invoke<string>('run_ai_clustering', { inputFolder: inputDir, threshold: 0.85 });
        
        // Log: Success
        setLogs(l => l.map(x => ({ ...x, animating: false })));
        setLogs(l => [...l, { text: pl('aiClusterCompleted', { result: res }), color: '#4caf50' }]);
    } catch (e) {
        setLogs(l => l.map(x => ({ ...x, animating: false })));
        setLogs(l => [...l, { text: pl('aiClusterFailed', { error: String(e) }), color: '#f44336' }]);
    }
  }
  

  return (
    <>
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#09090b',
        color: '#e4e4e7'
    }}>
      {/* 1. TOP HEADER (Static) */}
      <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          borderBottom: '1px solid #27272a',
          background: '#09090b',
          zIndex: 100
      }}>
          {/* LEFT: Toggle + Title */}
          <div style={{display:'flex', alignItems:'center', gap: 16}}>
               <div className="app-title" style={{display:'inline-flex', alignItems:'center', gap:8, color:'#fff'}}>
                 <span title="Metabayn" style={{display:'inline-flex', alignItems:'center'}}>
                   <img src={appIconUrl} alt="Metabayn" style={{height:18, width:18}} />
                 </span>

                 {/* Language Toggle */}
                 <div 
                     onClick={() => setLang(l => {
                       const next = l === 'en' ? 'id' : 'en'
                       try { localStorage.setItem('app_lang', next) } catch {}
                       return next
                     })}
                     style={{
                         cursor: 'pointer', 
                         fontSize: '10px', 
                         fontWeight: 'bold', 
                         color: lang === 'en' ? '#35a4e5' : '#F049A9', 
                         border: `1px solid ${lang === 'en' ? '#35a4e5' : '#F049A9'}`, 
                         padding: '1px 5px', 
                         borderRadius: '4px',
                         marginLeft: '4px',
                         userSelect: 'none'
                     }}
                     title={lang === 'en' ? (t?.dashboard?.switchToId || "Switch to Bahasa Indonesia") : (t?.dashboard?.switchToEn || "Switch to English")}
                 >
                     {lang.toUpperCase()}
                 </div>

                 {/* User Email & Status */}
                 {(userProfile?.email || userEmail) && (
                     <div style={{
                         display: 'flex', alignItems: 'center', gap: 8,
                         marginLeft: 8, paddingLeft: 8, borderLeft: '1px solid #333'
                     }}>
                         {/* Email */}
                         <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 500, userSelect: 'text' }}>
                             {userProfile?.email || userEmail}
                         </span>
                         
                         {/* Subscription Status Icon */}
                         <div
                           title={subscriptionActive ? "Subscription Active" : "Subscription Inactive"}
                           style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                         >
                           <span style={{
                             width: 8,
                             height: 8,
                             borderRadius: 999,
                             background: subscriptionActive ? '#00ff5a' : '#7f1d1d',
                             boxShadow: subscriptionActive ? '0 0 10px rgba(0,255,90,0.55)' : 'none',
                             display: 'inline-block'
                           }} />
                           {subscriptionActive ? (
                             <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 500, userSelect: 'text' }}>
                               {subscriptionExpiryLabel || '--/--/----'}
                             </span>
                           ) : (
                             <button
                               onClick={() => {
                                 try { localStorage.setItem('metabayn:topupFocus:v1', 'subscription'); } catch {}
                                 setShowTopUp(true);
                               }}
                               style={{
                                 border: '1px solid rgba(220, 38, 38, 0.5)',
                                 background: 'rgba(220, 38, 38, 0.18)',
                                 color: '#fecaca',
                                 padding: '3px 10px',
                                 borderRadius: 999,
                                 fontSize: 11,
                                 fontWeight: 700,
                                 cursor: 'pointer'
                               }}
                             >
                               {translations[lang].settings.subscribe || "Subscribe"}
                             </button>
                           )}
                         </div>


                     </div>
                 )}
               </div>
          </div>

          {/* RIGHT: Actions */}
          <div style={{display:'flex', gap:16, alignItems:'center'}}>
             
            {token && (
               <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                {/* Live Token Balance (Moved) */}
                {userProfile && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.1)',
                        cursor: 'default'
                    }} title={t?.dashboard?.tokenBalanceTitle || "Token Balance"}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                        </svg>
                        <span style={{ fontSize: '11px', color: '#e4e4e7', fontWeight: 600 }}>
                            {formatTokenBalance(userProfile?.tokens)}
                        </span>
                    </div>
                )}
                {/* Subscription Icon */}
                <button 
                    onClick={() => {
                        setShowTopUp(true);
                    }}
                    style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.2s ease'
                    }}
                    title={userProfile?.subscription_active ? (t?.dashboard?.subscriptionActiveTitle || "Subscription Active") : (t?.dashboard?.subscriptionRequiredTitle || "Subscription Required")}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={userProfile?.subscription_active ? "#ffd700" : "#fff"} xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 18V19C21 20.1 20.1 21 19 21H5C3.89 21 3 20.1 3 19V5C3 3.9 3.89 3 5 3H19C20.1 3 21 3.9 21 5V6H12C10.89 6 10 6.9 10 8V16C10 17.1 10.89 18 12 18H21ZM12 16H22V8H12V16ZM16 13.5C15.17 13.5 14.5 12.83 14.5 12C14.5 11.17 15.17 10.5 16 10.5C16.83 10.5 17.5 11.17 17.5 12C17.5 12.83 16.83 13.5 16 13.5Z"/>
                    </svg>
                    <span style={{fontSize: 11, fontWeight: 600, color: userProfile?.subscription_active ? '#ffd700' : '#fff'}}>
                        {t?.dashboard?.topUp || "Top Up"}
                    </span>
                </button>

                 {isAdmin && (
                   <button
                     onClick={() => onOpenAdmin && onOpenAdmin()}
                     style={{
                       background: 'transparent',
                       color: '#ffca28',
                       border: '1px solid #ffca28',
                       padding: '2px 8px',
                       borderRadius: 4,
                       cursor: 'pointer',
                       fontSize: 11,
                       fontWeight: 700
                     }}
                    title={t?.dashboard?.admin || "Admin Panel"}
                   >
                     Admin
                   </button>
                 )}
                 
                 <button 
                    onClick={() => setShowHelp(true)}
                    className="icon-min"
                    style={{
                      background: 'transparent', color: '#2196f3', 
                      padding: '4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                    }}
                    title={translations[lang].dashboard.help}
                 >
                   <div style={{
                       width: 18, height: 18, background: '#2196f3', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px', fontWeight: 'bold'
                   }}>?</div>
                 </button>
               </div>
             )}
          </div>
      </div>

      {/* CRITICAL ERROR ALERT BANNER */}
      {criticalError && (
          <div style={{
              background: '#d32f2f', 
              color: '#fff', 
              padding: '12px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 99
          }}>
              <div style={{display:'flex', alignItems:'center', gap:12}}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  <div>
                      <div style={{fontWeight:'bold', fontSize:'14px'}}>{t?.dashboard?.systemAlert || 'SYSTEM ALERT'}</div>
                      <div style={{fontSize:'13px', opacity:0.9}}>{criticalError}</div>
                  </div>
              </div>
              <div style={{display:'flex', gap:8}}>
                  <button 
                      onClick={() => setCriticalError(null)}
                      style={{
                          background:'rgba(0,0,0,0.2)', color:'white', border:'none', 
                          padding:'6px 12px', borderRadius:4, cursor:'pointer'
                      }}
                  >
                      {t?.dashboard?.dismiss || 'Dismiss'}
                  </button>
              </div>
          </div>
      )}

      {/* 2. MAIN BODY (Vertical Single Column) */}
      <div className="dashboard" style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#09090b',
          position: 'relative'
      }}>
          {/* SETTINGS AREA */}
          <div style={{
              flex: 1, 
              overflowY: 'auto', 
              padding: 0,
              background: '#09090b'
          }}>
             <Settings 
                onBack={()=>{}} 
                embedded={true} 
                lang={lang} 
                onGenerateCSV={generateCSV}
                onOpenDupConfig={openDupConfig}
                onRunAiCluster={runAiCluster}
             />
          </div>

          {/* CONTROL HEADER */}
          <div style={{
              background: '#09090b', 
              borderBottom: '1px solid #27272a',
              borderTop: '1px solid #27272a',
              padding: '12px 24px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              gap: 24, 
              flexShrink: 0
          }}>
               {/* Controls */}
               <div style={{display:'flex', gap:12, alignItems:'center'}}>
                   <button className="icon-min" onClick={handleStartClick} aria-label={translations[lang].dashboard.start} title={translations[lang].dashboard.start} style={{padding:8, background: '#18181b', border: '1px solid #27272a', borderRadius: 8, cursor:'pointer'}}>
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="#4caf50" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>
                   </button>
                   <button className="icon-min" onClick={stopProcess} aria-label={translations[lang].dashboard.stop} title={translations[lang].dashboard.stop} style={{padding:8, background: '#18181b', border: '1px solid #27272a', borderRadius: 8, cursor:'pointer'}}>
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="#f44336" xmlns="http://www.w3.org/2000/svg"><path d="M6 6h12v12H6z"/></svg>
                   </button>
               </div>

               {/* Progress & Stats */}
               <div style={{flex:1, display:'flex', flexDirection:'column', gap:4}}>
                   <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'#a1a1aa'}}>
                       <div style={{display:'flex', gap:12}}>
                           <span>{translations[lang].dashboard.total}: <span style={{color:'#fff'}}>{stats.total}</span></span>
                           <span>{translations[lang].dashboard.done}: <span style={{color:'#fff'}}>{stats.done}</span></span>
                       </div>
                       <div style={{display:'flex', gap:12}}>
                           <span style={{color:'#4caf50'}}>{translations[lang].dashboard.success}: {stats.success}</span>
                           <span style={{color:'#ff9800'}}>{translations[lang].dashboard.reject}: {stats.rejected}</span>
                           <span style={{color:'#f44336'}}>{translations[lang].dashboard.failed}: {stats.failed}</span>
                       </div>
                   </div>
                   <ProgressBar value={progress} />
               </div>
          </div>

          {/* LOG PANEL (Bottom) */}
          <div style={{
              height: '300px', 
              borderTop: '1px solid #27272a', 
              background: '#0f0f12', 
              display: 'flex', 
              flexDirection: 'column',
              flexShrink: 0
          }}>
              <div style={{
                  padding:'8px 16px', 
                  borderBottom:'1px solid #27272a', 
                  display:'flex', 
                  alignItems:'center', 
                  justifyContent:'space-between', 
                  background:'#18181b'
              }}>
                <div style={{fontSize:11, fontWeight:'bold', color:'#a1a1aa'}}>{t?.dashboard?.logs || 'Logs'}</div>
              </div>
              <div style={{flex:1, minHeight:0, overflowY:'auto'}}>
                <LogPanel logs={logs} lang={lang} />
              </div>

          </div>
      </div>
    </div>
    {showDupModal && (
      <div className="modal open" style={{zIndex: 9999}}>
        <div className="modal-content">
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>{t?.dashboard?.dupModal?.title || 'Duplicate Detection'}</div>
            <button className="icon-btn" onClick={()=>setShowDupModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{padding:16}}>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>{t?.dashboard?.dupModal?.inputFolder || 'Input Folder'}</div>
              <div style={{flex:1}} title={dupInputDir || (t?.dashboard?.dupModal?.noFolderSelected || 'No folder selected')}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {dupInputDir || (t?.dashboard?.dupModal?.noFolderSelected || 'No folder selected')}
                </div>
              </div>
              <button onClick={pickDupFolder} className="btn-browse" disabled={dupRunning}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
            </div>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>{t?.dashboard?.dupModal?.autoDeleteIdentical || 'Auto-delete identical'}</div>
              <input type="checkbox" checked={dupAutoDelete} onChange={(e)=>setDupAutoDelete(e.target.checked)} disabled={dupRunning} />
            </div>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>{t?.dashboard?.dupModal?.similarityThreshold || 'Similarity threshold'}</div>
              <input type="number" min={0} max={64} value={dupThreshold} onChange={(e)=>setDupThreshold(Math.max(0, Math.min(64, Number(e.target.value || 0))))} disabled={dupRunning} style={{width:80, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}} />
              <span style={{opacity:.7, fontSize:12}}>{t?.dashboard?.dupModal?.similarityHint || '0=strict, 3=default, higher=looser'}</span>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, padding:'12px 16px', borderTop:'1px solid #333'}}>
            <button onClick={()=>setShowDupModal(false)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>{t?.dashboard?.dupModal?.close || 'Close'}</button>
            <button onClick={runDupScan} disabled={dupRunning || !dupInputDir} style={{ padding: '10px 14px', background: dupRunning ? '#1f2937' : '#0ea5e9', color: '#fff', border: '1px solid #0ea5e9', borderRadius: 6, cursor: dupRunning ? 'not-allowed' : 'pointer' }}>{dupRunning ? (t?.dashboard?.dupModal?.running || 'Running...') : (t?.dashboard?.dupModal?.run || 'Run')}</button>
          </div>
        </div>
      </div>
    )}

    {/* Subscription Alert Modal */}
    {showSubAlert && (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)'
        }} onClick={() => setShowSubAlert(false)}>
            <div style={{
                background: '#18181b', border: '1px solid #27272a', borderRadius: 12,
                padding: 24, width: 400, maxWidth: '90%',
                display: 'flex', flexDirection: 'column', gap: 16,
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                        width: 40, height: 40, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' 
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    </div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff' }}>
                        {translations[lang].settings.subscriptionRequired || "Subscription Required"}
                    </h3>
                </div>
                
                <p style={{ margin: 0, color: '#a1a1aa', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                    {translations[lang].settings.subPopupMsg?.replace(/<br\/>/g, '\n') || "Your subscription is inactive. Please subscribe to unlock all features and generate metadata."}
                </p>

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <button onClick={() => setShowSubAlert(false)} style={{
                        flex: 1, padding: '10px', borderRadius: 6, border: '1px solid #27272a',
                        background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontWeight: 500
                    }}>
                        {translations[lang].settings.close || "Close"}
                    </button>
                    <button onClick={() => { setShowSubAlert(false); setShowTopUp(true); }} style={{
                        flex: 1, padding: '10px', borderRadius: 6, border: 'none',
                        background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 600
                    }}>
                        {translations[lang].settings.subscribe || "Subscribe"}
                    </button>
                </div>
            </div>
        </div>
    )}

    {/* TopUp Modal */}
    {showTopUp && (
        <TopUp 
            onBack={() => {
                setShowTopUp(false);
                if (token) {
                    apiGetUserProfile(token).then(p => setUserProfile(p)).catch(console.error);
                }
            }}
            onPaymentSuccess={() => {
                if (token) {
                    apiGetUserProfile(token).then(p => setUserProfile(p)).catch(console.error);
                }
            }} 
            lang={lang} 
            token={token || ''}
            userEmail={userProfile?.email || userEmail}
            userId={userProfile?.id}
        />
    )}

    {showMonitoring && (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)'
        }} onClick={() => setShowMonitoring(false)}>
            <div style={{
                background: '#18181b', border: '1px solid #27272a', borderRadius: 12,
                width: 760, maxWidth: '95%', height: 520, maxHeight: '90%',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{t?.dashboard?.monitoring?.title || 'Monitoring'}</div>
                        <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                          {auditLoading
                            ? (t?.dashboard?.monitoring?.loading || 'Loading...')
                            : String(t?.dashboard?.monitoring?.entries || 'Entries: {count}').replace('{count}', String((auditLogs || []).length))}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => setAuditFilter('all')} style={{
                            padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid #27272a', background: auditFilter === 'all' ? '#27272a' : 'transparent',
                            color: '#e4e4e7', fontSize: 12, fontWeight: 600
                        }}>{t?.dashboard?.monitoring?.filterAll || 'All'}</button>
                        <button onClick={() => setAuditFilter('error')} style={{
                            padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid #27272a', background: auditFilter === 'error' ? '#27272a' : 'transparent',
                            color: '#e4e4e7', fontSize: 12, fontWeight: 600
                        }}>{t?.dashboard?.monitoring?.filterErrors || 'Errors'}</button>
                        <button onClick={() => setAuditFilter('security')} style={{
                            padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid #27272a', background: auditFilter === 'security' ? '#27272a' : 'transparent',
                            color: '#e4e4e7', fontSize: 12, fontWeight: 600
                        }}>{t?.dashboard?.monitoring?.filterSecurity || 'Security'}</button>
                        <button onClick={() => { void loadAuditLogs() }} style={{
                            padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid #27272a', background: 'transparent',
                            color: '#e4e4e7', fontSize: 12, fontWeight: 600
                        }}>{t?.dashboard?.monitoring?.refresh || 'Refresh'}</button>
                        <button onClick={() => setShowMonitoring(false)} style={{
                            padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid #27272a', background: 'transparent',
                            color: '#e4e4e7', fontSize: 12, fontWeight: 600
                        }}>{t?.dashboard?.monitoring?.close || 'Close'}</button>
                    </div>
                </div>
                <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
                    {(auditLogs || [])
                        .filter((r: any) => {
                          const t = String((r as any)?.event_type || '').toLowerCase()
                          if (auditFilter === 'error') return t === 'error'
                          if (auditFilter === 'security') return t === 'securityalert' || t === 'security_alert'
                          return true
                        })
                        .slice()
                        .reverse()
                        .map((r: any, idx: number) => {
                          const ts = String((r as any)?.timestamp || '')
                          const ty = String((r as any)?.event_type || '')
                          const st = String((r as any)?.status || '')
                          const ctx = String((r as any)?.context || '')
                          const isErr = String(ty).toLowerCase() === 'error'
                          return (
                            <div key={`${ts}-${idx}`} style={{
                              border: '1px solid #27272a',
                              background: '#0f0f12',
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 10
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, color: '#a1a1aa' }}>{ts ? new Date(ts).toLocaleString() : '-'}</span>
                                  <span style={{
                                    fontSize: 12, fontWeight: 700,
                                    color: isErr ? '#fca5a5' : '#86efac'
                                  }}>{ty || '-'}</span>
                                  <span style={{ fontSize: 12, color: '#e4e4e7' }}>{st || '-'}</span>
                                </div>
                              </div>
                              <div style={{ marginTop: 8, fontSize: 12, color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>
                                {ctx || '-'}
                              </div>
                            </div>
                          )
                        })}
                    {(!auditLoading && (!auditLogs || auditLogs.length === 0)) && (
                      <div style={{ color: '#a1a1aa', fontSize: 12, padding: 8 }}>{t?.dashboard?.monitoring?.noLogs || 'No audit logs.'}</div>
                    )}
                </div>
            </div>
        </div>
    )}

    {/* Help Modal */}
    {showHelp && (
        <HelpGuide 
            onClose={() => setShowHelp(false)}
            lang={lang}
            onLangChange={(l) => {
              setLang(l)
              try { localStorage.setItem('app_lang', l) } catch {}
            }}
        />
    )}

    {/* NOTIFICATION POPUP */}
    {notification && (
          <div style={{
              position: 'fixed',
              top: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 12,
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              zIndex: 9999,
              minWidth: 320,
              maxWidth: 480,
              animation: 'slideDown 0.3s ease-out'
          }}>
              <div style={{
                  background: notification.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                  padding: 10,
                  borderRadius: '50%',
                  color: notification.type === 'success' ? '#10b981' : '#3b82f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                  {notification.type === 'success' ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  )}
              </div>
              <div style={{flex: 1}}>
                  <h3 style={{margin: '0 0 4px 0', fontSize: 16, fontWeight: 600, color: '#fff'}}>{notification.title}</h3>
                  <p style={{margin: 0, fontSize: 14, color: '#a1a1aa', lineHeight: 1.5}}>{notification.message}</p>
              </div>
              <button 
                  onClick={() => setNotification(null)}
                  style={{
                      background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', padding: 4
                  }}
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
          </div>
    )}
    <style>{`
        @keyframes slideDown {
            from { transform: translate(-50%, -20px); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
    `}</style>
    
    </>
  )
}
