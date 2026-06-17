import React, { useEffect, useState, useRef } from 'react'
import appIconUrl from '@icons/icon.ico'
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri'
import { open as shellOpen } from '@tauri-apps/api/shell'
import { open as dialogOpen } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { getVersion as tauriGetVersion } from '@tauri-apps/api/app'

const PROMPT_GRABBER_UI = {
  modalMaxWidthPx: 1000,
  modalHeightVh: 100,
  bodyPaddingPx: 20,
  baseFontPx: 11,
  labelFontPx: 10,
  controlFontPx: 10,
  inputPaddingPx: 6,
  gridCols: 5,
  gridHeightPx: 340,
  thumbHeightPx: 80,
  gridGapPx: 12
} as const
import ProgressBar from '../components/ProgressBar'
import LogPanel from '../components/LogPanel'
import Settings from './Settings'
import HelpGuide from '../components/HelpGuide'
import { getApiUrl, clearTokenLocal, apiGetUserProfile, getMachineHash, apiLicenseStatus, apiToolLicenseActivate, apiToolLicenseStatus } from '../api/backend'
import { decryptApiKey } from '../utils/crypto'
import { resolveGatewayBalanceAfter } from '../utils/gatewayBalance'
import { invokeWithTimeout } from '../utils/invokeWithTimeout'
import { translations } from '../utils/translations'
import { clearBatchState, loadBatchState, markBatchInterrupted, saveBatchState, type BatchFileStatus, type BatchStateV1 } from '../utils/batchLifecycle'
import { isVisionLikeModelId } from '../utils/modelVisionFilter'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'
const MODAL_EVENT_NAME = 'metabayn:modal';
const LICENSE_OPEN_EVENT_NAME = 'metabayn:license:open';
const LICENSE_CHANGED_EVENT_NAME = 'metabayn:license:changed';

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
  const toolT = (t as any)?.settings?.tools || (translations as any)['en']?.settings?.tools || {}
  const openInAppWeb = React.useCallback(async (url: string, label: string, title: string, opts?: { mobile?: boolean }) => {
    const u = String(url || '').trim()
    if (!u) return
    const mobile = !!opts?.mobile
    if (!isTauri) {
      try { window.open(u, '_blank', 'noopener,noreferrer') } catch {}
      return
    }
    try {
      const mod: any = await import('@tauri-apps/api/window')
      const WebviewWindow = mod?.WebviewWindow
      if (!WebviewWindow) throw new Error('WebviewWindow not available')
      const existing = WebviewWindow.getByLabel ? WebviewWindow.getByLabel(label) : null
      if (existing) {
        try { existing.setFocus() } catch {}
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
    } catch {
      try { await shellOpen(u) } catch {}
    }
  }, [])
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
    if (lang === 'id') {
      return raw
        .replace(/^API Error \(HTTP ([^)]+)\):/i, 'Kesalahan API (HTTP $1):')
        .replace(/^Direct API Error \(HTTP ([^,]+), URL: ([^)]+)\):/i, 'Kesalahan API Langsung (HTTP $1, URL: $2):')
        .replace(/^Direct API Network Error:/i, 'Kesalahan Jaringan API Langsung:')
        .replace(/^Missing API key/i, 'Kunci API belum ada')
        .replace(/\bSubscription expired\b/gi, 'Langganan berakhir')
        .replace(/\bSubscription inactive\b/gi, 'Langganan tidak aktif')
        .replace(/\bTokens exhausted\b/gi, 'Token habis')
        .replace(/\bInsufficient tokens\b/gi, 'Token tidak mencukupi')
    }
    return raw
      .replace(/\bSaldo token tidak cukup\b/gi, 'Insufficient tokens')
      .replace(/\bToken tidak mencukupi\b/gi, 'Insufficient tokens')
      .replace(/\bToken habis\b/gi, 'Tokens exhausted')
      .replace(/\bLangganan tidak aktif\b/gi, 'Subscription inactive')
      .replace(/\bLangganan berakhir\b/gi, 'Subscription expired')
  }, [lang])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const isResizing = useRef(false);
  const [logs,setLogs]=useState<any[]>([])
  const pushLog = React.useCallback((entry: any) => {
    setLogs(prev => {
      const entryId = entry.id;
      const entryFile = entry.file;
      const entryStatus = entry.status;

      if (entryId) {
        const idx = prev.findIndex(l => l.id === entryId);
        if (idx >= 0) {
          const newLogs = [...prev];
          newLogs[idx] = { ...newLogs[idx], ...entry };
          return newLogs;
        }
      }

      if (entryFile && entryStatus && entryStatus !== 'processing') {
        const idx = prev.findIndex(l => l.file === entryFile && l.status === 'processing');
        if (idx >= 0) {
          const newLogs = [...prev];
          newLogs[idx] = { ...newLogs[idx], ...entry, id: prev[idx].id };
          return newLogs;
        }
      }

      const nextEntry = { ...entry, id: entryId || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}` }
      const next = [...prev, nextEntry]
      if (next.length > 2000) next.splice(0, next.length - 2000)
      return next
    })
  }, [])
  const [progress,setProgress]=useState<number>(0)
  const [stats,setStats]=useState({total:0,done:0,success:0,failed:0,rejected:0})
  const toolFileStateRef = useRef<{
    csv: Map<string, string>,
    dup: Map<string, string>,
    tools: Map<string, string>,
    ai: Map<string, string>
  }>({ csv: new Map(), dup: new Map(), tools: new Map(), ai: new Map() })
  const toolRootRef = useRef<{ csv: string, dup: string, tools: string, ai: string }>({ csv: '', dup: '', tools: '', ai: '' })
  const [stopped,setStopped]=useState(false)
  const stoppedRef = React.useRef(false);
  const [showHelp, setShowHelp] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportBusy, setSupportBusy] = useState(false)
  const [supportPurchaseEmail, setSupportPurchaseEmail] = useState<string>('')
  const [supportProductCode, setSupportProductCode] = useState<'license' | 'prompt_grabber'>('license')
  const [supportPurchaseTimeHint, setSupportPurchaseTimeHint] = useState<string>('')
  const [supportAmountHint, setSupportAmountHint] = useState<string>('')
  const [supportEvidenceLink, setSupportEvidenceLink] = useState<string>('')
  const [supportNote, setSupportNote] = useState<string>('')
  const [supportError, setSupportError] = useState<string>('')
  const [supportSuccess, setSupportSuccess] = useState<string>('')
  const [appLicenseChecked, setAppLicenseChecked] = useState<boolean>(false)
  const [appLicenseActive, setAppLicenseActive] = useState<boolean>(false)
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
  const userProfileRef = useRef<any>(userProfile)
  useEffect(() => {
    userProfileRef.current = userProfile
  }, [userProfile])
  const openLicenseActivation = React.useCallback(() => {
    try { window.dispatchEvent(new CustomEvent(LICENSE_OPEN_EVENT_NAME)); } catch {}
  }, [])
  const refreshAppLicenseStatus = React.useCallback(async () => {
    if (!token) {
      setAppLicenseChecked(false)
      setAppLicenseActive(false)
      return
    }
    const u = userProfileRef.current as any
    const uid = String(u?.id ?? '').trim()
    const emailLc = String(u?.email ?? '').trim().toLowerCase()
    const isAdminLocal = !!(u && ((u.is_admin === 1) || (u.is_admin === true) || emailLc === 'metabayn@gmail.com'))
    if (isAdminLocal) {
      setAppLicenseChecked(true)
      setAppLicenseActive(true)
      return
    }
    if (!uid) {
      setAppLicenseChecked(false)
      setAppLicenseActive(false)
      return
    }
    const deviceHash = await getMachineHash().catch(() => '')
    if (!deviceHash) {
      setAppLicenseChecked(true)
      setAppLicenseActive(false)
      return
    }
    const lic = await apiLicenseStatus(token, uid, deviceHash).catch(() => null)
    const active = !!(lic && (lic as any).active)
    setAppLicenseChecked(true)
    setAppLicenseActive(active)
  }, [token])
  useEffect(() => {
    void refreshAppLicenseStatus()
  }, [refreshAppLicenseStatus, userProfile])
  useEffect(() => {
    const handler = () => {
      void refreshAppLicenseStatus()
    }
    window.addEventListener(LICENSE_CHANGED_EVENT_NAME, handler as any)
    return () => window.removeEventListener(LICENSE_CHANGED_EVENT_NAME, handler as any)
  }, [refreshAppLicenseStatus])
  const lastProfileRefreshMsRef = useRef<number>(0)
  const [showDupModal, setShowDupModal] = useState(false)
  const [dupInputDir, setDupInputDir] = useState<string>('')
  const [dupAutoDelete, setDupAutoDelete] = useState<boolean>(true)
  const [dupThreshold, setDupThreshold] = useState<number>(3)
  const [dupRunning, setDupRunning] = useState<boolean>(false)
  const [showResizeModal, setShowResizeModal] = useState(false)
  const [resizeInputDir, setResizeInputDir] = useState<string>('')
  const [resizeOutputDir, setResizeOutputDir] = useState<string>('')
  const [resizeDeleteOriginal, setResizeDeleteOriginal] = useState<boolean>(false)
  const [resizeWidth, setResizeWidth] = useState<string>('1920')
  const [resizeHeight, setResizeHeight] = useState<string>('1080')
  const [resizeKeepAspect, setResizeKeepAspect] = useState<boolean>(true)
  const [resizeFormat, setResizeFormat] = useState<string>('jpeg')
  const [resizeQuality, setResizeQuality] = useState<number>(85)
  const [resizeRunning, setResizeRunning] = useState<boolean>(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertInputDir, setConvertInputDir] = useState<string>('')
  const [convertOutputDir, setConvertOutputDir] = useState<string>('')
  const [convertDeleteOriginal, setConvertDeleteOriginal] = useState<boolean>(false)
  const [convertFormat, setConvertFormat] = useState<string>('jpeg')
  const [convertFormatOptions, setConvertFormatOptions] = useState<string[]>([])
  const [convertQuality, setConvertQuality] = useState<number>(85)
  const [convertRunning, setConvertRunning] = useState<boolean>(false)
  const pgPrefsInit = (() => {
    try {
      const raw = localStorage.getItem('metabayn:tool:promptgrabber:v1')
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })()
  const [showPromptGrabberModal, setShowPromptGrabberModal] = useState(false)
  const [pgPremiumOpen, setPgPremiumOpen] = useState<boolean>(false)
  const [pgPremiumBusy, setPgPremiumBusy] = useState<boolean>(false)
  const [pgPremiumCode, setPgPremiumCode] = useState<string>('')
  const [pgPremiumError, setPgPremiumError] = useState<string>('')
  const [pgPremiumActive, setPgPremiumActive] = useState<boolean | null>(null)
  const [pgInputDir, setPgInputDir] = useState<string>('')
  const [pgScanning, setPgScanning] = useState<boolean>(false)
  const [pgGenerating, setPgGenerating] = useState<boolean>(false)
  const [pgItems, setPgItems] = useState<any[]>([])
  const [pgSelected, setPgSelected] = useState<Record<string, boolean>>({})
  const [pgMinimized, setPgMinimized] = useState<boolean>(false)
  const [pgMiniStatus, setPgMiniStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [pgIncludeFilenameHeader, setPgIncludeFilenameHeader] = useState<boolean>(() => {
    const v = (pgPrefsInit as any)?.include_filename_header
    return typeof v === 'boolean' ? v : false
  })
  const [pgPlatform, setPgPlatform] = useState<string>(() => {
    const v = String((pgPrefsInit as any)?.platform || '').trim()
    return v || 'Midjourney'
  })
  const [pgDetailLevel, setPgDetailLevel] = useState<string>(() => {
    const v = String((pgPrefsInit as any)?.detail_level || '').trim()
    return v || 'Detail'
  })
  const [pgLanguage, setPgLanguage] = useState<string>(() => {
    const v = String((pgPrefsInit as any)?.language || '').trim()
    return v || 'English'
  })
  const [pgExtraPrompt, setPgExtraPrompt] = useState<string>(() => {
    return String((pgPrefsInit as any)?.extra_prompt || '')
  })
  const [pgOutputText, setPgOutputText] = useState<string>('')
  const [pgLastResults, setPgLastResults] = useState<any[]>([])
  const pgThumbLoadTokenRef = useRef<number>(0)
  const [criticalError, setCriticalError] = useState<string | null>(null)
  const criticalErrorRef = useRef<string | null>(null);
  const [profitMargin, setProfitMargin] = useState<number>(50);
  const convertFormatOptionsLoadedRef = useRef<boolean>(false);
  const [gatewayEnabled, setGatewayEnabled] = useState<boolean>(false);
  const autoResumeTriedRef = useRef(false);
  const isGeneratingRef = useRef(false)
  const isCsvToolsRunningRef = useRef(false)
  const inFlightCountRef = useRef(0)
  const prevTokenRef = useRef<string>(token || '')
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [auditFilter, setAuditFilter] = useState<'all' | 'error' | 'security'>('all')
  const [auditLoading, setAuditLoading] = useState(false)

  const applyToolStats = React.useCallback((channel: 'csv' | 'dup' | 'tools' | 'ai', payload: any) => {
    if (!payload || typeof payload !== 'object') return

    if (payload.code === 'TOOL_TOTAL') {
      const total = Number(payload.total ?? 0)
      if (!Number.isFinite(total)) return
      toolFileStateRef.current[channel].clear()
      toolRootRef.current[channel] = String(payload.file || payload.root || '')
      setStats({ total: Math.max(0, total), done: 0, success: 0, failed: 0, rejected: 0 })
      setProgress(0)
      return
    }

    if (payload.code === 'TOOL_PROGRESS') {
      const total = Number(payload.total ?? 0)
      const done = Number(payload.done ?? 0)
      const success = Number(payload.success ?? 0)
      const failed = Number(payload.failed ?? 0)
      const rejected = Number(payload.rejected ?? 0)
      if ([total, done, success, failed, rejected].some(v => !Number.isFinite(v))) return
      setStats({
        total: Math.max(0, total),
        done: Math.max(0, done),
        success: Math.max(0, success),
        failed: Math.max(0, failed),
        rejected: Math.max(0, rejected)
      })
      if (total > 0) {
        setProgress(Math.max(0, Math.min(100, Math.round((done / total) * 100))))
      }
      return
    }

    const status = String(payload.status || '')
    const isFinal = status === 'success' || status === 'error' || status === 'skipped' || status === 'deleted'
    if (!isFinal) return

    const key = String(payload.file_path || payload.path || payload.file || '')
    if (!key) return
    if (toolRootRef.current[channel] && key === toolRootRef.current[channel]) return

    const m = toolFileStateRef.current[channel]
    const prev = m.get(key)
    const prevFinal = prev === 'success' || prev === 'error' || prev === 'skipped' || prev === 'deleted'
    if (prevFinal) return

    m.set(key, status)

    setStats(s => {
      const next = { ...s }
      next.done = next.done + 1
      if (status === 'error') next.failed = next.failed + 1
      else next.success = next.success + 1
      return next
    })
  }, [])

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

  const notificationTimerRef = useRef<any>(null)
  const toast = React.useCallback((title: string, message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setNotification({ title, message, type })
    try {
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current)
      notificationTimerRef.current = setTimeout(() => setNotification(null), 2200)
    } catch {}
  }, [])

  const resolveGatewayFromSettings = (s: any): boolean => {
    return false
  }

  // Notification State
  const [notification, setNotification] = useState<{title: string, message: string, type: 'success' | 'info' | 'error'} | null>(null)
  const prevProfileRef = useRef<any>(null)

  useEffect(() => {
    try {
      const payload = {
        platform: pgPlatform,
        detail_level: pgDetailLevel,
        language: pgLanguage,
        extra_prompt: pgExtraPrompt,
        include_filename_header: pgIncludeFilenameHeader
      }
      localStorage.setItem('metabayn:tool:promptgrabber:v1', JSON.stringify(payload))
    } catch {}
  }, [pgPlatform, pgDetailLevel, pgLanguage, pgExtraPrompt, pgIncludeFilenameHeader])

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

  useEffect(() => {
    if (!userProfile) return;
    prevProfileRef.current = userProfile;
  }, [userProfile]);
  
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
          if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
            applyToolStats('csv', payload)
            return
          }
          if (payload.code === 'CSV_MISSING_TITLE_DESC') {
            const name = String(payload.file || '')
            payload.text = pl('csvMissingTitleDesc', { name })
          }
          if (payload.code === 'CSV_STOP_REQUESTED') {
            payload.text = pl('csvStopRequested')
          }
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

      applyToolStats('csv', payload)
      pushLog(logItem)
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
        if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
          applyToolStats('dup', payload)
          return
        }
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
      applyToolStats('dup', payload)
      pushLog(logItem)
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, []);

  // Listen for Resize Media Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('resize_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};
      let color = '#ec4899'; // Pink for Resize

      if (typeof payload === 'string') {
          logItem = { text: `[Resize] ${payload}`, color: color };
      } else if (typeof payload === 'object') {
          if (payload.code === 'RESIZE_ENGINE_EXTERNAL') {
            payload.text = formatLogText(toolT?.resizeEngineExternal || '', {})
            if (payload.detail) {
              payload.detail = formatLogText(toolT?.resizeEngineExternalDetail || '', { path: String(payload.detail) })
            }
          }
          if (payload.code === 'RESIZE_ENGINE_INTERNAL') {
            payload.text = formatLogText(toolT?.resizeEngineInternal || '', {})
          }
          if (payload.code === 'RESIZE_CONFIG') {
            payload.text = formatLogText(toolT?.resizeConfig || '', {
              input: String(payload.input_folder || ''),
              output: String(payload.output_folder || ''),
              width: Number(payload.width || 0),
              height: Number(payload.height || 0),
              keep_aspect: (payload.keep_aspect ? 'true' : 'false'),
              format: String(payload.format || ''),
              quality: Number(payload.quality || 0),
              delete_original: (payload.delete_original ? 'true' : 'false')
            })
          }
          if (payload.code === 'RESIZE_SCAN_OK') {
            payload.text = formatLogText(toolT?.resizeScanOk || '', {
              total: Number(payload.total || 0),
              files_seen: Number(payload.files_seen || 0),
              hidden_skipped: Number(payload.hidden_skipped || 0),
              walk_errors: Number(payload.walk_errors || 0)
            })
          }
          if (payload.code === 'RESIZE_SCAN_NONE') {
            payload.text = formatLogText(toolT?.resizeScanNone || '', {
              files_seen: Number(payload.files_seen || 0),
              hidden_skipped: Number(payload.hidden_skipped || 0),
              walk_errors: Number(payload.walk_errors || 0),
              exts_seen: String(payload.exts_seen || '')
            })
          }
          if (payload.code === 'RESIZE_FILE_PROCESSING') {
            payload.text = formatLogText(toolT?.resizeProcessingFile || '', { name: String(payload.name || '') })
          }
          if (payload.code === 'RESIZE_FILE_SUCCESS') {
            const suffix = payload.deleted_original ? (toolT?.resizeDeletedSuffix || '') : ''
            payload.text = formatLogText(toolT?.resizeSuccessFile || '', { name: String(payload.name || ''), suffix })
          }
          if (payload.code === 'RESIZE_FILE_ERROR') {
            payload.text = formatLogText(toolT?.resizeFailedFile || '', { name: String(payload.name || '') })
          }
          if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
            applyToolStats('tools', payload)
            return
          }
          if (payload.status === 'success') color = '#4caf50';
                else if (payload.status === 'error') color = '#f44336';
                else if (payload.status === 'processing') color = '#aaa';
                else if (payload.status === 'info') color = '#aaa';
                
                logItem = {
                    text: `[Resize] ${payload.text}`,
                    detail: payload.detail,
                    color: color,
                    animating: payload.status === 'processing',
                    file: payload.file,
                    status: payload.status
                };
            }

            applyToolStats('tools', payload)
            pushLog(logItem)
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, [toolT, lang, formatLogText, applyToolStats]);

  // Listen for Convert Logs
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen('convert_log', (event) => {
      const payload = event.payload as any;
      let logItem: any = {};
      let color = '#f59e0b';

      if (typeof payload === 'string') {
        logItem = { text: `[Convert] ${payload}`, color: color };
      } else if (typeof payload === 'object') {
        if (payload.code === 'CONVERT_ENGINE_MISSING') {
          payload.text = formatLogText(toolT?.convertEngineMissing || '', {})
        }
        if (payload.code === 'CONVERT_ENGINE_EXTERNAL') {
          payload.text = formatLogText(toolT?.convertEngineExternal || '', {})
          if (payload.detail) {
            payload.detail = formatLogText(toolT?.convertEngineExternalDetail || '', { path: String(payload.detail) })
          }
        }
        if (payload.code === 'CONVERT_CONFIG') {
          payload.text = formatLogText(toolT?.convertConfig || '', {
            input: String(payload.input_folder || ''),
            output: String(payload.output_folder || ''),
            format: String(payload.format || ''),
            quality: Number(payload.quality || 0),
            keep_metadata: (payload.keep_metadata ? 'true' : 'false'),
            delete_original: (payload.delete_original ? 'true' : 'false')
          })
        }
        if (payload.code === 'CONVERT_SCAN_OK') {
          payload.text = formatLogText(toolT?.convertScanOk || '', {
            total: Number(payload.total || 0),
            files_seen: Number(payload.files_seen || 0),
            hidden_skipped: Number(payload.hidden_skipped || 0),
            walk_errors: Number(payload.walk_errors || 0)
          })
        }
        if (payload.code === 'CONVERT_SCAN_NONE') {
          payload.text = formatLogText(toolT?.convertScanNone || '', {
            files_seen: Number(payload.files_seen || 0),
            hidden_skipped: Number(payload.hidden_skipped || 0),
            walk_errors: Number(payload.walk_errors || 0),
            exts_seen: String(payload.exts_seen || '')
          })
        }
        if (payload.code === 'CONVERT_FILE_PROCESSING') {
          payload.text = formatLogText(toolT?.convertProcessingFile || '', { name: String(payload.name || '') })
        }
        if (payload.code === 'CONVERT_FILE_SUCCESS') {
          const suffix = payload.deleted_original ? (toolT?.convertDeletedSuffix || '') : ''
          payload.text = formatLogText(toolT?.convertSuccessFile || '', { name: String(payload.name || ''), suffix })
        }
        if (payload.code === 'CONVERT_FILE_ERROR') {
          payload.text = formatLogText(toolT?.convertFailedFile || '', { name: String(payload.name || '') })
        }

        if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
          applyToolStats('tools', payload)
          return
        }

        if (payload.status === 'success') color = '#4caf50';
        else if (payload.status === 'error') color = '#f44336';
        else if (payload.status === 'processing') color = '#aaa';
        else if (payload.status === 'info') color = '#aaa';

        logItem = {
          text: `[Convert] ${payload.text}`,
          detail: payload.detail,
          color: color,
          animating: payload.status === 'processing',
          file: payload.file,
          status: payload.status
        };
      }

      applyToolStats('tools', payload)
      pushLog(logItem)
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, [toolT, lang, formatLogText, applyToolStats]);

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
          if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
            applyToolStats('ai', payload)
            return
          }
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

            applyToolStats('ai', payload)
            pushLog(logItem)
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
        if ((payload.code === 'TOOL_TOTAL' || payload.code === 'TOOL_PROGRESS') && !String(payload.text || '').trim()) {
          applyToolStats('tools', payload)
          return
        }
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
      applyToolStats('tools', payload)
      pushLog(logItem)
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

  useEffect(() => {
    if (!isTauri) return
    if (!showConvertModal) return
    if (convertFormatOptionsLoadedRef.current) return
    convertFormatOptionsLoadedRef.current = true

    const fallback = [
      'jpeg','jpg','png','webp','gif','tiff','tif','bmp','heic','heif','avif','jp2','j2k','jxl','svg','pdf','psd','ico','tga'
    ]

    ;(async () => {
      try {
        const list = await invoke<any>('list_convert_formats')
        const arr = Array.isArray(list) ? list : []
        const cleaned = arr
          .map(v => String(v || '').trim().toLowerCase())
          .filter(v => !!v)

        const unique = Array.from(new Set(cleaned))
        const preferred = ['jpeg','jpg','png','webp','gif','tiff','tif','bmp','heic','heif','avif','jp2','j2k','jxl','svg','pdf','psd','ico','tga']
        const preferredSet = new Set(preferred)
        const rest = unique.filter(x => !preferredSet.has(x)).sort((a, b) => a.localeCompare(b))
        const merged = [...preferred.filter(x => unique.includes(x)), ...rest]
        setConvertFormatOptions(merged.length ? merged : fallback)
      } catch {
        setConvertFormatOptions(fallback)
      }
    })()
  }, [showConvertModal])

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

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!isTauri) {
        if (!cancelled) setPgPremiumActive(null)
        return
      }
      if (!token) {
        if (!cancelled) setPgPremiumActive(null)
        return
      }
      try {
        const u = userProfileRef.current as any
        const email = String(u?.email || '').trim().toLowerCase()
        const isAdmin = !!u?.is_admin || email === 'metabayn@gmail.com'
        if (isAdmin) {
          if (!cancelled) setPgPremiumActive(true)
          return
        }
        const uid = String(u?.id || '').trim()
        if (!uid) {
          if (!cancelled) setPgPremiumActive(null)
          return
        }
        const deviceHash = await getMachineHash()
        const st = await apiToolLicenseStatus(token, uid, deviceHash, 'prompt_grabber').catch(() => null)
        if (!cancelled) setPgPremiumActive(!!(st && (st as any).active))
      } catch {
        if (!cancelled) setPgPremiumActive(null)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [token, userProfile, isTauri])

  useEffect(() => {
    if (!supportOpen) return
    const u = userProfileRef.current as any
    const email = String(u?.email || userEmail || '').trim().toLowerCase()
    if (!supportPurchaseEmail && email) setSupportPurchaseEmail(email)
    if (!supportSuccess) setSupportSuccess('')
    if (!supportError) setSupportError('')
  }, [supportOpen])

  async function submitLicenseSupport() {
    if (!token) return
    setSupportBusy(true)
    setSupportError('')
    setSupportSuccess('')
    try {
      const purchaseEmail = String(supportPurchaseEmail || '').trim()
      if (!purchaseEmail) throw new Error(lang === 'id' ? 'Masukkan email pembelian (yang tertulis di invoice Lynk).' : 'Enter purchase email.')
      const evidence = String(supportEvidenceLink || '').trim()
      const baseNote = String(supportNote || '').trim()
      const noteFinal = evidence
        ? (baseNote ? `${baseNote}\nBukti: ${evidence}` : `Bukti: ${evidence}`)
        : baseNote
      const payload = {
        purchase_email: purchaseEmail,
        product_code: supportProductCode,
        purchase_time_hint: String(supportPurchaseTimeHint || '').trim(),
        amount_hint: String(supportAmountHint || '').trim(),
        note: noteFinal
      }
      const { apiSupportLicenseClaim } = await import('../api/backend')
      const res = await apiSupportLicenseClaim(token, payload)
      const rid = String(res?.request_id || res?.requestId || '').trim()
      setSupportSuccess(lang === 'id'
        ? `Permintaan terkirim. ID: ${rid || '-'}`
        : `Request submitted. ID: ${rid || '-'}`)
    } catch (e: any) {
      setSupportError(e?.message ? String(e.message) : String(e))
    } finally {
      setSupportBusy(false)
    }
  }
  
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
             pushLog({text: pl('rescanCompleteFound', { count: files.length }), color:'#4caf50'})
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
    pushLog({id: 'scan-init', text: pl('scanning'), color:'#aaa'})
    setProgress(0)
    setStopped(false); stoppedRef.current = false;
    setCriticalError(null);
    
    const s=await invoke<any>('get_settings');
    const isGateway = resolveGatewayFromSettings(s);
    setGatewayEnabled(isGateway);

    if (token && userProfile) {
      const uid = String((userProfile as any)?.id ?? '').trim()
      const emailLc = String((userProfile as any)?.email ?? '').trim().toLowerCase()
      const isAdmin = !!((userProfile as any) && (((userProfile as any).is_admin === 1) || ((userProfile as any).is_admin === true) || emailLc === 'metabayn@gmail.com'))
      if (!isAdmin) {
        const deviceHash = await getMachineHash().catch(() => '')
        if (uid && deviceHash) {
          const lic = await apiLicenseStatus(token, uid, deviceHash).catch(() => null)
          const active = !!(lic && lic.active)
          setAppLicenseChecked(true)
          setAppLicenseActive(active)
          if (!active) {
            openLicenseActivation()
            return;
          }
        }
      }
    }
    pushLog({id: 'folder-info', text: pl('folder', { path: s.input_folder||'(None)' }), color:'#aaa'})

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
        const deviceSecret = String(await getMachineHash()).trim()
        const savedKey = localStorage.getItem('metabayn_api_key_enc');
        const savedIv = localStorage.getItem('metabayn_api_key_iv');
        if (!savedKey || !savedIv) {
          pushLog({text: pl('apiKeyMissing'), color:'#f44336'});
          return;
        }
        directApiKey = (await decryptApiKey(savedKey, savedIv, deviceSecret)).trim();
        if (!directApiKey) {
          pushLog({text: pl('apiKeyEmpty'), color:'#f44336'});
          return;
        }
        pushLog({text: pl('directModeEnabled', { provider: String(s.ai_provider||'AI') }), color:'#4caf50', hidden:true});
      } catch (e:any) {
        pushLog({text: pl('failedReadApiKey'), detail: String(e), color:'#f44336'});
        return;
      }
    } else {
      pushLog({text: pl('gatewayModeEnabled'), color:'#4caf50', hidden:true});
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
      pushLog({text: pl('modelNotSelected'), color:'#f44336'});
      stopProcessSystem(pl('modelNotSelectedDetail'));
      return;
    }

    const effectiveModel =
      String(s.ai_provider || '') === 'OpenAI'
        ? normalizeModelForProvider('OpenAI', rawModel)
        : rawModel;

    const loadGenModelCfg = (provider: string, model: string): any => {
      try {
        const key = `metabayn:gen:modelcfg:v1:${String(provider || '')}:${String(model || '').trim()}`
        const raw = localStorage.getItem(key)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    const genCfg = loadGenModelCfg(String(s.ai_provider || ''), effectiveModel)
    const autoStopEnabledCfg = (genCfg as any)?.auto_stop_enabled
    const autoStopEnabled = typeof autoStopEnabledCfg === 'boolean' ? autoStopEnabledCfg : true
    const autoStopFailThresholdRaw = Number((genCfg as any)?.auto_stop_fail_threshold)
    const autoStopFailThreshold = Number.isFinite(autoStopFailThresholdRaw) ? Math.max(1, Math.min(Math.round(autoStopFailThresholdRaw), 50)) : 5
    const reqTimeoutSecRaw = Number((genCfg as any)?.request_timeout_sec)
    const requestTimeoutSec = Number.isFinite(reqTimeoutSecRaw) ? Math.max(15, Math.min(Math.round(reqTimeoutSecRaw), 900)) : 180

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
    const stopSchedulingRef = { current: false };
    const failStreakRef = { current: 0 };
     
     const activePromises: Promise<any>[] = [];
    
    let i=initialDone // shared counter for progress
    let filesStayingInInputCount = 0; // Tracks files that were processed but remain in input (failed, skipped, or failed to delete)

    const requestStopSchedulingSystem = (detail?: string) => {
      if (stopSchedulingRef.current) return;
      stopSchedulingRef.current = true;
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

    const trackAutoStop = (status: BatchFileStatus | null, lastFileName?: string) => {
      if (!autoStopEnabled || !status || stopSchedulingRef.current) return;
      if (status === 'failed') {
        failStreakRef.current += 1;
      } else {
        failStreakRef.current = 0;
      }
      if (failStreakRef.current >= autoStopFailThreshold) {
        requestStopSchedulingSystem(`Auto-stop: ${autoStopFailThreshold}x gagal beruntun. Stop untuk file berikutnya (tidak membatalkan yang sedang berjalan). Terakhir: ${String(lastFileName || '')}`);
      }
    }

    const processFile = async (file: string, fileIndex: number) => {
        const currentFileName = file.split(/[\\/]/).pop();
        let finalStatus: BatchFileStatus | null = null;

        if(stoppedRef.current || criticalErrorRef.current) return;

        if (token) {
          const nowMs = Date.now()
          if (nowMs - lastProfileRefreshMsRef.current > 30000) {
            lastProfileRefreshMsRef.current = nowMs
            apiGetUserProfile(token)
              .then((fresh: any) => {
                if (!fresh) return
                setUserProfile((prev: any) => ({ ...(prev || {}), ...fresh }))
              })
              .catch(() => {})
          }
        }

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
                     trackAutoStop(finalStatus, currentFileName || '')
                     return;
                 }
             } catch(e) {}
        }

        const startTime = Date.now();
        pushLog({id: logId, text: pl('processing', { name: currentFileName }), color:'#888', animating: true}); 

        try {
            // Stop 'Starting...' animation if it's still running
            pushLog({ id: 'starting', animating: false });

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
              request_timeout_sec: requestTimeoutSec,
              request_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
            };
            if (isGateway) {
              reqPayload.connection_mode = 'gateway';
              reqPayload.api_key = '';
            } else {
              reqPayload.connection_mode = 'direct';
              reqPayload.api_key = directApiKey;
            }
            const res = await invoke<any[]>('generate_metadata_batch', { req: reqPayload })
            if (criticalErrorRef.current) {
              finalStatus = 'skipped'
              return
            }

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
                if (criticalErrorRef.current) {
                  finalStatus = finalStatus || 'skipped'
                  break
                }
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
                    const rawErr = String((g as any).description || '')
                    let detailMsg = localizeBackendError(rawErr);
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

                    pushLog({
                        id: logId,
                        text: isRejection ? `[${t.dashboard.reject}] ${fileName}` : `[${t.dashboard.failed}] ${fileName}`, 
                        detail: detailMsg, 
                        color: isRejection ? '#ff9800' : '#f44336', 
                        animating: false 
                    });
                    
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
                        pushLog({ id: logId, text: pl('failedWrite', { name: fileName }), detail: localizeBackendError(String(e)), color:'#f44336', animating: false });
                    }
                } else {
                    try{ 
                        renamedPath = await invokeWithTimeout<string | null>(invoke, 'write_image_metadata',{ req:{ file:g.file, output_file: targetFile, title:g.title, description:g.description, keywords:g.keywords, creator:'Metabayn', copyright:'Metabayn Studio', overwrite: !!s.overwrite, auto_embed: autoEmbed, category: g.category||"" } }, 60000);
                        writeSuccess = true;
                    } catch(e:any){ 
                        setStats(st=>({...st,failed:st.failed+1}));
                        pushLog({ id: logId, text: pl('failedWrite', { name: fileName }), detail: localizeBackendError(String(e)), color:'#f44336', animating: false });
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
                    pushLog({
                        id: logId,
                        text: isRejected ? `[${t.dashboard.reject}] ${fileName}` : `[${t.dashboard.success}] ${fileName}`, 
                        detail: tokenDetail, // Add detail for the modal log
                        color: isRejected ? '#ff9800' : '#4caf50', 
                        animating: false 
                    });
                    
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
            const isCancelled = msg.includes('CANCELLED_BY_USER');
            finalStatus = finalStatus || (isCancelled ? 'skipped' : 'failed');
            if (!isCancelled) {
              const isTimeout = msg.includes(' timeout') || /\btimeout\b/i.test(msg)
              const detail = isTimeout ? pl('timeoutDetail') : localizeBackendError(msg)
              pushLog({ id: logId, text: pl('systemError', { name: fileName }), detail, color:'#f44336', animating: false });
              setStats(st=>({...st, failed: st.failed+1}));
            } else {
              pushLog({ id: logId, text: pl('cancelled', { name: fileName }), detail: '', color:'#ff9800', animating: false });
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
            pushLog({ id: logId, animating: false });
            i++; setStats(st=>({...st,done:i})); setProgress(Math.round((i/totalCount)*100));
            trackAutoStop(finalStatus, currentFileName || '')
        }
    };

    for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++){
      const file = fileList[fileIndex]
      if(stoppedRef.current || criticalErrorRef.current || stopSchedulingRef.current) break; 
      if(stoppedRef.current) break;
      
      const p = processFile(file, fileIndex);
      activePromises.push(p);
      inFlightCountRef.current = activePromises.length
      
      p.finally(() => {
          const idx = activePromises.indexOf(p);
          if (idx > -1) activePromises.splice(idx, 1);
          inFlightCountRef.current = activePromises.length
      });

      while (activePromises.length >= CONCURRENCY) {
          if (stoppedRef.current || criticalErrorRef.current) break;
          await Promise.race(activePromises);
      }
    }
    
    const remaining = [...activePromises];
    if (remaining.length) await Promise.allSettled(remaining);
    inFlightCountRef.current = 0
    const endedByStop = stoppedRef.current || stopSchedulingRef.current;
    pushLog({text: endedByStop ? pl('stoppedBatch') : pl('doneText'), color: endedByStop ? '#ff5722' : '#4caf50'})
    
    // Auto-rescan to update file count
    if (!endedByStop && s.input_folder) {
        pushLog({text: pl('updatingFileCount'), color:'#aaa'});
        const left = await scan(s.input_folder);
        pushLog({text: pl('remainingFiles', { count: left.length }), color:'#4caf50'});
    }
    
    setStopped(false); stoppedRef.current = false;
    markBatchStopped()
    if (!endedByStop && i >= totalCount) clearBatchState()

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
      if (isCsvToolsRunningRef.current) {
        invoke('cancel_generate_csv_tools').catch(() => {})
        pushLog({text: pl('csvStopRequested'), color:'#ff5722'})
        return
      }
      if (stoppedRef.current) return
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
      const inFlight = Number(inFlightCountRef.current || 0)
      if (inFlight > 0) {
        pushLog({text: pl('stopRequestedDraining', { count: inFlight }), color:'#ff5722'});
      } else {
        pushLog({text: pl('stoppedByUser'), color:'#ff5722'});
      }
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

  const generateCSV = React.useCallback(async () => {
    if (!isTauri) { pushLog({text: pl('csvGenTauriOnly'), color:'#ff9800'}); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: pl('selectInputFolderImagesVideos')
        });
        if (!inputDir) return;

        // Fetch settings
        const s = await invoke<any>('get_settings');
        const p = userProfileRef.current as any
        const uid = String((p as any)?.id ?? '').trim()
        const emailLc = String((p as any)?.email ?? '').trim().toLowerCase()
        const isAdminLocal = !!(p && (((p as any).is_admin === 1) || ((p as any).is_admin === true) || emailLc === 'metabayn@gmail.com'))
        if (token && uid && !isAdminLocal) {
          const deviceHash = await getMachineHash().catch(() => '')
          if (deviceHash) {
            const lic = await apiLicenseStatus(token, uid, deviceHash).catch(() => null)
            const active = !!(lic && lic.active)
            setAppLicenseChecked(true)
            setAppLicenseActive(active)
            if (!active) {
              openLicenseActivation()
              return
            }
          }
        }

        const normalizeModelForProvider = (provider: string, model: string): string => {
          const p = String(provider || '')
          let m = String(model || '').trim()
          if (p === 'OpenAI') {
            if (m.includes('/')) m = m.split('/').pop() || m
          }
          return m
        }

        const loadGenModelCfg = (provider: string, model: string): any => {
          try {
            const key = `metabayn:gen:modelcfg:v1:${String(provider || '')}:${String(model || '').trim()}`
            const raw = localStorage.getItem(key)
            if (!raw) return {}
            const parsed = JSON.parse(raw)
            return parsed && typeof parsed === 'object' ? parsed : {}
          } catch {
            return {}
          }
        }

        const providerName = String(s?.ai_provider || '')
        const rawModel = String(s?.default_model || '').trim()
        const effectiveModel = providerName === 'OpenAI' ? normalizeModelForProvider('OpenAI', rawModel) : rawModel
        const cfg = loadGenModelCfg(providerName, effectiveModel)
        const autoStopEnabled = typeof (cfg as any)?.auto_stop_enabled === 'boolean' ? (cfg as any).auto_stop_enabled : true
        const autoStopFailThresholdRaw = Number((cfg as any)?.auto_stop_fail_threshold)
        const autoStopFailThreshold = Number.isFinite(autoStopFailThresholdRaw) ? Math.max(1, Math.min(Math.round(autoStopFailThresholdRaw), 50)) : 5
        const reqTimeoutSecRaw = Number((cfg as any)?.request_timeout_sec)
        const requestTimeoutSec = Number.isFinite(reqTimeoutSecRaw) ? Math.max(15, Math.min(Math.round(reqTimeoutSecRaw), 900)) : 180

        // Prepare API Key
        let apiKey = "";
        
        try {
            const deviceSecret = String(await getMachineHash()).trim()
            const savedKey = localStorage.getItem('metabayn_api_key_enc');
            const savedIv = localStorage.getItem('metabayn_api_key_iv');
            if (savedKey && savedIv) {
                apiKey = (await decryptApiKey(savedKey, savedIv, deviceSecret)).trim();
            }
        } catch(e) { console.error("Failed to decrypt API Key", e); }
        if (!apiKey) throw new Error('Missing API key')

        // Log: Start (Grey color, animating)
        const logId = `csv-gen-${Date.now()}`;
        pushLog({ id: logId, text: pl('csvGenGeneratingFrom', { path: inputDir }), color: '#aaa', animating: true });
        isCsvToolsRunningRef.current = true;
        
        // Output folder is same as input folder
        const res = await invoke('generate_csv_from_folder', {
          input_folder: inputDir,
          output_folder: inputDir,
          inputFolder: inputDir,
          outputFolder: inputDir,
          api_key: apiKey,
          apiKey: apiKey,
          token,
          auto_stop_enabled: autoStopEnabled,
          auto_stop_fail_threshold: autoStopFailThreshold,
          request_timeout_sec: requestTimeoutSec
        });
        
        // Log: Success (Update previous log to stop animation, add new success log)
        pushLog({ id: logId, animating: false });
        pushLog({ text: pl('csvGenSuccess', { result: res }), color: '#4caf50' });
    } catch (e) {
        pushLog({ id: logId, animating: false });
        pushLog({ text: pl('csvGenFailed', { error: String(e) }), color: '#f44336' });
    } finally {
        isCsvToolsRunningRef.current = false;
    }
  }, [pl, token, openLicenseActivation])
  const openDupConfig = React.useCallback(async () => {
    setShowDupModal(true)
    // Removed log to avoid confusion when opening config
  }, [])
  const openResizeConfig = React.useCallback(async () => {
    setShowResizeModal(true)
  }, [])
  const openConvertConfig = React.useCallback(async () => {
    setShowConvertModal(true)
  }, [])
  const openPromptGrabberConfig = React.useCallback(async () => {
    setPgMinimized(false)
    if (!isTauri) {
      pushLog({text: '[PromptGrabber] Feature only available in Tauri app', color:'#ff9800'})
      return
    }
    try {
      const u = userProfileRef.current as any
      const email = String(u?.email || '').trim().toLowerCase()
      const isAdmin = !!u?.is_admin || email === 'metabayn@gmail.com'
      if (isAdmin) {
        setPgPremiumActive(true)
        setShowPromptGrabberModal(true)
        return
      }
    } catch {}
    const ok = await (async () => {
      try {
        if (!token) throw new Error(lang === 'id' ? 'Silakan login terlebih dahulu' : 'Please login first')
        const uid = String((userProfileRef.current as any)?.id || '').trim()
        if (!uid) throw new Error(lang === 'id' ? 'User tidak valid' : 'Invalid user')
        const deviceHash = await getMachineHash()
        const st = await apiToolLicenseStatus(token, uid, deviceHash, 'prompt_grabber').catch(() => null)
        if (st && (st as any).active) {
          setPgPremiumActive(true)
          return true
        }
        setPgPremiumActive(false)
        setPgPremiumError('')
        setPgPremiumCode('')
        setPgPremiumOpen(true)
        return false
      } catch (e:any) {
        const msg = String(e?.message || e || '').replace('Error: ', '').trim()
        toast('Prompt Grabber', msg || (lang === 'id' ? 'Gagal cek lisensi' : 'License check failed'), 'error')
        pushLog({text: `[PromptGrabber] Gagal cek lisensi: ${msg || String(e)}`, color:'#f44336'})
        return false
      }
    })()
    if (!ok) return
    setShowPromptGrabberModal(true)
  }, [token, lang, toast])
  async function pgPremiumRecheckAndOpen(){
    if (pgPremiumBusy) return
    setPgPremiumBusy(true)
    setPgPremiumError('')
    try {
      if (!token) throw new Error(lang === 'id' ? 'Silakan login terlebih dahulu' : 'Please login first')
      const uid = String((userProfileRef.current as any)?.id || '').trim()
      if (!uid) throw new Error(lang === 'id' ? 'User tidak valid' : 'Invalid user')
      const deviceHash = await getMachineHash()
      const st = await apiToolLicenseStatus(token, uid, deviceHash, 'prompt_grabber')
      if (st && (st as any).active) {
        setPgPremiumActive(true)
        setPgPremiumOpen(false)
        setShowPromptGrabberModal(true)
        toast('Prompt Grabber', lang === 'id' ? 'Prompt Grabber Premium aktif' : 'Prompt Grabber Premium active', 'success')
        return
      }
      setPgPremiumActive(false)
      setPgPremiumError(lang === 'id'
        ? 'Lisensi Prompt Grabber belum aktif. Jika sudah beli, tunggu sebentar lalu klik Cek Aktivasi. Atau masukkan kode lisensi dari email.'
        : 'Prompt Grabber license is not active yet. If you already bought it, wait a moment then click Check Activation. Or enter the license code from email.')
    } catch (e:any) {
      const msg = String(e?.message || e || '').replace('Error: ', '').trim()
      setPgPremiumError(msg || (lang === 'id' ? 'Gagal cek lisensi' : 'License check failed'))
      pushLog({text: `[PromptGrabber] Premium check failed: ${msg || String(e)}`, color:'#f44336'})
    } finally {
      setPgPremiumBusy(false)
    }
  }
  async function pgPremiumActivateCode(){
    if (pgPremiumBusy) return
    const code = String(pgPremiumCode || '').trim()
    if (!code) {
      setPgPremiumError(lang === 'id' ? 'Masukkan kode lisensi (dari email) lalu klik Aktifkan.' : 'Enter your license code (from email) then click Activate.')
      return
    }
    setPgPremiumBusy(true)
    setPgPremiumError('')
    try {
      if (!token) throw new Error(lang === 'id' ? 'Silakan login terlebih dahulu' : 'Please login first')
      const uid = String((userProfileRef.current as any)?.id || '').trim()
      if (!uid) throw new Error(lang === 'id' ? 'User tidak valid' : 'Invalid user')
      const deviceHash = await getMachineHash()
      await apiToolLicenseActivate(token, code, uid, deviceHash, 'prompt_grabber')
      await pgPremiumRecheckAndOpen()
    } catch (e:any) {
      const msg = String(e?.message || e || '').replace('Error: ', '').trim()
      setPgPremiumError(msg || (lang === 'id' ? 'Gagal aktivasi' : 'Activation failed'))
      pushLog({text: `[PromptGrabber] Premium activation failed: ${msg || String(e)}`, color:'#f44336'})
    } finally {
      setPgPremiumBusy(false)
    }
  }
  async function pickPromptGrabberFolder(){
    if (!isTauri) { pushLog({text: '[PromptGrabber] Feature only available in Tauri app', color:'#ff9800'}); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: 'Select Folder (Prompt Grabber)' });
    if (inputDir) {
      const dir = String(inputDir)
      setPgInputDir(dir)
      toast('Prompt Grabber', lang === 'id' ? 'Folder dipilih' : 'Folder selected', 'info')
      void runPromptGrabberScan(dir)
    }
  }
  async function runPromptGrabberScan(dirOverride?: string){
    if (!isTauri) { pushLog({text: '[PromptGrabber] Feature only available in Tauri app', color:'#ff9800'}); return }
    const inputDir = String(dirOverride || pgInputDir || '').trim()
    if (!inputDir) {
      pushLog({text: '[PromptGrabber] No input folder selected', color:'#ff9800'})
      toast('Prompt Grabber', lang === 'id' ? 'Folder belum dipilih' : 'No folder selected', 'error')
      return
    }
    try {
      setPgScanning(true)
      setPgOutputText('')
      setPgLastResults([])
      setPgItems([])
      setPgSelected({})
      pgThumbLoadTokenRef.current = Date.now()
      const myToken = pgThumbLoadTokenRef.current
      toast('Prompt Grabber', lang === 'id' ? 'Scan dimulai' : 'Scan started', 'info')
      const items = await invoke<any[]>('prompt_grabber_scan_folder_fast', {
        input_folder: inputDir,
        inputFolder: inputDir,
        recurse: false,
        min_size: 0,
        minSize: 0,
        max_files: 0,
        maxFiles: 0
      })
      const list = Array.isArray(items) ? items : []
      setPgItems(list)
      const sel: Record<string, boolean> = {}
      for (const it of list) {
        const p = String((it as any)?.file_path || '')
        if (p) sel[p] = true
      }
      setPgSelected(sel)
      pushLog({text: `[PromptGrabber] Scan selesai: ${list.length} file`, color:'#4caf50'})
      toast('Prompt Grabber', lang === 'id' ? `Scan selesai: ${list.length} file` : `Scan done: ${list.length} files`, 'success')

      const paths = list.map((it: any) => String(it?.file_path || '')).filter(Boolean)
      const chunkSize = 12
      const runChunk = async (start: number) => {
        if (!paths.length) return
        if (pgThumbLoadTokenRef.current !== myToken) return
        const chunk = paths.slice(start, start + chunkSize)
        if (chunk.length === 0) return
        try {
          const res = await invoke<any[]>('prompt_grabber_get_thumbnails', { files: chunk })
          if (pgThumbLoadTokenRef.current !== myToken) return
          const map = new Map<string, string>()
          for (const r of (Array.isArray(res) ? res : [])) {
            const fp = String((r as any)?.file_path || '')
            const td = String((r as any)?.thumb_data_url || '')
            if (fp && td) map.set(fp, td)
          }
          if (map.size > 0) {
            setPgItems(prev => (prev || []).map((it: any) => {
              const fp = String(it?.file_path || '')
              if (!fp) return it
              if (String(it?.thumb_data_url || '').trim()) return it
              const td = map.get(fp)
              if (!td) return it
              return { ...it, thumb_data_url: td }
            }))
          }
        } catch {}
        if (pgThumbLoadTokenRef.current !== myToken) return
        if (start + chunkSize < paths.length) {
          setTimeout(() => { void runChunk(start + chunkSize) }, 0)
        }
      }
      void runChunk(0)
    } catch (e:any) {
      pushLog({text: `[PromptGrabber] Scan gagal: ${String(e)}`, color:'#f44336'})
      toast('Prompt Grabber', lang === 'id' ? 'Scan gagal' : 'Scan failed', 'error')
    } finally {
      setPgScanning(false)
    }
  }
  function pgSelectAll(){
    const sel: Record<string, boolean> = {}
    for (const it of pgItems || []) {
      const p = String((it as any)?.file_path || '')
      if (p) sel[p] = true
    }
    setPgSelected(sel)
    toast('Prompt Grabber', lang === 'id' ? 'Semua file dipilih' : 'All selected', 'info')
  }
  function pgClearSelection(){
    setPgSelected({})
    toast('Prompt Grabber', lang === 'id' ? 'Pilihan dikosongkan' : 'Selection cleared', 'info')
  }
  async function cancelPromptGrabber(){
    if (!isTauri) return
    try {
      await invoke('cancel_prompt_grabber')
      pushLog({text: '[PromptGrabber] Stop diminta. Menunggu proses yang berjalan...', color:'#ff9800'})
      toast('Prompt Grabber', lang === 'id' ? 'Stop diminta' : 'Stop requested', 'info')
    } catch {}
  }
  async function copyPromptGrabberOutput(){
    try {
      const text = String(pgOutputText || '')
      if (!text.trim()) return
      await navigator.clipboard.writeText(text)
      pushLog({text: '[PromptGrabber] Output berhasil disalin', color:'#4caf50'})
      toast('Prompt Grabber', lang === 'id' ? 'Output telah di-copy' : 'Output copied', 'success')
    } catch (e:any) {
      pushLog({text: `[PromptGrabber] Gagal copy: ${String(e)}`, color:'#f44336'})
      toast('Prompt Grabber', lang === 'id' ? 'Gagal copy' : 'Copy failed', 'error')
    }
  }
  async function savePromptGrabberTxt(){
    if (!isTauri) return
    try {
      const content = String(pgOutputText || '')
      if (!content.trim()) return
      if (!String(pgInputDir || '').trim()) throw new Error(lang === 'id' ? 'Folder input belum dipilih' : 'Input folder not selected')
      const outPath = await invoke<string>('prompt_grabber_save_file', { input_folder: pgInputDir, file_name: 'prompt.txt', content })
      pushLog({text: `[PromptGrabber] TXT tersimpan: ${String(outPath || '')}`, color:'#4caf50'})
      toast('Prompt Grabber', lang === 'id' ? 'File prompt.txt tersimpan di folder input' : 'prompt.txt saved in input folder', 'success')
    } catch (e:any) {
      const msg = String(e?.message || e || '').replace('Error: ', '').trim()
      pushLog({text: `[PromptGrabber] Gagal simpan TXT: ${msg || String(e)}`, color:'#f44336'})
      toast('Prompt Grabber', lang === 'id' ? `Gagal simpan TXT: ${msg || 'Unknown error'}` : `Failed to save TXT: ${msg || 'Unknown error'}`, 'error')
    }
  }
  async function savePromptGrabberCsv(){
    if (!isTauri) return
    try {
      const list = Array.isArray(pgLastResults) ? pgLastResults : []
      const rows = list
        .map((r:any) => ({
          file_name: String(r?.file_name || r?.file_path || '').trim(),
          prompt: String(r?.prompt || '').trim()
        }))
        .filter(x => x.file_name && x.prompt)
      if (rows.length === 0) return
      if (!String(pgInputDir || '').trim()) throw new Error(lang === 'id' ? 'Folder input belum dipilih' : 'Input folder not selected')
      const esc = (v: string): string => `"${String(v || '').replace(/"/g, '""')}"`
      const csv = ['file_name,prompt', ...rows.map(r => `${esc(r.file_name)},${esc(r.prompt)}`)].join('\n')
      const outPath = await invoke<string>('prompt_grabber_save_file', { input_folder: pgInputDir, file_name: 'prompt.csv', content: csv })
      pushLog({text: `[PromptGrabber] CSV tersimpan: ${String(outPath || '')}`, color:'#4caf50'})
      toast('Prompt Grabber', lang === 'id' ? 'File prompt.csv tersimpan di folder input' : 'prompt.csv saved in input folder', 'success')
    } catch (e:any) {
      const msg = String(e?.message || e || '').replace('Error: ', '').trim()
      pushLog({text: `[PromptGrabber] Gagal simpan CSV: ${msg || String(e)}`, color:'#f44336'})
      toast('Prompt Grabber', lang === 'id' ? `Gagal simpan CSV: ${msg || 'Unknown error'}` : `Failed to save CSV: ${msg || 'Unknown error'}`, 'error')
    }
  }
  function clearPromptGrabberOutput(){
    setPgOutputText('')
    setPgLastResults([])
    toast('Prompt Grabber', lang === 'id' ? 'Output dibersihkan' : 'Output cleared', 'info')
  }
  async function runPromptGrabberGenerate(){
    if (!isTauri) { pushLog({text: '[PromptGrabber] Feature only available in Tauri app', color:'#ff9800'}); return }
    const selectedFiles = Object.keys(pgSelected || {}).filter(k => pgSelected[k])
    if (selectedFiles.length === 0) {
      pushLog({text: '[PromptGrabber] Tidak ada file yang dipilih', color:'#ff9800'})
      toast('Prompt Grabber', lang === 'id' ? 'Tidak ada file yang dipilih' : 'No files selected', 'error')
      return
    }
    try {
      setPgGenerating(true)
      setPgOutputText('')
      setPgLastResults([])
      setPgMiniStatus('running')
      setPgMinimized(true)
      setShowPromptGrabberModal(false)
      toast('Prompt Grabber', lang === 'id' ? 'Generate dimulai. Lihat log di panel Logs.' : 'Generate started. See logs in Logs panel.', 'info')
      const s = await invoke<any>('get_settings')
      const provider = String(s.ai_provider || '').trim()
      const rawModel = String(s.default_model || '').trim()
      if (!provider) throw new Error('Provider belum dipilih di Settings')
      if (!rawModel) throw new Error('Model belum dipilih di Settings')

      const normalizeModelForProvider = (p: string, m: string): string => {
        if (String(p) === 'OpenAI') {
          const v = String(m || '').trim()
          if (v.includes('/')) return v.split('/').pop() || v
          return v
        }
        return String(m || '').trim()
      }
      const model = normalizeModelForProvider(provider, rawModel)

      let apiKey = ''
      try {
        const deviceSecret = String(await getMachineHash()).trim()
        const savedKey = localStorage.getItem('metabayn_api_key_enc')
        const savedIv = localStorage.getItem('metabayn_api_key_iv')
        if (savedKey && savedIv) apiKey = (await decryptApiKey(savedKey, savedIv, deviceSecret)).trim()
      } catch {}
      if (!apiKey) throw new Error('API key belum diset di Settings')

      const loadGenModelCfg = (p: string, m: string): any => {
        try {
          const key = `metabayn:gen:modelcfg:v1:${String(p || '')}:${String(m || '').trim()}`
          const raw = localStorage.getItem(key)
          if (!raw) return {}
          const parsed = JSON.parse(raw)
          return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
          return {}
        }
      }
      const genCfg = loadGenModelCfg(provider, model)
      const reqTimeoutSecRaw = Number((genCfg as any)?.request_timeout_sec)
      const requestTimeoutSec = Number.isFinite(reqTimeoutSecRaw) ? Math.max(15, Math.min(Math.round(reqTimeoutSecRaw), 900)) : 45

      if ((provider === 'OpenAI' || provider === 'Gemini' || provider === 'OpenRouter') && !isVisionLikeModelId(model)) {
        throw new Error(`Model tidak mendukung vision: ${model}`)
      }

      const reqPayload: any = {
        files: selectedFiles,
        provider,
        model,
        connection_mode: 'direct',
        api_key: apiKey,
        token: '',
        retries: Math.max(0, Math.min(10, Number(s.retry_count ?? 2))),
        request_timeout_sec: requestTimeoutSec,
        max_threads: Math.max(1, Math.min(16, Number(s.max_threads ?? 4))),
        platform: pgPlatform,
        detail_level: pgDetailLevel,
        language: pgLanguage,
        extra_prompt: pgExtraPrompt
      }
      const results = await invoke<any[]>('prompt_grabber_generate', { req: reqPayload })
      const list = Array.isArray(results) ? results : []
      setPgLastResults(list)
      const text = list
        .map((r: any) => {
          const name = String(r?.file_name || r?.file_path || '')
          const prompt = String(r?.prompt || '').trim()
          if (!prompt) return ''
          if (pgIncludeFilenameHeader) return `${name}\n${prompt}`.trim()
          return prompt
        })
        .filter(Boolean)
        .join('\n\n')
      setPgOutputText(text)
      pushLog({text: `[PromptGrabber] Generate selesai: ${list.length} file`, color:'#4caf50'})
      setPgMiniStatus('done')
      toast('Prompt Grabber', lang === 'id' ? `Selesai: ${list.length} file` : `Done: ${list.length} files`, 'success')
    } catch (e:any) {
      pushLog({text: `[PromptGrabber] Generate gagal: ${String(e)}`, color:'#f44336'})
      setPgMiniStatus('idle')
      toast('Prompt Grabber', lang === 'id' ? 'Generate gagal' : 'Generate failed', 'error')
    } finally {
      setPgGenerating(false)
    }
  }
  async function pickConvertInputFolder(){
    if (!isTauri) { pushLog({text: '[Convert] Feature only available in Tauri app', color:'#ff9800'}); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: toolT?.selectFolderConvert || 'Select Folder (Convert)' });
    if (inputDir) setConvertInputDir(String(inputDir))
  }
  async function pickConvertOutputFolder(){
    if (!isTauri) { pushLog({text: '[Convert] Feature only available in Tauri app', color:'#ff9800'}); return }
    const outputDir = await dialogOpen({ directory: true, multiple: false, title: toolT?.convertOutputFolder || 'Output Folder' });
    if (outputDir) setConvertOutputDir(String(outputDir))
  }
  async function runConvert(){
    if (!isTauri) { pushLog({text: '[Convert] Feature only available in Tauri app', color:'#ff9800'}); return }
    if (!convertInputDir) {
      pushLog({text: '[Convert] No input folder selected', color:'#ff9800'})
      return
    }
    if (!convertOutputDir) {
      pushLog({text: '[Convert] No output folder selected', color:'#ff9800'})
      return
    }
    try {
      setConvertRunning(true)
      setShowConvertModal(false)
      const logId = `convert-${Date.now()}`;
      pushLog({ id: logId, text: pl('convertStarting', { path: convertInputDir }), color: '#aaa', animating: true });
      const res = await invoke<string>('convert_media_batch', {
        req: {
          input_folder: convertInputDir,
          output_folder: convertOutputDir,
          delete_original: convertDeleteOriginal,
          format: convertFormat,
          quality: convertQuality
        }
      });
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('convertCompleted', { result: res }), color: '#4caf50' });
    } catch (e:any) {
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('convertFailed', { error: String(e) }), color: '#f44336' });
    } finally {
      setConvertRunning(false)
    }
  }
  async function pickResizeInputFolder(){
    if (!isTauri) { pushLog({text: '[Resize] Feature only available in Tauri app', color:'#ff9800'}); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: toolT?.selectFolderResize || 'Select Folder (Images/Videos)' });
    if (inputDir) setResizeInputDir(String(inputDir))
  }
  async function pickResizeOutputFolder(){
    if (!isTauri) { pushLog({text: '[Resize] Feature only available in Tauri app', color:'#ff9800'}); return }
    const outputDir = await dialogOpen({ directory: true, multiple: false, title: toolT?.resizeOutputFolder || 'Output Folder' });
    if (outputDir) setResizeOutputDir(String(outputDir))
  }
  async function runResize(){
    if (!isTauri) { pushLog({text: '[Resize] Feature only available in Tauri app', color:'#ff9800'}); return }
    if (!resizeInputDir) {
      pushLog({text: '[Resize] No input folder selected', color:'#ff9800'})
      return
    }
    if (!resizeOutputDir) {
      pushLog({text: '[Resize] No output folder selected', color:'#ff9800'})
      return
    }
    try {
      setResizeRunning(true)
      setShowResizeModal(false)
      const logId = `resize-${Date.now()}`;
      pushLog({ id: logId, text: pl('resizeStarting', { path: resizeInputDir }), color: '#aaa', animating: true });
      const parsedWidth = Math.max(1, Math.min(10000, Math.round(Number(String(resizeWidth || '').trim())) || 0))
      const parsedHeight = Math.max(1, Math.min(10000, Math.round(Number(String(resizeHeight || '').trim())) || 0))
      const res = await invoke<string>('resize_media_batch', { 
        req: {
          input_folder: resizeInputDir,
          output_folder: resizeOutputDir,
          delete_original: resizeDeleteOriginal,
          width: parsedWidth,
          height: parsedHeight,
          keep_aspect: resizeKeepAspect,
          format: resizeFormat,
          quality: resizeQuality
        }
      });
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('resizeCompleted', { result: res }), color: '#4caf50' });
    } catch (e:any) {
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('resizeFailed', { error: String(e) }), color: '#f44336' });
    } finally {
      setResizeRunning(false)
    }
  }

  async function pickDupFolder(){
    if (!isTauri) { pushLog({text: pl('duplicateTauriOnly'), color:'#ff9800'}); return }
    const inputDir = await dialogOpen({ directory: true, multiple: false, title: pl('selectFolderImagesVideos') });
    if (inputDir) setDupInputDir(String(inputDir))
  }

  async function runDupScan(){
    if (!isTauri) { pushLog({text: pl('duplicateTauriOnly'), color:'#ff9800'}); return }
    if (!dupInputDir) {
      pushLog({text: pl('duplicateNoFolderSelected'), color:'#ff9800'})
      return
    }
    try {
      setDupRunning(true)
      const logId = `dup-${Date.now()}`;
      pushLog({ id: logId, text: pl('duplicateStartingScan', { path: dupInputDir }), color: '#aaa', animating: true });
      console.log("[Duplicate] Invoking command with:", { input_folder: dupInputDir, auto_delete: dupAutoDelete, threshold: dupThreshold });
      const res = await invoke<string>('detect_duplicate_images', { input_folder: dupInputDir, inputFolder: dupInputDir, auto_delete: dupAutoDelete, autoDelete: dupAutoDelete, threshold: dupThreshold });
      console.log("[Duplicate] Result:", res);
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('duplicateCompleted', { result: res }), color: '#4caf50' });
    } catch (e) {
      console.error("[Duplicate] Error:", e);
      pushLog({ id: logId, animating: false });
      pushLog({ text: pl('duplicateFailed', { error: String(e) }), color: '#f44336' });
    } finally {
      setDupRunning(false)
    }
  }

  const runAiCluster = React.useCallback(async () => {
    if (!isTauri) { pushLog({text: pl('aiClusterTauriOnly'), color:'#ff9800'}); return }
    try {
        const inputDir = await dialogOpen({
            directory: true,
            multiple: false,
            title: translations[lang].dashboard.aiClusterTitle
        });
        if (!inputDir) return;

        // Log: Start
        const logId = `ai-cluster-${Date.now()}`;
        pushLog({ id: logId, text: pl('aiClusterStarting', { path: inputDir, threshold: '0.85' }), color: '#aaa', animating: true });
        
        // Threshold hardcoded to 0.85 for now as per python script default
        const res = await invoke<string>('run_ai_clustering', { inputFolder: inputDir, threshold: 0.85 });
        
        // Log: Success
        pushLog({ id: logId, animating: false });
        pushLog({ text: pl('aiClusterCompleted', { result: res }), color: '#4caf50' });
    } catch (e) {
        pushLog({ id: logId, animating: false });
        pushLog({ text: pl('aiClusterFailed', { error: String(e) }), color: '#f44336' });
    }
  }, [lang, pl])
  

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
                         {(() => {
                           const u = userProfile as any
                           const emailLc = String(u?.email || userEmail || '').trim().toLowerCase()
                           const isAdminLocal = !!(u && ((u.is_admin === 1) || (u.is_admin === true) || emailLc === 'metabayn@gmail.com'))
                           if (!token || isAdminLocal) return null
                           const label = !appLicenseChecked
                             ? (lang === 'id' ? 'Cek lisensi...' : 'Checking...')
                             : (appLicenseActive ? (lang === 'id' ? 'Berlisensi' : 'Licensed') : (lang === 'id' ? 'Belum lisensi' : 'Unlicensed'))
                           const bg = !appLicenseChecked
                             ? '#27272a'
                             : (appLicenseActive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)')
                           const border = !appLicenseChecked
                             ? '#3f3f46'
                             : (appLicenseActive ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)')
                           const color = !appLicenseChecked
                             ? '#a1a1aa'
                             : (appLicenseActive ? '#86efac' : '#fca5a5')
                           return (
                             <button
                               onClick={() => { if (appLicenseChecked && !appLicenseActive) openLicenseActivation() }}
                               disabled={!appLicenseChecked || appLicenseActive}
                               style={{
                                 background: bg,
                                 border: `1px solid ${border}`,
                                 color,
                                 fontSize: 10,
                                 fontWeight: 700,
                                 padding: '2px 8px',
                                 borderRadius: 999,
                                 cursor: (!appLicenseChecked || appLicenseActive) ? 'default' : 'pointer'
                               }}
                               title={
                                 appLicenseActive
                                   ? (lang === 'id' ? 'Lisensi aktif' : 'License active')
                                   : (lang === 'id' ? 'Klik untuk aktivasi lisensi' : 'Click to activate license')
                               }
                             >
                               {label}
                             </button>
                           )
                         })()}
                     </div>
                 )}
               </div>
          </div>

          {/* RIGHT: Actions */}
          <div style={{display:'flex', gap:16, alignItems:'center'}}>
             
            {token && (
               <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
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
                   onClick={() => { void openInAppWeb('https://lynk.id/metabayn', 'metabayn-store', 'Metabayn Store', { mobile: true }) }}
                   className="icon-min"
                   style={{
                     background: 'transparent', color: '#10b981',
                     padding: '4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                   }}
                   title={lang === 'id' ? 'Toko Metabayn' : 'Metabayn Store'}
                >
                  <div style={{
                      width: 18, height: 18, background: '#10b981', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6 6h15l-1.5 9h-13L6 6Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
                      <path d="M6 6l-2-3H1" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M9 20a1 1 0 1 0 0.001 0Z" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M18 20a1 1 0 1 0 0.001 0Z" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                </button>
                
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
                onOpenPromptGrabber={openPromptGrabberConfig}
                onOpenDupConfig={openDupConfig}
                onRunAiCluster={runAiCluster}
                onOpenResizeConfig={openResizeConfig}
                onOpenConvertConfig={openConvertConfig}
                promptGrabberLicensed={pgPremiumActive === null ? undefined : pgPremiumActive}
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
    {pgPremiumOpen && (
      <div className="modal open" style={{zIndex: 10000}}>
        <div className="modal-content" style={{width: 'min(560px, 92vw)', maxHeight: '84vh', height: 'auto', display:'flex', flexDirection:'column'}}>
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>{lang === 'id' ? 'Prompt Grabber Premium' : 'Prompt Grabber Premium'}</div>
            <button className="icon-btn" onClick={()=>setPgPremiumOpen(false)} disabled={pgPremiumBusy}>✕</button>
          </div>
          <div className="modal-body" style={{padding: 14, display:'flex', flexDirection:'column', gap:12}}>
            <div style={{fontSize: 12, color:'#cbd5e1', lineHeight: 1.45}}>
              {lang === 'id'
                ? 'Tool Prompt Grabber adalah fitur premium. Untuk mengaktifkannya, beli lisensi di link produk. Setelah pembelian sukses, tool akan aktif otomatis untuk akun email yang sama. Jika belum aktif, Anda bisa masukkan kode lisensi dari email.'
                : 'Prompt Grabber is a premium feature. Buy a license from the product link. After a successful purchase, it will auto-activate for the same account email. If it is not active yet, you can enter the license code from email.'}
            </div>
            <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
              <button
                onClick={() => { void openInAppWeb('http://lynk.id/metabayn/wp6d9o37o51d', 'metabayn-buy-prompt-grabber', 'Prompt Grabber Premium', { mobile: true }) }}
                disabled={pgPremiumBusy}
                style={{ padding:'8px 12px', background:'#0ea5e9', color:'#fff', border:'1px solid #0ea5e9', borderRadius: 8, cursor:'pointer', fontSize: 12, fontWeight: 700 }}
              >
                {lang === 'id' ? 'Beli Lisensi' : 'Buy License'}
              </button>
              <button
                onClick={()=>{ void pgPremiumRecheckAndOpen() }}
                disabled={pgPremiumBusy}
                style={{ padding:'8px 12px', background:'#18181b', color:'#fff', border:'1px solid #27272a', borderRadius: 8, cursor:'pointer', fontSize: 12 }}
              >
                {pgPremiumBusy ? (lang === 'id' ? 'Memeriksa...' : 'Checking...') : (lang === 'id' ? 'Cek Aktivasi' : 'Check Activation')}
              </button>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              <div style={{fontSize: 11, color:'#a1a1aa'}}>{lang === 'id' ? 'Kode lisensi (opsional)' : 'License code (optional)'}</div>
              <input
                value={pgPremiumCode}
                onChange={(e)=>setPgPremiumCode(String(e.target.value || ''))}
                disabled={pgPremiumBusy}
                placeholder={lang === 'id' ? 'Masukkan kode dari email...' : 'Enter code from email...'}
                style={{ padding:'10px 10px', background:'#0b0b0b', border:'1px solid #27272a', color:'#fff', borderRadius: 8, fontSize: 12 }}
              />
              <button
                onClick={()=>{ void pgPremiumActivateCode() }}
                disabled={pgPremiumBusy}
                style={{ alignSelf:'flex-start', padding:'8px 12px', background:'#22c55e', color:'#000', border:'1px solid #22c55e', borderRadius: 8, cursor:'pointer', fontSize: 12, fontWeight: 800 }}
              >
                {lang === 'id' ? 'Aktifkan' : 'Activate'}
              </button>
            </div>
            {pgPremiumError ? (
              <div style={{background:'#2a0f12', border:'1px solid #7f1d1d', color:'#fecaca', padding:'10px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.4}}>
                {pgPremiumError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )}
    {showPromptGrabberModal && (
      <div className="modal open" style={{zIndex: 9999}}>
        <div
          className="modal-content"
          style={{
            width: `min(${PROMPT_GRABBER_UI.modalMaxWidthPx}px, 96vw)`,
            maxHeight: `${PROMPT_GRABBER_UI.modalHeightVh}vh`,
            height: `${PROMPT_GRABBER_UI.modalHeightVh}vh`,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>Prompt Grabber</div>
            <button className="icon-btn" onClick={()=>setShowPromptGrabberModal(false)} disabled={pgScanning || pgGenerating}>✕</button>
          </div>
          <div className="modal-body" style={{padding: PROMPT_GRABBER_UI.bodyPaddingPx, flex: 1, minHeight: 0, overflowY: 'auto', fontSize: PROMPT_GRABBER_UI.baseFontPx}}>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12, flexWrap:'wrap'}}>
              <div style={{minWidth:110, color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>{lang === 'id' ? 'Folder input' : 'Input folder'}</div>
              <div style={{flex:1, minWidth:0}} title={pgInputDir || (lang === 'id' ? 'Belum dipilih' : 'Not selected')}>
                <div style={{padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                  {pgInputDir || (lang === 'id' ? 'Belum dipilih' : 'Not selected')}
                </div>
              </div>
              <button onClick={pickPromptGrabberFolder} className="btn-browse" disabled={pgScanning || pgGenerating} style={{fontSize: PROMPT_GRABBER_UI.controlFontPx}}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
              <button
                onClick={() => { void runPromptGrabberScan() }}
                disabled={pgScanning || pgGenerating || !pgInputDir}
                style={{ padding: '8px 12px', background: (pgScanning || !pgInputDir) ? '#1f2937' : '#0ea5e9', color: '#fff', border: '1px solid #0ea5e9', borderRadius: 6, cursor: (pgScanning || !pgInputDir) ? 'not-allowed' : 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}
              >
                {pgScanning ? (lang === 'id' ? 'Scanning...' : 'Scanning...') : (lang === 'id' ? 'Scan' : 'Scan')}
              </button>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:10}}>
              <div style={{color:'#a1a1aa', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>
                {(() => {
                  const total = Array.isArray(pgItems) ? pgItems.length : 0
                  const selected = Object.keys(pgSelected || {}).filter(k => (pgSelected as any)[k]).length
                  return (lang === 'id' ? `Dipilih ${selected}/${total}` : `Selected ${selected}/${total}`)
                })()}
              </div>
              <button onClick={pgSelectAll} disabled={pgScanning || pgGenerating || (pgItems || []).length === 0} style={{ padding: '6px 10px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Pilih semua' : 'Select all'}
              </button>
              <button onClick={pgClearSelection} disabled={pgScanning || pgGenerating} style={{ padding: '6px 10px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Kosongkan' : 'Clear'}
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${PROMPT_GRABBER_UI.gridCols}, minmax(0, 1fr))`,
                gap: PROMPT_GRABBER_UI.gridGapPx,
                height: PROMPT_GRABBER_UI.gridHeightPx,
                overflowY: 'auto',
                padding: 10,
                border: '1px solid #222',
                borderRadius: 10,
                background: '#0b0b0b',
                marginBottom: 12
              }}
            >
              {(pgItems || []).map((it: any) => {
                const p = String(it?.file_path || '')
                const name = String(it?.file_name || '')
                const kind = String(it?.kind || '')
                const thumb = String(it?.thumb_data_url || '')
                const selected = !!(pgSelected as any)?.[p]
                const fallbackSrc = (isTauri && p && kind === 'image') ? convertFileSrc(p) : ''
                return (
                  <button
                    key={p || name}
                    type="button"
                    onClick={() => setPgSelected(prev => ({ ...(prev || {}), [p]: !((prev || {}) as any)[p] }))}
                    disabled={pgScanning || pgGenerating || !p}
                    title={name}
                    style={{
                      display:'flex',
                      flexDirection:'column',
                      gap:6,
                      padding: 6,
                      borderRadius: 8,
                      border: selected ? '2px solid #0ea5e9' : '1px solid #222',
                      background: selected ? 'rgba(14,165,233,0.12)' : '#111',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{width:'100%', height: PROMPT_GRABBER_UI.thumbHeightPx, borderRadius: 10, overflow:'hidden', background:'#000', position:'relative'}}>
                      {(thumb || fallbackSrc) ? (
                        <img
                          src={thumb || fallbackSrc}
                          alt={name}
                          loading="lazy"
                          onError={(e) => {
                            try {
                              ;(e.currentTarget as any).style.visibility = 'hidden'
                            } catch {}
                          }}
                          style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}}
                        />
                      ) : (
                        <div style={{width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#666', fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                          {kind || 'file'}
                        </div>
                      )}
                    </div>
                    <div style={{fontSize: 9, color:'#e4e4e7', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{name}</div>
                  </button>
                )
              })}
              {(pgItems || []).length === 0 && (
                <div style={{color:'#666', fontSize: PROMPT_GRABBER_UI.controlFontPx, padding: 8}}>
                  {lang === 'id' ? 'Belum ada file. Klik Scan.' : 'No files yet. Click Scan.'}
                </div>
              )}
            </div>

            <div style={{display:'grid', gridTemplateColumns:'120px 1fr 120px 1fr', gap:'8px 12px', alignItems:'center', marginBottom:10}}>
              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>{lang === 'id' ? 'Platform' : 'Platform'}</div>
              <select value={pgPlatform} onChange={(e)=>setPgPlatform(String(e.target.value || 'Midjourney'))} disabled={pgScanning || pgGenerating} style={{width:'100%', padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                <option value="Midjourney">Midjourney</option>
                <option value="Stable Diffusion">Stable Diffusion</option>
                <option value="DALL·E">DALL·E</option>
                <option value="Kling/Runway">Kling/Runway</option>
                <option value="Universal">Universal</option>
              </select>

              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>{lang === 'id' ? 'Detail' : 'Detail'}</div>
              <select value={pgDetailLevel} onChange={(e)=>setPgDetailLevel(String(e.target.value || 'Detail'))} disabled={pgScanning || pgGenerating} style={{width:'100%', padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                <option value="Singkat">{lang === 'id' ? 'Singkat' : 'Short'}</option>
                <option value="Detail">{lang === 'id' ? 'Detail' : 'Detailed'}</option>
                <option value="Sangat Detail">{lang === 'id' ? 'Sangat Detail' : 'Very detailed'}</option>
              </select>

              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>{lang === 'id' ? 'Bahasa' : 'Language'}</div>
              <select value={pgLanguage} onChange={(e)=>setPgLanguage(String(e.target.value || 'English'))} disabled={pgScanning || pgGenerating} style={{gridColumn:'2 / span 3', width:'100%', padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                <option value="English">English</option>
                <option value="Bilingual (EN+ID)">Bilingual (EN+ID)</option>
              </select>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:12, alignItems:'start', marginBottom:10}}>
              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx, paddingTop:6}}>{lang === 'id' ? 'Instruksi tambahan' : 'Extra instructions'}</div>
              <textarea value={pgExtraPrompt} onChange={(e)=>setPgExtraPrompt(String(e.target.value || ''))} disabled={pgScanning || pgGenerating} rows={3} style={{width:'100%', padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, resize:'vertical', fontSize: PROMPT_GRABBER_UI.controlFontPx}} />
            </div>

            <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:12, alignItems:'center', marginBottom:10}}>
              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx}}>{lang === 'id' ? 'Opsi output' : 'Output options'}</div>
              <label style={{display:'flex', alignItems:'center', gap:8, color:'#ccc', fontSize: PROMPT_GRABBER_UI.controlFontPx}}>
                <input type="checkbox" checked={pgIncludeFilenameHeader} onChange={(e)=>setPgIncludeFilenameHeader(e.target.checked)} disabled={pgScanning || pgGenerating} />
                <span>{lang === 'id' ? 'Tampilkan nama file di atas setiap prompt' : 'Show filename header for each prompt'}</span>
              </label>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:12, alignItems:'start'}}>
              <div style={{color:'#ccc', fontSize: PROMPT_GRABBER_UI.labelFontPx, paddingTop:6}}>{lang === 'id' ? 'Output' : 'Output'}</div>
              <textarea value={pgOutputText} readOnly rows={6} style={{width:'100%', padding: PROMPT_GRABBER_UI.inputPaddingPx, background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, resize:'vertical', fontSize: PROMPT_GRABBER_UI.controlFontPx}} />
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', gap:8, padding:'12px 16px', borderTop:'1px solid #333'}}>
            <div style={{display:'flex', gap:8}}>
              <button onClick={copyPromptGrabberOutput} disabled={pgGenerating || pgScanning || !String(pgOutputText || '').trim()} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Copy output' : 'Copy output'}
              </button>
              <button onClick={savePromptGrabberTxt} disabled={pgGenerating || pgScanning || !String(pgOutputText || '').trim() || !String(pgInputDir || '').trim()} style={{ padding: '8px 10px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                .TXT
              </button>
              <button onClick={savePromptGrabberCsv} disabled={pgGenerating || pgScanning || (Array.isArray(pgLastResults) ? pgLastResults.length : 0) === 0 || !String(pgInputDir || '').trim()} style={{ padding: '8px 10px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                .CSV
              </button>
              <button onClick={clearPromptGrabberOutput} disabled={pgGenerating || pgScanning || !String(pgOutputText || '').trim()} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Bersihkan' : 'Clear'}
              </button>
            </div>
            <div style={{display:'flex', gap:8}}>
              <button onClick={()=>setShowPromptGrabberModal(false)} disabled={pgScanning || pgGenerating} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Tutup' : 'Close'}
              </button>
              <button onClick={cancelPromptGrabber} disabled={!pgGenerating} style={{ padding: '8px 12px', background: '#6b7280', color: '#fff', border: '1px solid #6b7280', borderRadius: 6, cursor: pgGenerating ? 'pointer' : 'not-allowed', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {lang === 'id' ? 'Stop' : 'Stop'}
              </button>
              <button onClick={runPromptGrabberGenerate} disabled={pgGenerating || pgScanning || Object.keys(pgSelected || {}).filter(k => (pgSelected as any)[k]).length === 0} style={{ padding: '8px 12px', background: pgGenerating ? '#1f2937' : '#22c55e', color: '#fff', border: '1px solid #22c55e', borderRadius: 6, cursor: pgGenerating ? 'not-allowed' : 'pointer', fontSize: PROMPT_GRABBER_UI.controlFontPx }}>
                {pgGenerating ? (lang === 'id' ? 'Generating...' : 'Generating...') : (lang === 'id' ? 'Generate' : 'Generate')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
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

    {showConvertModal && (
      <div className="modal open" style={{zIndex: 9999}}>
        <div className="modal-content">
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>{toolT?.convertHeading || 'Convert Media'}</div>
            <button className="icon-btn" onClick={()=>setShowConvertModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{padding:16}}>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.convertInputFolder || 'Input Folder'}</div>
              <div style={{flex:1, minWidth:0}} title={convertInputDir || 'No folder selected'}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {convertInputDir || 'No folder selected'}
                </div>
              </div>
              <button onClick={pickConvertInputFolder} className="btn-browse" disabled={convertRunning}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.convertOutputFolder || 'Output Folder'}</div>
              <div style={{flex:1, minWidth:0}} title={convertOutputDir || 'No folder selected'}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {convertOutputDir || 'No folder selected'}
                </div>
              </div>
              <button onClick={pickConvertOutputFolder} className="btn-browse" disabled={convertRunning}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}></div>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <input type="checkbox" checked={convertDeleteOriginal} onChange={(e)=>setConvertDeleteOriginal(e.target.checked)} disabled={convertRunning} />
                <span style={{color:'#ccc', fontSize:12}}>{toolT?.convertDeleteOriginal || (lang === 'id' ? 'Hapus file asli setelah berhasil' : 'Delete original files after success')}</span>
              </div>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.convertFormat || 'Output Format'}</div>
              {(() => {
                const fallback = ['jpeg','jpg','png','webp','gif','tiff','tif','bmp','heic','heif','avif','jp2','j2k','jxl','svg','pdf','psd','ico','tga']
                const opts = (convertFormatOptions && convertFormatOptions.length) ? convertFormatOptions : fallback
                const val = String(convertFormat || '').trim().toLowerCase()
                const finalOpts = val && !opts.includes(val) ? [val, ...opts] : opts
                return (
                  <select
                    value={val || (finalOpts[0] || 'jpeg')}
                    onChange={(e)=>setConvertFormat(String(e.target.value || '').trim())}
                    disabled={convertRunning}
                    style={{width:220, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}}
                  >
                    {finalOpts.map((fmt) => (
                      <option key={fmt} value={fmt}>{fmt}</option>
                    ))}
                  </select>
                )
              })()}
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.convertQuality || 'Quality'}</div>
              <input type="number" min={1} max={100} value={convertQuality} onChange={(e)=>setConvertQuality(Math.max(1, Math.min(100, Number(e.target.value || 0))))} disabled={convertRunning} style={{width:80, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}} />
              <span style={{color:'#71717a', fontSize:12}}>%</span>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, padding:'12px 16px', borderTop:'1px solid #333'}}>
            <button onClick={()=>setShowConvertModal(false)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>{t?.dashboard?.dupModal?.close || 'Close'}</button>
            <button onClick={runConvert} disabled={convertRunning || !convertInputDir || !convertOutputDir || !String(convertFormat || '').trim()} style={{ padding: '10px 14px', background: convertRunning ? '#1f2937' : '#f59e0b', color: '#fff', border: '1px solid #f59e0b', borderRadius: 6, cursor: convertRunning ? 'not-allowed' : 'pointer' }}>{convertRunning ? (toolT?.convertRunning || 'Converting...') : (toolT?.convertStart || 'Start Convert')}</button>
          </div>
        </div>
      </div>
    )}

    {showResizeModal && (
      <div className="modal open" style={{zIndex: 9999}}>
        <div className="modal-content">
          <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>{toolT?.resizeHeading || 'Resize Media'}</div>
            <button className="icon-btn" onClick={()=>setShowResizeModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{padding:16}}>
            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeInputFolder || 'Input Folder'}</div>
              <div style={{flex:1, minWidth:0}} title={resizeInputDir || 'No folder selected'}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {resizeInputDir || 'No folder selected'}
                </div>
              </div>
              <button onClick={pickResizeInputFolder} className="btn-browse" disabled={resizeRunning}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeOutputFolder || 'Output Folder'}</div>
              <div style={{flex:1, minWidth:0}} title={resizeOutputDir || 'No folder selected'}>
                <div style={{padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {resizeOutputDir || 'No folder selected'}
                </div>
              </div>
              <button onClick={pickResizeOutputFolder} className="btn-browse" disabled={resizeRunning}>{t?.dashboard?.dupModal?.browse || 'Browse'}</button>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}></div>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <input type="checkbox" checked={resizeDeleteOriginal} onChange={(e)=>setResizeDeleteOriginal(e.target.checked)} disabled={resizeRunning} />
                <span style={{color:'#ccc', fontSize:12}}>
                  {toolT?.resizeDeleteOriginal || (lang === 'id' ? 'Hapus file asli setelah berhasil' : 'Delete original files after success')}
                </span>
              </div>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeWidth || 'Width'}</div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={resizeWidth}
                onFocus={(e)=>e.currentTarget.select()}
                onChange={(e)=>{
                  const raw = String(e.target.value || '')
                  const next = raw.replace(/[^\d]/g, '')
                  setResizeWidth(next)
                }}
                onBlur={()=>{
                  const n = Math.max(1, Math.min(10000, Math.round(Number(String(resizeWidth || '').trim())) || 0))
                  setResizeWidth(String(n))
                }}
                disabled={resizeRunning}
                style={{width:100, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}}
              />
              <span style={{color:'#71717a', fontSize:12}}>px</span>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeHeight || 'Height'}</div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={resizeHeight}
                onFocus={(e)=>e.currentTarget.select()}
                onChange={(e)=>{
                  const raw = String(e.target.value || '')
                  const next = raw.replace(/[^\d]/g, '')
                  setResizeHeight(next)
                }}
                onBlur={()=>{
                  const n = Math.max(1, Math.min(10000, Math.round(Number(String(resizeHeight || '').trim())) || 0))
                  setResizeHeight(String(n))
                }}
                disabled={resizeRunning}
                style={{width:100, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}}
              />
              <span style={{color:'#71717a', fontSize:12}}>px</span>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeKeepAspect || 'Keep Aspect Ratio'}</div>
              <input type="checkbox" checked={resizeKeepAspect} onChange={(e)=>setResizeKeepAspect(e.target.checked)} disabled={resizeRunning} />
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeFormat || 'Output Format'}</div>
              <select value={resizeFormat} onChange={(e)=>setResizeFormat(e.target.value)} disabled={resizeRunning} style={{width:120, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}}>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="gif">GIF</option>
              </select>
            </div>

            <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:12}}>
              <div style={{minWidth:140, color:'#ccc'}}>{toolT?.resizeQuality || 'Quality'}</div>
              <input type="number" min={1} max={100} value={resizeQuality} onChange={(e)=>setResizeQuality(Math.max(1, Math.min(100, Number(e.target.value || 0))))} disabled={resizeRunning} style={{width:80, padding:'8px', background:'#0b0b0b', border:'1px solid #222', color:'#fff', borderRadius:6}} />
              <span style={{color:'#71717a', fontSize:12}}>%</span>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, padding:'12px 16px', borderTop:'1px solid #333'}}>
            <button onClick={()=>setShowResizeModal(false)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>{t?.dashboard?.dupModal?.close || 'Close'}</button>
            <button onClick={runResize} disabled={resizeRunning || !resizeInputDir || !resizeOutputDir} style={{ padding: '10px 14px', background: resizeRunning ? '#1f2937' : '#ec4899', color: '#fff', border: '1px solid #ec4899', borderRadius: 6, cursor: resizeRunning ? 'not-allowed' : 'pointer' }}>{resizeRunning ? (toolT?.resizeRunning || 'Resizing...') : (toolT?.resizeStart || 'Start Resize')}</button>
          </div>
        </div>
      </div>
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
            onOpenLicenseSupport={() => {
              setShowHelp(false)
              setSupportSuccess('')
              setSupportError('')
              setSupportOpen(true)
            }}
        />
    )}

    {supportOpen && (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 10002,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}
        onClick={() => { if (!supportBusy) setSupportOpen(false) }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: '#18181b',
            border: '1px solid #27272a',
            borderRadius: 16,
            padding: 22,
            maxWidth: 520,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)'
          }}
        >
          <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
            {lang === 'id' ? 'Pusat Bantuan: Klaim Lisensi' : 'Help Center: License Claim'}
          </div>
          <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.5, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
            {lang === 'id'
              ? 'Gunakan ini jika email pembelian salah ketik atau tidak menerima email kode.\nIsi email pembelian yang tertulis di invoice Lynk, lalu admin akan cek webhook dan mengikat lisensi ke email akun Anda.'
              : 'Use this if purchase email is mistyped or you did not receive the license email.\nFill the purchase email shown on Lynk invoice, then admin will verify webhook data and rebind the license to your account email.'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {lang === 'id' ? 'Email pembelian (di invoice Lynk)' : 'Purchase email (from Lynk invoice)'}
              </div>
              <input
                value={supportPurchaseEmail}
                onChange={(e) => setSupportPurchaseEmail(e.target.value)}
                disabled={supportBusy}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: supportError ? '1px solid #ef4444' : '1px solid #27272a',
                  color: '#fff',
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  {lang === 'id' ? 'Produk' : 'Product'}
                </div>
                <select
                  value={supportProductCode}
                  onChange={(e) => setSupportProductCode(e.target.value === 'prompt_grabber' ? 'prompt_grabber' : 'license')}
                  disabled={supportBusy}
                  style={{
                    width: '100%',
                    background: '#0f0f12',
                    border: '1px solid #27272a',
                    color: '#fff',
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="license">{lang === 'id' ? 'Lisensi Aplikasi' : 'App License'}</option>
                  <option value="prompt_grabber">{lang === 'id' ? 'Tools Prompt Grabber' : 'Prompt Grabber Tool'}</option>
                </select>
              </div>
              <div>
                <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  {lang === 'id' ? 'Nominal (opsional)' : 'Amount (optional)'}
                </div>
                <input
                  value={supportAmountHint}
                  onChange={(e) => setSupportAmountHint(e.target.value)}
                  disabled={supportBusy}
                  placeholder={lang === 'id' ? 'Contoh: 149000 / Rp 149.000' : 'Example: 149000 / Rp 149.000'}
                  style={{
                    width: '100%',
                    background: '#0f0f12',
                    border: '1px solid #27272a',
                    color: '#fff',
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {lang === 'id' ? 'Perkiraan waktu pembelian (opsional)' : 'Approx purchase time (optional)'}
              </div>
              <input
                value={supportPurchaseTimeHint}
                onChange={(e) => setSupportPurchaseTimeHint(e.target.value)}
                disabled={supportBusy}
                placeholder={lang === 'id' ? 'Contoh: 14 Mei 2026 10:30 WIB' : 'Example: May 14 2026 10:30 WIB'}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: '1px solid #27272a',
                  color: '#fff',
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {lang === 'id' ? 'Catatan (opsional)' : 'Notes (optional)'}
              </div>
              <textarea
                value={supportNote}
                onChange={(e) => setSupportNote(e.target.value)}
                disabled={supportBusy}
                rows={4}
                placeholder={lang === 'id'
                  ? 'Tuliskan detail tambahan. Jika perlu, siapkan screenshot invoice untuk admin.'
                  : 'Add extra details. If needed, prepare invoice screenshot for admin.'}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: '1px solid #27272a',
                  color: '#fff',
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#e4e4e7', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {lang === 'id' ? 'Link bukti (opsional)' : 'Evidence link (optional)'}
              </div>
              <input
                value={supportEvidenceLink}
                onChange={(e) => setSupportEvidenceLink(e.target.value)}
                disabled={supportBusy}
                placeholder={lang === 'id' ? 'Contoh: link Google Drive / Dropbox' : 'Example: Google Drive / Dropbox link'}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: '1px solid #27272a',
                  color: '#fff',
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {supportError ? (
            <div style={{ color: '#f87171', fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>
              {supportError}
            </div>
          ) : null}
          {supportSuccess ? (
            <div style={{ color: '#34d399', fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>
              {supportSuccess}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              className="btn-click-anim"
              onClick={() => { if (!supportBusy) setSupportOpen(false) }}
              disabled={supportBusy}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: 'transparent',
                color: '#fff',
                border: '1px solid #3f3f46',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: supportBusy ? 'not-allowed' : 'pointer',
                opacity: supportBusy ? 0.6 : 1
              }}
            >
              {lang === 'id' ? 'Tutup' : 'Close'}
            </button>
            <button
              className="btn-click-anim"
              onClick={() => { void submitLicenseSupport() }}
              disabled={supportBusy}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                cursor: supportBusy ? 'not-allowed' : 'pointer',
                opacity: supportBusy ? 0.7 : 1
              }}
            >
              {supportBusy ? (lang === 'id' ? 'Mengirim...' : 'Submitting...') : (lang === 'id' ? 'Kirim' : 'Submit')}
            </button>
          </div>
        </div>
      </div>
    )}

    {pgMinimized && (
      <div style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 10002,
        background: '#18181b',
        border: '1px solid #27272a',
        borderRadius: 12,
        padding: '10px 12px',
        minWidth: 260,
        maxWidth: 360,
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }}>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 12, fontWeight: 700, color: '#fff'}}>Prompt Grabber</div>
          <div style={{fontSize: 11, color: '#a1a1aa', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
            {pgMiniStatus === 'running'
              ? (lang === 'id' ? 'Sedang generate... lihat Logs' : 'Generating... see Logs')
              : pgMiniStatus === 'done'
                ? (lang === 'id' ? 'Selesai. Klik Open untuk lihat output' : 'Done. Click Open to view output')
                : (lang === 'id' ? 'Siap' : 'Ready')}
          </div>
        </div>
        <button
          onClick={() => { setShowPromptGrabberModal(true); setPgMinimized(false) }}
          style={{ padding: '8px 10px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
        >
          Open
        </button>
        <button
          onClick={() => { if (pgGenerating) { void cancelPromptGrabber() } else { setPgMinimized(false); setPgMiniStatus('idle') } }}
          style={{ padding: '8px 10px', background: pgGenerating ? '#6b7280' : '#333', color: '#fff', border: '1px solid #444', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
        >
          {pgGenerating ? (lang === 'id' ? 'Stop' : 'Stop') : (lang === 'id' ? 'Tutup' : 'Close')}
        </button>
      </div>
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
