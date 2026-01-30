import React from 'react'
export default function ProgressBar({value}:{value:number}){
  return <div className="progress"><div className="bar" style={{width:`${value}%`}}/></div>
}

