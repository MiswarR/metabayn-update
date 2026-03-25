import React, { useState } from 'react'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'

export default function UpdateButton(){
  const [status,setStatus]=useState('')
  async function check(){
    const r=await checkUpdate()
    if(r.shouldUpdate){ setStatus(`v${r.manifest?.version}`) } else { setStatus('Up to date') }
  }
  async function install(){ await installUpdate(); }
  return (
    <div style={{display:'flex',gap:8}}>
      <button onClick={check}>Check Update</button>
      <button onClick={install}>Install Now</button>
      <span>{status}</span>
    </div>
  )
}

