import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

;(window as any).__METABAYN_BUNDLE_LOADED__ = true

const rootEl = document.getElementById('root') as HTMLElement | null
try {
  if (!rootEl) {
    throw new Error('Root element not found (#root)')
  }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (e) {
  try {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack || ''}` : String(e)
    console.error('[Bootstrap] Failed to mount React app:', e)
    if (rootEl) {
      rootEl.innerText = msg
      ;(rootEl.style as any).whiteSpace = 'pre-wrap'
      ;(rootEl.style as any).fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
      ;(rootEl.style as any).padding = '16px'
      ;(rootEl.style as any).color = '#fca5a5'
      ;(rootEl.style as any).background = '#0b0b0b'
    }
  } catch {}
}
