import React, { useEffect, useState, useRef } from 'react'
import appPkg from '../../package.json'
import appIconUrl from '@icons/icon.svg'
import { invoke } from '@tauri-apps/api/tauri'
import { open as shellOpen } from '@tauri-apps/api/shell'
import { open as dialogOpen } from '@tauri-apps/api/dialog'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { listen } from '@tauri-apps/api/event'
import ProgressBar from '../components/ProgressBar'
import LogPanel from '../components/LogPanel'
import Settings from './Settings'
import TopUpModal from '../components/TopUpModal'
import HelpGuide from '../components/HelpGuide'
import { apiGetBalance, getApiUrl, clearTokenLocal } from '../api/backend'
import { decryptApiKey } from '../utils/crypto'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'
export default function Dashboard({token,onSettings,onAdmin,onProcessChange,isActive}:{token:string,onSettings:()=>void,onAdmin?:()=>void,onProcessChange?:(isProcessing:boolean)=>void,isActive?:boolean}){
  const [logs,setLogs]=useState<any[]>([])
  const [progress,setProgress]=useState<number>(0)
  const [balance,setBalance]=useState<number>(0)
  const [usdRate,setUsdRate]=useState<number>(0)
  const [userEmail, setUserEmail] = useState<string>('')
  const appVersion = appPkg.version
  const [stats,setStats]=useState({total:0,done:0,success:0,failed:0,rejected:0})
  const [paused,setPaused]=useState(false)
  const [stopped,setStopped]=useState(false)
  const pausedRef = React.useRef(false);
  const stoppedRef = React.useRef(false);
  const [showLogs,setShowLogs]=useState(false)
  const [updateModal, setUpdateModal] = useState<any>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [updateStatusText, setUpdateStatusText] = useState<string>('')
  const [showDupModal, setShowDupModal] = useState(false)
  const [dupInputDir, setDupInputDir] = useState<string>('')
  const [dupAutoDelete, setDupAutoDelete] = useState<boolean>(true)
  const [dupThreshold, setDupThreshold] = useState<number>(3)
  const [dupRunning, setDupRunning] = useState<boolean>(false)
  
  // Resize Logic
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);

  useEffect(() => {
    console.log("Dashboard mounted. Token present:", !!token);
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      e.preventDefault();
      let newWidth = e.clientX;
      if (newWidth < 180) newWidth = 180; // Min width reduced to 180px
      if (newWidth > 600) newWidth = 600; // Max width
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Listen for CSV Generation Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('csv_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};

      if (typeof payload === 'string') {
          logItem = { text: `[CSV Gen] ${payload}`, color: '#aaa' };
      } else if (typeof payload === 'object') {
          // Map backend status to colors
          let color = '#aaa';
          if (payload.status === 'success') color = '#4caf50';
          else if (payload.status === 'error') color = '#f44336';
          else if (payload.status === 'processing') color = '#888';
          else if (payload.status === 'skipped') color = '#ff9800';

          logItem = {
              text: `[CSV Gen] ${payload.text}`,
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
        logItem = { text: `[Duplicate] ${payload}`, color: '#aaa' };
      } else if (typeof payload === 'object') {
        let color = '#aaa';
        if (payload.status === 'success') color = '#4caf50';
        else if (payload.status === 'error') color = '#f44336';
        else if (payload.status === 'processing') color = '#888';
        else if (payload.status === 'skipped') color = '#ff9800';
        else if (payload.status === 'deleted') color = '#ff9800';
        logItem = {
          text: `[Duplicate] ${payload.text}`,
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
          logItem = { text: `[AI Cluster] ${payload}`, color: color };
      } else if (typeof payload === 'object') {
          if (payload.status === 'success') color = '#4caf50';
                else if (payload.status === 'error') color = '#f44336';
                else if (payload.status === 'processing') color = '#aaa'; // Standard Grey for consistency
                
                logItem = {
                    text: `[AI Cluster] ${payload.text}`,
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
          refreshBalance();
      }
  }, [isActive]);

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
  
  // TopUp State
  const [showTopUp, setShowTopUp] = useState(false)
  const [userId, setUserId] = useState<string>('') 
  const [isAdmin, setIsAdmin] = useState(false)
  const [tokenMode, setTokenMode] = useState<number>(2) // 0=Token, 1=Currency, 2=Percent (Default USD)
  const [refBalance, setRefBalance] = useState<number>(0)
  const [successNotification, setSuccessNotification] = useState<{ type: 'token' | 'subscription', amount?: number, expiry?: string, source?: 'paypal' | 'voucher' } | null>(null)

  useEffect(()=>{ 
      // autoCheckUpdate(); // MOVED TO App.tsx
      refreshBalance();
      handleRescan(); // Auto-scan on load
  },[])
  

  // Extract userId from JWT for payment (simple parse)
  useEffect(()=>{
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserId(payload.sub);
        
        // Initial check from Token
        if (payload.is_admin === 1) {
            setIsAdmin(true);
        } else {
            // Check server real-time status (in case user was promoted but has old token)
            checkServerAdmin(token);
        }
        
        // Load stored reference balance for this user
        const storedRef = localStorage.getItem(`meta_ref_${payload.sub}`);
        if(storedRef) setRefBalance(Number(storedRef));

        // Load token display mode preference
        const storedMode = localStorage.getItem('token_mode');
        if(storedMode) setTokenMode(Number(storedMode));

        getApiUrl().then(async apiUrl => {
            try {
                const res = await fetch(`${apiUrl}/user/me`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data && typeof data.email === 'string') {
                    setUserEmail(data.email);
                }
            } catch(e) {}
        });
        
    } catch(e) {}
  }, [token]);

  async function checkServerAdmin(t: string) {
    try {
        // Try to access a lightweight admin endpoint to verify access
        const apiUrl = await getApiUrl();
        const res = await fetch(`${apiUrl}/admin/vouchers`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${t}` }
        });
        if (res.ok) {
            setIsAdmin(true);
        }
    } catch(e) {}
  }

  const [balanceError, setBalanceError] = useState(false);

  async function refreshBalance() {
    try {
        setBalanceError(false);
        const apiUrl = await getApiUrl();
        const res = await fetch(`${apiUrl}/token/balance?t=${Date.now()}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.balance !== undefined) setBalance(data.balance);
        if (data.usd_rate) setUsdRate(data.usd_rate);
        
        // Also fetch reference/bonus balance if needed (optional)
        // const ref = await apiGetReferenceBalance(token);
        // setRefBalance(ref);
    } catch(e) {
        console.error("Refresh balance error:", e);
        setBalanceError(true);
    }
  }

  async function autoCheckUpdate(){
    try {
        const { shouldUpdate, manifest } = await checkUpdate()
        if (shouldUpdate) {
            setUpdateModal(manifest)
        }
    } catch(e) {
        console.error("Update check failed:", e)
    }
  }

  async function performUpdate() {
    setIsUpdating(true)
    setUpdateProgress(0)
    setUpdateStatusText('Initializing...')
    
    let downloaded = 0;
    let total = 0;

    // Listen to download progress
    const unlisten = await listen('tauri://update-download-progress', (event: any) => {
        const { chunkLength, contentLength } = event.payload;
        downloaded += chunkLength;
        if (contentLength) total = contentLength;
        
        if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            setUpdateProgress(pct);
            setUpdateStatusText(`Downloading... ${pct}%`);
        } else {
            // If total is unknown, just increment/animate fake progress or show size
            setUpdateStatusText(`Downloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
        }
    });

    try {
        setUpdateStatusText('Installing...')
        // Just install and relaunch immediately
        await installUpdate()
        
        setUpdateStatusText('Restarting...')
        await relaunch()
    } catch(e) {
        setIsUpdating(false)
        setLogs(l=>[...l, {text:`Update failed: ${e}`, color:'#f44336'}])
        setUpdateModal(null)
    } finally {
        unlisten();
    }
  }


  useEffect(()=>{
    if(token) {
        checkServerAdmin(token);
        refreshBalance(); // Immediate check on mount
        const int = setInterval(refreshBalance, 30000); // Poll every 30s
        
        // Update window title with version
        if (!isTauri) return;
        import('@tauri-apps/api/window').then(({ appWindow }) => {
            appWindow.setTitle(`Metabayn Studio v${appVersion}${userEmail ? ' – ' + userEmail : ''}`);
        });

        return ()=>clearInterval(int);
    }
  },[token]);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/window').then(({ appWindow }) => {
      appWindow.setTitle(`Metabayn Studio v${appVersion}${userEmail ? ' – ' + userEmail : ''}`);
    });
  }, [userEmail, appVersion]);

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
             setLogs(l=>[...l, {text:`Rescan complete. Found ${files.length} files.`, color:'#4caf50'}])
         }
     } catch(e) {}
  }

  async function start(isAutoRetry: boolean | any = false){
    const isRetry = typeof isAutoRetry === 'boolean' ? isAutoRetry : false;
    if (!isRetry) folderRetryCount.current = 0;

    if(onProcessChange) onProcessChange(true);
    enableKeepAlive();
    try {
        setStats({total:0, done:0, success:0, failed:0, rejected:0});
    setLogs(l=>[...l, {text:'Scanning...', color:'#aaa'}])
    setProgress(0)
    setStopped(false); stoppedRef.current = false;
    setPaused(false); pausedRef.current = false;
    
    const s=await invoke<any>('get_settings');
    setLogs(l=>[...l, {text:`Folder: ${s.input_folder||'(None)'}`, color:'#aaa'}])

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

    const directMode = String(s.connection_mode || 'server') === 'direct'
    let directApiKey = ''
    if (directMode) {
        try {
            const savedKey = localStorage.getItem('metabayn_api_key_enc')
            const savedIv = localStorage.getItem('metabayn_api_key_iv')
            if (!savedKey || !savedIv) {
                setLogs(l=>[...l, {text:'API key mode is enabled, but no API key is saved in Settings.', color:'#f44336'}])
                return
            }
            directApiKey = await decryptApiKey(savedKey, savedIv)
            if (!directApiKey.trim()) {
                setLogs(l=>[...l, {text:'API key is empty. Please enter it and save it in Settings.', color:'#f44336'}])
                return
            }
            setLogs(l=>[...l, {text:`Direct Mode enabled (${String(s.ai_provider||'AI')}) - server tokens will not be deducted`, color:'#4caf50', hidden:true}])
        } catch (e:any) {
            setLogs(l=>[...l, {text:'Failed to read the saved API key. Please save it again in Settings.', detail: String(e), color:'#f44336'}])
            return
        }
    }
    
    // --- FIX: CSV Headers are now initialized on-demand inside processFile ---
    /* 
    try {
        // Legacy CSV Init removed to support dynamic timestamped filenames
    } catch(e) { console.error("CSV Init Error", e); }
    */
    // ------------------------------------------------------------------

    const fileList = await scan(String(s.input_folder||''))
    
    // Add file count check
    if (fileList.length === 0) {
       setLogs(l=>[...l, {text:'No supported files found.', color:'#ff9800'}])
       return
    }
    
    // RESET STATS AT START
    setStats({total:fileList.length, done:0, success:0, failed:0, rejected:0});
    
    setLogs(l=>[...l, {id: 'starting', text:`Found ${fileList.length} files. Starting...`, color:'#fff', animating: true}])

    const cpuCores = (typeof navigator !== 'undefined' && (navigator as any).hardwareConcurrency) ? (navigator as any).hardwareConcurrency : 4;
    const MAX_CONCURRENCY = Math.max(1, Math.min(Number(s.max_threads || 8), Math.max(1, cpuCores - 1)));
    const CONCURRENCY = MAX_CONCURRENCY;
     
     const activePromises: Promise<any>[] = [];

    const invokeWithTimeout = async (cmd: string, payload: any, ms: number) => {
        let tid: any;
        let timedOut = false;
        const base = invoke<any>(cmd, payload);
        const timeout = new Promise((_, reject) => {
            tid = setTimeout(() => { timedOut = true; reject(new Error(`${cmd} timeout`)); }, ms);
        });
        try {
            return await Promise.race([base, timeout]);
        } finally {
            clearTimeout(tid);
            if (timedOut) {
                base.catch(() => {});
            }
        }
    };
    
    let i=0 // shared counter for progress
    let filesStayingInInputCount = 0; // Tracks files that were processed but remain in input (failed, skipped, or failed to delete)

    const processFile = async (file: string) => {
        const currentFileName = file.split(/[\\/]/).pop();

        if(stoppedRef.current) return;
        
        let fileRemoved = false;
        const logId = `${file}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

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
                     setLogs(l=>[...l, {text:`[Skipped] ${currentFileName} (Already exists)`, color:'#888'}]);
                     i++; 
                     setStats(st=>({...st, done: i})); 
                     setProgress(Math.round((i/fileList.length)*100));
                     filesStayingInInputCount++; // Skipped files remain in input
                     return;
                 }
             } catch(e) {}
        }

        const startTime = Date.now();
        setLogs(l=>[...l, {id: logId, text:`Processing ${currentFileName}...`, color:'#888', animating: true}]); 

        try {
            // Stop 'Starting...' animation if it's still running
            setLogs(l => l.map(x => x.id === 'starting' ? { ...x, animating: false } : x));

            const effectiveModel = (s.ai_provider === 'OpenAI') 
                ? ((s.default_model && !s.default_model.startsWith('gemini')) ? s.default_model : 'gpt-4o-mini') 
                : ((s.default_model && !s.default_model.startsWith('gpt') && s.default_model !== 'o1') ? s.default_model : 'gemini-2.0-flash-lite-preview-02-05');

            const res = await invokeWithTimeout('generate_metadata_batch',{ req:{ files: [file], model:effectiveModel, token: directMode ? '' : token, retries:Number(s.retry_count||3), title_min_words:Number(s.title_min_words||5), title_max_words:Number(s.title_max_words||13), description_min_chars:Number(s.description_min_chars||80), description_max_chars:Number(s.description_max_chars||200), keywords_min_count:Number(s.keywords_min_count||35), keywords_max_count:Number(s.keywords_max_count||49), banned_words:String(s.banned_words||''), max_threads:Number(s.max_threads||4), connection_mode: directMode ? 'direct' : 'server', api_key: directMode ? directApiKey : undefined, provider: String(s.ai_provider||'') } }, 180000)
            
            if (!directMode) {
                refreshBalance();
            }

            
            
            for(const g of res){
                if(stoppedRef.current) {
                    console.log("[Dashboard] Process loop terminated by User Stop.");
                    break;
                }
                const fileName = g.file.split(/[\\/]/).pop();

                if (g.source === 'error' || g.title === 'ERROR') {
                    const isRejection = String(g.description).startsWith('Rejected:');
                    
                    // Construct detail with token stats for rejected/failed files
                    let detailMsg = g.description;
                    if (g.cost !== undefined || g.input_tokens !== undefined) {
                        const costUSD = g.cost || 0;
                        const rate = usdRate && usdRate > 0 ? usdRate : null;
                        const costIDR = rate ? costUSD * rate : null;
                        
                        detailMsg += `\n\n-- Full Generation (Vision + Text) --`;
                        detailMsg += `\nModel: ${g.source || 'unknown'}`;
                        detailMsg += `\nIn: ${g.input_tokens||0} | Out: ${g.output_tokens||0}`;
                        
                        if (!directMode) {
                             detailMsg += rate
                               ? `\nCost: $${costUSD.toFixed(6)} / Rp ${costIDR!.toLocaleString('en-US', {maximumFractionDigits: 2})}`
                               : `\nCost: $${costUSD.toFixed(6)} (Rate IDR belum tersedia)`;
                        }
                        
                        if (g.selection_status) {
                             detailMsg += `\nSelection: ${g.selection_status}`;
                        }
                    }

                    setLogs(l => l.map(x => x.id === logId ? { 
                        ...x, 
                        text: isRejection ? `[Reject] ${fileName}` : `[Failed] ${fileName}`, 
                        detail: detailMsg, 
                        color: isRejection ? '#ff9800' : '#f44336', 
                        animating: false 
                    } : x));
                    
                    if (!isRejection) {
                         setStats(st=>({...st, failed: st.failed+1}));
                    } else {
                         setStats(st=>({...st, rejected: st.rejected+1}));
                    }
                    // filesStayingInInputCount will be incremented in finally block since fileRemoved is false
                    
                    if (String(g.description).includes('Too Many Requests') || String(g.description).includes('Rate limit')) {
                        setLogs(l=>[...l, {text:`Rate limit encountered but continuing at max speed.`, color:'#ff9800', hidden:true}]);
                    }
                     continue;
                }

                setLogs(l=>[...l, {text:`Writing XMP... ${fileName}`, color:'#aaa', hidden: true}])
                
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
                                if (f.includes('trademarked logo') || f.includes('brand logo') || f.includes('specific trademarked logo')) return 'Brand_Logo';
                                if (f.includes('watermark') || f.includes('copyright stamp')) return 'Watermark';
                                
                                // Quality
                                if (f.includes('blurry') || f.includes('blur') || f.includes('out of focus')) return 'Blurry';
                                if (f.includes('pixelated') || f.includes('low resolution') || f.includes('low quality')) return 'Low_Quality';
                                if (f.includes('artifact') || f.includes('distortion')) return 'Artifacts';

                                // Text
                                if (f.includes('gibberish')) return 'Text_Gibberish';
                                if (f.includes('non-english')) return 'Text_Non_English';
                                if (f.includes('irrelevant')) return 'Text_Irrelevant';
                                if (f.includes('relevant-text')) return 'Text_Relevant';
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

                if(g.file.toLowerCase().match(/\.(mp4|mov|mkv|avi|webm)$/)){
                    try{ 
                        renamedPath = await invokeWithTimeout('write_video_metadata',{ req:{ file:g.file, output_file: targetFile, title:g.title, description:g.description, keywords:g.keywords, overwrite: !!s.overwrite, auto_embed: !!s.auto_embed, category: g.category||"" } }, 60000);
                        writeSuccess = true;
                    } catch(e:any){ 
                        setStats(st=>({...st,failed:st.failed+1}));
                        setLogs(l => l.map(x => x.id === logId ? { ...x, text:`[Failed Write] ${fileName}`, detail: String(e), color:'#f44336', animating: false } : x));
                    }
                } else {
                    try{ 
                        renamedPath = await invokeWithTimeout('write_image_metadata',{ req:{ file:g.file, output_file: targetFile, title:g.title, description:g.description, keywords:g.keywords, creator:'Metabayn', copyright:'Metabayn Studio', overwrite: !!s.overwrite, auto_embed: !!s.auto_embed, category: g.category||"" } }, 60000);
                        writeSuccess = true;
                    } catch(e:any){ 
                        setStats(st=>({...st,failed:st.failed+1}));
                        setLogs(l => l.map(x => x.id === logId ? { ...x, text:`[Failed Write] ${fileName}`, detail: String(e), color:'#f44336', animating: false } : x));
                    }
                }

                if (renamedPath) {
                    const sep = renamedPath.includes('\\') ? '\\' : '/';
                    outputFileName = renamedPath.split(sep).pop() || outputFileName;
                }
                
                if (writeSuccess) {
                    if ((g.selection_status || '').toLowerCase() === 'rejected') {
                         setStats(st=>({...st, rejected: st.rejected+1}));
                    } else {
                         setStats(st=>({...st,success:st.success+1}));
                    }
                    
                    // Format detailed log with token usage
                    // We need to pass the usage data from the generation result 'g'
                    const tokenDetail = (() => {
                        let msg = `-- Full Generation (Vision + Text) --`;
                        msg += `\nModel: ${g.source || 'unknown'}`;
                        msg += `\nIn: ${g.input_tokens || 0} | Out: ${g.output_tokens || 0}`;
                        
                        if (!directMode) {
                             const costUSD = g.cost || 0;
                             const rate = usdRate && usdRate > 0 ? usdRate : null;
                             const costIDR = rate ? costUSD * rate : null;
                             msg += rate
                               ? `\nCost: $${costUSD.toFixed(6)} / Rp ${costIDR!.toLocaleString('en-US', {maximumFractionDigits: 2})}`
                               : `\nCost: $${costUSD.toFixed(6)} (Rate IDR belum tersedia)`;
                        }
                        
                        msg += `\nSelection: ${g.selection_status || 'n/a'}`;
                        return msg;
                    })();
                    
                    // Update existing log in-place
                    const isRejected = (g.selection_status || '').toLowerCase() === 'rejected';
                    setLogs(l => l.map(x => x.id === logId ? { 
                        ...x, 
                        text: isRejected ? `[Reject] ${fileName}` : `[Success] ${fileName}`, 
                        detail: tokenDetail, // Add detail for the modal log
                        color: isRejected ? '#ff9800' : '#4caf50', 
                        animating: false 
                    } : x));
                    
                    if (!directMode) {
                        refreshBalance();
                    }
                    
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
                                setLogs(l=>[...l, {text:`[Warning] Failed to delete original file: ${fileName}`, detail: msg, color:'#ff9800'}]);
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
                        const row=[outputFileName,g.title,g.description,g.keywords.join(',')];
                        await invoke('append_csv',{ path: mbPath, row });
                        
                        // Shutterstock CSV
                        await ensureCsvHeader(ssPath, 'shutterstock');
                        const rowSS=[outputFileName,g.description,g.keywords.join(','),g.category||"","No","No","No"];
                        await invoke('append_csv',{ path: ssPath, row: rowSS });
                    } catch(e) {
                        console.error("CSV Write Error", e);
                        const n = mbPath.split(/[\\/]/).pop();
                        setLogs(l=>[...l, {text:`[Warning] Failed to write to CSV: ${n}`, color:'#ff9800'}]);
                    }
                }
                }
            }
        } catch(e:any) {
            // No throttling or sleeps on failure; continue at max speed
            const fileName = file.split(/[\\/]/).pop();
            setLogs(l => l.map(x => x.id === logId ? { ...x, text:`[System Error] ${fileName}`, detail: String(e), color:'#f44336', animating: false } : x));
            setStats(st=>({...st, failed: st.failed+1}));
        } finally {
            // Stop animation for this file
            if (!fileRemoved) filesStayingInInputCount++;
            setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
            i++; setStats(st=>({...st,done:i})); setProgress(Math.round((i/fileList.length)*100));
        }
    };

    for(const file of fileList){
      if(stoppedRef.current) break; 
      while(pausedRef.current){ 
          if(stoppedRef.current) break; 
          await new Promise(r=>setTimeout(r,300)); 
      }
      if(stoppedRef.current) break;
      
      const p = processFile(file);
      activePromises.push(p);
      
      p.finally(() => {
          const idx = activePromises.indexOf(p);
          if (idx > -1) activePromises.splice(idx, 1);
      });

      if (activePromises.length >= CONCURRENCY) {
          await Promise.race(activePromises);
      }
      
      // Small stagger to prevent burst
      await new Promise(r=>setTimeout(r, 10));
    }
    
    if(!stoppedRef.current) await Promise.all(activePromises); // Wait for remaining tasks
    setLogs(l=>[...l, {text:'Done', color:'#4caf50'}])
    
    // Auto-rescan to update file count
    if (!stoppedRef.current && s.input_folder) {
        setLogs(l=>[...l, {text:'Updating file count...', color:'#aaa'}]);
        const left = await scan(s.input_folder);
        setLogs(l=>[...l, {text:`Remaining files: ${left.length}`, color:'#4caf50'}]);
    }
    
    setPaused(false); pausedRef.current = false;
    setStopped(false); stoppedRef.current = false;

    } catch (e) {
        console.error("Process Error", e);
        setLogs(l=>[...l, {text:'[Error] Process interrupted.', detail: String(e), color:'#f44336'}]);
    } finally {
        if(onProcessChange) onProcessChange(false);
        disableKeepAlive();
    }
  }

  useEffect(()=>{ refreshBalance() },[token])
  function pauseProcess(){ 
      setPaused(p => {
          const newVal = !p;
          pausedRef.current = newVal;
          if(newVal) setLogs(l=>[...l, {text:'[Paused] Process paused by user.', color:'#ffd700'}]); // Yellow
          else setLogs(l=>[...l, {text:'[Resumed] Process resumed.', color:'#4caf50'}]);
          return newVal;
      }) 
  }
  function stopProcess(){ 
      setStopped(true); 
      stoppedRef.current = true;
      setPaused(false); // Unpause so loop can break
      pausedRef.current = false;
      disableKeepAlive();
      setLogs(l=>[...l, {text:'[Stopped] Process stopped by user.', color:'#ff5722'}]); // Orange-Red
  }
  async function generateCSV(){
    if (!isTauri) { setLogs(l=>[...l,{text:'[CSV Gen] Feature only available in Tauri app', color:'#ff9800'}]); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: "Select Input Folder (Images/Videos)"
        });
        if (!inputDir) return;

        // Fetch settings
        const s = await invoke<any>('get_settings');

        // Prepare API Key for Direct Mode if needed
        let apiKey = "";
        const directMode = String(s.connection_mode || 'server') === 'direct';
        if (directMode) {
            try {
                const savedKey = localStorage.getItem('metabayn_api_key_enc');
                const savedIv = localStorage.getItem('metabayn_api_key_iv');
                if (savedKey && savedIv) {
                    apiKey = await decryptApiKey(savedKey, savedIv);
                }
            } catch(e) { console.error("Failed to decrypt API Key", e); }
        }

        // Log: Start (Grey color, animating)
        const logId = Date.now();
        setLogs(l => [...l, { id: logId, text: `[CSV Gen] Generating from ${inputDir}... (AI Checking & Filling Missing Metadata)`, color: '#aaa', animating: true }]);
        
        // Output folder is same as input folder
        const res = await invoke('generate_csv_from_folder', { input_folder: inputDir, output_folder: inputDir, api_key: apiKey, token });
        
        // Log: Success (Update previous log to stop animation, add new success log)
        setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
        setLogs(l => [...l, { text: `[CSV Gen] Success! ${res}`, color: '#4caf50' }]);
    } catch (e) {
        setLogs(l => l.map(x => x.animating ? { ...x, animating: false } : x)); // Stop all animations
        setLogs(l => [...l, { text: `[CSV Gen] Failed: ${e}`, color: '#f44336' }]);
    }
  }
  async function openDupConfig(){
    setShowDupModal(true)
    // Removed log to avoid confusion when opening config
  }

  async function pickDupFolder(){
    if (!isTauri) { setLogs(l=>[...l,{text:'[Duplicate] Feature only available in Tauri app', color:'#ff9800'}]); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: "Select Folder (Images/Videos)" });
    if (inputDir) setDupInputDir(String(inputDir))
  }

  async function runDupScan(){
    if (!isTauri) { setLogs(l=>[...l,{text:'[Duplicate] Feature only available in Tauri app', color:'#ff9800'}]); return }
    if (!dupInputDir) {
      setLogs(l=>[...l,{text:'[Duplicate] No folder selected.', color:'#ff9800'}])
      return
    }
    try {
      setDupRunning(true)
      const logId = Date.now();
      setLogs(l => [...l, { id: logId, text: `[Duplicate] Starting scan: ${dupInputDir}...`, color: '#aaa', animating: true }]);
      console.log("[Duplicate] Invoking command with:", { input_folder: dupInputDir, auto_delete: dupAutoDelete, threshold: dupThreshold });
      const res = await invoke<string>('detect_duplicate_images', { input_folder: dupInputDir, inputFolder: dupInputDir, auto_delete: dupAutoDelete, autoDelete: dupAutoDelete, threshold: dupThreshold });
      console.log("[Duplicate] Result:", res);
      setLogs(l => l.map(x => x.id === logId ? { ...x, animating: false } : x));
      setLogs(l => [...l, { text: `[Duplicate] Completed! ${res}`, color: '#4caf50' }]);
    } catch (e) {
      console.error("[Duplicate] Error:", e);
      setLogs(l => l.map(x => x.animating ? { ...x, animating: false } : x));
      setLogs(l => [...l, { text: `[Duplicate] Failed: ${e}`, color: '#f44336' }]);
    } finally {
      setDupRunning(false)
    }
  }

  async function runAiCluster(){
    if (!isTauri) { setLogs(l=>[...l,{text:'[AI Cluster] Feature only available in Tauri app', color:'#ff9800'}]); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: "Select Folder for AI Clustering"
        });
        if (!inputDir) return;

        // Log: Start
        const logId = Date.now();
        setLogs(l => [...l, { id: logId, text: `[AI Cluster] Starting clustering on ${inputDir}... (Threshold: 0.85)`, color: '#aaa', animating: true }]);
        
        // Threshold hardcoded to 0.85 for now as per python script default
        const res = await invoke<string>('run_ai_clustering', { inputFolder: inputDir, threshold: 0.85 });
        
        // Log: Success
        setLogs(l => l.map(x => ({ ...x, animating: false })));
        setLogs(l => [...l, { text: `[AI Cluster] Completed! ${res}`, color: '#4caf50' }]);
    } catch (e) {
        setLogs(l => l.map(x => ({ ...x, animating: false })));
        setLogs(l => [...l, { text: `[AI Cluster] Failed: ${e}`, color: '#f44336' }]);
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
        background: 'var(--bg-color)'
    }}>
      {/* 1. TOP HEADER (Static) */}
      <div style={{
          height: 48, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '0 16px', 
          borderBottom: '1px solid #222',
          background: '#0a0a0a',
          zIndex: 100
      }}>
          {/* LEFT: Toggle + Title */}
          <div style={{display:'flex', alignItems:'center', gap: 16}}>
               {/* Toggle Button */}
               <div onClick={()=>setIsSidebarOpen(!isSidebarOpen)} style={{cursor:'pointer', padding:4, display:'flex', alignItems:'center', justifyContent:'center', opacity: 0.8, transition: 'opacity 0.2s'}} title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}>
                    <div style={{display:'flex', flexDirection:'column', gap:4}}>
                        <div style={{width: 18, height: 2, background: '#fff'}}></div>
                        <div style={{width: 18, height: 2, background: '#fff'}}></div>
                        <div style={{width: 18, height: 2, background: '#fff'}}></div>
                    </div>
               </div>

               <div className="app-title" style={{display:'inline-flex', alignItems:'center', gap:8, color:'#fff'}}>
                 <span title="Metabayn" style={{display:'inline-flex', alignItems:'center'}}>
                   <img src={appIconUrl} alt="Metabayn" style={{height:18, width:18}} />
                 </span>
                 {userEmail ? (
                   <span style={{fontSize:12, color:'#bbb', display:'inline-flex', alignItems:'center', gap:6}}>
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <circle cx="12" cy="8" r="3" stroke="#bbb" strokeWidth="2"/>
                       <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="#bbb" strokeWidth="2" strokeLinecap="round"/>
                     </svg>
                     <span>{userEmail}</span>
                   </span>
                 ) : null}
               </div>
          </div>

          {/* RIGHT: Token + Actions */}
          <div style={{display:'flex', gap:16, alignItems:'center'}}>
             {token && (
               <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                 {balanceError && (
                     <div title="Connection Error: Failed to sync balance" style={{width:8, height:8, borderRadius:'50%', background:'#f44336', animation:'pulse 1s infinite'}}></div>
                 )}
                 {/* Token Dropdown */}
                 <select 
                    value={tokenMode} 
                    onChange={(e) => {
                        const m = Number(e.target.value);
                        setTokenMode(m);
                        localStorage.setItem('token_mode', String(m));
                    }}
                    style={{
                        background: 'transparent', color: '#fff', border: 'none', 
                        fontSize:'13px', fontFamily:'Consolas', fontWeight:'bold', 
                        cursor:'pointer', outline:'none', textAlign:'right',
                        minWidth: '120px'
                    }}
                    title="Click to switch currency"
                 >
                    <option value={1} style={{background:'#222', color:'#fff'}}>{(balance).toLocaleString('id-ID')}</option>
                    <option value={2} style={{background:'#222', color:'#fff'}}>${usdRate > 0 ? (balance / usdRate).toFixed(2) : 'N/A'}</option>
                 </select>
               </div>
             )}

             {token && (
               <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                 <button 
                    onClick={() => setShowTopUp(true)}
                    className="icon-min"
                    style={{
                      background: 'transparent', color: '#4caf50', 
                      padding: '4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                    }}
                    title="Top Up"
                 >
                   <div style={{
                       width: 18, height: 18, background: '#4caf50', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px', fontWeight: 'bold'
                   }}>+</div>
                 </button>

                 <button 
                    onClick={() => setShowHelp(true)}
                    className="icon-min"
                    style={{
                      background: 'transparent', color: '#2196f3', 
                      padding: '4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                    }}
                    title="Panduan / Help"
                 >
                   <div style={{
                       width: 18, height: 18, background: '#2196f3', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px', fontWeight: 'bold'
                   }}>?</div>
                 </button>

                  {isAdmin && (
                    <button 
                      className="icon-min" 
                      onClick={onAdmin}
                      title="Admin Panel"
                      style={{
                         background: 'rgba(255, 193, 7, 0.1)', 
                         color: '#ffc107', 
                         border: '1px solid rgba(255, 193, 7, 0.3)',
                         padding: '4px 8px',
                         borderRadius: 4,
                         cursor: 'pointer'
                      }}
                    >
                      <span style={{fontSize:'16px'}}>🛡️</span>
                    </button>
                  )}
               </div>
             )}
          </div>
      </div>

      {/* 2. MAIN BODY (Flex/Grid) */}
      <div className="dashboard two-col" style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: isSidebarOpen ? `${sidebarWidth}px 6px minmax(0, 1fr)` : '0px 0px minmax(0, 1fr)', 
          gap: 0,
          transition: 'grid-template-columns 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
          overflow: 'hidden',
          padding: 0
      }}>

          {/* SIDEBAR */}
          <div className="sidebar" style={{
              width: '100%', 
              paddingRight: 0,
              overflowY: isSidebarOpen ? 'auto' : 'hidden',
              overflowX: 'hidden',
              opacity: isSidebarOpen ? 1 : 0,
              pointerEvents: isSidebarOpen ? 'auto' : 'none',
              transition: 'opacity 0.2s ease-in-out',
              whiteSpace: 'nowrap',
              background: 'var(--bg-color)',
              paddingTop: 16,
              paddingLeft: 16
          }}>
            <Settings onBack={()=>{}} embedded={true} />
          </div>
          
          {/* RESIZER */}
          <div className="resizer" onMouseDown={startResizing} style={{
              width: '6px', 
              cursor: 'col-resize', 
              background: 'transparent',
              zIndex: 10,
              position: 'relative',
              display: 'block'
          }} />

          {/* MAIN CONTENT (LOGS) */}
          <div className="main" style={{
              flex: 1, 
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              padding: 12,
              paddingLeft: 12, // Always constant padding since header is separate
              transition: 'padding 0.3s'
          }}>
            {updateModal && (
                <div style={{
                    position:'fixed', top:0, left:0, right:0, bottom:0, 
                    background:'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex:9999, 
                    display:'flex', alignItems:'center', justifyContent:'center'
                }}>
                    <div style={{
                        background:'linear-gradient(145deg, #1e1e1e, #181818)', 
                        border:'1px solid #333', 
                        borderRadius:12, width:420, overflow:'hidden',
                        boxShadow:'0 20px 50px rgba(0,0,0,0.7)',
                        display:'flex', flexDirection:'column', animation:'slideUp 0.3s ease-out'
                    }}>
                        {/* Header with Icon */}
                        <div style={{
                            padding: '24px 24px 0 24px', 
                            display:'flex', justifyContent:'space-between', alignItems:'flex-start'
                        }}>
                            <div style={{display:'flex', gap:16}}>
                                 <div style={{
                                     width:48, height:48, borderRadius:12, 
                                     background:'linear-gradient(135deg, #4caf50, #2e7d32)',
                                     display:'flex', alignItems:'center', justifyContent:'center',
                                     boxShadow:'0 4px 12px rgba(76, 175, 80, 0.3)'
                                 }}>
                                     <svg width="28" height="28" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                         <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                                     </svg>
                                 </div>
                                 <div>
                                     <h3 style={{margin:'0 0 4px 0', color:'#fff', fontSize:'18px', fontWeight:'600'}}>Update Available</h3>
                                     <div style={{fontSize:'13px', color:'#aaa'}}>Version {updateModal.version} is ready</div>
                                 </div>
                            </div>
                        </div>

                        {/* Body / Release Notes */}
                        <div style={{padding:'16px 24px', maxHeight:'200px', overflowY:'auto', color:'#ddd', fontSize:'13px', lineHeight:'1.5'}}>
                            <div style={{background:'rgba(255,255,255,0.05)', padding:12, borderRadius:8}}>
                                {updateModal.body || "Performance improvements and bug fixes."}
                            </div>
                        </div>

                        {/* Progress Bar (Visible when updating) */}
                        {isUpdating && (
                            <div style={{padding:'0 24px 16px 24px'}}>
                                 <div style={{display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#aaa', marginBottom:4}}>
                                     <span>{updateStatusText}</span>
                                     <span>{updateProgress > 0 ? updateProgress + '%' : ''}</span>
                                 </div>
                                 <div style={{height:6, width:'100%', background:'#333', borderRadius:3, overflow:'hidden'}}>
                                     <div style={{
                                         height:'100%', 
                                         width: `${updateProgress}%`, 
                                         background: '#4caf50',
                                         transition: 'width 0.3s ease-out'
                                     }}/>
                                 </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{
                            padding:'16px 24px', background:'rgba(0,0,0,0.2)', 
                            display:'flex', justifyContent:'flex-end', gap:12
                        }}>
                            {!isUpdating && (
                                <button 
                                    onClick={()=>setUpdateModal(null)}
                                    style={{
                                        background:'transparent', border:'1px solid #444', 
                                        color:'#aaa', padding:'8px 16px', borderRadius:6,
                                        cursor:'pointer', fontSize:'13px'
                                    }}
                                >
                                    Not Now
                                </button>
                            )}
                            <button 
                                onClick={performUpdate}
                                disabled={isUpdating}
                                style={{
                                    background: isUpdating ? '#333' : '#4caf50', 
                                    border: 'none',
                                    color: isUpdating ? '#888' : '#fff', 
                                    padding:'10px 24px', borderRadius:6, 
                                    cursor: isUpdating ? 'not-allowed' : 'pointer', 
                                    fontSize:'13px', fontWeight:'600',
                                    boxShadow: isUpdating ? 'none' : '0 4px 12px rgba(76, 175, 80, 0.3)',
                                    transition:'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: 8
                                }}
                            >
                                {isUpdating ? (
                                    <>
                                      <span style={{
                                        display:'inline-block', width:12, height:12, 
                                        border:'2px solid #666', borderTopColor:'#fff', borderRadius:'50%',
                                        animation:'spin 1s linear infinite'
                                      }}/>
                                      <span>Processing...</span>
                                      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                                    </>
                                ) : 'Update Now'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Top Up Modal */}
            <TopUpModal 
                isOpen={showTopUp} 
                onClose={() => setShowTopUp(false)} 
                token={token} 
                userId={userId}
                usdRate={usdRate}
                onSuccess={(added, purchaseType, expiry, source) => {
                    refreshBalance();
                    if (typeof added === 'number' && added > 0) {
                        setBalance(b => b + added);
                        setSuccessNotification({ type: 'token', amount: added, source: source });
                    } else if (purchaseType === 'token') {
                        setSuccessNotification({ type: 'token', source: source });
                    }
                    if (purchaseType === 'subscription') {
                        setSuccessNotification({ type: 'subscription', expiry, source: source });
                    }
                    setShowTopUp(false);
                }}
            />
            {successNotification && (
                <div style={{
                    position:'fixed', top:0, left:0, right:0, bottom:0,
                    background:'rgba(0,0,0,0.8)', zIndex:9999,
                    display:'flex', alignItems:'center', justifyContent:'center'
                }}>
                    <div style={{background:'#1e1e1e', padding:30, borderRadius:12, maxWidth:460, width:'90vw', textAlign:'left', border:'1px solid #333'}}>
                        <div style={{ fontWeight: 700, fontSize: 18, color: '#4caf50' }}>
                            {successNotification.type === 'subscription'
                              ? (successNotification.source === 'voucher' ? 'Subscription Voucher Activated' : 'Subscription Activated')
                              : (successNotification.source === 'voucher' ? 'Voucher Redeemed' : 'Payment Successful')}
                        </div>
                        <div style={{ marginTop: 10, color: '#ccc', fontSize: 13, lineHeight: 1.6 }}>
                            {successNotification.type === 'token' && (
                                <>
                                  {successNotification.source === 'voucher'
                                    ? (
                                        typeof successNotification.amount === 'number' && successNotification.amount > 0
                                          ? `${successNotification.amount.toLocaleString()} tokens have been added to your account.`
                                          : 'Your token voucher has been redeemed and tokens have been added.'
                                      )
                                    : (
                                        typeof successNotification.amount === 'number' && successNotification.amount > 0
                                          ? `${successNotification.amount.toLocaleString()} tokens have been added to your account.`
                                          : 'Your tokens have been added to your account.'
                                      )}
                                </>
                            )}
                            {successNotification.type === 'subscription' && (
                                <>
                                  {successNotification.source === 'voucher'
                                    ? (
                                        successNotification.expiry
                                          ? `Your API Key mode is active until ${new Date(successNotification.expiry).toLocaleString()}.`
                                          : 'Your API Key mode has been activated.'
                                      )
                                    : (
                                        successNotification.expiry
                                          ? `Your API Key mode is active until ${new Date(successNotification.expiry).toLocaleString()}.`
                                          : 'Your API Key mode has been activated.'
                                      )}
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                            <button onClick={() => setSuccessNotification(null)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Help Guide Modal */}
            {showHelp && <HelpGuide 
                onClose={() => setShowHelp(false)} 
            />}
            
            <div style={{flex:1, display:'flex', gap: 12, overflow:'hidden'}}>
              {/* Log Area (Full Width) */}
              <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#0b0b0b', borderRadius:6, border:'1px solid #222'}}>
                
                {/* NEW LOG HEADER WITH CONTROLS */}
                <div style={{
                    background: '#080808', border: '1px solid #333', borderBottom: 'none',
                    borderTopLeftRadius: '6px', borderTopRightRadius: '6px',
                    padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 6, minHeight: 60
                }}>
                     <div style={{display:'flex', gap:16, alignItems:'center', justifyContent:'center'}}>
                         <button className="icon-min" onClick={start} aria-label="Start" title="Start">
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>
                         </button>
                         <button className="icon-min" onClick={pauseProcess} aria-label="Pause" title="Pause">
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                         </button>
                         <button className="icon-min" onClick={stopProcess} aria-label="Stop" title="Stop">
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M6 6h12v12H6z"/></svg>
                         </button>
                     </div>
                     <div style={{display:'flex', gap: 16, alignItems:'center', justifyContent:'center', fontSize:'11px'}}>
                         <span style={{color:'#aaa'}}>Total: <span style={{color:'#fff'}}>{stats.total}</span></span>
                         <span style={{color:'#aaa'}}>Success: <span style={{color:'#4caf50'}}>{stats.success}</span></span>
                         <span style={{color:'#aaa'}}>Reject: <span style={{color:'#ff9800'}}>{stats.rejected}</span></span>
                         <span style={{color:'#aaa'}}>Failed: <span style={{color:'#f44336'}}>{stats.failed}</span></span>
                         <span style={{color:'#aaa'}}>Done: <span style={{color:'#fff'}}>{stats.done}</span></span>
                     </div>
                </div>

                <ProgressBar value={progress} />
                {/* LogPanel with removed top border radius to attach to header */}
                <div style={{flex:1, display:'flex', flexDirection:'column', overflowY:'auto', marginTop:-1}}>
                    <LogPanel logs={logs} />
                </div>
                
                <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', marginTop: 4, paddingLeft: 2}}>
                    <div style={{display:'flex', gap:4}}>
                      <button className="icon-min" onClick={generateCSV} aria-label="CSV" title="Generate CSV from Folder">
                         <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 5C7 3.89543 7.89543 3 9 3H21L29 11V29C29 30.1046 28.1046 31 27 31H9C7.89543 31 7 30.1046 7 29V5Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            <rect x="3" y="7" width="16" height="9" rx="2" fill="#10b981"/>
                            <text x="11" y="12.5" fontFamily="sans-serif" fontSize="6.5" fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="800">CSV</text>
                            <path d="M19 25C19 25 24 25 26 25M26 25V18M26 25L17 16" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="icon-min" onClick={openDupConfig} aria-label="Duplicate Detection" title="Detect Duplicates (Images/Videos)">
                         <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 5C7 3.89543 7.89543 3 9 3H21L29 11V29C29 30.1046 28.1046 31 27 31H9C7.89543 31 7 30.1046 7 29V5Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            <rect x="3" y="7" width="16" height="9" rx="2" fill="#38bdf8"/>
                            <text x="11" y="12.5" fontFamily="sans-serif" fontSize="6.5" fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="800">DUP</text>
                            <path d="M19 25L24 20M24 20L26 22M24 20L22 18" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="icon-min" onClick={runAiCluster} aria-label="AI Clustering" title="AI Media Clustering (Group by Visual Similarity)">
                         <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 5C7 3.89543 7.89543 3 9 3H21L29 11V29C29 30.1046 28.1046 31 27 31H9C7.89543 31 7 30.1046 7 29V5Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            <rect x="3" y="7" width="16" height="9" rx="2" fill="#8b5cf6"/>
                            <text x="11" y="12.5" fontFamily="sans-serif" fontSize="6.5" fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="800">AI</text>
                            <path d="M16 22L12 18" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M16 22L20 18" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M16 22L16 27" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round"/>
                            <circle cx="16" cy="22" r="2.5" fill="#1e293b" stroke="#8b5cf6" strokeWidth="1.5"/>
                            <circle cx="12" cy="18" r="1.5" fill="#8b5cf6"/>
                            <circle cx="20" cy="18" r="1.5" fill="#8b5cf6"/>
                            <circle cx="16" cy="27" r="1.5" fill="#8b5cf6"/>
                        </svg>
                      </button>
                      <button className="icon-min" onClick={()=>setShowLogs(true)} aria-label="Logs" title="Show Logs">
                         <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 5C7 3.89543 7.89543 3 9 3H21L29 11V29C29 30.1046 28.1046 31 27 31H9C7.89543 31 7 30.1046 7 29V5Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            <path d="M11 10H21" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M11 15H23" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M11 20H23" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M11 25H18" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
                            <circle cx="22" cy="22" r="5" fill="#0f172a" stroke="#38bdf8" strokeWidth="2"/>
                            <path d="M26 26L29 29" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round"/>
                         </svg>
                      </button>
                    </div>
                </div>
              </div>
            </div>
            
            {showLogs && (
              <div className="modal open">
                <div className="modal-content">
                  <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>Logs</div>
                    <button className="icon-btn" onClick={()=>setShowLogs(false)}>✕</button>
                  </div>
                  <div className="modal-body">
                    {logs.length===0 ? <div style={{opacity:.7}}>No logs available</div> : (
                      <div className="log-scroll" style={{userSelect: 'text', cursor: 'text'}}>
                        {logs.map((l,i)=>(
                          typeof l === 'string' 
                          ? <div key={i} style={{padding:'6px 0',borderBottom:'1px solid #222', userSelect:'text'}}>{l}</div>
                          : <div key={i} style={{padding:'6px 0',borderBottom:'1px solid #222', color: l.color || '#aaa', userSelect:'text'}}>
                              {l.text}
                              {l.detail && <div style={{fontSize:'0.85em', opacity:0.8, marginTop:2, marginLeft:10, whiteSpace:'pre-wrap', userSelect:'text'}}>{l.detail}</div>}
                            </div>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              </div>
            )}
          </div>
      </div>
    </div>
    {showDupModal && (
      <div className="modal open" style={{zIndex: 9999}}>
        <div className="modal-content">
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>Duplicate Detection</div>
            <button className="icon-btn" onClick={()=>setShowDupModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{padding:16}}>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>Input Folder</div>
              <div style={{flex:1}} title={dupInputDir || 'No folder selected'}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {dupInputDir || 'No folder selected'}
                </div>
              </div>
              <button onClick={pickDupFolder} className="btn-browse" disabled={dupRunning}>Browse</button>
            </div>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>Auto-delete identical</div>
              <input type="checkbox" checked={dupAutoDelete} onChange={(e)=>setDupAutoDelete(e.target.checked)} disabled={dupRunning} />
            </div>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:120, color:'#ccc'}}>Similarity threshold</div>
              <input type="number" min={0} max={64} value={dupThreshold} onChange={(e)=>setDupThreshold(Math.max(0, Math.min(64, Number(e.target.value || 0))))} disabled={dupRunning} style={{width:80, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}} />
              <span style={{opacity:.7, fontSize:12}}>0=strict, 3=default, higher=looser</span>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, padding:'12px 16px', borderTop:'1px solid #333'}}>
            <button onClick={()=>setShowDupModal(false)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>Close</button>
            <button onClick={runDupScan} disabled={dupRunning || !dupInputDir} style={{ padding: '10px 14px', background: dupRunning ? '#1f2937' : '#0ea5e9', color: '#fff', border: '1px solid #0ea5e9', borderRadius: 6, cursor: dupRunning ? 'not-allowed' : 'pointer' }}>{dupRunning ? 'Running...' : 'Run'}</button>
          </div>
        </div>
      </div>
    )}
    
    </>
  )
}
