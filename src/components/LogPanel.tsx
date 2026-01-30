import React, { useEffect, useRef } from 'react'

export default function LogPanel({logs}:{logs:any[]}){
  const endRef = useRef<HTMLDivElement>(null)
  const [expandedIndex, setExpandedIndex] = React.useState<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const toggleExpand = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
  }

  return (
    <div className="log-panel" style={{borderTopLeftRadius:0, borderTopRightRadius:0, borderTop:'none', padding: '12px'}}>
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
                    title={hasDetail ? "Click for details" : ""}
                 >
                    {hasDetail && <span style={{fontSize:'0.8em', opacity:0.7}}>{isExpanded ? '▼' : '▶'}</span>}
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
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        marginBottom: '4px'
                    }}>
                        {l.detail}
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
