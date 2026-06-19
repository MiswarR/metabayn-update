import React, { useEffect, useRef, memo, useState, useCallback } from 'react'
import { translations } from '../utils/translations';

interface LogEntry {
  id?: string;
  text?: string;
  color?: string;
  animating?: boolean;
  detail?: string;
  hidden?: boolean;
  [key: string]: any;
}

/**
 * LogLine component represents a single log entry.
 * Memoized to prevent re-renders of existing logs when new logs are added to the list.
 */
const LogLine = memo(function LogLine({
  id,
  log,
  isExpanded,
  onToggleExpand,
  clickDetailsLabel
}: {
  id: string;
  log: LogEntry | string;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  clickDetailsLabel: string;
}) {
  if (typeof log === 'object' && log.hidden) return null;

  const handleClick = useCallback(() => {
    onToggleExpand(id);
  }, [onToggleExpand, id]);

  if (typeof log === 'string') {
    let color = '#aaa';
    const lower = log.toLowerCase();
    if (lower.includes('failed') || lower.includes('error')) color = '#f44336';
    else if (lower.includes('success') || lower.includes('done')) color = '#4caf50';
    else if (lower.includes('warning')) color = '#ff9800';
    else if (lower.includes('found') || lower.includes('scanning')) color = '#fff';

    return <div className="line" style={{ color }}>{log}</div>
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
        onClick={hasDetail ? handleClick : undefined}
        title={hasDetail ? clickDetailsLabel : ""}
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
});

/**
 * LogPanel component displays a list of logs.
 * Memoized to prevent re-renders when other parts of Dashboard change.
 */
const LogPanel = memo(function LogPanel({ logs, lang = 'en' }: { logs: (LogEntry | string)[], lang?: 'en' | 'id' }) {
  const t = translations[lang].logPanel;
  const endRef = useRef<HTMLDivElement>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="log-panel" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', padding: '10px', fontSize: 12, lineHeight: 1.35 }}>
      {logs.map((l, i) => {
        const id = typeof l === 'object' && l.id ? l.id : `idx-${i}`;
        return (
          <LogLine
            key={id}
            id={id}
            log={l}
            isExpanded={expandedId === id}
            onToggleExpand={toggleExpand}
            clickDetailsLabel={t.clickDetails}
          />
        );
      })}
      <div ref={endRef} />
    </div>
  )
})

export default LogPanel
