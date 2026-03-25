import React, { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open as pick } from '@tauri-apps/api/dialog'
import { encryptApiKey, decryptApiKey } from '../utils/crypto'
import { logAudit } from '../utils/audit'
import { apiGetUserProfile, getApiUrl, getTokenLocal } from '../api/backend'
import { translations } from '../utils/translations'
import { isVisionLikeModelId } from '../utils/modelVisionFilter'
import { formatTokenBalance } from '../utils/gatewayBalance'

export default function Settings({onBack, embedded, onSave, lang='en', onGenerateCSV, onOpenDupConfig, onRunAiCluster}:{onBack:()=>void, embedded?: boolean, onSave?:()=>void, lang?:'en'|'id', onGenerateCSV?:()=>void, onOpenDupConfig?:()=>void, onRunAiCluster?:()=>void}){
  const t = (translations[lang] || translations['en'])?.settings || translations['en'].settings;
  const getTabLabel = (tab: string) => {
    const key = tab.toLowerCase()
    return (t as any)?.tabs?.[key] || tab
  }
  const [authToken] = useState(() => getTokenLocal() || '')
  const [userEmail] = useState(() => {
    try { return localStorage.getItem('metabayn:userEmail:v1') || '' } catch { return '' }
  })
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
  const [descEnabled, setDescEnabled] = useState(true)
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

  const [apiKey, setApiKey] = useState('')
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState('')
  const [apiKeyEncrypted, setApiKeyEncrypted] = useState('')
  const [showPriceList, setShowPriceList] = useState(false)
  
  const [isApiKeyFocused, setIsApiKeyFocused] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')
  
  const [inputError, setInputError] = useState(false)
  const [outputError, setOutputError] = useState(false)
  const [toast, setToast] = useState<{text: string, type: 'success'|'error'|'info'} | null>(null)
  const [activeTab, setActiveTab] = useState<'General'|'Provider'|'Generation'|'Selection'|'Output'|'Tools'>('General')
  const [selectionSubTab, setSelectionSubTab] = useState<'Human'|'Animal'|'Text'|'Other'>('Human')

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
    {label:'GPT-4o', value:'gpt-4o'},
    {label:'GPT-4o Mini (Nano)', value:'gpt-4o-mini'},
    {label:'GPT-5 Nano', value:'gpt-5-nano'},
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
  ]

  const groqModels = [
    {label:'Llama 3.2 8B Vision — Free Tier / $0.0005 (Vision, Cheapest)', value:'llama-3.2-8b-vision-instruct'},
    {label:'Phi-3 Vision Mini 4K — Free Tier / $0.0006 (Vision, Cepat)', value:'phi-3-vision-mini-4k'},
    {label:'Gemma 2 9B Vision — Free Tier / $0.0008 (Vision)', value:'gemma-2-9b-vision-instruct'},
    {label:'Qwen 2 72B Vision — Free Tier / $0.0025 (Vision + Reasoning, Recommended)', value:'qwen2-72b-vision-instruct'},
    {label:'GPT-4o Mini Vision — Free Tier / $0.003 (Vision, OpenAI Compatible)', value:'gpt-4o-mini-vision'},
    {label:'GPT-4o Vision — Paid / $0.012 (Vision + Reasoning, High Quality)', value:'gpt-4o-vision'},
    {label:'Llama 3.2 70B Vision — Paid / $0.018 (Vision + Reasoning, Detail Tinggi)', value:'llama-3.2-70b-vision-instruct'},
  ]

  const openRouterModels = [
    {label:'Qwen 3 VL 235B A22B (Vision + Thinking)', value:'qwen/qwen3-vl-235b-a22b-thinking'},
    {label:'Qwen 3 VL 30B A3B (Vision + Thinking)', value:'qwen/qwen3-vl-30b-a3b-thinking'},
    {label:'NVIDIA Nemotron Nano 12B V2 (Vision)', value:'nvidia/nemotron-nano-12b-v2-vl:free'},
    {label:'OpenAI GPT-5 Nano', value:'openai/gpt-5-nano'},
  ]

  type OpenRouterModel = {
    id: string
    name?: string
    context_length?: number
    description?: string
    supported_parameters?: string[]
    architecture?: {
      modality?: string
      input_modalities?: string[]
      output_modalities?: string[]
      tokenizer?: string
      instruct_type?: string | null
    }
    pricing?: {
      prompt?: string
      completion?: string
      request?: string
      image?: string
      internal_reasoning?: string
    }
  }

  const [openRouterLiveModels, setOpenRouterLiveModels] = useState<OpenRouterModel[]>([])
  const [openRouterModelsLoading, setOpenRouterModelsLoading] = useState(false)

  const [openAiLiveModels, setOpenAiLiveModels] = useState<{label: string, value: string}[]>([])
  const [openAiModelsLoading, setOpenAiModelsLoading] = useState(false)

  const [fetchedModels, setFetchedModels] = useState<any[]>([])
  const [modelsRefreshTick, setModelsRefreshTick] = useState(0)
  const openRouterLastFetchTickRef = useRef(-1)

  const isOpenRouterBlockedModel = (modelId: string, modelName?: string) => {
    const id = String(modelId || '').trim().toLowerCase()
    const name = String(modelName || '').trim().toLowerCase()
    if (!id) return false
    if (id === 'openrouter/auto') return true
    if (id.startsWith('openrouter/') && (id.includes('router') || id.includes('auto'))) return true
    if (name && name.includes('router') && id.startsWith('openrouter/')) return true
    return false
  }

  const sanitizeOpenRouterLabel = (display: string, modelId: string) => {
    const rawDisplay = String(display || '').trim()
    const id = String(modelId || '').trim()
    let s = rawDisplay || id

    if (!rawDisplay) s = id
    if (s === id) {
      if (id === 'openrouter/free') s = 'openrouter'
      s = s.replace(/:free$/i, '')
      s = s.replace(/\/free$/i, '')
    }

    s = s.replace(/\(free\)/ig, '')
    s = s.replace(/\bfree\b/ig, '')
    s = s.replace(/\(\s*\)/g, '')
    s = s.replace(/\[\s*\]/g, '')
    s = s.replace(/\s*[-–—]\s*$/g, '')
    s = s.replace(/\s{2,}/g, ' ').trim()
    return s || rawDisplay || id
  }

  useEffect(() => {
    const controller = new AbortController()

    async function fetchModels() {
      try {
        const apiUrl = await getApiUrl()
        const token = getTokenLocal()
        if (!token) return

        const res = await fetch(`${apiUrl}/config/models`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          cache: 'no-store',
          signal: controller.signal
        })

        if (!res.ok) {
          setFetchedModels([])
          showToast(`Gagal memuat model AI Gateway (HTTP ${res.status}).`, 'error')
          return
        }

        const data = await res.json()
        if (data.success && Array.isArray(data.data)) {
          setFetchedModels(data.data)
        } else {
          setFetchedModels([])
          showToast('Gagal memuat model AI Gateway dari server.', 'error')
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setFetchedModels([])
        showToast('Gagal memuat model AI Gateway dari server.', 'error')
      }
    }

    fetchModels()
    return () => controller.abort()
  }, [provider, showPriceList, modelsRefreshTick])

  useEffect(() => {
    const shouldFetch = (provider === 'OpenRouter' || (apiKey || '').startsWith('sk-or-'))
    if (!shouldFetch) return
    if (openRouterModelsLoading) return
    if (openRouterLiveModels.length > 0 && openRouterLastFetchTickRef.current === modelsRefreshTick) return

    setOpenRouterModelsLoading(true)
    fetch('https://openrouter.ai/api/v1/models', {
      headers: (apiKey || '').startsWith('sk-or-')
        ? { 'Authorization': `Bearer ${apiKey.trim()}` }
        : undefined
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data) => {
        const list = Array.isArray(data?.data) ? data.data : []
        const normalized: OpenRouterModel[] = list
          .map((m: any) => ({
            id: String(m?.id || ''),
            name: typeof m?.name === 'string' ? m.name : undefined,
            context_length: typeof m?.context_length === 'number' ? m.context_length : undefined,
            description: typeof m?.description === 'string' ? m.description : undefined,
            supported_parameters: Array.isArray(m?.supported_parameters) ? m.supported_parameters : undefined,
            architecture: m?.architecture && typeof m.architecture === 'object'
              ? {
                  modality: typeof m.architecture.modality === 'string' ? m.architecture.modality : undefined,
                  input_modalities: Array.isArray(m.architecture.input_modalities) ? m.architecture.input_modalities : undefined,
                  output_modalities: Array.isArray(m.architecture.output_modalities) ? m.architecture.output_modalities : undefined,
                  tokenizer: typeof m.architecture.tokenizer === 'string' ? m.architecture.tokenizer : undefined,
                  instruct_type: typeof m.architecture.instruct_type === 'string' || m.architecture.instruct_type === null ? m.architecture.instruct_type : undefined
                }
              : undefined,
            pricing: m?.pricing && typeof m.pricing === 'object'
              ? {
                  prompt: typeof m.pricing.prompt === 'string' ? m.pricing.prompt : undefined,
                  completion: typeof m.pricing.completion === 'string' ? m.pricing.completion : undefined,
                  request: typeof m.pricing.request === 'string' ? m.pricing.request : undefined,
                  image: typeof m.pricing.image === 'string' ? m.pricing.image : undefined,
                  internal_reasoning: typeof m.pricing.internal_reasoning === 'string' ? m.pricing.internal_reasoning : undefined
                }
              : undefined
          }))
          .filter((m: OpenRouterModel) => !!m.id)

        if (normalized.length > 0) {
          setOpenRouterLiveModels(normalized)
          openRouterLastFetchTickRef.current = modelsRefreshTick
        }
      })
      .catch(() => {})
      .finally(() => setOpenRouterModelsLoading(false))
  }, [provider, apiKey, modelsRefreshTick])

  useEffect(() => {
    const key = String(apiKey || '').trim()
    const shouldFetch = provider === 'OpenAI' && !!key && !key.startsWith('sk-or-')
    if (!shouldFetch) return
    if (openAiModelsLoading) return

    const cacheKey = 'openai_models_cache_v1'
    const cacheTsKey = 'openai_models_cache_ts_v1'
    const cachedTs = Number(localStorage.getItem(cacheTsKey) || 0)
    const isFresh = cachedTs > 0 && Date.now() - cachedTs < 6 * 60 * 60 * 1000

    if (isFresh && modelsRefreshTick === 0) {
      try {
        const raw = localStorage.getItem(cacheKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setOpenAiLiveModels(parsed)
            return
          }
        }
      } catch (e) {}
    }

    setOpenAiModelsLoading(true)
    fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data) => {
        const list = Array.isArray(data?.data) ? data.data : []
        const normalized = list
          .map((m: any) => String(m?.id || '').trim())
          .filter(Boolean)
          .map((id: string) => ({ label: id, value: id }))
        if (normalized.length > 0) {
          setOpenAiLiveModels(normalized)
          try {
            localStorage.setItem(cacheKey, JSON.stringify(normalized))
            localStorage.setItem(cacheTsKey, String(Date.now()))
          } catch (e) {}
        }
      })
      .catch(() => {})
      .finally(() => setOpenAiModelsLoading(false))
  }, [provider, apiKey, modelsRefreshTick])

  // Fungsi untuk mendeteksi provider berdasarkan format API key
  const detectProviderFromApiKey = (apiKey: string): string | null => {
    if (!apiKey || typeof apiKey !== 'string') return null;
    
    // OpenAI keys start with 'sk-proj-'
    if (apiKey.startsWith('sk-proj-')) {
      return 'OpenAI';
    }

    // Groq keys start with 'gsk_'
    if (apiKey.startsWith('gsk_')) {
      return 'Groq';
    }
    
    // OpenRouter keys start with 'sk-or-'
    if (apiKey.startsWith('sk-or-')) {
      return 'OpenRouter';
    }

    // Google AI/Gemini keys typically start with 'AIza' 
    if (apiKey.startsWith('AIza')) {
      return 'Gemini';
    }
    
    // Legacy OpenAI 'sk-' (without proj)
    if (apiKey.startsWith('sk-')) {
        // Assume OpenAI for legacy keys
        return 'OpenAI';
    }

    return null; // Keep current if ambiguous
  };



  // Fungsi untuk mendapatkan model termurah berdasarkan provider
  const getCheapestModel = (provider: string): string => {
    // Safety check for fetchedModels
    const models = getModels(provider) || [];
    if (!models || models.length === 0) {
        // Fallback defaults if no models found in DB
        if(provider === 'Gemini') return 'gemini-2.0-flash-exp';
        if(provider === 'OpenAI') return 'gpt-4o-mini';
        if(provider === 'Groq') return 'llama-3.1-8b-instant';
        if(provider === 'OpenRouter') return 'qwen/qwen3-vl-235b-a22b-thinking';
        return '';
    }

    if (provider === 'OpenRouter' && openRouterLiveModels.length > 0) {
      const asNum = (s?: string) => {
        if (!s) return 0
        const n = Number(s)
        return Number.isFinite(n) ? n : 0
      }
      const isFree = (m: OpenRouterModel) => {
        if (m.id === 'openrouter/free') return true
        if (m.id.endsWith(':free')) return true
        const p = asNum(m.pricing?.prompt)
        const c = asNum(m.pricing?.completion)
        const r = asNum(m.pricing?.request)
        const i = asNum(m.pricing?.image)
        return p === 0 && c === 0 && r === 0 && i === 0
      }
      const supportsReasoning = (m: OpenRouterModel) => {
        const params = m.supported_parameters || []
        return params.includes('reasoning') || params.includes('include_reasoning')
      }
      const hasStructuredOutput = (m: OpenRouterModel) => {
        const params = m.supported_parameters || []
        return params.includes('response_format') || params.includes('structured_outputs')
      }
      const hasVision = (m: OpenRouterModel) => {
        const modality = String(m.architecture?.modality || '').toLowerCase()
        if (modality.includes('image') || modality.includes('video') || modality.includes('vision')) return true
        const inputs = (m.architecture?.input_modalities || []).map(x => String(x).toLowerCase())
        if (inputs.some(i => i.includes('image') || i.includes('video') || i.includes('vision'))) return true
        if (m.pricing && (m.pricing as any).image !== undefined && (m.pricing as any).image !== null) return true
        return isVisionLikeModelId(m.id)
      }
      const promptPer1M = (m: OpenRouterModel) => asNum(m.pricing?.prompt) * 1_000_000
      const completionPer1M = (m: OpenRouterModel) => asNum(m.pricing?.completion) * 1_000_000
      const isAffordable = (m: OpenRouterModel) => {
        const p = promptPer1M(m)
        const c = completionPer1M(m)
        const promptOk = p === 0 || p <= 2.0
        const completionOk = c === 0 || c <= 2.0
        return promptOk && completionOk
      }
      const score = (m: OpenRouterModel) => {
        const prompt = asNum(m.pricing?.prompt)
        const completion = asNum(m.pricing?.completion)
        const request = asNum(m.pricing?.request)
        const image = asNum(m.pricing?.image)
        return (prompt + completion) * 1_000_000 + request + image
      }
      const vision = openRouterLiveModels.filter(hasVision)
      const freeVision = vision.filter(isFree)
      const freeVisionReasoning = freeVision.filter(supportsReasoning)
      const paidAffordableVision = vision.filter(m => !isFree(m) && isAffordable(m))
      const paidAffordableVisionReasoning = paidAffordableVision.filter(supportsReasoning)
      const pool = freeVisionReasoning.length > 0
        ? freeVisionReasoning
        : freeVision.length > 0
          ? freeVision
          : paidAffordableVisionReasoning.length > 0
            ? paidAffordableVisionReasoning
            : paidAffordableVision.length > 0
              ? paidAffordableVision
              : vision
      
      if (pool.length === 0) return 'qwen/qwen3-vl-235b-a22b-thinking';

      const best = [...pool].sort((a, b) => {
        const sa = hasStructuredOutput(a) ? 0 : 1
        const sb = hasStructuredOutput(b) ? 0 : 1
        if (sa !== sb) return sa - sb
        const ra = supportsReasoning(a) ? 0 : 1
        const rb = supportsReasoning(b) ? 0 : 1
        if (ra !== rb) return ra - rb
        return score(a) - score(b)
      })[0]
      if (best?.id) return best.id
    }
    
    // Model termurah untuk setiap provider
    const cheapestModels = {
      'Gemini': 'gemini-1.5-flash-8b',
      'OpenAI': 'gpt-4o-mini',
      'Groq': 'llama-3.1-8b-instant',
      'OpenRouter': 'qwen/qwen3-vl-235b-a22b-thinking'
    };
    
    const targetModel = cheapestModels[provider as keyof typeof cheapestModels];
    const found = models.find(m => m.value === targetModel);
    
    // Jika model termurah tidak ditemukan, gunakan model pertama dengan safe check
    if (models.length === 0) return '';
    return found ? found.value : (models[0]?.value || '');
  };

  const getModels = (p: string): {label: string, value: string}[] => {
     if (!fetchedModels) return [];
     // Filter models from DB for this provider
     const dbModels = fetchedModels
        .filter(m => m && m.provider && m.provider.toLowerCase() === p.toLowerCase() && m.active)
        .map(m => {
          const modelName = String(m.model_name || '')
          const label = p === 'OpenRouter' ? sanitizeOpenRouterLabel(modelName, modelName) : modelName
          return { label, value: modelName }
        });

     // Untuk OpenAI, gabungkan data DB dengan daftar lokal supaya user melihat
     // seluruh model vision yang didukung meskipun DB belum lengkap.
     if (p === 'OpenAI') {
        const byValue: Record<string, {label:string, value:string}> = {};
        const addAll = (list: {label:string, value:string}[]) => {
          for (const it of list) {
            if (!it || !it.value) continue;
            if (!byValue[it.value]) byValue[it.value] = it;
          }
        };
        addAll(dbModels);
        addAll(openaiModels);
        addAll(openAiLiveModels);
        const merged = Object.values(byValue);
        return merged.filter(m => isVisionLikeModelId(m.value));
     }
     
     if (dbModels.length > 0 && p !== 'OpenRouter') {
        return dbModels.filter(m => isVisionLikeModelId(m.value))
     }
     
     const filterFallback = (list: {label: string, value: string}[]) => {
       return (list || []).filter(m => {
         if (p === 'OpenRouter') return !isOpenRouterBlockedModel(m.value, m.label) && isVisionLikeModelId(m.value)
         return isVisionLikeModelId(m.value)
       })
     }
     
     const buildOpenRouterOptions = (): {label: string, value: string}[] => {
        if (openRouterLiveModels.length === 0) return []
        const asNum = (s?: string) => {
          if (!s) return 0
          const n = Number(s)
          return Number.isFinite(n) ? n : 0
        }
        const isFree = (m: OpenRouterModel) => {
          const id = String(m.id || '').trim().toLowerCase()
          if (!id) return false
          if (id === 'openrouter/free') return true
          if (id.endsWith(':free')) return true
          const p = asNum(m.pricing?.prompt)
          const c = asNum(m.pricing?.completion)
          const r = asNum(m.pricing?.request)
          const i = asNum(m.pricing?.image)
          return p === 0 && c === 0 && r === 0 && i === 0
        }
        const hasVision = (m: OpenRouterModel) => {
          const modality = String(m.architecture?.modality || '').toLowerCase()
          if (modality.includes('image') || modality.includes('video') || modality.includes('vision')) return true
          const inputs = (m.architecture?.input_modalities || []).map(x => String(x).toLowerCase())
          if (inputs.some(i => i.includes('image') || i.includes('video') || i.includes('vision'))) return true
          if (m.pricing && (m.pricing as any).image !== undefined && (m.pricing as any).image !== null) return true
          return isVisionLikeModelId(m.id)
        }
        const supportsReasoning = (m: OpenRouterModel) => {
          const params = m.supported_parameters || []
          return params.includes('reasoning') || params.includes('include_reasoning')
        }
        const hasStructuredOutput = (m: OpenRouterModel) => {
          const params = m.supported_parameters || []
          return params.includes('response_format') || params.includes('structured_outputs')
        }
        const promptPer1M = (m: OpenRouterModel) => asNum(m.pricing?.prompt) * 1_000_000
        const completionPer1M = (m: OpenRouterModel) => asNum(m.pricing?.completion) * 1_000_000
        const isAffordable = (m: OpenRouterModel) => {
          const p = promptPer1M(m)
          const c = completionPer1M(m)
          const promptOk = p === 0 || p <= 2.0
          const completionOk = c === 0 || c <= 2.0
          return promptOk && completionOk
        }
        const priceLabel = (m: OpenRouterModel) => {
          const p = asNum(m.pricing?.prompt)
          const c = asNum(m.pricing?.completion)
          const pm = p > 0 ? (p * 1_000_000).toFixed(2) : '0.00'
          const cm = c > 0 ? (c * 1_000_000).toFixed(2) : '0.00'
          return `$${pm}/$${cm} per 1M`
        }
        const score = (m: OpenRouterModel) => {
          const prompt = asNum(m.pricing?.prompt)
          const completion = asNum(m.pricing?.completion)
          const request = asNum(m.pricing?.request)
          const image = asNum(m.pricing?.image)
          return (prompt + completion) * 1_000_000 + request + image
        }

        const filteredLive = openRouterLiveModels.filter(m => !isOpenRouterBlockedModel(m.id, m.name))

        const sortFn = (a: OpenRouterModel, b: OpenRouterModel) => {
          // Prioritize Free models
          const freeA = isFree(a) ? 1 : 0
          const freeB = isFree(b) ? 1 : 0
          if (freeA !== freeB) return freeB - freeA

          return score(a) - score(b)
        }

        const vision = filteredLive.filter(hasVision)
        const freeVision = vision.filter(isFree)
        const paidVision = vision.filter(m => !isFree(m))
        
        // Include all paid vision models, sorted by price
        const source = [...freeVision, ...paidVision]
        if (source.length === 0) return []

        const liveOptions = [...source]
          .sort((a, b) => {
            return sortFn(a, b)
          })
          .map(m => {
            const display = m.name || m.id
            const baseLabel = sanitizeOpenRouterLabel(display, m.id)
            const label = isFree(m) ? `${baseLabel} (Free)` : baseLabel
            return { label, value: m.id }
          })
        
        const byValue: Record<string, {label: string, value: string}> = {}
        for (const it of liveOptions) {
          if (it && it.value && !byValue[it.value]) byValue[it.value] = it
        }
        for (const it of openRouterModels) {
          if (it && it.value && !byValue[it.value] && isVisionLikeModelId(it.value)) byValue[it.value] = it
        }
        return Object.values(byValue)
     }
     
     if (p === 'OpenAI') return filterFallback(openaiModels)
     if (p === 'Gemini') return filterFallback(geminiModels)
     if (p === 'Groq') return filterFallback(groqModels)
     if (p === 'OpenRouter') return filterFallback(buildOpenRouterOptions())
     return [];
  }

  useEffect(() => {
    const available = getModels(provider)
    if (!available || available.length === 0) return
    const exists = available.some(m => m.value === model)
    if (exists) return
    setModel(available[0].value)
  }, [provider, fetchedModels, openRouterLiveModels, openAiLiveModels])

  useEffect(()=>{ load(); },[])

  // Validate folders
  useEffect(() => {
     if(input) invoke('file_exists', {path: input}).then((e:any) => setInputError(!e))
     else setInputError(false)
     
     if(output) invoke('file_exists', {path: output}).then((e:any) => setOutputError(!e))
     else setOutputError(false)
  }, [input, output])

  // Load API Key from local storage if exists
  useEffect(() => {
      const savedKey = localStorage.getItem('metabayn_api_key_enc')
      const savedIv = localStorage.getItem('metabayn_api_key_iv')
      if (savedKey && savedIv) {
        decryptApiKey(savedKey, savedIv).then(k => {
            setApiKey(k)
            setApiKeyEncrypted(savedKey)
        }).catch(e => console.error("Failed to decrypt API key", e))
      }
  }, [])

  const [testingConnection, setTestingConnection] = useState(false)

  async function testConnection() {
      if (!apiKey.trim()) {
          showToast(t.apiKeyEmpty, 'error')
          return
      }
      if (apiKeyError) {
          showToast(apiKeyError, 'error')
          return
      }
      setTestingConnection(true)
      try {
          const res = await invoke<string>('test_api_connection', { provider, apiKey: apiKey, endpoint: null })
          showToast(res === 'Success' ? t.connectedSuccess : `${t.connected}${res}`, 'success')
      } catch (e:any) {
          const msg = String(e).replace('Error: ', '')
          showToast(`${t.connectionFailed}${msg}`, 'error')
      } finally {
          setTestingConnection(false)
      }
  }

  async function saveApiKey() {
      // Validate format
      if (apiKey.trim().length < 5) {
          showToast(t.apiKeyInvalid, 'error')
          return
      }
      if (provider === 'OpenAI' && !apiKey.startsWith('sk-proj-') && !apiKey.startsWith('sk-')) {
          showToast(t.openaiKeyInvalid, 'error')
          return
      }

      try {
          const { iv, data } = await encryptApiKey(apiKey, "user-secret") // Using fixed secret for now or generate
          localStorage.setItem('metabayn_api_key_enc', data)
          localStorage.setItem('metabayn_api_key_iv', iv)
          setApiKeyEncrypted(data)
          logAudit('ApiKeyUsage', 'Save API Key', 'Success');
          showToast(t.apiKeySaved, 'success')
      } catch (e:any) {
          logAudit('Error', 'Save API Key Failed', String(e));
          showToast(`${t.saveFailed}${String(e).replace('Error: ', '')}`, 'error')
      }
  }

  function clearApiKey() {
      localStorage.removeItem('metabayn_api_key_enc')
      localStorage.removeItem('metabayn_api_key_iv')
      setApiKey('')
      setApiKeyEncrypted('')
  }

  async function load(){
    // @ts-ignore
    if (typeof window !== 'undefined' && !window.__TAURI_IPC__) {
        console.log("Browser mode detected: Skipping Tauri settings load");
        return;
    }

    try {
      const sRaw=await invoke<any>('get_settings')
      const s = sRaw || {};
      
      let p = s.ai_provider || 'Gemini';
      const validProviders = ['Gemini', 'OpenAI', 'OpenRouter', 'Groq'];
      if (!validProviders.includes(p)) p = 'Gemini';
      setProvider(p)

      let initialModel = s.default_model || 'gemini-2.0-flash-lite-preview-02-05';
      if (p === 'OpenRouter' && initialModel === 'openrouter/auto') {
        initialModel = 'nvidia/nemotron-nano-12b-v2-vl:free';
      }
      setModel(initialModel);
      setOverwrite(true); setCsv(''); setLogs('')
      setInput(s.input_folder||''); setOutput(s.output_folder||''); setThreads(Math.max(1, Math.min(Number(s.max_threads||4), 10))); setRetry(Number(s.retry_count||1))
      setTmin(Number(s.title_min_words ?? 5)); setTmax(Number(s.title_max_words ?? 13)); 
      
      const l_dmax = Number(s.description_max_chars ?? 200);
      const l_enabled = l_dmax > 0;
      setDescEnabled(l_enabled);
      setDmin(l_enabled ? Number(s.description_min_chars ?? 80) : 80);
      setDmax(l_enabled ? l_dmax : 200);

      setKmin(Number(s.keywords_min_count ?? 35)); setKmax(Number(s.keywords_max_count ?? 49)); setBanned(s.banned_words||'')
      
      const defaultOpenRouterEndpoint = 'https://metabayn-backend.metabayn.workers.dev/v1/chat/completions'
      let orEndpoint = (s.openrouter_endpoint || defaultOpenRouterEndpoint) as string
      if (orEndpoint.includes('metabayn-worker.metabayn.workers.dev')) {
        orEndpoint = defaultOpenRouterEndpoint
      }
      setOpenRouterEndpoint(orEndpoint)

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
  }, [model, input, output, threads, retry, tmin, tmax, dmin, dmax, kmin, kmax, banned, provider, selectionEnabled, descEnabled, /*checkAnatomyDefect,*/ checkHumanAnimalSimilarity, checkHumanPresence, checkAnimalPresence, checkDeformedObject, checkUnrecognizableSubject, checkTextOrTextLike, checkBrandLogo, checkFamousTrademark, checkWatermark, checkDuplicateSimilarity, qualityBlurMin, qualityNoiseMax, qualityLumaMin, qualityLumaMax, duplicateMaxDistance, selectionOrder, loaded, generateCsv,
      renameEnabled, renameMode, renameCustomText,
      openRouterEndpoint, enableQualityFilter,
      textFilterGibberish, textFilterNonEnglish, textFilterIrrelevant, textFilterRelevant,
      humanFilterFullFace, humanFilterNoHead, humanFilterPartialPerfect, humanFilterPartialDefect, humanFilterBackView, humanFilterUnclear, humanFilterFaceOnly, humanFilterNudity,
      animalFilterFullFace, animalFilterNoHead, animalFilterPartialPerfect, animalFilterPartialDefect, animalFilterBackView, animalFilterUnclear, animalFilterFaceOnly, animalFilterNudity
  ])

  async function saveSilent(overrides:any = {}){
    const s_input = overrides.input_folder !== undefined ? overrides.input_folder : input
    const s_output = overrides.output_folder !== undefined ? overrides.output_folder : output
    const csvOut = s_output ? (s_output.endsWith('\\')||s_output.endsWith('/') ? (s_output + 'metabayn.csv') : (s_output + (s_output.includes('\\') ? '\\' : '/') + 'metabayn.csv')) : ''
    const safeThreads = Math.max(1, Math.min(Number(threads || 1), 10))
    const s_desc_min = overrides.description_min_chars !== undefined ? Number(overrides.description_min_chars) : (descEnabled ? dmin : 0)
    const s_desc_max = overrides.description_max_chars !== undefined ? Number(overrides.description_max_chars) : (descEnabled ? dmax : 0)
    // Get current auth token to prevent overwriting it with empty string
    const currentToken = getTokenLocal() || '';
    
    await invoke('save_settings',{ settings:{ default_model:model, overwrite:true, csv_path:csvOut, logs_path:logs,
      input_folder:s_input, output_folder:s_output, max_threads:safeThreads, retry_count:retry,
      title_min_words:tmin, title_max_words:tmax, description_min_chars:s_desc_min, description_max_chars:s_desc_max,
      keywords_min_count:kmin, keywords_max_count:kmax, auto_embed:true, banned_words:banned, ai_provider:provider,
      selection_enabled: selectionEnabled, generate_csv: generateCsv,
      auth_token: currentToken, // Ensure auth token is preserved/saved
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
      connection_mode: provider === 'OpenRouter' ? 'server' : 'direct',

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
      animal_filter_nudity: animalFilterNudity,

      openrouter_endpoint: openRouterEndpoint
    } })
  }

  async function save(){
    await saveSilent()
    onBack()
  }

  async function applySettings() {
    await saveSilent()
    showToast(t.successApplied, 'success')
  }

  const openRouterSelectableIds = new Set(getModels('OpenRouter').map(m => m.value))
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

  useEffect(() => {
    if (!authToken) return
    apiGetUserProfile(authToken)
      .then((p) => setUserProfile(p))
      .catch(() => {})
  }, [authToken])

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

  return (
    <div className="settings" style={{background:'#09090b', color:'#e4e4e7', minHeight: embedded ? '100%' : '100vh', overflowY: embedded ? 'visible' : 'auto'}}>
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
      
      {!embedded && (
        <div style={{height:64, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', borderBottom:'1px solid #27272a', background:'#09090b', marginBottom:8}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <button onClick={onBack} aria-label={t.back} style={{display:'inline-flex', alignItems:'center', justifyContent:'center', width:32, height:32, borderRadius:8, border:'1px solid #27272a', background:'#18181b', color:'#fff', cursor:'pointer'}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <h2 style={{margin:0, fontSize:14, fontWeight:800}}>{t.title}</h2>
          </div>
          {!!authToken && (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              {(userProfile?.email || userEmail) && (
                <div style={{display:'flex', alignItems:'center', gap:10, padding:'6px 10px', border:'1px solid #27272a', borderRadius: 999, background: 'rgba(255,255,255,0.04)'}}>
                  <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600, userSelect: 'text' }}>
                    {userProfile?.email || userEmail}
                  </span>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: subscriptionActive ? '#00ff5a' : '#7f1d1d',
                    boxShadow: subscriptionActive ? '0 0 10px rgba(0,255,90,0.55)' : 'none',
                    display: 'inline-block'
                  }} />
                  <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600, userSelect: 'text' }}>
                    {subscriptionActive ? (subscriptionExpiryLabel || '--/--/----') : (lang === 'id' ? 'Tidak aktif' : 'Inactive')}
                  </span>
                </div>
              )}

              {userProfile && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'default'
                }} title={(translations as any)[lang]?.dashboard?.tokenBalanceTitle || "Token Balance"}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  </svg>
                  <span style={{ fontSize: '11px', color: '#e4e4e7', fontWeight: 700 }}>
                    {formatTokenBalance(userProfile?.tokens)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}





      <div style={{display:'flex', gap:12, padding:'0 12px 12px 12px'}}>
        <div style={{width: embedded ? 118 : 150, flex:'0 0 auto', display:'flex', flexDirection:'column', gap:8}}>
          {(['General','Provider','Generation','Selection','Output','Tools'] as const).map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)} 
              style={{
                width:'100%',
                background: activeTab===tab ? '#18181b' : 'transparent',
                border: '1px solid #27272a',
                color: '#fff',
                padding: '8px 10px',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 10,
                opacity: activeTab===tab ? 1 : 0.85,
                display:'inline-flex',
                alignItems:'center',
                justifyContent:'flex-start',
                gap:8,
                textAlign:'left'
              }}>
              <span style={{display:'inline-flex', alignItems:'center', justifyContent:'center', width:16}}>
                {tab==='General' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 4h16v6H4V4zm0 10h10v6H4v-6z" stroke="#9ca3af" strokeWidth="2"/></svg>)}
                {tab==='Provider' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1 3-6z" stroke="#9ca3af" strokeWidth="2"/></svg>)}
                {tab==='Generation' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 15h16M4 9h10" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round"/></svg>)}
                {tab==='Selection' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
                {tab==='Output' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
                {tab==='Tools' && (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
              </span>
              <span>{getTabLabel(tab)}</span>
            </button>
          ))}
        </div>

        <div style={{flex:1, minWidth:0}}>

      {activeTab==='General' && (
      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <label style={{ color:'#a1a1aa', fontSize:10 }}>{t.inputFolder} {inputError && <span style={{color:'#ef4444', marginLeft:10}}>{t.folderNotFound}</span>}</label>
          <button onClick={async()=>{
                const r=await pick({directory:true, title: t.selectInputFolder}); 
                if(typeof r==='string') { 
                    const exists = await invoke('file_exists', {path: r});
                    if(!exists) { alert(t.folderNotFound); return; }
                    setInput(r); 
                    saveSilent({input_folder:r}) 
                }
            }} style={{background:'#18181b', border:'1px solid #27272a', color:'#fff', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:10}}>{t.browse}</button>
        </div>
        <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{ width:'100%', background:'#18181b', border:'1px solid '+(inputError ? '#ef4444' : '#27272a'), color:'#fff', padding:'10px 12px', borderRadius:10, fontSize:12, outline:'none' }} />
      </div>
      )}
      {activeTab==='General' && (
      <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14, marginTop:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <label style={{ color:'#a1a1aa', fontSize:10 }}>{t.outputFolder} {outputError && <span style={{color:'#ef4444', marginLeft:10}}>{t.folderNotFound}</span>}</label>
          <button onClick={async()=>{
                const r=await pick({directory:true, title: t.selectOutputFolder}); 
                if(typeof r==='string') { 
                    const exists = await invoke('file_exists', {path: r});
                    if(!exists) { alert(t.folderNotFound); return; }
                    setOutput(r); 
                    saveSilent({output_folder:r}) 
                }
            }} style={{background:'#18181b', border:'1px solid #27272a', color:'#fff', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:10}}>{t.browse}</button>
        </div>
        <input type="text" value={output} onChange={e=>setOutput(e.target.value)} style={{ width:'100%', background:'#18181b', border:'1px solid '+(outputError ? '#ef4444' : '#27272a'), color:'#fff', padding:'10px 12px', borderRadius:10, fontSize:12, outline:'none' }} />
      </div>
      )}



      {activeTab==='Provider' && (
      <div style={{marginTop:0, marginBottom:10, background:'#252525', padding:10, borderRadius:8}}>
          {/* Provider Type Selection (Tabs) */}
                        <div style={{marginBottom: 10, borderBottom: '1px solid #444', paddingBottom: 10}}>
                            <div style={{fontSize: 9, color: '#aaa', marginBottom: 4, textTransform:'uppercase', letterSpacing:1}}>{t.providerType}</div>
                            <div style={{display:'flex', gap: 8}}>
                                <button 
                                    onClick={() => {
                                        if (provider === 'OpenRouter') {
                                            setProvider('Gemini');
                                            const cheapest = getCheapestModel('Gemini');
                                            if (cheapest) setModel(cheapest);
                                        }
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '6px 10px',
                                        borderRadius: 6,
                                        border: provider !== 'OpenRouter' ? '2px solid #3b74a8' : '1px solid #444',
                                        background: provider !== 'OpenRouter' ? 'rgba(59, 116, 168, 0.2)' : '#222',
                                        color: provider !== 'OpenRouter' ? '#fff' : '#888',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{fontSize: 10, fontWeight: 'bold', marginBottom: 1}}>Standard AI</div>
                                    <div style={{fontSize: 8, opacity: 0.7}}>Gemini, OpenAI</div>
                                </button>
                                
                                <button 
                                    onClick={() => {
                                        setProvider('OpenRouter');
                                        const cheapest = getCheapestModel('OpenRouter');
                                        if (cheapest) setModel(cheapest);
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '6px 10px',
                                        borderRadius: 6,
                                        border: provider === 'OpenRouter' ? '2px solid #3b74a8' : '1px solid #444',
                                        background: provider === 'OpenRouter' ? 'rgba(59, 116, 168, 0.2)' : '#222',
                                        color: provider === 'OpenRouter' ? '#fff' : '#888',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize: 10, fontWeight: 'bold', marginBottom: 1}}>AI Gateway</div>
                                            <div style={{fontSize: 8, opacity: 0.7}}>Premium Access</div>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        </div>

          {/* Standard Provider Selection */}
          {provider !== 'OpenRouter' && (
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
              <label style={{fontSize:10, color:'#aaa', width:80, flexShrink:0}}>{t.aiProvider}</label>
              <div style={{flex:1}}>
                  <select value={provider} onChange={e=>{
                    const p = e.target.value;
                    setProvider(p); 
                    const cheapest = getCheapestModel(p);
                    if (cheapest) setModel(cheapest);
                    else {
                      const available = getModels(p);
                      if (available.length > 0) setModel(available[0].value);
                    }
                  }} style={{width:'100%', background:'#111', border:'1px solid #444', padding:'4px 8px', borderRadius:6, color:'#fff', fontSize:10}}>
                    <option>Gemini</option>
                    <option>OpenAI</option>
                  </select>
              </div>
          </div>
          )}

          {/* Model Selection (Shared) */}
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
              <label style={{fontSize:10, color:'#aaa', width:80, flexShrink:0}}>{t.model}</label>
              <div style={{flex:1, display:'flex', gap:6}}>
                  <select value={model} onChange={e=>setModel(e.target.value)} style={{flex:1, background:'#111', border:'1px solid #444', padding:'4px 8px', borderRadius:6, color:'#fff', fontSize:10}}>
                    {getModels(provider).map(m=> (<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                  <button onClick={() => setModelsRefreshTick(v => v + 1)} style={{
                    padding: '4px 8px',
                    background: '#333',
                    border: '1px solid #444',
                    borderRadius: 6,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 10,
                    whiteSpace: 'nowrap'
                  }}>
                    Refresh
                  </button>
                  {provider === 'OpenRouter' && (
                    <button onClick={() => setShowPriceList(true)} style={{
                      padding: '4px 8px',
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: 6,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 10,
                      whiteSpace: 'nowrap'
                    }}>
                      Price List
                    </button>
                  )}
              </div>
          </div>

          {/* API Key Input (Standard Only) */}
          {provider !== 'OpenRouter' && (
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
              <label style={{fontSize:10, color:'#aaa', width:80, flexShrink:0}}>{t.apiKey}</label>
              <div style={{flex:1, display:'flex', gap:5, flexDirection:'column'}}>
                  <input 
                    type="text" 
                    value={isApiKeyFocused ? apiKey : (apiKey.length > 3 ? apiKey.substring(0,3)+'•••' : apiKey)}
                    onChange={e=>{
                        const val = e.target.value;
                        setApiKey(val);
                        
                        const detectedProvider = detectProviderFromApiKey(val);
                        if (detectedProvider && detectedProvider !== provider && val.length > 5) {
                            setProvider(detectedProvider);
                            const cheapestModel = getCheapestModel(detectedProvider);
                            if (cheapestModel) {
                                setModel(cheapestModel);
                                showToast(lang === 'id' ? `${detectedProvider} terdeteksi. Model diatur ke ${cheapestModel}` : `${detectedProvider} detected. Model set to ${cheapestModel}`, 'success');
                            } else {
                                showToast(lang === 'id' ? `${detectedProvider} terdeteksi.` : `${detectedProvider} detected.`, 'success');
                            }
                        }
                        
                        if (detectedProvider === 'OpenAI' && val && !val.startsWith('sk-proj-') && !val.startsWith('sk-')) {
                            setApiKeyError(t.apiKeyHintOpenai);
                        } else if (detectedProvider === 'Gemini' && val && !val.startsWith('AIza')) {
                            setApiKeyError(t.apiKeyHintGemini);
                        } else {
                            setApiKeyError('');
                        }
                    }} 
                    onFocus={()=>setIsApiKeyFocused(true)}
                    onBlur={()=>setIsApiKeyFocused(false)}
                    placeholder={t.apiKeyPlaceholder}
                    style={{width:'100%', borderColor: apiKeyError ? 'red' : '#444', borderStyle:'solid', borderWidth:1, padding:'4px 8px', borderRadius:6, background:'#111', color:'#eee', fontSize:10}}
                  />
                  {apiKeyError && <div style={{color:'#ff5252', fontSize: 9}}>{apiKeyError}</div>}
              </div>
          </div>
          )}
          <div style={{display:'flex', justifyContent:'space-between', marginTop:10, borderTop:'1px solid #333', paddingTop:8}}>
              <div style={{color:'#777', fontSize: 9, display:'flex', alignItems:'center'}}>
                  {provider === 'OpenRouter' ? '' : (apiKeyEncrypted ? t.saved : t.notSaved)}
              </div>
              <div style={{display:'flex', gap:6}}>
                  <button 
                    onClick={provider === 'OpenRouter' ? async () => {
                        setTestingConnection(true);
                        try {
                           const res = await invoke<string>('test_api_connection', { provider, apiKey: 'mock-key', endpoint: openRouterEndpoint?.trim() || undefined });
                           if (res === 'Success') showToast(t.connectedSuccess, 'success');
                           else showToast(res, 'error');
                        } catch(e: any) {
                           showToast(String(e), 'error');
                        } finally {
                           setTestingConnection(false);
                        }
                    } : testConnection} 
                    disabled={testingConnection}
                    title={t.testConnectionTitle}
                    style={{background:'#3b74a8', border:'none', color:'#fff', borderRadius:6, padding:'4px 8px', cursor:'pointer', opacity: testingConnection ? 0.7 : 0.9, fontSize: 10}}
                  >
                    {testingConnection ? t.testing : (provider === 'OpenRouter' ? t.testAiGateway : t.testApiKey)}
                  </button>
                  <button 
                    onClick={provider === 'OpenRouter' ? applySettings : saveApiKey} 
                    title={t.saveSettingsTitle}
                    style={{background:'#4f8f66', border:'none', color:'#fff', borderRadius:6, padding:'4px 8px', cursor:'pointer', opacity:0.9, fontSize: 10}}
                  >
                    {t.save}
                  </button>
              </div>
          </div>
      </div>
      )}
      
      {activeTab==='Generation' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 8 }}>
        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 12, minWidth: 0 }}>
          <div style={{ color: '#a1a1aa', fontSize: 11, fontWeight: 700, marginBottom: 10 }}>{t.generationPerformance}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.threads}</div>
              <input 
                type="number" 
                value={threads} 
                onChange={e=>{
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) { setThreads(1); return; }
                  setThreads(Math.max(1, Math.min(n, 10)));
                }} 
                min={1} 
                max={10} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.retry}</div>
              <input 
                type="number" 
                value={retry} 
                onChange={e=>setRetry(Number(e.target.value))} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 12, minWidth: 0 }}>
          <div style={{ color: '#a1a1aa', fontSize: 11, fontWeight: 700, marginBottom: 10 }}>{t.generationTitle}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.titleMin}</div>
              <input 
                type="number" 
                value={tmin} 
                onChange={e=>setTmin(Number(e.target.value))} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.titleMax}</div>
              <input 
                type="number" 
                value={tmax} 
                onChange={e=>setTmax(Number(e.target.value))} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 12, minWidth: 0 }}>
          <div style={{ color: '#a1a1aa', fontSize: 11, fontWeight: 700, marginBottom: 10 }}>{t.generationTags}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.tagsMin}</div>
              <input 
                type="number" 
                value={kmin} 
                onChange={e=>setKmin(Number(e.target.value))} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.tagsMax}</div>
              <input 
                type="number" 
                value={kmax} 
                onChange={e=>setKmax(Number(e.target.value))} 
                style={{ width: '100%', background: '#18181b', border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 12, minWidth: 0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10 }}>
            <div style={{ color: '#a1a1aa', fontSize: 11, fontWeight: 700 }}>{t.generationDescription}</div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11, color:'#888', minWidth:24, textAlign:'right'}}>{descEnabled ? t.on : t.off}</span>
              <button
                onClick={async ()=>{
                  const next = !descEnabled;
                  setDescEnabled(next);
                  // Preserve values in UI state, but save as 0 if disabled
                  if (loaded) {
                    await saveSilent({ 
                      description_min_chars: next ? dmin : 0, 
                      description_max_chars: next ? dmax : 0 
                    });
                  }
                }}
                style={{
                  width:26,
                  height:14,
                  borderRadius:7,
                  background: descEnabled ? '#4caf50' : '#444',
                  border:'1px solid #666',
                  position:'relative',
                  padding:0,
                  cursor:'pointer',
                }}
                aria-label={t.aria?.toggleDescription || 'Toggle Description'}
              >
                <span style={{
                  display:'block',
                  width:10,
                  height:10,
                  borderRadius:'50%',
                  background:'#fff',
                  position:'absolute',
                  top:1,
                  left: descEnabled ? 13 : 1,
                  transition: 'left 0.2s'
                }}></span>
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.descMin}</div>
              <input 
                type="number" 
                value={dmin} 
                onChange={e=>setDmin(Number(e.target.value))} 
                disabled={!descEnabled}
                style={{ width: '100%', background: descEnabled ? '#18181b' : '#0f0f12', opacity: descEnabled ? 1 : 0.5, border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: 10, marginBottom: 4 }}>{t.descMax}</div>
              <input 
                type="number" 
                value={dmax} 
                onChange={e=>setDmax(Number(e.target.value))} 
                disabled={!descEnabled}
                style={{ width: '100%', background: descEnabled ? '#18181b' : '#0f0f12', opacity: descEnabled ? 1 : 0.5, border: '1px solid #27272a', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 11, outline: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>
      )}

      {activeTab==='Selection' && (
      <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <label>{t.imageSelection}</label>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{selectionEnabled ? t.on : t.off}</span>
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
            aria-label={t.aria?.toggleImageSelection || 'Toggle Image Selection'}
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
      )}
      {selectionEnabled && activeTab==='Selection' && (
        <>
          <div className="setting-row">
            <label>{t.selectionOrder}</label>
            <select value={selectionOrder} onChange={e=>setSelectionOrder(e.target.value as any)}>
              <option value="before">{t.beforeGenerate}</option>
              <option value="after">{t.afterGenerate}</option>
            </select>
          </div>

          <div style={{display:'flex', gap:12, marginTop:12}}>
            <div style={{width: embedded ? 90 : 110, flex:'0 0 auto', display:'flex', flexDirection:'column', gap:6}}>
              {([
                { key: 'Human', label: t.selectionTabs?.human || (lang === 'id' ? 'Manusia' : 'Human') },
                { key: 'Animal', label: t.selectionTabs?.animal || (lang === 'id' ? 'Hewan' : 'Animal') },
                { key: 'Text', label: t.selectionTabs?.text || (lang === 'id' ? 'Teks' : 'Text') },
                { key: 'Other', label: t.selectionTabs?.other || (lang === 'id' ? 'Lainnya' : 'Other') },
              ] as const).map(x => (
                <button
                  key={x.key}
                  onClick={()=>setSelectionSubTab(x.key)}
                  style={{
                    background: selectionSubTab===x.key ? '#18181b' : 'transparent',
                    border: '1px solid #27272a',
                    color: '#fff',
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 11,
                    textAlign: 'left',
                    opacity: selectionSubTab===x.key ? 1 : 0.7
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>

            <div style={{flex:1, minWidth:0}}>
              {selectionSubTab==='Human' && (
                <div className="setting-group" style={{marginTop:0, display:'grid', gridTemplateColumns: '1fr 1fr', gap:10}}>
                  <div style={{gridColumn: '1 / -1'}}>
                    <label className="checkline"><input type="checkbox" checked={checkHumanPresence} onChange={e=>{
                      const v = e.target.checked;
                      setCheckHumanPresence(v);
                      if(v) {
                        const hasAny =
                          humanFilterFullFace ||
                          humanFilterNoHead ||
                          humanFilterPartialPerfect ||
                          humanFilterPartialDefect ||
                          humanFilterBackView ||
                          humanFilterUnclear ||
                          humanFilterFaceOnly ||
                          humanFilterNudity;
                        if (!hasAny) {
                          setHumanFilterFullFace(true); setHumanFilterNoHead(true); setHumanFilterPartialPerfect(true);
                          setHumanFilterPartialDefect(true); setHumanFilterBackView(true); setHumanFilterUnclear(true);
                          setHumanFilterFaceOnly(true); setHumanFilterNudity(true);
                        }
                      }
                    }} /><span>{t.humanPresence}</span></label>
                    
                    <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:4, marginLeft: 20, marginTop: 4, opacity: checkHumanPresence ? 1 : 0.45}}>
                      {[
                        { label: t.filters.fullBody, val: humanFilterFullFace, set: setHumanFilterFullFace },
                        { label: t.filters.noHead, val: humanFilterNoHead, set: setHumanFilterNoHead },
                        { label: t.filters.partialPerfect, val: humanFilterPartialPerfect, set: setHumanFilterPartialPerfect },
                        { label: t.filters.partialDefect, val: humanFilterPartialDefect, set: setHumanFilterPartialDefect },
                        { label: t.filters.backView, val: humanFilterBackView, set: setHumanFilterBackView },
                        { label: t.filters.unclear, val: humanFilterUnclear, set: setHumanFilterUnclear },
                        { label: t.filters.faceOnly, val: humanFilterFaceOnly, set: setHumanFilterFaceOnly },
                        { label: t.filters.nudity, val: humanFilterNudity, set: setHumanFilterNudity },
                      ].map((opt, i) => (
                        <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} disabled={!checkHumanPresence} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectionSubTab==='Animal' && (
                <div className="setting-group" style={{marginTop:0, display:'grid', gridTemplateColumns: '1fr 1fr', gap:10}}>
                  <div style={{gridColumn: '1 / -1'}}>
                    <label className="checkline"><input type="checkbox" checked={checkAnimalPresence} onChange={e=>{
                      const v = e.target.checked;
                      setCheckAnimalPresence(v);
                      if(v) {
                        const hasAny =
                          animalFilterFullFace ||
                          animalFilterNoHead ||
                          animalFilterPartialPerfect ||
                          animalFilterPartialDefect ||
                          animalFilterBackView ||
                          animalFilterUnclear ||
                          animalFilterFaceOnly ||
                          animalFilterNudity;
                        if (!hasAny) {
                          setAnimalFilterFullFace(true); setAnimalFilterNoHead(true); setAnimalFilterPartialPerfect(true);
                          setAnimalFilterPartialDefect(true); setAnimalFilterBackView(true); setAnimalFilterUnclear(true);
                          setAnimalFilterFaceOnly(true); setAnimalFilterNudity(true);
                        }
                      }
                    }} /><span>{t.animalPresence}</span></label>
                    
                    <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:4, marginLeft: 20, marginTop: 4, opacity: checkAnimalPresence ? 1 : 0.45}}>
                      {[
                        { label: t.filters.fullBody, val: animalFilterFullFace, set: setAnimalFilterFullFace },
                        { label: t.filters.noHead, val: animalFilterNoHead, set: setAnimalFilterNoHead },
                        { label: t.filters.partialPerfect, val: animalFilterPartialPerfect, set: setAnimalFilterPartialPerfect },
                        { label: t.filters.partialDefect, val: animalFilterPartialDefect, set: setAnimalFilterPartialDefect },
                        { label: t.filters.backView, val: animalFilterBackView, set: setAnimalFilterBackView },
                        { label: t.filters.unclear, val: animalFilterUnclear, set: setAnimalFilterUnclear },
                        { label: t.filters.faceOnly, val: animalFilterFaceOnly, set: setAnimalFilterFaceOnly },
                        { label: t.filters.mating, val: animalFilterNudity, set: setAnimalFilterNudity },
                      ].map((opt, i) => (
                        <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} disabled={!checkAnimalPresence} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectionSubTab==='Text' && (
                <div className="setting-group" style={{marginTop:0, display:'grid', gridTemplateColumns: '1fr 1fr', gap:10}}>
                  <div style={{gridColumn: '1 / -1'}}>
                    <label className="checkline"><input type="checkbox" checked={checkTextOrTextLike} onChange={e=>{
                      const v = e.target.checked;
                      setCheckTextOrTextLike(v);
                      if(v) {
                        const hasAny =
                          textFilterGibberish ||
                          textFilterNonEnglish ||
                          textFilterIrrelevant ||
                          textFilterRelevant;
                        if (!hasAny) {
                          setTextFilterGibberish(true); setTextFilterNonEnglish(true); setTextFilterIrrelevant(true); setTextFilterRelevant(true);
                        }
                      }
                    }} /><span>{t.textFilter}</span></label>
                    
                    <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:4, marginLeft: 20, marginTop: 4, opacity: checkTextOrTextLike ? 1 : 0.45}}>
                      {[
                        { label: t.filters.gibberish, val: textFilterGibberish, set: setTextFilterGibberish },
                        { label: t.filters.nonEnglish, val: textFilterNonEnglish, set: setTextFilterNonEnglish },
                        { label: t.filters.irrelevant, val: textFilterIrrelevant, set: setTextFilterIrrelevant },
                        { label: t.filters.relevant, val: textFilterRelevant, set: setTextFilterRelevant },
                      ].map((opt, i) => (
                        <label key={i} className="checkline sub-check" style={{color:'#aaa'}}><input type="checkbox" checked={opt.val} disabled={!checkTextOrTextLike} onChange={e=>opt.set(e.target.checked)} style={{accentColor: '#2bd3d3'}} /><span>{opt.label}</span></label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectionSubTab==='Other' && (
                <>
                  <div className="setting-group" style={{marginTop:0, display:'grid', gridTemplateColumns: '1fr 1fr', gap:10}}>
                    <label className="checkline"><input type="checkbox" checked={checkDeformedObject} onChange={e=>setCheckDeformedObject(e.target.checked)} /><span>{t.deformedObject}</span></label>
                    <label className="checkline"><input type="checkbox" checked={checkUnrecognizableSubject} onChange={e=>setCheckUnrecognizableSubject(e.target.checked)} /><span>{t.unrecognizableSubject}</span></label>
                    <label className="checkline"><input type="checkbox" checked={checkBrandLogo} onChange={e=>setCheckBrandLogo(e.target.checked)} /><span>{t.brandLogo}</span></label>
                    <label className="checkline"><input type="checkbox" checked={checkFamousTrademark} onChange={e=>setCheckFamousTrademark(e.target.checked)} /><span>{t.famousTrademark}</span></label>
                    <label className="checkline"><input type="checkbox" checked={checkWatermark} onChange={e=>setCheckWatermark(e.target.checked)} /><span>{t.watermark}</span></label>
                    <label className="checkline"><input type="checkbox" checked={checkDuplicateSimilarity} onChange={e=>setCheckDuplicateSimilarity(e.target.checked)} /><span>{t.duplicateSimilarity}</span></label>
                  </div>

                  {checkDuplicateSimilarity && (
                    <div className="setting-group" style={{marginTop:8}}>
                      <div className="setting-item" style={{width: 'min(280px, 100%)'}}>
                        <label>{t.dupDist}</label>
                        <input type="number" value={duplicateMaxDistance} onChange={e=>setDuplicateMaxDistance(Number(e.target.value))} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      
      {activeTab==='Output' && (
      <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <label>{t.generateCsv}</label>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{generateCsv ? t.on : t.off}</span>
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
            aria-label={t.aria?.toggleCsvGeneration || 'Toggle CSV Generation'}
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
      )}

      {activeTab==='Output' && (
      <div style={{ marginBottom: 10 }}>
        <div className="setting-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <label>{t.renameFile}</label>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11, color:'#888', minWidth:20, textAlign:'right'}}>{renameEnabled ? t.on : t.off}</span>
            <button
              onClick={()=>setRenameEnabled(!renameEnabled)}
              style={{
                width:26, height:14, borderRadius:7,
                background: renameEnabled ? '#4caf50' : '#444',
                border:'1px solid #666', position:'relative', padding:0, cursor:'pointer', marginLeft: 0
              }}
              aria-label={t.aria?.toggleFileRename || 'Toggle File Rename'}
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
                  <span>{t.renameTitle}</span>
              </label>
              <label className="checkline sub-check" style={{color:'#aaa'}}>
                  <input
                    type="checkbox"
                    checked={renameMode === 'datetime'}
                    onChange={()=>setRenameMode('datetime')}
                    style={{accentColor: '#2bd3d3'}}
                  />
                  <span>{t.renameDateTime}</span>
              </label>
              <label className="checkline sub-check" style={{color:'#aaa'}}>
                  <input
                    type="checkbox"
                    checked={renameMode === 'custom'}
                    onChange={()=>setRenameMode('custom')}
                    style={{accentColor: '#2bd3d3'}}
                  />
                  <span>{t.renameCustom}</span>
              </label>
              {renameMode === 'custom' && (
                  <input 
                      type="text" 
                      value={renameCustomText} 
                      onChange={e=>setRenameCustomText(e.target.value)} 
                      placeholder={t.customNamePlaceholder}
                      style={{marginLeft: 20, padding: '4px 8px', background: '#333', border: '1px solid #555', color: 'white', borderRadius: 4, width: 200}}
                  />
              )}
          </div>
        )}
      </div>
      )}
      
      {activeTab==='Output' && (
      <>
        <label>{t.bannedWords}</label>
        <textarea value={banned} onChange={e=>setBanned(e.target.value)} rows={3} />
      </>
      )}
      
      {activeTab==='Output' && (
      <div style={{marginTop:10, display:'flex', gap:10, justifyContent:'flex-end'}}>
          <div style={{display:'flex', gap:10}}>
              <button 
                  className="btn-apply"
                  onClick={applySettings} 
                  title={t.applyTooltip}
              >
                  {t.apply}
              </button>
              {!embedded && <button onClick={onBack} style={{padding:'6px 10px', cursor:'pointer', fontSize:11, borderRadius:6, border:'1px solid #666', background:'transparent', color:'#ccc'}}>{t.back}</button>}
          </div>
        </div>
      )}

      {activeTab==='Tools' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14, minWidth: 0 }}>
            <div style={{marginBottom:12, color:'#a1a1aa', fontSize:11, fontWeight:600}}>{t.tools?.csvGenerationHeading || 'CSV Generation'}</div>
            <button 
                onClick={onGenerateCSV} 
                style={{
                    width:'100%', 
                    display:'flex', 
                    gap:10, 
                    padding:'10px 14px', 
                    background:'#18181b', 
                    borderRadius:8, 
                    alignItems:'center', 
                    border:'1px solid #3f3f46', 
                    cursor:'pointer', 
                    color:'#e4e4e7',
                    textAlign:'left'
                }}
            >
                <div style={{width:10, height:10, borderRadius:3, background:'#10b981', flexShrink:0}}></div>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                    <span style={{fontSize:12, fontWeight:600}}>{t.tools?.generateCsvTitle || 'Generate CSV'}</span>
                    <span style={{fontSize:10, color:'#71717a'}}>{t.tools?.generateCsvDesc || 'Export logs to CSV format'}</span>
                </div>
            </button>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14, minWidth: 0 }}>
            <div style={{marginBottom:12, color:'#a1a1aa', fontSize:11, fontWeight:600}}>{t.tools?.duplicateHeading || 'Duplicate Check'}</div>
            <button 
                onClick={onOpenDupConfig} 
                style={{
                    width:'100%', 
                    display:'flex', 
                    gap:10, 
                    padding:'10px 14px', 
                    background:'#18181b', 
                    borderRadius:8, 
                    alignItems:'center', 
                    border:'1px solid #3f3f46', 
                    cursor:'pointer', 
                    color:'#e4e4e7',
                    textAlign:'left'
                }}
            >
                <div style={{width:10, height:10, borderRadius:3, background:'#38bdf8', flexShrink:0}}></div>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                    <span style={{fontSize:12, fontWeight:600}}>{t.tools?.duplicateCheckTitle || 'Duplicate Check'}</span>
                    <span style={{fontSize:10, color:'#71717a'}}>{t.tools?.duplicateCheckDesc || 'Check for duplicate images'}</span>
                </div>
            </button>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14, minWidth: 0 }}>
            <div style={{marginBottom:12, color:'#a1a1aa', fontSize:11, fontWeight:600}}>{t.tools?.metadataRemovalHeading || 'Metadata Removal'}</div>
            <button 
                onClick={async ()=>{
                    try {
                        const dir = await pick({ directory: true, multiple: false, title: t.tools?.selectFolderImagesVideos || 'Select Folder (Images/Videos)' });
                        if (!dir) return;
                        showToast(t.tools?.removingMetadataToast || 'Removing metadata...', 'info');
                        const res = await invoke<string>('strip_metadata_batch', { inputFolder: String(dir), recurse: true });
                        if (res) showToast(t.tools?.metadataRemovedToast || 'Metadata removed successfully', 'success');
                    } catch(e:any){
                        showToast(String(e).replace('Error: ', ''), 'error');
                    }
                }} 
                style={{
                    width:'100%', 
                    display:'flex', 
                    gap:10, 
                    padding:'10px 14px', 
                    background:'#18181b', 
                    borderRadius:8, 
                    alignItems:'center', 
                    border:'1px solid #3f3f46', 
                    cursor:'pointer', 
                    color:'#e4e4e7',
                    textAlign:'left'
                }}
            >
                <div style={{width:10, height:10, borderRadius:3, background:'#f97316', flexShrink:0}}></div>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                    <span style={{fontSize:12, fontWeight:600}}>{t.tools?.removeMetadataBatchTitle || 'Remove Metadata (Batch)'}</span>
                    <span style={{fontSize:10, color:'#71717a'}}>{t.tools?.removeMetadataBatchDesc || 'Remove metadata (images & videos)'}</span>
                </div>
            </button>
        </div>

        <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 12, padding: 14, minWidth: 0 }}>
            <div style={{marginBottom:12, color:'#a1a1aa', fontSize:11, fontWeight:600}}>{t.tools?.aiClusterHeading || 'AI Cluster'}</div>
            <button 
                onClick={onRunAiCluster} 
                style={{
                    width:'100%', 
                    display:'flex', 
                    gap:10, 
                    padding:'10px 14px', 
                    background:'#18181b', 
                    borderRadius:8, 
                    alignItems:'center', 
                    border:'1px solid #3f3f46', 
                    cursor:'pointer', 
                    color:'#e4e4e7',
                    textAlign:'left'
                }}
            >
                <div style={{width:10, height:10, borderRadius:3, background:'#8b5cf6', flexShrink:0}}></div>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                    <span style={{fontSize:12, fontWeight:600}}>{t.tools?.aiClusterTitle || 'AI Cluster'}</span>
                    <span style={{fontSize:10, color:'#71717a'}}>{t.tools?.aiClusterDesc || 'Cluster images using AI'}</span>
                </div>
            </button>
        </div>
      </div>
      )}


        </div>
      </div>
      {showPriceList && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20
        }} onClick={() => setShowPriceList(false)}>
          <div style={{
            background: '#18181b', border: '1px solid #333', borderRadius: 12,
            width: '100%', maxWidth: 600, maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{padding: '16px 20px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <h3 style={{margin: 0, fontSize: 16, color: '#fff'}}>{t.tools?.priceListTitle || 'AI Gateway Price List'}</h3>
              <button onClick={() => setShowPriceList(false)} style={{background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 20}}>×</button>
            </div>
            <div style={{padding: 20, overflowY: 'auto'}}>
              <p style={{fontSize: 12, color: '#888', marginBottom: 16}}>
                Harga OpenRouter per 1Juta token (Input / Output).
              </p>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                <thead>
                  <tr style={{borderBottom: '1px solid #333', textAlign: 'left'}}>
                    <th style={{padding: '8px 4px', color: '#888'}}>{t.tools?.priceListColModel || 'Model'}</th>
                    <th style={{padding: '8px 4px', color: '#888', textAlign: 'right'}}>{t.tools?.priceListColInput || 'Input / 1M'}</th>
                    <th style={{padding: '8px 4px', color: '#888', textAlign: 'right'}}>{t.tools?.priceListColOutput || 'Output / 1M'}</th>
                  </tr>
                </thead>
                <tbody>
                  {openRouterLiveModels.length > 0 ? openRouterLiveModels
                    .filter(m => {
                      if (isOpenRouterBlockedModel(m.id, m.name)) return false
                      const modality = String(m.architecture?.modality || '').toLowerCase()
                      const inputs = (m.architecture?.input_modalities || []).map(x => String(x).toLowerCase())
                      const hasVision =
                        modality.includes('image') ||
                        modality.includes('video') ||
                        modality.includes('vision') ||
                        inputs.some(i => i.includes('image') || i.includes('video') || i.includes('vision')) ||
                        (m.pricing && (m.pricing as any).image !== undefined && (m.pricing as any).image !== null) ||
                        isVisionLikeModelId(m.id)
                      if (!hasVision) return false
                      return openRouterSelectableIds.has(m.id)
                    })
                    .sort((a, b) => {
                       const isFree = (m: any) => {
                         const p = Number(m?.pricing?.prompt) || 0
                         const c = Number(m?.pricing?.completion) || 0
                         const r = Number(m?.pricing?.request) || 0
                         const i = Number(m?.pricing?.image) || 0
                         return p === 0 && c === 0 && r === 0 && i === 0
                       }
                       const getPrice = (m: any) => {
                         const p = Number(m?.pricing?.prompt) || 0
                         const c = Number(m?.pricing?.completion) || 0
                         return p + c
                       }
                       const fa = isFree(a) ? 1 : 0
                       const fb = isFree(b) ? 1 : 0
                       if (fa !== fb) return fb - fa
                       return getPrice(a) - getPrice(b)
                    })
                    .map(m => {
                      const formatUsdPer1M = (value: number) => {
                        const n = Number(value)
                        if (!Number.isFinite(n)) return '0.00'
                        const abs = Math.abs(n)
                        if (abs > 0 && abs < 0.01) {
                          const s = n.toFixed(7)
                          return s.replace(/0+$/,'').replace(/\.$/,'')
                        }
                        return n.toFixed(2)
                      }

                      const pRaw = Number(m.pricing?.prompt) || 0
                      const cRaw = Number(m.pricing?.completion) || 0
                      const pValue = pRaw * 1_000_000
                      const cValue = cRaw * 1_000_000
                      const pDisplay = formatUsdPer1M(pValue)
                      const cDisplay = formatUsdPer1M(cValue)
                      
                      return (
                        <tr key={m.id} style={{borderBottom: '1px solid #222'}}>
                          <td style={{padding: '8px 4px', color: '#eee'}}>{sanitizeOpenRouterLabel(m.name || m.id, m.id)}</td>
                          <td style={{padding: '8px 4px', color: '#ccc', textAlign: 'right'}}>${pDisplay}</td>
                          <td style={{padding: '8px 4px', color: '#ccc', textAlign: 'right'}}>${cDisplay}</td>
                        </tr>
                      )
                    }) : (
                      <tr><td colSpan={3} style={{padding: 20, textAlign: 'center', color: '#666'}}>No models loaded. Please check connection.</td></tr>
                    )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
