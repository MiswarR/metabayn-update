import React, { useEffect, useRef } from 'react'
import { translations } from '../utils/translations';

const LogItem = React.memo(({ log, isExpanded, onToggle, logId, t }: { log: any, isExpanded: boolean, onToggle: (id: string | number) => void, logId: string | number, t: any }) => {
  if (log && typeof log === 'object' && log.hidden) return null;

  if (typeof log === 'string') {
    let color = '#aaa';
    const lower = log.toLowerCase();
    if (lower.includes('failed') || lower.includes('error')) color = '#f44336';
    else if (lower.includes('success') || lower.includes('done')) color = '#4caf50';
    else if (lower.includes('warning')) color = '#ff9800';
    else if (lower.includes('found') || lower.includes('scanning')) color = '#fff';

    return <div className="line" style={{ color }}>{log}</div>;
  } else {
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
          onClick={() => hasDetail && onToggle(logId)}
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
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            marginBottom: '4px'
          }}>
            {log.detail}
          </div>
        )}
      </div>
    );
  }
});

function LogPanel({ logs, lang = 'en' }: { logs: any[], lang?: 'en' | 'id' }) {
  const t = translations[lang].logPanel;
  const endRef = useRef<HTMLDivElement>(null)
  const [expandedIndex, setExpandedIndex] = React.useState<string | number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const toggleExpand = React.useCallback((key: string | number) => {
    setExpandedIndex(prev => (prev === key ? null : key));
  }, []);

  return (
    <div className="log-panel" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', padding: '10px', fontSize: 12, lineHeight: 1.35 }}>
      {logs.map((l, i) => {
        const key = l.id || l.file || i;
        return (
          <LogItem
            key={key}
            log={l}
            isExpanded={expandedIndex === key}
            onToggle={toggleExpand}
            logId={key}
            t={t}
          />
        );
      })}
      <div ref={endRef} />
    </div>
  )
}

export default React.memo(LogPanel);
