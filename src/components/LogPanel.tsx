import React, { useEffect, useRef } from 'react'
import { translations } from '../utils/translations';

export default function LogPanel({logs, lang = 'en'}:{logs:any[], lang?: 'en' | 'id'}){
  const t = translations[lang].logPanel;
  const endRef = useRef<HTMLDivElement>(null)
  const [expandedIndex, setExpandedIndex] = React.useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const toggleExpand = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
  }

  const copyDetail = async (i: number, l: any) => {
    const text = [l?.text, l?.detail].filter(Boolean).join('\n');
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
      setCopiedIndex(i);
      window.setTimeout(() => setCopiedIndex(cur => (cur === i ? null : cur)), 1500);
    } catch {}
  }

  return (
    <div className="log-panel" style={{borderTopLeftRadius:0, borderTopRightRadius:0, borderTop:'none', padding: '10px', fontSize: 12, lineHeight: 1.35}}>
      {logs.map((l,i)=>{
         if (l && typeof l === 'object' && l.hidden) return null; // Skip hidden logs
         
         if(typeof l === 'string') {
             // Legacy string support - attempt to color based on content keywords
             let color = '#aaa'; // Default grey
             const lower = l.toLowerCase();
             if (lower.includes('failed') || lower.includes('error')) color = '#f44336';
             else if (lower.includes('success') || lower.includes('done')) color = '#4caf50';
             else if (lower.includes('warning')) color = '#ff9800';
             else if (lower.includes('found') || lower.includes('scanning')) color = '#fff';
             
             return <div key={i} className="line" style={{color}}>{l}</div>
         } else {
             // Structured log object {text, color, animating, detail}
             const txt = l.text || '';
             const animate = l.animating !== undefined ? l.animating : (txt.endsWith('Starting...') || txt.startsWith('Processing'));
             // Always strip trailing dots so they don't duplicate/persist statically
             const display = txt.replace(/\.\.\.$/, '');
             
             const hasDetail = !!l.detail;
             const isExpanded = expandedIndex === i;

             return (
               <div key={i}>
                 <div 
                    className="line" 
                    style={{
                        color: l.color || '#aaa', 
                        cursor: hasDetail ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                    onClick={() => hasDetail && toggleExpand(i)}
                    title={hasDetail ? t.clickDetails : ""}
                 >
                    {hasDetail && <span style={{fontSize:'0.75em', opacity:0.7}}>{isExpanded ? '▼' : '▶'}</span>}
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
                            onClick={(e) => { e.stopPropagation(); copyDetail(i, l); }}
                            style={{
                                position: 'absolute',
                                top: '6px',
                                right: '6px',
                                padding: '2px 8px',
                                fontSize: '0.85em',
                                borderRadius: '6px',
                                border: '1px solid #3f3f46',
                                background: copiedIndex === i ? '#166534' : '#27272a',
                                color: '#fff',
                                cursor: 'pointer'
                            }}
                            title={lang === 'id' ? 'Salin log' : 'Copy log'}
                        >
                            {copiedIndex === i ? (lang === 'id' ? 'Tersalin' : 'Copied') : (lang === 'id' ? 'Salin' : 'Copy')}
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
      })}
      <div ref={endRef} />
    </div>
  )
}
