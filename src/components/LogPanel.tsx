import React, { useEffect, useRef } from 'react'
import { translations } from '../utils/translations';
import LogLine from './LogLine';

const LogPanel: React.FC<{logs:any[], lang?: 'en' | 'id'}> = ({logs, lang = 'en'}) => {
  const t = translations[lang].logPanel;
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="log-panel" style={{borderTopLeftRadius:0, borderTopRightRadius:0, borderTop:'none', padding: '10px', fontSize: 12, lineHeight: 1.35}}>
      {logs.map((l, i)=>{
         const key = (l && typeof l === 'object' && l.id) ? l.id : i;
         return <LogLine key={key} log={l} lang={lang} t={t} />
      })}
      <div ref={endRef} />
    </div>
  )
}

export default React.memo(LogPanel)
