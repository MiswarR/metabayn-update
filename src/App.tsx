/// <reference types="vite/client" />
import React, { useEffect, useState, Component, ErrorInfo } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { appWindow, LogicalSize } from '@tauri-apps/api/window'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { listen } from '@tauri-apps/api/event'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Settings from './pages/Settings'
import AdminTopup from './pages/AdminTopup'
import VideoPlayerWindow from './pages/VideoPlayerWindow'
import TitleBar from './components/TitleBar'
import { apiGetBalance, isValidToken, getTokenLocal, saveTokenLocal, clearTokenLocal } from './api/backend'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'

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
      return (
        <div style={{padding: 20, color: '#f44336', background: '#111', height: '100vh', overflow: 'auto'}}>
          <h2>Something went wrong.</h2>
          <details style={{whiteSpace: 'pre-wrap'}}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button 
            onClick={() => window.location.reload()} 
            style={{marginTop: 20, padding: '10px 20px', background: '#333', color: '#fff', border: 'none', cursor: 'pointer'}}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default function App(){
  const [token,setToken]=useState<string>('')
  
  // Initial state check for video player
  const [page,setPage]=useState<'login'|'dashboard'|'settings'|'admin_topup'|'video_player'>(() => {
    if (window.location.search.includes('video_id=')) return 'video_player';
    return 'login';
  });

  const [isProcessing, setIsProcessing] = useState(false)
  
  // Skip booting screen for video player
  const [booting, setBooting] = useState(() => {
    if (window.location.search.includes('video_id=')) return false;
    return true;
  });

  // --- UPDATE LOGIC ---
  const [updateModal, setUpdateModal] = useState<any>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateStatusText, setUpdateStatusText] = useState('')

  async function checkForUpdates() {
      if (!isTauri) return
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
    if (!isTauri) return
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
            setUpdateStatusText(`Downloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
        }
    });

    try {
        setUpdateStatusText('Installing...')
        await installUpdate()
        setUpdateStatusText('Restarting...')
        await relaunch()
    } catch(e) {
        setIsUpdating(false)
        alert(`Update failed: ${e}`);
        setUpdateModal(null)
    } finally {
        unlisten();
    }
  }
  
  useEffect(()=>{ 
    // Skip init if we are in video player mode
    if (page === 'video_player') return;

    // Check for updates immediately on startup
    if (isTauri) checkForUpdates();

    init();
    
    // Safety timeout: force boot off after 5 seconds if backend hangs
    const timer = setTimeout(() => {
        setBooting(false);
    }, 5000);
    return () => clearTimeout(timer);
  },[])
  
  useEffect(() => {
    const pressed = new Set<string>();
    let lastKey = '';
    let lastKeyTime = 0;

    function onDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      pressed.add(k);

      if (e.shiftKey && e.ctrlKey) {
        const bActive = pressed.has('b');
        const yActive = pressed.has('y');
        const now = Date.now();

        if (
          (bActive && yActive) ||
          (k === 'y' && lastKey === 'b' && now - lastKeyTime < 1000) ||
          (k === 'b' && lastKey === 'y' && now - lastKeyTime < 1000)
        ) {
          setToken('');
          setPage('login');
          clearTokenLocal();
          if (isTauri) invoke('logout');
          return;
        }

        if (k === 'b' || k === 'y') {
          lastKey = k;
          lastKeyTime = now;
        }
      }
    }

    function onUp(e: KeyboardEvent) {
      pressed.delete(e.key.toLowerCase());
    }

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);
  
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
            if (isTauri) invoke('save_auth_token', { token: extractedToken }).catch(console.error);
           }
        }
      });
      return () => { unlisten.then(f => f()); };
    });
  }, []);

  async function init(){
    try { 
        // 1. Check LocalStorage first (Fastest)
        let t = getTokenLocal();
        
        // 2. If not in LS, check Rust Settings
        if (!t && isTauri) {
            const s = await invoke<any>('get_settings');
            if (s?.auth_token) t = s.auth_token;
        }

        if(t && isValidToken(t)){ 
            // Optimistic Login
            setToken(t);
            setPage('dashboard');
            
            // Background Verification
            apiGetBalance(t).catch(e => {
                const msg = String(e).toLowerCase();
                // Only logout if explicit auth error, NOT network error
                if (msg.includes('unauthorized') || msg.includes('invalid') || msg.includes('expired') || msg.includes('401')) {
                    console.log("Session invalid, logging out...");
                    setToken('');
                    setPage('login');
                    clearTokenLocal();
                    if (isTauri) invoke('logout');
                } else {
                    console.log("Offline or Server Error, keeping session active: " + msg);
                }
            });
        } else if (t) {
            // Token exists but expired/invalid structure
            console.log("Token expired locally");
            clearTokenLocal();
            if (isTauri) invoke('logout');
        }
    } catch(e) {
        console.error("Error loading configuration: " + e);
    }
    setBooting(false);
  }

  // TUI Boot Screen removed - restoring standard behavior
  // We can keep the logic but remove the visual delay/screen if desired, 
  // or just show a minimal loader. For "previous design", we likely had no boot screen.
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
            <div>Loading Application Configuration...</div>
            <button onClick={() => setBooting(false)} style={{marginTop: 20, padding: '10px 20px', cursor: 'pointer', background: '#333', color: 'white', border: '1px solid #555'}}>
                Force Start
            </button>
        </div>
      );
  }

  // Simple secret key navigation (e.g., from Settings or hidden shortcut)
  // For now, we can add a button in Settings or Dashboard to go to Admin if user is admin.
  // Or expose it via onAdmin prop from Dashboard/Settings.
  
  return (
    <ErrorBoundary>
      {page === 'video_player' ? (
        <VideoPlayerWindow />
      ) : (
      <div className="app">
        {/* <TitleBar />  REMOVED FOR STANDARD WINDOW DECORATION */}
        <div className="app-content" style={{flex: 1, overflow: 'hidden', position: 'relative'}}>
            {page==='login'&&<Login onSuccess={(t)=>{setToken(t);setPage('dashboard')}} />}
            
            {/* Keep Dashboard Alive for Background Processing */}
            {token && (
              <div style={{display: page==='dashboard' ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden'}}>
                  <Dashboard 
                      token={token} 
                      onSettings={()=>setPage('settings')} 
                      onAdmin={() => setPage('admin_topup')} 
                      onProcessChange={setIsProcessing}
                      isActive={page==='dashboard'}
                  />
              </div>
            )}

            {page==='settings'&&<Settings onBack={()=>setPage(token? 'dashboard':'login')} />}
            
            {page==='admin_topup' && (
                <div className="admin-wrapper" style={{height:'100%', overflow:'auto'}}>
                    <AdminTopup token={token} onBack={() => setPage('dashboard')} isProcessing={isProcessing} />
                </div>
            )}

            {/* --- GLOBAL UPDATE MODAL --- */}
            {updateModal && (
                <div className="modal open" style={{zIndex: 99999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)'}}>
                    <div className="modal-content" style={{
                        maxWidth: 480, 
                        background: '#1a1a1a', 
                        border: '1px solid #333', 
                        borderRadius: 12, 
                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                        padding: 0,
                        overflow: 'hidden'
                    }}>
                        <div className="modal-header" style={{
                            padding: '20px 24px', 
                            borderBottom: '1px solid #2a2a2a',
                            background: '#1f1f1f'
                        }}>
                            <div style={{fontSize: 18, fontWeight: 600, color: '#fff'}}>Update Available</div>
                            <div style={{fontSize: 13, color: '#888', marginTop: 4}}>A new version of Metabayn Studio is ready.</div>
                        </div>
                        
                        <div className="modal-body" style={{padding: '24px'}}>
                            <div style={{marginBottom:20}}>
                                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 12}}>
                                    <span style={{color: '#ccc', fontSize: 14}}>New Version:</span>
                                    <span style={{background: '#4caf50', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600}}>v{updateModal.version}</span>
                                </div>
                                
                                {updateModal.body && (
                                    <div style={{
                                        marginTop:12, 
                                        padding:16, 
                                        background:'#111', 
                                        border: '1px solid #2a2a2a',
                                        borderRadius:8, 
                                        maxHeight:180, 
                                        overflowY:'auto',
                                        fontSize: 13,
                                        color: '#ccc',
                                        lineHeight: 1.6
                                    }}>
                                        {updateModal.body}
                                    </div>
                                )}

                                {isUpdating && (
                                    <div style={{marginTop:20}}>
                                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12, color:'#aaa'}}>
                                            <span>{updateStatusText}</span>
                                            <span>{updateProgress}%</span>
                                        </div>
                                        <div style={{height:6, background:'#333', borderRadius:3, overflow:'hidden'}}>
                                            <div style={{height:'100%', width:`${updateProgress}%`, background:'#4caf50', transition:'width 0.2s ease-out'}}></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Actions */}
                            <div style={{
                                display:'flex', justifyContent:'flex-end', gap:12, paddingTop: 20, borderTop: '1px solid #2a2a2a'
                            }}>
                                {!isUpdating && (
                                    <button 
                                        onClick={()=>setUpdateModal(null)}
                                        style={{
                                            background:'transparent', 
                                            border:'1px solid #444', 
                                            color:'#ccc', 
                                            padding:'10px 20px', 
                                            borderRadius:6,
                                            cursor:'pointer', 
                                            fontSize:'13px',
                                            fontWeight: 500,
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.borderColor = '#666'}
                                        onMouseOut={e => e.currentTarget.style.borderColor = '#444'}
                                    >
                                        Remind Me Later
                                    </button>
                                )}
                                <button 
                                    onClick={performUpdate}
                                    disabled={isUpdating}
                                    style={{
                                        background: isUpdating ? '#333' : '#4caf50', 
                                        border: 'none',
                                        color: isUpdating ? '#888' : '#fff', 
                                        padding:'10px 24px', 
                                        borderRadius:6, 
                                        cursor: isUpdating ? 'not-allowed' : 'pointer', 
                                        fontSize:'13px', 
                                        fontWeight:'600',
                                        boxShadow: isUpdating ? 'none' : '0 4px 12px rgba(76, 175, 80, 0.3)',
                                        transition:'all 0.2s',
                                        display: 'flex', alignItems: 'center', gap: 8
                                    }}
                                >
                                    {isUpdating ? (
                                        <>
                                          <span style={{
                                            display:'inline-block', width:14, height:14, 
                                            border:'2px solid #666', borderTopColor:'#fff', borderRadius:'50%',
                                            animation:'spin 1s linear infinite'
                                          }}/>
                                          <span>Updating...</span>
                                          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                                        </>
                                    ) : 'Update Now'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>
      )}
    </ErrorBoundary>
  )
}
