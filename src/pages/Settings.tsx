import React, { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open as pick } from '@tauri-apps/api/dialog'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { encryptApiKey, decryptApiKey } from '../utils/crypto'
import { logAudit } from '../utils/audit'
import { getApiUrl, getTokenLocal } from '../api/backend'
import TopUpModal from '../components/TopUpModal'

export default function Settings({onBack, embedded, onSave}:{onBack:()=>void, embedded?: boolean, onSave?:()=>void}){
  const [server,setServer]=useState('')
  const [model,setModel]=useState('gemini-2.0-flash-exp')
  const [overwrite,setOverwrite]=useState(true)
  const [csv,setCsv]=useState('')
  const [logs,setLogs]=useState('')
  const [input,setInput]=useState('')
  const [output,setOutput]=useState('')
  const [threads,setThreads]=useState(4)
  const [retry,setRetry]=useState(1)
  const [tmin,setTmin]=useState(5)
  const [tmax,setTmax]=useState(13)
  const [dmin,setDmin]=useState(80)
  const [dmax,setDmax]=useState(200)
  const [kmin,setKmin]=useState(35)
  const [kmax,setKmax]=useState(49)
  const [banned,setBanned]=useState('')
  const [provider,setProvider]=useState('Gemini')
  const [loaded, setLoaded] = useState(false)
  const [selectionEnabled, setSelectionEnabled] = useState(false)
  // // const [checkAnatomyDefect, setCheckAnatomyDefect] = useState(false)
  const [checkHumanAnimalSimilarity, setCheckHumanAnimalSimilarity] = useState(false)
  const [checkHumanPresence, setCheckHumanPresence] = useState(false)
  const [checkAnimalPresence, setCheckAnimalPresence] = useState(false)
  const [checkDeformedObject, setCheckDeformedObject] = useState(false)
  const [checkUnrecognizableSubject, setCheckUnrecognizableSubject] = useState(false)
  const [checkTextOrTextLike, setCheckTextOrTextLike] = useState(false)
  const [checkBrandLogo, setCheckBrandLogo] = useState(false)
  const [checkFamousTrademark, setCheckFamousTrademark] = useState(false)
  const [checkWatermark, setCheckWatermark] = useState(false)
  const [checkDuplicateSimilarity, setCheckDuplicateSimilarity] = useState(false)
  
  // Text Sub-options
  const [textFilterGibberish, setTextFilterGibberish] = useState(false)
  const [textFilterNonEnglish, setTextFilterNonEnglish] = useState(false)
  const [textFilterIrrelevant, setTextFilterIrrelevant] = useState(false)
  const [textFilterRelevant, setTextFilterRelevant] = useState(false)

  // Human Sub-options
  const [humanFilterFullFace, setHumanFilterFullFace] = useState(false)
  const [humanFilterNoHead, setHumanFilterNoHead] = useState(false)
  const [humanFilterPartialPerfect, setHumanFilterPartialPerfect] = useState(false)
  const [humanFilterPartialDefect, setHumanFilterPartialDefect] = useState(false)
  const [humanFilterBackView, setHumanFilterBackView] = useState(false)
  const [humanFilterUnclear, setHumanFilterUnclear] = useState(false)
  const [humanFilterFaceOnly, setHumanFilterFaceOnly] = useState(false)
  const [humanFilterNudity, setHumanFilterNudity] = useState(false)

  // Animal Sub-options
  const [animalFilterFullFace, setAnimalFilterFullFace] = useState(false)
  const [animalFilterNoHead, setAnimalFilterNoHead] = useState(false)
  const [animalFilterPartialPerfect, setAnimalFilterPartialPerfect] = useState(false)
  const [animalFilterPartialDefect, setAnimalFilterPartialDefect] = useState(false)
  const [animalFilterBackView, setAnimalFilterBackView] = useState(false)
  const [animalFilterUnclear, setAnimalFilterUnclear] = useState(false)
  const [animalFilterFaceOnly, setAnimalFilterFaceOnly] = useState(false)
  const [animalFilterNudity, setAnimalFilterNudity] = useState(false)

  const [enableQualityFilter] = useState(false)
  const [qualityBlurMin] = useState(80)
  const [qualityNoiseMax] = useState(18)
  const [qualityLumaMin] = useState(25)
  const [qualityLumaMax] = useState(235)
  const [duplicateMaxDistance, setDuplicateMaxDistance] = useState(5)
  const [selectionOrder, setSelectionOrder] = useState<'before'|'after'>('before')
  const [generateCsv, setGenerateCsv] = useState(true)

  // Rename Options
  const [renameEnabled, setRenameEnabled] = useState(false)
  const [renameMode, setRenameMode] = useState('title')
  const [renameCustomText, setRenameCustomText] = useState('')

  // Dual Connection States
  const [connectionMode, setConnectionMode] = useState<'server'|'direct'>('server')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyEncrypted, setApiKeyEncrypted] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<{is_active:boolean, expiry?:string}>({is_active:false})
  const [showSubPopup, setShowSubPopup] = useState(false)
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [topUpInitialTab, setTopUpInitialTab] = useState<'topup'|'redeem'>('topup')
  const [topUpPurchaseType, setTopUpPurchaseType] = useState<'token'|'subscription'>('token')
  const [userId, setUserId] = useState('')
  const [successNotification, setSuccessNotification] = useState<{ type: 'token' | 'subscription', amount?: number, expiry?: string, source?: 'paypal' | 'voucher' } | null>(null)
  const [tokenActive, setTokenActive] = useState(false) // Assuming server token is active if loaded
  const [isApiKeyFocused, setIsApiKeyFocused] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')
  const [usdRate, setUsdRate] = useState<number>(0)
  
  const [inputError, setInputError] = useState(false)
  const [outputError, setOutputError] = useState(false)
  const [toast, setToast] = useState<{text: string, type: 'success'|'error'|'info'} | null>(null)

  function showToast(text: string, type: 'success'|'error'|'info' = 'info'){
    setToast({ text, type })
    window.setTimeout(() => {
      setToast(cur => (cur && cur.text === text ? null : cur))
    }, 2200)
  }

  const pressHandlers = {
    onMouseEnter:(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.filter = 'brightness(1.05)'; },
    onMouseLeave:(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'none'; },
    onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(0.98)'; e.currentTarget.style.transition = 'transform 120ms ease'; },
    onMouseUp:   (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(1)'; }
  }

  const openaiModels=[
    {label:'GPT-4.1', value:'gpt-4.1'},
    {label:'GPT-4.1 Mini', value:'gpt-4.1-mini'},
    {label:'GPT-4.1 Distilled', value:'gpt-4.1-distilled'},
    {label:'GPT-5.1', value:'gpt-5.1'},
    {label:'GPT-5.1 Mini', value:'gpt-5.1-mini'},
    {label:'GPT-5.1 Instant', value:'gpt-5.1-instant'},
    {label:'GPT-4o', value:'gpt-4o'},
    {label:'GPT-4o Mini', value:'gpt-4o-mini'},
    {label:'o1', value:'o1'},
    {label:'o3', value:'o3'},
    {label:'o4-mini', value:'o4-mini'},
    {label:'GPT-4 Turbo', value:'gpt-4-turbo'}
  ]
  const geminiModels=[
    {label:'Gemini 3.0 Flash (Preview)', value:'gemini-3.0-flash-preview'},
    {label:'Gemini 3.0 Pro (Preview)', value:'gemini-3.0-pro-preview'},
    {label:'Gemini 3.0 Ultra', value:'gemini-3.0-ultra'},
    {label:'Gemini 2.5 Pro', value:'gemini-2.5-pro'},
    {label:'Gemini 2.5 Flash', value:'gemini-2.5-flash'},
    {label:'Gemini 2.5 Flash-Lite', value:'gemini-2.5-flash-lite'},
    {label:'Gemini 2.5 Ultra', value:'gemini-2.5-ultra'},
    {label:'Gemini 2.0 Pro', value:'gemini-2.0-pro-exp-02-05'},
    {label:'Gemini 2.0 Ultra', value:'gemini-2.0-ultra'},
    {label:'Gemini 2.0 Flash', value:'gemini-2.0-flash-exp'},
    {label:'Gemini 2.0 Flash Lite', value:'gemini-2.0-flash-lite-preview-02-05'},
    {label:'Gemini 1.5 Pro', value:'gemini-1.5-pro-002'},
    {label:'Gemini 1.5 Flash', value:'gemini-1.5-flash-002'},
    {label:'Gemini 1.5 Flash-8B', value:'gemini-1.5-flash-8b'},
    {label:'Gemini 1.0 Pro', value:'gemini-1.0-pro'}
  ]

  const [fetchedModels, setFetchedModels] = useState<any[]>([])

  useEffect(() => {
    // Fetch models from DB
    async function fetchModels() {
       try {
         const apiUrl = await getApiUrl();
         const token = getTokenLocal();
         if (!token) return;
         // Use the same endpoint as AdminTopup
         const res = await fetch(`${apiUrl}/admin/model-prices`, {
            headers: { 'Authorization': `Bearer ${token}` }
         });
         if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setFetchedModels(data.data);
            }
         }
       } catch (e) { console.error("Failed to fetch models", e); }
    }
    fetchModels();
  }, [])

  const getModels = (p: string) => {
     // Filter models from DB for this provider
     const dbModels = fetchedModels
        .filter(m => m.provider.toLowerCase() === p.toLowerCase() && m.active)
        .map(m => ({label: m.model_name, value: m.model_name}));
     
     // Merge with hardcoded if DB is empty or just use DB?
     // Better to use DB if available, else fallback
     if (dbModels.length > 0) {
        // Optional: Deduplicate if needed, but for now just return DB models
        return dbModels;
     }
     
     if (p === 'OpenAI') return openaiModels;
     if (p === 'Gemini') return geminiModels;
     return [];
  }

  useEffect(()=>{ load(); checkSub(); },[])

  // Validate folders
  useEffect(() => {
     if(input) invoke('file_exists', {path: input}).then((e:any) => setInputError(!e))
     else setInputError(false)
     
     if(output) invoke('file_exists', {path: output}).then((e:any) => setOutputError(!e))
     else setOutputError(false)
  }, [input, output])

  // Check subscription on mount and when connection mode changes
  useEffect(() => {
      checkSub(); // Always check sub status on load to enable toggle if eligible
      
      if (connectionMode === 'direct') {
      // Load API Key from local storage if exists
      const savedKey = localStorage.getItem('metabayn_api_key_enc')
      const savedIv = localStorage.getItem('metabayn_api_key_iv')
      if (savedKey && savedIv) {
        decryptApiKey(savedKey, savedIv).then(k => {
            setApiKey(k)
            setApiKeyEncrypted(savedKey)
        }).catch(e => console.error("Failed to decrypt API key", e))
      }
    }
  }, [connectionMode])

  async function checkSub() {
    let status = { is_active: false, expiry: undefined as string | undefined };
    try {
        const apiUrl = await getApiUrl();
        const token = getTokenLocal();
        
        if (token) {
            try {
                const res = await fetch(`${apiUrl}/user/me`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.id) setUserId(data.id);
                    
                    let isActive = !!data.subscription_active;
                    if (isActive && data.subscription_expiry) {
                        const expiry = new Date(data.subscription_expiry);
                        const now = new Date();
                        if (expiry < now) {
                            isActive = false; // Expired
                        }
                    }

                    status = {
                        is_active: isActive,
                        expiry: data.subscription_expiry
                    };
                }
            } catch (e) {
                console.error("Failed to fetch subscription from API", e);
            }
        }

        setSubscriptionStatus(status)
        if (!status.is_active) {
            // User requirement: "Sistem otomatis menonaktifkan toggle"
            if (connectionMode === 'direct') {
                setConnectionMode('server');
                setShowSubPopup(true); // Let user know why it switched back
            }
        }
    } catch (e) {
        console.error("Failed to check subscription", e)
    }
    return status;
  }

  useEffect(() => {
    async function fetchUsdRate() {
      try {
        const apiUrl = await getApiUrl();
        const token = getTokenLocal();
        if (!token) return;
        const res = await fetch(`${apiUrl}/token/balance`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (data && typeof data.usd_rate === 'number') {
          setUsdRate(data.usd_rate);
        }
      } catch (e) {}
    }
    fetchUsdRate();
  }, [showTopUpModal])

  const [testingConnection, setTestingConnection] = useState(false)

  async function testConnection() {
      if (!apiKey.trim()) {
          showToast('API key is empty', 'error')
          return
      }
      if (apiKeyError) {
          showToast(apiKeyError, 'error')
          return
      }
      setTestingConnection(true)
      try {
          const res = await invoke<string>('test_api_connection', { provider, apiKey })
          showToast(res === 'Success' ? 'Connected successfully' : `Connected: ${res}`, 'success')
      } catch (e:any) {
          const msg = String(e).replace('Error: ', '')
          showToast(`Connection failed: ${msg}`, 'error')
      } finally {
          setTestingConnection(false)
      }
  }

  async function saveApiKey() {
      // Validate format
      if (apiKey.trim().length < 5) {
          showToast('API Key tidak valid', 'error')
          return
      }
      if (provider === 'OpenAI' && !apiKey.startsWith('sk-proj-')) {
          showToast('OpenAI API keys must start with sk-proj-', 'error')
          return
      }

      try {
          const { iv, data } = await encryptApiKey(apiKey, "user-secret") // Using fixed secret for now or generate
          localStorage.setItem('metabayn_api_key_enc', data)
          localStorage.setItem('metabayn_api_key_iv', iv)
          setApiKeyEncrypted(data)
          logAudit('ApiKeyUsage', 'Save API Key', 'Success');
          showToast('API key saved', 'success')
      } catch (e:any) {
          logAudit('Error', 'Save API Key Failed', String(e));
          showToast(`Failed to save API key: ${String(e).replace('Error: ', '')}`, 'error')
      }
  }

  function clearApiKey() {
      localStorage.removeItem('metabayn_api_key_enc')
      localStorage.removeItem('metabayn_api_key_iv')
      setApiKey('')
      setApiKeyEncrypted('')
  }

  async function load(){
    try {
      const s=await invoke<any>('get_settings')
      setServer(s.server_url||''); 
      // Ensure model is set correctly, fallback to a valid default if needed
      setModel(s.default_model||'gemini-2.0-flash-lite-preview-02-05'); 
      setOverwrite(true); setCsv(''); setLogs('')
      setInput(s.input_folder||''); setOutput(s.output_folder||''); setThreads(Number(s.max_threads||4)); setRetry(Number(s.retry_count||1))
      setTmin(Number(s.title_min_words||5)); setTmax(Number(s.title_max_words||13)); setDmin(Number(s.description_min_chars||80)); setDmax(Number(s.description_max_chars||200))
      setKmin(Number(s.keywords_min_count||35)); setKmax(Number(s.keywords_max_count||49)); setBanned(s.banned_words||'')
      setProvider(s.ai_provider||'Gemini')
      setSelectionEnabled(!!s.selection_enabled)
      // setCheckAnatomyDefect(!!s.check_anatomy_defect)
      setCheckHumanAnimalSimilarity(!!s.check_human_animal_similarity)
      setCheckHumanPresence(!!s.check_human_presence)
      setCheckAnimalPresence(!!s.check_animal_presence)
      
      // Text
      setTextFilterGibberish(!!s.text_filter_gibberish)
      setTextFilterNonEnglish(!!s.text_filter_non_english)
      setTextFilterIrrelevant(!!s.text_filter_irrelevant)
      setTextFilterRelevant(!!s.text_filter_relevant)

      // Human
      setHumanFilterFullFace(!!s.human_filter_full_face)
      setHumanFilterNoHead(!!s.human_filter_no_head)
      setHumanFilterPartialPerfect(!!s.human_filter_partial_perfect)
      setHumanFilterPartialDefect(!!s.human_filter_partial_defect)
      setHumanFilterBackView(!!s.human_filter_back_view)
      setHumanFilterUnclear(!!s.human_filter_unclear)
      setHumanFilterFaceOnly(!!s.human_filter_face_only)
      setHumanFilterNudity(!!s.human_filter_nudity)

      // Animal
      setAnimalFilterFullFace(!!s.animal_filter_full_face)
      setAnimalFilterNoHead(!!s.animal_filter_no_head)
      setAnimalFilterPartialPerfect(!!s.animal_filter_partial_perfect)
      setAnimalFilterPartialDefect(!!s.animal_filter_partial_defect)
      setAnimalFilterBackView(!!s.animal_filter_back_view)
      setAnimalFilterUnclear(!!s.animal_filter_unclear)
      setAnimalFilterFaceOnly(!!s.animal_filter_face_only)
      setAnimalFilterNudity(!!s.animal_filter_nudity)

      setCheckDeformedObject(!!s.check_deformed_object)
      setCheckUnrecognizableSubject(!!s.check_unrecognizable_subject)
      setCheckTextOrTextLike(!!s.check_text_or_text_like)
      setCheckBrandLogo(!!s.check_brand_logo)
      setCheckFamousTrademark(!!s.check_famous_trademark)
      setCheckWatermark(!!s.check_watermark)
      setCheckDuplicateSimilarity(!!s.check_duplicate_similarity)
      setDuplicateMaxDistance(Number(s.duplicate_max_hamming_distance || 4))
      setSelectionOrder(String(s.selection_order||'before') === 'after' ? 'after' : 'before')
      setGenerateCsv(s.generate_csv !== false)
      setRenameEnabled(!!s.rename_enabled)
      setRenameMode(s.rename_mode || 'title')
      setRenameCustomText(s.rename_custom_text || '')
      setConnectionMode(s.connection_mode === 'direct' ? 'direct' : 'server')
      setTokenActive(!!s.auth_token)
      setLoaded(true)
    } catch(e) {
      console.error(e)
      setLoaded(true)
    }
  }

  // Auto-save effect
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      saveSilent()
    }, 400)
    return () => clearTimeout(timer)
  }, [server, model, input, output, threads, retry, tmin, tmax, dmin, dmax, kmin, kmax, banned, provider, selectionEnabled, /*checkAnatomyDefect,*/ checkHumanAnimalSimilarity, checkHumanPresence, checkAnimalPresence, checkDeformedObject, checkUnrecognizableSubject, checkTextOrTextLike, checkBrandLogo, checkFamousTrademark, checkWatermark, checkDuplicateSimilarity, qualityBlurMin, qualityNoiseMax, qualityLumaMin, qualityLumaMax, duplicateMaxDistance, selectionOrder, connectionMode, loaded, generateCsv,
      renameEnabled, renameMode, renameCustomText,
      textFilterGibberish, textFilterNonEnglish, textFilterIrrelevant, textFilterRelevant,
      humanFilterFullFace, humanFilterNoHead, humanFilterPartialPerfect, humanFilterPartialDefect, humanFilterBackView, humanFilterUnclear, humanFilterFaceOnly, humanFilterNudity,
      animalFilterFullFace, animalFilterNoHead, animalFilterPartialPerfect, animalFilterPartialDefect, animalFilterBackView, animalFilterUnclear, animalFilterFaceOnly, animalFilterNudity
  ])

  async function saveSilent(overrides:any = {}){
    const s_input = overrides.input_folder !== undefined ? overrides.input_folder : input
    const s_output = overrides.output_folder !== undefined ? overrides.output_folder : output
    const csvOut = s_output ? (s_output.endsWith('\\')||s_output.endsWith('/') ? (s_output + 'metabayn.csv') : (s_output + (s_output.includes('\\') ? '\\' : '/') + 'metabayn.csv')) : ''
    await invoke('save_settings',{ settings:{ server_url:server, default_model:model, overwrite:true, csv_path:csvOut, logs_path:logs,
      input_folder:s_input, output_folder:s_output, max_threads:threads, retry_count:retry,
      title_min_words:tmin, title_max_words:tmax, description_min_chars:dmin, description_max_chars:dmax,
      keywords_min_count:kmin, keywords_max_count:kmax, auto_embed:true, banned_words:banned, ai_provider:provider,
      selection_enabled: selectionEnabled, generate_csv: generateCsv,
      rename_enabled: renameEnabled, rename_mode: renameMode, rename_custom_text: renameCustomText,
      // check_anatomy_defect: checkAnatomyDefect,
      check_human_animal_similarity: checkHumanAnimalSimilarity,
      check_human_presence: checkHumanPresence,
      check_animal_presence: checkAnimalPresence,
      check_deformed_object: checkDeformedObject,
      check_unrecognizable_subject: checkUnrecognizableSubject,
      check_text_or_text_like: checkTextOrTextLike,
      check_brand_logo: checkBrandLogo,
      check_famous_trademark: checkFamousTrademark,
      check_watermark: checkWatermark,
      check_duplicate_similarity: checkDuplicateSimilarity,
      enable_quality_filter: enableQualityFilter,
      quality_blur_min: qualityBlurMin,
      quality_noise_max: qualityNoiseMax,
      quality_luma_min: qualityLumaMin,
      quality_luma_max: qualityLumaMax,
      duplicate_max_hamming_distance: duplicateMaxDistance,
      selection_order: selectionOrder,
      connection_mode: connectionMode,

      text_filter_gibberish: textFilterGibberish,
      text_filter_non_english: textFilterNonEnglish,
      text_filter_irrelevant: textFilterIrrelevant,
      text_filter_relevant: textFilterRelevant,

      human_filter_full_face: humanFilterFullFace,
      human_filter_no_head: humanFilterNoHead,
      human_filter_partial_perfect: humanFilterPartialPerfect,
      human_filter_partial_defect: humanFilterPartialDefect,
      human_filter_back_view: humanFilterBackView,
      human_filter_unclear: humanFilterUnclear,
      human_filter_face_only: humanFilterFaceOnly,
      human_filter_nudity: humanFilterNudity,

      animal_filter_full_face: animalFilterFullFace,
      animal_filter_no_head: animalFilterNoHead,
      animal_filter_partial_perfect: animalFilterPartialPerfect,
      animal_filter_partial_defect: animalFilterPartialDefect,
      animal_filter_back_view: animalFilterBackView,
      animal_filter_unclear: animalFilterUnclear,
      animal_filter_face_only: animalFilterFaceOnly,
      animal_filter_nudity: animalFilterNudity
    } })
  }

  async function save(){
    await saveSilent()
    onBack()
  }

  async function applySettings() {
    await saveSilent()
    showToast("Settings applied successfully", 'success')
  }

  return (
    <div className="settings">
      {toast && (
        <div style={{
          position:'fixed',
          right: 16,
          bottom: 16,
          zIndex: 2000,
          background: toast.type === 'success' ? '#2e7d32' : toast.type === 'error' ? '#c62828' : '#37474f',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: 8,
          maxWidth: 340,
          boxShadow: '0 6px 18px rgba(0,0,0,0.35)'
        }}>{toast.text}</div>
      )}
      {/* Subscription Popup */}
      {showSubPopup && (
        <div style={{
            position:'fixed', top:0, left:0, right:0, bottom:0,
            background:'rgba(0,0,0,0.8)', zIndex:999,
            display:'flex', alignItems:'center', justifyContent:'center'
        }}>
            <div style={{background:'#1e1e1e', padding:30, borderRadius:12, maxWidth:400, textAlign:'center', border:'1px solid #333'}}>
                <h3 style={{marginTop:0, color:'#ff5252'}}>Subscription Required</h3>
                <p style={{color:'#ccc', lineHeight:1.5}}>
                    API Key Mode is only available for subscribed users.<br/>
                    Your subscription has expired or is not active.
                </p>
                <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:20}}>
                    <button 
                        onClick={()=>{ 
                            setShowSubPopup(false); 
                            setTopUpInitialTab('redeem');
                            setTopUpPurchaseType('token');
                            setShowTopUpModal(true);
                        }}
                        style={{background:'#4caf50', padding:'12px', border:'none', borderRadius:6, color:'white', cursor:'pointer', fontWeight:'bold'}}>
                        Enter Subscription Voucher
                    </button>
                    <button 
                        onClick={()=>{ 
                            setShowSubPopup(false);
                            setTopUpInitialTab('topup');
                            setTopUpPurchaseType('subscription');
                            setShowTopUpModal(true);
                        }} {...pressHandlers}
                        style={{background:'#0070ba', padding:'12px', border:'none', borderRadius:6, color:'white', cursor:'pointer', fontWeight:'bold'}}>
                        Subscribe
                    </button>
                    <button 
                        onClick={()=>{ setShowSubPopup(false); if(connectionMode==='direct') setConnectionMode('server'); }} {...pressHandlers}
                        style={{background:'#444', padding:'10px', border:'none', borderRadius:6, color:'white', cursor:'pointer'}}>
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
      {!embedded && (
        <div className="settings-header" style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <h2 style={{margin:0}}>Settings</h2>
        </div>
      )}



      <div className="folder-group">
        <label>Input Folder {inputError && <span style={{color:'red', marginLeft:10}}>Folder not found!</span>}</label>
        <div className="folder">
            <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{borderColor: inputError ? 'red' : ''}} />
            <button className="btn-browse" onClick={async()=>{
                const r=await pick({directory:true}); 
                if(typeof r==='string') { 
                    const exists = await invoke('file_exists', {path: r});
                    if(!exists) { alert("Selected folder does not exist!"); return; }
                    setInput(r); 
                    saveSilent({input_folder:r}) 
                }
            }}>Browse</button>
        </div>
      </div>
      <div className="folder-group">
        <label>Output Folder {outputError && <span style={{color:'red', marginLeft:10}}>Folder not found!</span>}</label>
        <div className="folder">
            <input type="text" value={output} onChange={e=>setOutput(e.target.value)} style={{borderColor: outputError ? 'red' : ''}} />
            <button className="btn-browse" onClick={async()=>{
                const r=await pick({directory:true}); 
                if(typeof r==='string') { 
                    const exists = await invoke('file_exists', {path: r});
                    if(!exists) { alert("Selected folder does not exist!"); return; }
                    setOutput(r); 
                    saveSilent({output_folder:r}) 
                }
            }}>Browse</button>
        </div>
      </div>

      <div className="setting-row">
        <label>AI Provider</label>
        <select value={provider} onChange={e=>{
          const p = e.target.value;
          setProvider(p); 
          // Set default model for the new provider
          const available = getModels(p);
          if (available.length > 0) setModel(available[0].value);
        }}>
          <option>Gemini</option>
          <option>OpenAI</option>
        </select>
      </div>

      <div className="setting-row">
        <label>Model</label>
        <select value={model} onChange={e=>setModel(e.target.value)}>
          {getModels(provider).map(m=> (<option key={m.value} value={m.value}>{m.label}</option>))}
        </select>
      </div>

      {/* Api Key Toggle */}
      <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center', opacity: subscriptionStatus.is_active ? 1 : 0.5}}>
        <div>
          <label>Api Key</label>
          {!subscriptionStatus.is_active && <div style={{color:'#ff5252', marginTop:2, fontSize: 10}}>Subscription required</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{connectionMode === 'direct' ? 'On' : 'Off'}</span>
          <button
            onClick={()=>{
                if (!subscriptionStatus.is_active) {
                    setShowSubPopup(true);
                    checkSub();
                    return;
                }
                const newMode = connectionMode === 'server' ? 'direct' : 'server';
                setConnectionMode(newMode);
                logAudit('ModeSwitch', newMode === 'direct' ? 'Switched to Direct Mode' : 'Switched to Server Mode', 'Success');
            }} {...pressHandlers}
            style={{
              width:26,
              height:14,
              borderRadius:7,
              background: connectionMode === 'direct' ? '#4caf50' : '#444',
              border:'1px solid #666',
              position:'relative',
              padding:0,
              cursor: 'pointer',
              marginLeft: 0
            }}
            aria-label="Toggle Api Key Mode"
          >
            <span style={{
              display:'block',
              width:10,
              height:10,
              borderRadius:'50%',
              background:'#fff',
              position:'absolute',
              top:1,
              left: connectionMode === 'direct' ? 13 : 1,
              transition: 'left 0.2s'
            }}></span>
          </button>
        </div>
      </div>

      {connectionMode === 'direct' && (
          <div style={{marginTop:5, marginBottom:15, background:'#252525', padding:10, borderRadius:8}}>
              <div className="setting-row">
                  <label>API Key ({provider})</label>
                  <div style={{display:'flex', gap:5, flexDirection:'column', flex:1}}>
                      <input 
                        type="text" 
                        value={isApiKeyFocused ? apiKey : (apiKey.length > 3 ? apiKey.substring(0,3)+'•••' : apiKey)}
                        onChange={e=>{
                            const val = e.target.value;
                            setApiKey(val);
                            if (provider === 'OpenAI' && !val.startsWith('sk-proj-')) {
                                setApiKeyError('OpenAI API keys must start with sk-proj-');
                            } else {
                                setApiKeyError('');
                            }
                        }} 
                        onFocus={()=>setIsApiKeyFocused(true)}
                        onBlur={()=>setIsApiKeyFocused(false)}
                        placeholder={provider === 'OpenAI' ? 'sk-proj-...' : 'AIza...'}
                        style={{flex:1, borderColor: apiKeyError ? 'red' : '#ccc', borderStyle:'solid', borderWidth:1, padding:6, borderRadius:6, background:'#1b1b1b', color:'#eee'}}
                      />
                      {apiKeyError && <div style={{color:'#ff5252', fontSize: 10}}>{apiKeyError}</div>}
                  </div>
              </div>
              <div style={{display:'flex', justifyContent:'space-between', marginTop:6}}>
                  <div style={{color:'#777', fontSize: 10}}>
                      {apiKeyEncrypted ? '✓ Saved (AES-GCM)' : '⚠ Not saved'}
                  </div>
                  <div style={{display:'flex', gap:6}}>
                      <button 
                        onClick={testConnection} 
                        disabled={testingConnection}
                        title="Test API key with provider"
                        style={{background:'#3b74a8', border:'none', color:'#fff', borderRadius:6, padding:'6px 10px', cursor:'pointer', opacity: testingConnection ? 0.7 : 0.9, fontSize: 10}}
                      >
                        {testingConnection ? 'Testing...' : 'Test API Key'}
                      </button>
                      <button 
                        onClick={saveApiKey} 
                        title="Save API key securely"
                        style={{background:'#4f8f66', border:'none', color:'#fff', borderRadius:6, padding:'6px 10px', cursor:'pointer', opacity:0.9, fontSize: 10}}
                      >
                        Save
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Hidden as requested */}
      {/* <label>Server FastAPI</label>
      <div className="w-lg"><input value={server} readOnly disabled /></div> */}
      
      <div className="setting-group-grid">
        <div className="setting-item">
          <label>Threads</label>
          <input type="number" value={threads} onChange={e=>setThreads(Number(e.target.value))} />
        </div>
        <div className="setting-item">
          <label>Retry</label>
          <input type="number" value={retry} onChange={e=>setRetry(Number(e.target.value))} />
        </div>
      </div>

      <div className="setting-group-grid">
        <div className="setting-item">
          <label>Title min</label>
          <input type="number" value={tmin} onChange={e=>setTmin(Number(e.target.value))} />
        </div>
        <div className="setting-item">
          <label>Title max</label>
          <input type="number" value={tmax} onChange={e=>setTmax(Number(e.target.value))} />
        </div>
      </div>

      <div className="setting-group-grid">
        <div className="setting-item">
          <label>Desc min</label>
          <input type="number" value={dmin} onChange={e=>setDmin(Number(e.target.value))} />
        </div>
        <div className="setting-item">
          <label>Desc max</label>
          <input type="number" value={dmax} onChange={e=>setDmax(Number(e.target.value))} />
        </div>
      </div>

      <div className="setting-group-grid">
        <div className="setting-item">
          <label>Tags min</label>
          <input type="number" value={kmin} onChange={e=>setKmin(Number(e.target.value))} />
        </div>
        <div className="setting-item">
          <label>Tags max</label>
          <input type="number" value={kmax} onChange={e=>setKmax(Number(e.target.value))} />
        </div>
      </div>

      <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <label>Image Selection</label>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{selectionEnabled ? 'On' : 'Off'}</span>
          <button
            onClick={()=>setSelectionEnabled(!selectionEnabled)}
            style={{
              width:26,
              height:14,
              borderRadius:7,
              background: selectionEnabled ? '#4caf50' : '#444',
              border:'1px solid #666',
              position:'relative',
              padding:0,
              cursor:'pointer',
              marginLeft: 0
            }}
            aria-label="Toggle Image Selection"
          >
            <span style={{
              display:'block',
              width:10,
              height:10,
              borderRadius:'50%',
              background:'#fff',
              position:'absolute',
              top:1,
              left: selectionEnabled ? 13 : 1,
              transition: 'left 0.2s'
            }}></span>
          </button>
        </div>
      </div>
      {selectionEnabled && (
        <>
        <div className="setting-row">
          <label>Selection Order</label>
          <select value={selectionOrder} onChange={e=>setSelectionOrder(e.target.value as any)}>
            <option value="before">Before Generate</option>
            <option value="after">After Generate</option>
          </select>
        </div>
        <div className="setting-group" style={{marginTop:8, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
          {/* <label className="checkline"><input type="checkbox" checked={checkAnatomyDefect} onChange={e=>setCheckAnatomyDefect(e.target.checked)} /><span>Anatomy Defect</span></label> */}
          
          {/* Human Presence Filter */}
          <div style={{gridColumn: '1 / -1'}}>
            <label className="checkline"><input type="checkbox" checked={checkHumanPresence} onChange={e=>{
              const v = e.target.checked;
              setCheckHumanPresence(v);
              // Auto select all sub-options if checked
              if(v) {
                setHumanFilterFullFace(true); setHumanFilterNoHead(true); setHumanFilterPartialPerfect(true);
                setHumanFilterPartialDefect(true); setHumanFilterBackView(true); setHumanFilterUnclear(true);
                setHumanFilterFaceOnly(true); setHumanFilterNudity(true);
              } else {
                 setHumanFilterFullFace(false); setHumanFilterNoHead(false); setHumanFilterPartialPerfect(false);
                 setHumanFilterPartialDefect(false); setHumanFilterBackView(false); setHumanFilterUnclear(false);
                 setHumanFilterFaceOnly(false); setHumanFilterNudity(false);
              }
            }} /><span>Human Presence Filter</span></label>
            
            {checkHumanPresence && <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginLeft: 20, marginTop: 4}}>
              {[
                { label: 'Full Body (Perfect Face)', val: humanFilterFullFace, set: setHumanFilterFullFace },
                { label: 'No Head Visible', val: humanFilterNoHead, set: setHumanFilterNoHead },
                { label: 'Partial Body (Perfect)', val: humanFilterPartialPerfect, set: setHumanFilterPartialPerfect },
                { label: 'Partial Body (Defect)', val: humanFilterPartialDefect, set: setHumanFilterPartialDefect },
                { label: 'Back View', val: humanFilterBackView, set: setHumanFilterBackView },
                { label: 'Unclear/Hybrid/Alien', val: humanFilterUnclear, set: setHumanFilterUnclear },
                { label: 'Face Only', val: humanFilterFaceOnly, set: setHumanFilterFaceOnly },
                { label: 'Nudity/NSFW', val: humanFilterNudity, set: setHumanFilterNudity },
              ].map((opt, i) => (
                <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
              ))}
            </div>}
          </div>

          {/* Animal Presence Filter */}
          <div style={{gridColumn: '1 / -1'}}>
            <label className="checkline"><input type="checkbox" checked={checkAnimalPresence} onChange={e=>{
               const v = e.target.checked;
               setCheckAnimalPresence(v);
               if(v) {
                 setAnimalFilterFullFace(true); setAnimalFilterNoHead(true); setAnimalFilterPartialPerfect(true);
                 setAnimalFilterPartialDefect(true); setAnimalFilterBackView(true); setAnimalFilterUnclear(true);
                 setAnimalFilterFaceOnly(true); setAnimalFilterNudity(true);
               } else {
                 setAnimalFilterFullFace(false); setAnimalFilterNoHead(false); setAnimalFilterPartialPerfect(false);
                 setAnimalFilterPartialDefect(false); setAnimalFilterBackView(false); setAnimalFilterUnclear(false);
                 setAnimalFilterFaceOnly(false); setAnimalFilterNudity(false);
               }
            }} /><span>Animal Presence Filter</span></label>
            
            {checkAnimalPresence && <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginLeft: 20, marginTop: 4}}>
              {[
                { label: 'Full Body (Perfect)', val: animalFilterFullFace, set: setAnimalFilterFullFace },
                { label: 'No Head Visible', val: animalFilterNoHead, set: setAnimalFilterNoHead },
                { label: 'Partial Body (Perfect)', val: animalFilterPartialPerfect, set: setAnimalFilterPartialPerfect },
                { label: 'Partial Body (Defect)', val: animalFilterPartialDefect, set: setAnimalFilterPartialDefect },
                { label: 'Back View', val: animalFilterBackView, set: setAnimalFilterBackView },
                { label: 'Unclear/Hybrid/Alien', val: animalFilterUnclear, set: setAnimalFilterUnclear },
                { label: 'Face Only', val: animalFilterFaceOnly, set: setAnimalFilterFaceOnly },
                { label: 'Mating/Genitals', val: animalFilterNudity, set: setAnimalFilterNudity },
              ].map((opt, i) => (
                <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
              ))}
            </div>}
          </div>

          {/* Text or Text-like Filter */}
          <div style={{gridColumn: '1 / -1'}}>
            <label className="checkline"><input type="checkbox" checked={checkTextOrTextLike} onChange={e=>{
              const v = e.target.checked;
              setCheckTextOrTextLike(v);
              if(v) {
                setTextFilterGibberish(true); setTextFilterNonEnglish(true); setTextFilterIrrelevant(true); setTextFilterRelevant(true);
              } else {
                setTextFilterGibberish(false); setTextFilterNonEnglish(false); setTextFilterIrrelevant(false); setTextFilterRelevant(false);
              }
            }} /><span>Text or Text-like Filter</span></label>
            
            {checkTextOrTextLike && <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginLeft: 20, marginTop: 4}}>
              {[
                { label: 'Gibberish/Meaningless', val: textFilterGibberish, set: setTextFilterGibberish },
                { label: 'Non-English Text', val: textFilterNonEnglish, set: setTextFilterNonEnglish },
                { label: 'Irrelevant Meaning', val: textFilterIrrelevant, set: setTextFilterIrrelevant },
                { label: 'Relevant Meaning', val: textFilterRelevant, set: setTextFilterRelevant },
              ].map((opt, i) => (
                <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
              ))}
            </div>}
          </div>

          <label className="checkline"><input type="checkbox" checked={checkDeformedObject} onChange={e=>setCheckDeformedObject(e.target.checked)} /><span>Deformed Object</span></label>
          <label className="checkline"><input type="checkbox" checked={checkUnrecognizableSubject} onChange={e=>setCheckUnrecognizableSubject(e.target.checked)} /><span>Unrecognizable Subject</span></label>
          <label className="checkline"><input type="checkbox" checked={checkBrandLogo} onChange={e=>setCheckBrandLogo(e.target.checked)} /><span>Brand Logo</span></label>
          <label className="checkline"><input type="checkbox" checked={checkFamousTrademark} onChange={e=>setCheckFamousTrademark(e.target.checked)} /><span>Famous Trademark</span></label>
          <label className="checkline"><input type="checkbox" checked={checkWatermark} onChange={e=>setCheckWatermark(e.target.checked)} /><span>Watermark</span></label>
          <label className="checkline"><input type="checkbox" checked={checkDuplicateSimilarity} onChange={e=>setCheckDuplicateSimilarity(e.target.checked)} /><span>Duplicate Similarity</span></label>
        </div>
        </>
      )}

      {/* Local Quality Filter UI removed intentionally */}

      {selectionEnabled && checkDuplicateSimilarity && (
        <div className="setting-group" style={{marginTop:8}}>
          <div className="setting-item" style={{width: '25%'}}><label>Dup dist</label><input type="number" value={duplicateMaxDistance} onChange={e=>setDuplicateMaxDistance(Number(e.target.value))} /></div>
        </div>
      )}
      
      <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <label>Generate CSV</label>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{generateCsv ? 'On' : 'Off'}</span>
          <button
            onClick={()=>setGenerateCsv(!generateCsv)}
            style={{
              width:26,
              height:14,
              borderRadius:7,
              background: generateCsv ? '#4caf50' : '#444',
              border:'1px solid #666',
              position:'relative',
              padding:0,
              cursor:'pointer',
              marginLeft: 0
            }}
            aria-label="Toggle CSV Generation"
          >
            <span style={{
              display:'block',
              width:10,
              height:10,
              borderRadius:'50%',
              background:'#fff',
              position:'absolute',
              top:1,
              left: generateCsv ? 13 : 1,
              transition: 'left 0.2s'
            }}></span>
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <label>Rename File</label>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{renameEnabled ? 'On' : 'Off'}</span>
            <button
              onClick={()=>setRenameEnabled(!renameEnabled)}
              style={{
                width:26, height:14, borderRadius:7,
                background: renameEnabled ? '#4caf50' : '#444',
                border:'1px solid #666', position:'relative', padding:0, cursor:'pointer', marginLeft: 0
              }}
              aria-label="Toggle File Rename"
            >
              <span style={{
                display:'block', width:10, height:10, borderRadius:'50%', background:'#fff', position:'absolute', top:1,
                left: renameEnabled ? 13 : 1, transition: 'left 0.2s'
              }}></span>
            </button>
          </div>
        </div>

        {renameEnabled && (
          <div style={{marginLeft: 20, marginTop: 4, display:'flex', flexDirection:'column', gap:4}}>
              <label className="checkline sub-check" style={{color:'#aaa'}}>
                  <input
                    type="checkbox"
                    checked={renameMode === 'title'}
                    onChange={()=>setRenameMode('title')}
                    style={{accentColor: '#2bd3d3'}}
                  />
                  <span>Rename with Title file</span>
              </label>
              <label className="checkline sub-check" style={{color:'#aaa'}}>
                  <input
                    type="checkbox"
                    checked={renameMode === 'datetime'}
                    onChange={()=>setRenameMode('datetime')}
                    style={{accentColor: '#2bd3d3'}}
                  />
                  <span>Rename with Date/Time</span>
              </label>
              <label className="checkline sub-check" style={{color:'#aaa'}}>
                  <input
                    type="checkbox"
                    checked={renameMode === 'custom'}
                    onChange={()=>setRenameMode('custom')}
                    style={{accentColor: '#2bd3d3'}}
                  />
                  <span>Rename with Custom Name</span>
              </label>
              {renameMode === 'custom' && (
                  <input 
                      type="text" 
                      value={renameCustomText} 
                      onChange={e=>setRenameCustomText(e.target.value)} 
                      placeholder="Enter custom filename..."
                      style={{marginLeft: 20, padding: '4px 8px', background: '#333', border: '1px solid #555', color: 'white', borderRadius: 4, width: 200}}
                  />
              )}
          </div>
        )}
      </div>
      
      <label>Banned Words (comma or newline separated)</label>
      <textarea value={banned} onChange={e=>setBanned(e.target.value)} rows={3} />
      
      <div style={{marginTop:10, display:'flex', gap:10, justifyContent:'flex-end'}}>
          <div style={{display:'flex', gap:10}}>
              <button 
                  className="btn-apply"
                  onClick={applySettings} 
                  title="Apply and Save Settings"
              >
                  Apply
              </button>
              {!embedded && <button onClick={onBack} style={{padding:'6px 10px', cursor:'pointer', fontSize:11, borderRadius:6, border:'1px solid #666', background:'transparent', color:'#ccc'}}>Back</button>}
          </div>
        </div>

      <TopUpModal 
        isOpen={showTopUpModal} 
        onClose={()=>setShowTopUpModal(false)} 
        token={getTokenLocal() || ''}
        userId={userId}
        usdRate={usdRate}
        onSuccess={async (added, purchaseType, expiry, source)=>{ 
            try {
              const status = await checkSub();
              if (purchaseType === 'subscription') {
                setSuccessNotification({ type: 'subscription', expiry, source });
                if (status.is_active) setConnectionMode('direct');
              } else {
                if (typeof added === 'number' && added > 0) {
                  setSuccessNotification({ type: 'token', amount: added, source });
                } else {
                  setSuccessNotification({ type: 'token', source });
                }
              }
            } finally {
              setShowTopUpModal(false);
            }
        }}
        initialTab={topUpInitialTab}
        initialPurchaseType={topUpPurchaseType}
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
                          {successNotification.expiry
                            ? `Your API Key mode is active until ${new Date(successNotification.expiry).toLocaleString()}.`
                            : 'Your API Key mode has been activated.'}
                        </>
                    )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <button onClick={() => setSuccessNotification(null)} style={{ padding: '10px 14px', background: '#333', color: '#fff', border: '1px solid #444', borderRadius: 6, cursor: 'pointer' }}>Close</button>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}
