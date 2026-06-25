import React, { useState } from 'react'

interface LogLineProps {
  log: any
  lang: 'en' | 'id'
  t: any
}

const LogLine: React.FC<LogLineProps> = ({ log: l, lang, t }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  if (l && typeof l === 'object' && l.hidden) return null

  const toggleExpand = () => setIsExpanded(!isExpanded)

  const copyDetail = async () => {
    const text = [l?.text, l?.detail].filter(Boolean).join('\n')
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1500)
    } catch {}
  }

  if (typeof l === 'string') {
    let color = '#aaa'
    const lower = l.toLowerCase()
    if (lower.includes('failed') || lower.includes('error')) color = '#f44336'
    else if (lower.includes('success') || lower.includes('done')) color = '#4caf50'
    else if (lower.includes('warning')) color = '#ff9800'
    else if (lower.includes('found') || lower.includes('scanning')) color = '#fff'

    return <div className="line" style={{ color }}>{l}</div>
  }

  const txt = l.text || ''
  const animate = l.animating !== undefined ? l.animating : (txt.endsWith('Starting...') || txt.startsWith('Processing'))
  const display = txt.replace(/\.\.\.$/, '')
  const hasDetail = !!l.detail

  return (
    <div>
      <div
        className="line"
        style={{
          color: l.color || '#aaa',
          cursor: hasDetail ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
        onClick={() => hasDetail && toggleExpand()}
        title={hasDetail ? t.clickDetails : ""}
      >
        {hasDetail && <span style={{ fontSize: '0.75em', opacity: 0.7 }}>{isExpanded ? '▼' : '▶'}</span>}
        <span>
          {display}
          {animate && <span className="typing-dots"></span>}
        </span>
      </div>
      {isExpanded && l.detail && (
        <div style={{
          marginLeft: '20px',
          padding: '8px',
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderLeft: `2px solid ${l.color || '#aaa'}`,
          fontSize: '0.85em',
          color: '#ddd',
          marginBottom: '4px',
          position: 'relative'
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); copyDetail(); }}
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              padding: '2px 8px',
              fontSize: '0.85em',
              borderRadius: '6px',
              border: '1px solid #3f3f46',
              background: isCopied ? '#166534' : '#27272a',
              color: '#fff',
              cursor: 'pointer'
            }}
            title={lang === 'id' ? 'Salin log' : 'Copy log'}
          >
            {isCopied ? (lang === 'id' ? 'Tersalin' : 'Copied') : (lang === 'id' ? 'Salin' : 'Copy')}
          </button>
          <div style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            userSelect: 'text',
            WebkitUserSelect: 'text',
            cursor: 'text',
            paddingRight: '54px'
          }}>
            {l.detail}
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(LogLine)
