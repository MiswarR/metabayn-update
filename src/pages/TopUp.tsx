import React, { useState, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/api/shell';
// import { message } from '@tauri-apps/api/dialog'; // Removed to replace with CustomModal
import { translations } from '../utils/translations';
import { apiCreatePaypalPayment, apiGetExchangeRate, apiGetUserProfile, apiRedeemVoucher, getMachineHash } from '../api/backend';

// Assets
import lynkIcon from '../assets/payments/lynk.svg';
import paypalIcon from '../assets/payments/paypal.svg';
import sub30day from '../assets/payments/sub30day.png';
import sub3month from '../assets/payments/sub3month.png';
import sub6month from '../assets/payments/sub6month.png';
import sub1year from '../assets/payments/sub1year.png';
import token20k from '../assets/payments/token20000.png';
import token50k from '../assets/payments/token50000.png';
import token100k from '../assets/payments/token100000.png';
import token150k from '../assets/payments/token150000.png';

interface TopUpProps {
  onBack: () => void;
  onPaymentSuccess?: () => void;
  lang: 'en' | 'id';
  token?: string;
  userEmail?: string;
  userId?: string | number;
}

// Exchange Rate Default (Fallback)
const DEFAULT_USD_RATE = 16911;
const MODAL_EVENT_NAME = 'metabayn:modal';
const PENDING_PAYMENT_KEY = 'metabayn:pendingPayment:v1';
const TOPUP_FOCUS_KEY = 'metabayn:topupFocus:v1';

type PendingPayment = {
  method: 'paypal' | 'lynkid';
  productType: 'token' | 'subscription';
  productId: string;
  packageLabel: string;
  durationLabel?: string;
  durationDays?: number;
  tokensExpected?: number;
  bonusTokensExpected?: number;
  amountIdr?: number;
  amountUsd?: number;
  transactionId?: string | number;
  since?: number;
  createdAt: number;
  snapshot?: {
    tokens: number;
    subscription_active: boolean;
    subscription_expiry: string | null;
  };
};

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getPendingPayment(): PendingPayment | null {
  return safeParseJson<PendingPayment>(localStorage.getItem(PENDING_PAYMENT_KEY));
}

function setPendingPayment(p: PendingPayment) {
  localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(p));
}

function clearPendingPayment() {
  try {
    localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {}
}

function inferSubscriptionLabel(durationDays?: number) {
  if (!durationDays || durationDays <= 0) return 'Subscription';
  if (durationDays === 30) return '1 Month';
  if (durationDays === 90) return '3 Months';
  if (durationDays === 180) return '6 Months';
  if (durationDays === 365) return '1 Year';
  return `${durationDays} Days`;
}

function emitModal(detail: { title: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; afterClose?: () => void }) {
  window.dispatchEvent(new CustomEvent(MODAL_EVENT_NAME, { detail }));
}

function formatIdr(num: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
}

function formatUsd(num: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num);
}

