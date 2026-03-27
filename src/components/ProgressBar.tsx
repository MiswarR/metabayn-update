import React from 'react'

export default function ProgressBar({ value }: { value: number }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  return (
    <div style={{ height: 10, background: '#27272a', borderRadius: 999, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${safe}%`,
          background: safe >= 100 ? '#22c55e' : '#3b82f6',
          transition: 'width 120ms linear'
        }}
      />
    </div>
  )
}
