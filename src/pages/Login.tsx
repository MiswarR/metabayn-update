import React, { useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { API_URL, apiRegister, apiLogin, getApiUrl, saveTokenLocal } from '../api/backend';

export default function Login({onSuccess}:{onSuccess:(t:string)=>void}){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')
  const [messageType,setMessageType]=useState<'error'|'success'|'warning'>('error')
  const [isRegister,setIsRegister]=useState(false)

  async function submit(){
    if(!email || !password) {
        setMessage("Please fill in all fields");
        setMessageType('error');
        return;
    }

    setLoading(true);setMessage('')
    try{
      if(isRegister){
        if(password !== confirmPassword) {
           throw new Error("Passwords do not match");
        }
        const res = await apiRegister(email, password);
        setMessageType('success');
        setMessage(res.message || "Registration successful. Please check your email to activate your account.");
        setLoading(false);
        // Optional: Switch to login mode automatically
        // setIsRegister(false); 
        return;
      } else {
        // Use apiLogin instead of invoke('login') to hit the backend directly
        const res = await apiLogin(email, password);
        
        /* 
        // --- Restrict login to Admin only for this PC app ---
        try {
            const payload = JSON.parse(atob(res.token.split('.')[1]));
            if (!payload.is_admin && payload.role !== 'admin') {
                const apiUrl = await getApiUrl();
                const adminCheck = await fetch(`${apiUrl}/admin/vouchers`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${res.token}` }
                });
                if (!adminCheck.ok) {
                    throw new Error("Access Denied: Admin privileges required to login on this device.");
                }
            }
        } catch(e: any) {
             if (String(e).includes("Access Denied")) throw e;
        }
        // ---------------------------------------------------------
        */

        try{ await invoke('save_auth_token',{ token: res.token }) }catch{}
        saveTokenLocal(res.token);
        onSuccess(res.token)
      }
    }catch(e:any){
      let msg = String(e).replace('Error: ', '');
      
      // Handle Network/Fetch Errors specifically
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('TypeFailed')) {
          msg = "Failed to connect to the server. Please check your internet connection or firewall settings.";
      }
      
      if (msg.includes('{') && msg.includes('}')) {
        try {
           const parsed = JSON.parse(msg.substring(msg.indexOf('{')));
           if (parsed.error) msg = parsed.error;
        } catch {}
      }
      setMessage(msg);
      if(msg.toLowerCase().includes('email already exists') || msg.toLowerCase().includes('duplicate')) {
        setMessageType('warning');
      } else {
        setMessageType('error');
      }
    }
    setLoading(false)
  }

  return (
    <div className="login" style={{height: '100%', overflowY: 'auto'}}>
      <div className="login-form">
        <div style={{textAlign:'center',marginBottom:16,fontSize:16,fontWeight:'bold', color:'#fff'}}>Metabayn Studio</div>
        {isRegister && (
          <div style={{fontSize: 9, color: '#aaa', marginTop: -10, marginBottom: 15, textAlign: 'center', padding: '0 10px'}}>
            Please ensure you use an active and correctly spelled email to receive the verification link.
          </div>
        )}
        
        <div className="label">Email</div>
        <input 
            className="input" 
            value={email} 
            onChange={e=>setEmail(e.target.value)} 
            autoFocus
        />
        
        <div className="label">Password</div>
        <input 
            className="input" 
            type="password" 
            value={password} 
            onChange={e=>setPassword(e.target.value)} 
            onKeyDown={e=>e.key==='Enter'&&submit()} 
        />
        
        {isRegister && (
          <>
            <div className="label">Confirm Password</div>
            <input 
                className="input" 
                type="password" 
                value={confirmPassword} 
                onChange={e=>setConfirmPassword(e.target.value)} 
                onKeyDown={e=>e.key==='Enter'&&submit()} 
            />
          </>
        )}

        {message && (
          <div className="message" style={{
            marginTop:10, 
            textAlign:'center', 
            fontSize:11,
            color: messageType==='success'?'#4caf50' : (messageType==='warning'?'#ff9800':'#f44336')
          }}>
            {message}
          </div>
        )}

        <div className="login-actions" style={{display:'flex', flexDirection:'column', gap:10, marginTop:12}}>
          <button className="btn-login" onClick={submit} disabled={loading}>
            {loading?'Loading...':(isRegister?'Register':'Login')}
          </button>
          
          <div 
            style={{fontSize:12,color:'#888',cursor:'pointer',textAlign:'center', marginTop: 10, padding: 5}} 
            onClick={()=>{setIsRegister(!isRegister);setMessage('')}}
          >
            {isRegister ? (
                <>Already have an account? <span style={{color:'#4caf50', fontWeight:'bold', textDecoration:'underline'}}>Login</span></>
            ) : (
                <>No account? <span style={{color:'#4caf50', fontWeight:'bold', textDecoration:'underline'}}>Register</span></>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
