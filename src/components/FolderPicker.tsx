import React from 'react'
import { open } from '@tauri-apps/api/dialog'

export default function FolderPicker({label,value,onChange}:{label:string,value:string,onChange:(v:string)=>void}){
  async function pick(){
    const r=await open({directory:true})
    if(typeof r==='string') onChange(r)
  }
  return (
    <div className="folder">
      <span>{label}:</span>
      <input value={value} onChange={e=>onChange(e.target.value)} />
      <button onClick={pick}>Browse</button>
    </div>
  )
}

