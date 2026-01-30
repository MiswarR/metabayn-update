import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/// <reference types="vite/client" />
import { useEffect, useState, Component } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { listen } from '@tauri-apps/api/event';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';
import AdminTopup from './pages/AdminTopup';
import VideoPlayerWindow from './pages/VideoPlayerWindow';
import { apiGetBalance, isValidToken, getTokenLocal, clearTokenLocal } from './api/backend';
// Error Boundary Component to catch runtime errors
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (_jsxs("div", { style: { padding: 20, color: '#f44336', background: '#111', height: '100vh', overflow: 'auto' }, children: [_jsx("h2", { children: "Something went wrong." }), _jsx("details", { style: { whiteSpace: 'pre-wrap' }, children: this.state.error && this.state.error.toString() }), _jsx("button", { onClick: () => window.location.reload(), style: { marginTop: 20, padding: '10px 20px', background: '#333', color: '#fff', border: 'none', cursor: 'pointer' }, children: "Reload App" })] }));
        }
        return this.props.children;
    }
}
export default function App() {
    const [token, setToken] = useState('');
    // Initial state check for video player
    const [page, setPage] = useState(() => {
        if (window.location.search.includes('video_id='))
            return 'video_player';
        return 'login';
    });
    const [isProcessing, setIsProcessing] = useState(false);
    // Skip booting screen for video player
    const [booting, setBooting] = useState(() => {
        if (window.location.search.includes('video_id='))
            return false;
        return true;
    });
    // --- UPDATE LOGIC ---
    const [updateModal, setUpdateModal] = useState(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState(0);
    const [updateStatusText, setUpdateStatusText] = useState('');
    async function checkForUpdates() {
        try {
            const { shouldUpdate, manifest } = await checkUpdate();
            if (shouldUpdate) {
                setUpdateModal(manifest);
            }
        }
        catch (e) {
            console.error("Update check failed:", e);
        }
    }
    async function performUpdate() {
        setIsUpdating(true);
        setUpdateProgress(0);
        setUpdateStatusText('Initializing...');
        let downloaded = 0;
        let total = 0;
        // Listen to download progress
        const unlisten = await listen('tauri://update-download-progress', (event) => {
            const { chunkLength, contentLength } = event.payload;
            downloaded += chunkLength;
            if (contentLength)
                total = contentLength;
            if (total > 0) {
                const pct = Math.round((downloaded / total) * 100);
                setUpdateProgress(pct);
                setUpdateStatusText(`Downloading... ${pct}%`);
            }
            else {
                setUpdateStatusText(`Downloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
            }
        });
        try {
            setUpdateStatusText('Installing...');
            await installUpdate();
            setUpdateStatusText('Restarting...');
            await relaunch();
        }
        catch (e) {
            setIsUpdating(false);
            alert(`Update failed: ${e}`);
            setUpdateModal(null);
        }
        finally {
            unlisten();
        }
    }
    useEffect(() => {
        // Skip init if we are in video player mode
        if (page === 'video_player')
            return;
        // Check for updates immediately on startup
        checkForUpdates();
        init();
        // Safety timeout: force boot off after 5 seconds if backend hangs
        const timer = setTimeout(() => {
            setBooting(false);
        }, 5000);
        return () => clearTimeout(timer);
    }, []);
    useEffect(() => {
        const pressed = new Set();
        let lastKey = '';
        let lastKeyTime = 0;
        function onDown(e) {
            const k = e.key.toLowerCase();
            pressed.add(k);
            if (e.shiftKey && e.ctrlKey) {
                const bActive = pressed.has('b');
                const yActive = pressed.has('y');
                const now = Date.now();
                if ((bActive && yActive) ||
                    (k === 'y' && lastKey === 'b' && now - lastKeyTime < 1000) ||
                    (k === 'b' && lastKey === 'y' && now - lastKeyTime < 1000)) {
                    setToken('');
                    setPage('login');
                    clearTokenLocal();
                    invoke('logout');
                    return;
                }
                if (k === 'b' || k === 'y') {
                    lastKey = k;
                    lastKeyTime = now;
                }
            }
        }
        function onUp(e) {
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
        import('@tauri-apps/api/event').then(({ listen }) => {
            const unlisten = listen('deep-link', (event) => {
                const url = event.payload;
                console.log('Deep Link received:', url);
                // Parse token: metabayn://auth?token=XYZ
                if (url.includes('token=')) {
                    const extractedToken = url.split('token=')[1].split('&')[0];
                    if (extractedToken) {
                        setToken(extractedToken);
                        setPage('dashboard');
                        // Save auth persistence
                        invoke('save_auth_token', { token: extractedToken }).catch(console.error);
                    }
                }
            });
            return () => { unlisten.then(f => f()); };
        });
    }, []);
    async function init() {
        try {
            // 1. Check LocalStorage first (Fastest)
            let t = getTokenLocal();
            // 2. If not in LS, check Rust Settings
            if (!t) {
                const s = await invoke('get_settings');
                if (s?.auth_token)
                    t = s.auth_token;
            }
            if (t && isValidToken(t)) {
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
                        invoke('logout');
                    }
                    else {
                        console.log("Offline or Server Error, keeping session active: " + msg);
                    }
                });
            }
            else if (t) {
                // Token exists but expired/invalid structure
                console.log("Token expired locally");
                clearTokenLocal();
                invoke('logout');
            }
        }
        catch (e) {
            console.error("Error loading configuration: " + e);
        }
        setBooting(false);
    }
    // TUI Boot Screen removed - restoring standard behavior
    // We can keep the logic but remove the visual delay/screen if desired, 
    // or just show a minimal loader. For "previous design", we likely had no boot screen.
    if (booting) {
        return (_jsxs("div", { style: {
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
            }, children: [_jsx("div", { children: "Loading Application Configuration..." }), _jsx("button", { onClick: () => setBooting(false), style: { marginTop: 20, padding: '10px 20px', cursor: 'pointer', background: '#333', color: 'white', border: '1px solid #555' }, children: "Force Start" })] }));
    }
    // Simple secret key navigation (e.g., from Settings or hidden shortcut)
    // For now, we can add a button in Settings or Dashboard to go to Admin if user is admin.
    // Or expose it via onAdmin prop from Dashboard/Settings.
    return (_jsx(ErrorBoundary, { children: page === 'video_player' ? (_jsx(VideoPlayerWindow, {})) : (_jsx("div", { className: "app", children: _jsxs("div", { className: "app-content", style: { flex: 1, overflow: 'hidden', position: 'relative' }, children: [page === 'login' && _jsx(Login, { onSuccess: (t) => { setToken(t); setPage('dashboard'); } }), token && (_jsx("div", { style: { display: page === 'dashboard' ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }, children: _jsx(Dashboard, { token: token, onSettings: () => setPage('settings'), onAdmin: () => setPage('admin_topup'), onProcessChange: setIsProcessing, isActive: page === 'dashboard' }) })), page === 'settings' && _jsx(Settings, { onBack: () => setPage(token ? 'dashboard' : 'login') }), page === 'admin_topup' && (_jsx("div", { className: "admin-wrapper", style: { height: '100%', overflow: 'auto' }, children: _jsx(AdminTopup, { token: token, onBack: () => setPage('dashboard'), isProcessing: isProcessing }) })), updateModal && (_jsx("div", { className: "modal open", style: { zIndex: 99999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }, children: _jsxs("div", { className: "modal-content", style: {
                                maxWidth: 480,
                                background: '#1a1a1a',
                                border: '1px solid #333',
                                borderRadius: 12,
                                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                                padding: 0,
                                overflow: 'hidden'
                            }, children: [_jsxs("div", { className: "modal-header", style: {
                                        padding: '20px 24px',
                                        borderBottom: '1px solid #2a2a2a',
                                        background: '#1f1f1f'
                                    }, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 600, color: '#fff' }, children: "Update Available" }), _jsx("div", { style: { fontSize: 13, color: '#888', marginTop: 4 }, children: "A new version of Metabayn Studio is ready." })] }), _jsxs("div", { className: "modal-body", style: { padding: '24px' }, children: [_jsxs("div", { style: { marginBottom: 20 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, children: [_jsx("span", { style: { color: '#ccc', fontSize: 14 }, children: "New Version:" }), _jsxs("span", { style: { background: '#4caf50', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }, children: ["v", updateModal.version] })] }), updateModal.body && (_jsx("div", { style: {
                                                        marginTop: 12,
                                                        padding: 16,
                                                        background: '#111',
                                                        border: '1px solid #2a2a2a',
                                                        borderRadius: 8,
                                                        maxHeight: 180,
                                                        overflowY: 'auto',
                                                        fontSize: 13,
                                                        color: '#ccc',
                                                        lineHeight: 1.6
                                                    }, children: updateModal.body })), isUpdating && (_jsxs("div", { style: { marginTop: 20 }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#aaa' }, children: [_jsx("span", { children: updateStatusText }), _jsxs("span", { children: [updateProgress, "%"] })] }), _jsx("div", { style: { height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' }, children: _jsx("div", { style: { height: '100%', width: `${updateProgress}%`, background: '#4caf50', transition: 'width 0.2s ease-out' } }) })] }))] }), _jsxs("div", { style: {
                                                display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 20, borderTop: '1px solid #2a2a2a'
                                            }, children: [!isUpdating && (_jsx("button", { onClick: () => setUpdateModal(null), style: {
                                                        background: 'transparent',
                                                        border: '1px solid #444',
                                                        color: '#ccc',
                                                        padding: '10px 20px',
                                                        borderRadius: 6,
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: 500,
                                                        transition: 'all 0.2s'
                                                    }, onMouseOver: e => e.currentTarget.style.borderColor = '#666', onMouseOut: e => e.currentTarget.style.borderColor = '#444', children: "Remind Me Later" })), _jsx("button", { onClick: performUpdate, disabled: isUpdating, style: {
                                                        background: isUpdating ? '#333' : '#4caf50',
                                                        border: 'none',
                                                        color: isUpdating ? '#888' : '#fff',
                                                        padding: '10px 24px',
                                                        borderRadius: 6,
                                                        cursor: isUpdating ? 'not-allowed' : 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        boxShadow: isUpdating ? 'none' : '0 4px 12px rgba(76, 175, 80, 0.3)',
                                                        transition: 'all 0.2s',
                                                        display: 'flex', alignItems: 'center', gap: 8
                                                    }, children: isUpdating ? (_jsxs(_Fragment, { children: [_jsx("span", { style: {
                                                                    display: 'inline-block', width: 14, height: 14,
                                                                    border: '2px solid #666', borderTopColor: '#fff', borderRadius: '50%',
                                                                    animation: 'spin 1s linear infinite'
                                                                } }), _jsx("span", { children: "Updating..." }), _jsx("style", { children: `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }` })] })) : 'Update Now' })] })] })] }) }))] }) })) }));
}
