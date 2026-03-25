import React from 'react'

function toFileUrl(p:string){
  if(!p) return ''
  if(p.startsWith('file://')) return p
  const fixed=p.replace(/\\/g,'/')
  return 'file:///'+fixed
}

export default function Preview({file}:{file:string}){
  if(!file) return <div className="preview"/>
  const lower=file.toLowerCase()
  const url=toFileUrl(file)
  if(lower.match(/\.(mp4|mov|mkv|avi|webm)$/)){
    return <div className="preview"><video src={url} controls width={420}/></div>
  }
  return <div className="preview"><img src={url} width={420} /></div>
}

