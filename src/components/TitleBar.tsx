import { appWindow } from '@tauri-apps/api/window'
import appPkg from '../../package.json'

export default function TitleBar() {
  return (
    <div 
        className="titlebar" 
        data-tauri-drag-region
        style={{
            position: 'relative', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            zIndex: 9999
        }}
    >
      
      {/* Content Layer - Pointer events none so clicks pass to drag region (the parent) */}
      <div className="title-content" style={{pointerEvents: 'none', position: 'relative', zIndex: 2}}>
        <span style={{fontWeight: 600, fontSize: 12, letterSpacing: '0.02em'}}>Metabayn Studio v{appPkg.version}</span>
      </div>

      {/* Controls Layer - No drag so buttons are clickable */}
      <div className="title-controls" style={{position: 'relative', zIndex: 10000, height: '100%', display: 'flex', WebkitAppRegion: 'no-drag'} as any}>
        <button 
            className="t-btn min" 
            onClick={() => appWindow.minimize()}
            title="Minimize"
            style={{cursor: 'pointer'}}
        >
           <svg width="10" height="1" viewBox="0 0 10 1" style={{pointerEvents:'none'}}><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button 
            className="t-btn close" 
            onClick={() => appWindow.close()}
            title="Close"
            style={{cursor: 'pointer'}}
        >
           <svg width="10" height="10" viewBox="0 0 10 10" style={{pointerEvents:'none'}}><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  )
}