export default function TopUp({ onBack, onPaymentSuccess, lang, token, userEmail, userId }: TopUpProps) {
  const t = translations[lang].topUp;
  const [currency, setCurrency] = useState<'IDR' | 'USD' | 'VOUCHER'>('IDR');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_USD_RATE);
  const [processing, setProcessing] = useState<string | null>(null);
  const subscriptionSectionRef = useRef<HTMLElement | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const showModal = (title: string, message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', afterClose?: () => void) => {
    emitModal({ title, message, type, afterClose });
  };
  const isIdr = currency === 'IDR';
  const isUsd = currency === 'USD';
  const isVoucher = currency === 'VOUCHER';

  // Fetch Exchange Rate
  useEffect(() => {
    apiGetExchangeRate().then(setExchangeRate).catch(err => {
        console.error("Failed to fetch rate, using default", err);
    });
  }, []);

  useEffect(() => {
    try {
      const focus = localStorage.getItem(TOPUP_FOCUS_KEY) || '';
      if (focus === 'subscription') {
        localStorage.removeItem(TOPUP_FOCUS_KEY);
        setTimeout(() => {
          subscriptionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const refreshIfPending = () => {
      const pending = getPendingPayment();
      if (!pending) return;
      onPaymentSuccess?.();
    };

    refreshIfPending();

    const onFocus = () => refreshIfPending();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfPending();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, onPaymentSuccess]);

  const calculateUsdPrice = (idrPrice: number) => {
    // Formula: (IDR / Rate) + 4.23%
    const baseUsd = idrPrice / exchangeRate;
    const withFee = baseUsd + (baseUsd * 0.0423);
    return withFee.toFixed(2);
  };

  const resolveUserIdStr = async (): Promise<string> => {
    if (userId !== undefined && userId !== null && String(userId).trim()) return String(userId).trim();
    if (!token) return '';
    const profile = await apiGetUserProfile(token).catch(() => null);
    const uid = profile?.id ?? profile?.user_id ?? '';
    return uid !== undefined && uid !== null ? String(uid).trim() : '';
  };

  const runRedeemVoucher = async () => {
    const code = redeemCode.trim();
    if (!code) {
      setRedeemError(lang === 'id' ? 'Masukkan kode voucher.' : 'Enter voucher code.');
      return;
    }
    if (!token) {
      showModal("Authentication Required", "Please login first to redeem voucher", "warning");
      return;
    }
    setRedeemLoading(true);
    setRedeemError('');
    try {
      const deviceHash = await getMachineHash();
      const userIdStr = await resolveUserIdStr();
      if (!userIdStr) throw new Error(lang === 'id' ? 'User ID tidak ditemukan.' : 'User ID not found.');
      const res = await apiRedeemVoucher(token, code, userIdStr, deviceHash);
      try {
        localStorage.setItem(`metabayn:redeemed_voucher:${userIdStr}`, '1');
      } catch {}
      setRedeemOpen(false);
      setRedeemCode('');
      onPaymentSuccess?.();
      showModal(lang === 'id' ? 'Voucher berhasil' : 'Voucher redeemed', String(res?.message || ''), "success");
    } catch (e: any) {
      setRedeemError(e?.message ? String(e.message) : String(e));
    } finally {
      setRedeemLoading(false);
    }
  };

  const openLink = async (url: string, pendingInfo: Omit<PendingPayment, 'since' | 'transactionId' | 'createdAt'>) => {
    try {
      if (!token) {
        showModal("Authentication Required", "Please login first to continue purchase", "warning");
        return;
      }
      setProcessing(pendingInfo.productId);
      const profile = await apiGetUserProfile(token).catch(() => null);
      const snapshot = profile ? {
        tokens: Number(profile.tokens || 0) || 0,
        subscription_active: !!(profile.subscription_active === 1 || profile.subscription_active === true),
        subscription_expiry: profile.subscription_expiry ? String(profile.subscription_expiry) : null
      } : undefined;
      const since = Date.now();
      setPendingPayment({ ...pendingInfo, method: 'lynkid', since, createdAt: since, snapshot });
      await open(url);
    } catch (e) {
      console.error("Failed to open link", e);
      clearPendingPayment();
      try {
        showModal("Error", "Failed to open Lynk.id payment page. Please try again.", "error");
      } catch {}
    } finally {
      setProcessing(null);
    }
  };

  const handlePaypalBuy = async (productId: string, type: 'subscription' | 'token', idrAmount: number, packAmount?: number, duration?: number) => {
    if (!token) {
        showModal("Authentication Required", "Please login first to continue purchase", "warning");
        return;
    }
    setProcessing(productId);
    try {
        const usdAmount = Number(calculateUsdPrice(idrAmount));
        // Use backend API to create payment
        
        const res = await apiCreatePaypalPayment(token, {
            amount: usdAmount,
            userId: userId ? String(userId) : (userEmail || 'unknown'),
            type: type,
            tokensPack: packAmount,
            duration: duration
        });

        if (res && res.paymentUrl) {
            if (res.paymentUrl.includes("sandbox")) {
                 // Sandbox notification is optional, maybe just log it or show a small toast, 
                 // but for now we'll just open the link.
                 console.log("Sandbox Mode Active", res.paymentUrl);
            }
            const durationDays = type === 'subscription' ? Number(duration || 30) : 0;
            const durationLabel = type === 'subscription' ? inferSubscriptionLabel(durationDays) : undefined;

            const pending: PendingPayment = {
              method: 'paypal',
              productType: type,
              productId,
              packageLabel: type === 'subscription' ? 'Metabayn Subscription' : `${new Intl.NumberFormat('en-US').format(Number(packAmount || 0) || 0)} Tokens`,
              durationLabel,
              durationDays: durationDays || undefined,
              tokensExpected: type === 'token' ? Number(packAmount || 0) || 0 : undefined,
              bonusTokensExpected: type === 'subscription' ? Number(packAmount || 0) || 0 : undefined,
              amountIdr: idrAmount,
              amountUsd: Number.isFinite(usdAmount) ? usdAmount : undefined,
              transactionId: res.transactionId,
              createdAt: Date.now()
            };
            setPendingPayment(pending);

            await open(res.paymentUrl);
        } else {
            showModal("Error", t.paymentFailed || "Payment creation failed. Please try again.", "error");
        }
    } catch (e) {
        console.error(e);
        clearPendingPayment();
        try {
            const msg = e instanceof Error ? e.message : String(e);
            showModal(lang === 'id' ? "Error Pembayaran" : "Payment Error", msg, "error");
        } catch (err) {
            alert(String(e));
        }
    } finally {
        setProcessing(null);
    }
  };

  const subscriptions = [
    {
      id: 'sub30',
      duration: t.days ? `30 ${t.days}` : '30 Days',
      durationDays: 30,
      priceIdr: 99000,
      originalIdr: 119000,
      bonus: 20000,
      link: 'http://lynk.id/metabayn/065w46gnjy76',
      img: sub30day,
      type: 'subscription' as const
    },
    {
      id: 'sub90',
      duration: t.months ? `3 ${t.months}` : '3 Months',
      durationDays: 90,
      priceIdr: 279000,
      originalIdr: 359000,
      bonus: 56364,
      link: 'http://lynk.id/metabayn/1l5oklz6yyxm',
      img: sub3month,
      type: 'subscription' as const
    },
    {
      id: 'sub180',
      duration: t.months ? `6 ${t.months}` : '6 Months',
      durationDays: 180,
      priceIdr: 569000,
      originalIdr: 709000,
      bonus: 114949,
      link: 'http://lynk.id/metabayn/845024poxz6n',
      img: sub6month,
      type: 'subscription' as const
    },
    {
      id: 'sub365',
      duration: t.year ? `1 ${t.year}` : '1 Year',
      durationDays: 365,
      priceIdr: 999000,
      originalIdr: 1419000,
      bonus: 201818,
      link: 'http://lynk.id/metabayn/onyo5njmzn23',
      img: sub1year,
      type: 'subscription' as const
    }
  ];

  const tokens = [
    {
      id: 'tok20k',
      amount: '20.000',
      value: 20000,
      priceIdr: 22500,
      link: 'http://lynk.id/metabayn/ok0jwk5k4odw',
      img: token20k
    },
    {
      id: 'tok50k',
      amount: '50.000',
      value: 50000,
      priceIdr: 52500,
      link: 'http://lynk.id/metabayn/kdzxkod5llj1',
      img: token50k
    },
    {
      id: 'tok100k',
      amount: '100.000',
      value: 100000,
      priceIdr: 102500,
      link: 'http://lynk.id/metabayn/emod5eer6j1v',
      img: token100k
    },
    {
      id: 'tok150k',
      amount: '150.000',
      value: 150000,
      priceIdr: 152500,
      link: 'http://lynk.id/metabayn/0n523p4p3ey2',
      img: token150k
    }
  ];

  return (
    <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#09090b',
        color: '#fff',
        overflowY: 'auto',
        fontFamily: 'sans-serif'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid #27272a',
        background: '#09090b',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
            <button 
                onClick={onBack} 
                style={{
                    padding: 8,
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 6,
                    transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#27272a'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
            </button>
            <h2 style={{fontSize: 18, fontWeight: 600, margin:0}}>{t.title}</h2>

            <div style={{display:'flex', background: '#18181b', borderRadius: 8, padding: 4, border: '1px solid #27272a'}}>
                <button 
                    onClick={() => setCurrency('IDR')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: isIdr ? '#27272a' : 'transparent',
                        color: isIdr ? '#fff' : '#71717a',
                        transition: 'all 0.2s'
                    }}
                >
                    IDR (Lynk.id)
                </button>
                <button 
                    onClick={() => setCurrency('USD')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: isUsd ? '#27272a' : 'transparent',
                        color: isUsd ? '#fff' : '#71717a',
                        transition: 'all 0.2s'
                    }}
                >
                    USD (PayPal)
                </button>
                <button 
                    onClick={() => {
                      setCurrency('VOUCHER');
                      setRedeemError('');
                      setRedeemCode('');
                      setRedeemOpen(true);
                    }}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: isVoucher ? '#27272a' : 'transparent',
                        color: isVoucher ? '#fff' : '#71717a',
                        transition: 'all 0.2s'
                    }}
                >
                    Voucher
                </button>
            </div>
        </div>
      </div>

      <div style={{padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box'}}>

        {isVoucher && <div />}

        {!isVoucher && (
        <section style={{marginBottom: 40}}>
            <h3 style={{fontSize: 16, fontWeight: 600, marginBottom: 16, display:'flex', alignItems:'center', gap: 10, color: '#e4e4e7'}}>
                <span style={{width: 4, height: 20, background: '#3b82f6', borderRadius: 4}}></span>
                Metabayn Token Top-Up
            </h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16
            }}>
                {tokens.map(tok => {
                    const usdPrice = Number(calculateUsdPrice(tok.priceIdr));
                    
                    return (
                        <div key={tok.id} style={{
                            background: '#18181b',
                            borderRadius: 12,
                            border: '1px solid #27272a',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            transition: 'border-color 0.2s',
                            cursor: 'default'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                        onMouseOut={(e) => e.currentTarget.style.borderColor = '#27272a'}
                        >
                            <div style={{position: 'relative', width: '100%', paddingTop: '75%', background: '#000', padding: 16, boxSizing: 'border-box', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                <img 
                                    src={tok.img} 
                                    alt={tok.amount} 
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        objectFit: 'contain'
                                    }} 
                                    onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Token')} 
                                />
                            </div>
                            <div style={{padding: 16, flex: 1, display: 'flex', flexDirection: 'column'}}>
                                <h4 style={{fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', color: '#fff'}}>{tok.amount} Tokens</h4>
                                <div style={{fontSize: 11, color: '#71717a', marginBottom: 12}}>Credit Top-Up for Metadata Processing</div>
                                <div style={{marginTop: 'auto'}}>
                                    {currency === 'IDR' ? (
                                        <div style={{fontSize: 18, fontWeight: 700, color: '#3b82f6'}}>{formatIdr(tok.priceIdr)}</div>
                                    ) : (
                                        <div style={{fontSize: 18, fontWeight: 700, color: '#3b82f6'}}>{formatUsd(usdPrice)}</div>
                                    )}
                                </div>
                                
                                <button 
                                    onClick={() => currency === 'IDR'
                                      ? openLink(tok.link, {
                                          method: 'lynkid',
                                          productType: 'token',
                                          productId: tok.id,
                                          packageLabel:
                                            tok.value === 20000 ? 'Metabayn Token 20.000 – Credit Top-Up for Metadata Processing' :
                                            tok.value === 50000 ? 'Metabayn Token 50.000 – Credit Top-Up for Metadata Processing' :
                                            tok.value === 100000 ? 'Metabayn Token 100.000 – Credit Top-Up for Metadata Processing' :
                                            tok.value === 150000 ? 'Metabayn Token 150.000 – Credit Top-Up for Metadata Processing' :
                                            `${new Intl.NumberFormat('en-US').format(tok.value)} Tokens`,
                                          tokensExpected: tok.value,
                                          amountIdr: tok.priceIdr
                                        })
                                      : handlePaypalBuy(tok.id, 'token', tok.priceIdr, tok.value)
                                    }
                                    disabled={processing === tok.id}
                                    style={{
                                        marginTop: 16,
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: 8,
                                        border: 'none',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: processing === tok.id ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        background: currency === 'IDR' ? '#4caf50' : '#0070ba',
                                        color: '#fff',
                                        opacity: processing === tok.id ? 0.7 : 1
                                    }}
                                >
                                    {processing === tok.id ? (
                                        <span style={{fontSize:12}}>Processing...</span>
                                    ) : (
                                        <>
                                            <img src={currency === 'IDR' ? lynkIcon : paypalIcon} style={{height: 16, width: 'auto', filter: 'brightness(0) invert(1)'}} alt="" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
        )}

        {/* Subscriptions Section */}
        {!isVoucher && (
        <section ref={subscriptionSectionRef}>
            <h3 style={{fontSize: 16, fontWeight: 600, marginBottom: 16, display:'flex', alignItems:'center', gap: 10, color: '#e4e4e7'}}>
                <span style={{width: 4, height: 20, background: '#ffd700', borderRadius: 4}}></span>
                Metabayn Subscription
            </h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16
            }}>
                {subscriptions.map(sub => {
                    const usdPrice = Number(calculateUsdPrice(sub.priceIdr));
                    const usdOriginal = Number(calculateUsdPrice(sub.originalIdr));
                    
                    return (
                        <div key={sub.id} style={{
                            background: '#18181b',
                            borderRadius: 12,
                            border: '1px solid #27272a',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            transition: 'border-color 0.2s',
                            cursor: 'default'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.borderColor = '#ffd700'}
                        onMouseOut={(e) => e.currentTarget.style.borderColor = '#27272a'}
                        >
                            <div style={{position: 'relative', width: '100%', paddingTop: '75%', background: '#000', padding: 16, boxSizing: 'border-box', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                <img 
                                    src={sub.img} 
                                    alt={sub.duration} 
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        objectFit: 'contain'
                                    }} 
                                    onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Subscription')} 
                                />
                                <div style={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    background: 'rgba(0,0,0,0.8)',
                                    color: '#ffd700',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    border: '1px solid #ffd700'
                                }}>
                                    Bonus {new Intl.NumberFormat('id-ID').format(sub.bonus)} Tokens
                                </div>
                            </div>
                            <div style={{padding: 16, flex: 1, display: 'flex', flexDirection: 'column'}}>
                                <h4 style={{fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', color: '#fff'}}>{sub.duration}</h4>
                                <div style={{marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2}}>
                                    {currency === 'IDR' ? (
                                        <>
                                            <div style={{fontSize: 12, color: '#71717a', textDecoration: 'line-through'}}>{formatIdr(sub.originalIdr)}</div>
                                            <div style={{fontSize: 18, fontWeight: 700, color: '#ffd700'}}>{formatIdr(sub.priceIdr)}</div>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{fontSize: 12, color: '#71717a', textDecoration: 'line-through'}}>{formatUsd(usdOriginal)}</div>
                                            <div style={{fontSize: 18, fontWeight: 700, color: '#ffd700'}}>{formatUsd(usdPrice)}</div>
                                        </>
                                    )}
                                </div>
                                
                                <button 
                                    onClick={() => currency === 'IDR'
                                      ? openLink(sub.link, {
                                          method: 'lynkid',
                                          productType: 'subscription',
                                          productId: sub.id,
                                          packageLabel:
                                            sub.durationDays === 30 ? 'Metabayn Subscription - 30 Days' :
                                            sub.durationDays === 90 ? 'Metabayn Subscription - 3 Months' :
                                            sub.durationDays === 180 ? 'Metabayn Subscription - 6 Months' :
                                            sub.durationDays === 365 ? 'Metabayn Subscription - 1 Year' :
                                            'Metabayn Subscription',
                                          durationLabel: inferSubscriptionLabel(sub.durationDays),
                                          durationDays: sub.durationDays,
                                          bonusTokensExpected: sub.bonus,
                                          amountIdr: sub.priceIdr
                                        })
                                      : handlePaypalBuy(sub.id, 'subscription', sub.priceIdr, sub.bonus, sub.durationDays)
                                    }
                                    disabled={processing === sub.id}
                                    style={{
                                        marginTop: 16,
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: 8,
                                        border: 'none',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: processing === sub.id ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        background: currency === 'IDR' ? '#4caf50' : '#0070ba',
                                        color: '#fff',
                                        opacity: processing === sub.id ? 0.7 : 1
                                    }}
                                >
                                    {processing === sub.id ? (
                                        <span style={{fontSize:12}}>Processing...</span>
                                    ) : (
                                        <>
                                            <img src={currency === 'IDR' ? lynkIcon : paypalIcon} style={{height: 16, width: 'auto', filter: 'brightness(0) invert(1)'}} alt="" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
        )}

        {redeemOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}>
            <div style={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 16,
              padding: 22,
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)'
            }}>
              <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                {(translations as any)[lang]?.topup?.redeemTitle || (lang === 'id' ? 'Tukarkan Voucher' : 'Redeem Voucher')}
              </div>
              <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                {lang === 'id' ? 'Masukkan kode voucher.' : 'Enter voucher code.'}
              </div>
              <input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder={(translations as any)[lang]?.topup?.enterCode || (lang === 'id' ? 'Masukkan Kode' : 'Enter Code')}
                disabled={redeemLoading}
                style={{
                  width: '100%',
                  background: '#0f0f12',
                  border: redeemError ? '1px solid #ef4444' : '1px solid #27272a',
                  color: '#fff',
                  padding: '12px 12px',
                  borderRadius: 10,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              {redeemError ? (
                <div style={{ color: '#f87171', fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {redeemError}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  className="btn-click-anim"
                  onClick={() => {
                    setRedeemOpen(false);
                    setRedeemError('');
                  }}
                  disabled={redeemLoading}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: 'transparent',
                    color: '#fff',
                    border: '1px solid #3f3f46',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.6 : 1
                  }}
                >
                  Close
                </button>
                <button
                  className="btn-click-anim"
                  onClick={() => { void runRedeemVoucher(); }}
                  disabled={redeemLoading}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#fff',
                    color: '#000',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: redeemLoading ? 'not-allowed' : 'pointer',
                    opacity: redeemLoading ? 0.7 : 1
                  }}
                >
                  {redeemLoading ? (lang === 'id' ? 'Redeeming...' : 'Redeeming...') : 'Redeem'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
