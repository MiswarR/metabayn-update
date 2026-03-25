import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open as shellOpen } from '@tauri-apps/api/shell';
import appIconUrl from '@icons/icon.svg'; 

export default function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState<'en' | 'id'>('id'); 
  const [showRegister, setShowRegister] = useState(false);
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regMessage, setRegMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Add 15s timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(lang === 'id' ? "Waktu habis. Periksa koneksi internet Anda." : "Login timed out. Check connection.")), 15000)
      );

      const res = await Promise.race([
        invoke<any>('login', { req: { email, password } }),
        timeoutPromise
      ]) as any;
      
      if (res && res.token) {
        onLogin(res.token);
      } else {
        throw new Error("Login failed: No token returned");
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const t = {
    en: {
      title: "Metabayn Studio",
      email: "Email",
      password: "Password",
      login: "Login",
      loggingIn: "Logging in...",
      error: "Error",
      contactAdmin: "No account? Register below.",
      register: "Register Account",
      createAccount: "Create Account",
      creating: "Creating...",
      confirmPassword: "Confirm Password",
      registerInfo: "After registering, please check your email to verify your account.",
      forgotPass: "Forgot Password?",
      regSuccessTitle: "Registration Successful!",
      regSuccessMsg: "Please check your email (including Spam folder) to verify your account before logging in.",
      backToLogin: "Back to Login",
      ok: "OK"
    },
    id: {
      title: "Metabayn Studio",
      email: "Email",
      password: "Kata Sandi",
      login: "Masuk",
      loggingIn: "Sedang masuk...",
      error: "Kesalahan",
      contactAdmin: "Belum punya akun? Daftar di bawah.",
      register: "Daftar Akun",
      createAccount: "Buat Akun",
      creating: "Mendaftarkan...",
      confirmPassword: "Konfirmasi Kata Sandi",
      registerInfo: "Setelah daftar, cek email Anda untuk verifikasi akun.",
      forgotPass: "Lupa Kata Sandi?",
      regSuccessTitle: "Registrasi Berhasil!",
      regSuccessMsg: "Silakan cek email Anda (termasuk folder Spam) untuk memverifikasi akun sebelum login.",
      backToLogin: "Kembali ke Login",
      ok: "OK"
    }
  };

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#09090b',
      color: '#e4e4e7',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{
        width: '360px',
        padding: '28px',
        background: '#18181b',
        borderRadius: '12px',
        border: '1px solid #27272a',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px'
      }}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginBottom:'6px'}}>
           <img src={appIconUrl} alt="Logo" style={{width:'28px', height:'28px'}} />
           <div style={{fontSize:'20px', fontWeight:700, color:'#fff'}}>{t[lang].title}</div>
          </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.14)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            padding: '10px',
            borderRadius: '8px',
            fontSize: '12px'
          }}>
            {error}
          </div>
        )}

        {!showRegister ? (
          /* LOGIN FORM */
          <>
            <form onSubmit={handleLogin} style={{display:'flex', flexDirection:'column', gap:'16px'}}>
              <div style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                <label style={{fontSize:'10px', color:'#a1a1aa'}}>{t[lang].email}</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                <label style={{fontSize:'10px', color:'#a1a1aa'}}>{t[lang].password}</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
              </div>

              <button 
                type="submit" 
                disabled={loading}
                style={{
                  background: '#4f46e5',
                  color: '#fff',
                  border: '1px solid rgba(99,102,241,0.6)',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: '10px',
                  opacity: loading ? 0.7 : 1
                }}
              >
                {loading ? t[lang].loggingIn : t[lang].login}
              </button>
            </form>

            <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', fontSize:'12px', color:'#666', marginTop:'10px'}}>
                <div style={{display:'flex', gap:'10px'}}>
                  <span 
                      onClick={() => setShowRegister(true)} 
                      style={{cursor:'pointer', color:'#2196f3', textDecoration:'underline'}}
                  >
                      {t[lang].register}
                  </span>
                  <span>|</span>
                  <span 
                      onClick={() => shellOpen('https://metabayn.com/reset-password')} 
                      style={{cursor:'pointer', color:'#aaa', textDecoration:'underline'}}
                  >
                      {t[lang].forgotPass}
                  </span>
                </div>
            </div>
          </>
        ) : (
          /* REGISTER FORM */
          <div style={{display:'flex', flexDirection:'column', gap:'16px'}}>
              {/* REMOVED SUBHEADER TO MATCH LOGIN UI */}
              
              {regMessage && (
                <div style={{background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.35)', color:'#a7f3d0', padding:8, borderRadius:8, fontSize:12}}>
                  {regMessage}
                </div>
              )}

              <div style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                <label style={{fontSize:'10px', color:'#a1a1aa'}}>{t[lang].email}</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={e=>setRegEmail(e.target.value)}
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                <label style={{fontSize:'10px', color:'#a1a1aa'}}>{t[lang].password}</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={e=>setRegPassword(e.target.value)}
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                <label style={{fontSize:'10px', color:'#a1a1aa'}}>{t[lang].confirmPassword}</label>
                <input
                  type="password"
                  value={regConfirm}
                  onChange={e=>setRegConfirm(e.target.value)}
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
              </div>

              <button
                disabled={regLoading}
                onClick={async ()=>{
                  setError('');
                  setRegMessage('');
                  if (!regEmail || !regPassword || regPassword !== regConfirm) {
                    setError(lang==='id' ? 'Email/sandi tidak valid atau tidak sama' : 'Invalid email/password or mismatch');
                    return;
                  }
                  setRegLoading(true);
                  try {
                    const { apiRegister } = await import('../api/backend');
                    const res = await apiRegister(regEmail.trim(), regPassword);
                    setShowSuccessModal(true);
                  } catch (e:any) {
                    setError(String(e));
                  } finally {
                    setRegLoading(false);
                  }
                }}
                style={{
                  background: '#4f46e5', /* Match Login Button Color (Indigo) */
                  color: '#fff',
                  border: '1px solid rgba(99,102,241,0.6)',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontWeight: 700,
                  cursor: regLoading ? 'not-allowed' : 'pointer',
                  marginTop: '10px',
                  opacity: regLoading ? 0.7 : 1
                }}
              >
                {regLoading ? t[lang].creating : t[lang].createAccount}
              </button>

              <div style={{fontSize:11, color:'#a1a1aa', textAlign:'center'}}>{t[lang].registerInfo}</div>

              <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', fontSize:'12px', color:'#666', marginTop:'4px'}}>
                  <div style={{display:'flex', gap:'10px'}}>
                    <span 
                        onClick={() => setShowRegister(false)} 
                        style={{cursor:'pointer', color:'#2196f3', textDecoration:'underline'}}
                    >
                        {t[lang].backToLogin}
                    </span>
                  </div>
              </div>
          </div>
        )}

        <div style={{display:'flex', justifyContent:'space-between', width:'100%', marginTop:'10px'}}>
            <span onClick={() => setLang(l => l==='en'?'id':'en')} style={{cursor:'pointer', color:'#aaa'}}>
                {lang === 'en' ? 'Bahasa Indonesia' : 'English'}
            </span>
            <span>v1.0</span>
          </div>
        </div>
      
      {showSuccessModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: '#18181b', padding: '24px', borderRadius: '12px',
            width: '320px', textAlign: 'center', border: '1px solid #27272a',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
          }}>
            <div style={{fontSize: '18px', fontWeight: 800, marginBottom: '16px', color: '#34d399'}}>
              {t[lang].regSuccessTitle}
            </div>
            <div style={{fontSize: '14px', color: '#c7c7d1', marginBottom: '24px', lineHeight: '1.5'}}>
              {t[lang].regSuccessMsg}
            </div>
            <button 
              onClick={() => {
                setShowSuccessModal(false);
                setShowRegister(false); // Switch back to login
                setRegEmail('');
                setRegPassword('');
                setRegConfirm('');
              }}
              style={{
                background: '#4f46e5', color: '#fff', border: '1px solid rgba(99,102,241,0.6)', padding: '10px 20px',
                borderRadius: '10px', cursor: 'pointer', fontWeight: 800, width: '100%'
              }}
            >
              {t[lang].ok}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
