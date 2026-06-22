import React, { useEffect, useRef, useState, memo } from 'react'
import { translations } from '../utils/translations';

interface LogLineProps {
  log: any;
  lang: 'en' | 'id';
  t: any;
}

/**
 * ⚡ Bolt Optimization: LogLine is memoized to prevent unnecessary re-renders.
 * During batch processing, new logs are added frequently. Memoization ensures
 * that existing log lines don't re-render unless their specific content changes.
 * Localized state (isExpanded, isCopied) also prevents parent-level re-renders
 * when interacting with a single log line.
 */
const LogLine = memo(({ log, lang, t }: LogLineProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const copyDetail = async () => {
    const text = [log?.text, log?.detail].filter(Boolean).join('\n');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch {}
  }

  if (!log) return null;
  if (typeof log === 'object' && log.hidden) return null;

  if (typeof log === 'string') {
    let color = '#aaa';
    const lower = log.toLowerCase();
    if (lower.includes('failed') || lower.includes('error')) color = '#f44336';
    else if (lower.includes('success') || lower.includes('done')) color = '#4caf50';
    else if (lower.includes('warning')) color = '#ff9800';
    else if (lower.includes('found') || lower.includes('scanning')) color = '#fff';

    return <div className="line" style={{ color }}>{log}</div>;
  }

  const txt = log.text || '';
  const animate = log.animating !== undefined ? log.animating : (txt.endsWith('Starting...') || txt.startsWith('Processing'));
  const display = txt.replace(/\.\.\.$/, '');
  const hasDetail = !!log.detail;

  return (
    <div>
      <div
        className="line"
        style={{
          color: log.color || '#aaa',
          cursor: hasDetail ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
        onClick={() => hasDetail && setIsExpanded(!isExpanded)}
        title={hasDetail ? t.clickDetails : ""}
      >
        {hasDetail && <span style={{ fontSize: '0.75em', opacity: 0.7 }}>{isExpanded ? '▼' : '▶'}</span>}
        <span>
          {display}
          {animate && <span className="typing-dots"></span>}
        </span>
      </div>
      {isExpanded && log.detail && (
        <div style={{
          marginLeft: '20px',
          padding: '8px',
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderLeft: `2px solid ${log.color || '#aaa'}`,
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
            {log.detail}
          </div>
        </div>
      )}
    </div>
  );
});

LogLine.displayName = 'LogLine';

export default function LogPanel({ logs, lang = 'en' }: { logs: any[], lang?: 'en' | 'id' }) {
  const t = translations[lang].logPanel;
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="log-panel" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', padding: '10px', fontSize: 12, lineHeight: 1.35 }}>
      {logs.map((l, i) => (
        <LogLine key={l.id || i} log={l} lang={lang} t={t} />
      ))}
      <div ref={endRef} />
    </div>
  )
}
