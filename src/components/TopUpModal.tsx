import React, { useState, useEffect, useRef } from 'react';
import { apiCreatePaypal, apiGetBalance, apiCheckPaypalStatus, apiRedeemVoucher, getMachineHash } from '../api/backend';
import paypalLogoUrl from '../assets/payments/paypal.svg';
import lynkLogoUrl from '../assets/payments/lynk.svg';
import token20000Img from '../assets/payments/token20000.png';
import token50000Img from '../assets/payments/token50000.png';
import token100000Img from '../assets/payments/token100000.png';
import sub30Img from '../assets/payments/subapikey30day.png';
import sub90Img from '../assets/payments/subapikey3month.png';
import sub180Img from '../assets/payments/subapikey6month.png';
import sub365Img from '../assets/payments/subapikey1year.png';
import token150000Img from '../assets/payments/token150000.png';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  userId: string;
  usdRate?: number;
  onSuccess: (addedAmount?: number, purchaseType?: 'token' | 'subscription', expiry?: string, source?: 'paypal' | 'voucher') => void;
  initialTab?: 'topup' | 'redeem';
  initialPurchaseType?: 'token' | 'subscription';
}

const TopUpModal: React.FC<TopUpModalProps> = ({ isOpen, onClose, token, userId, usdRate, onSuccess, initialTab = 'topup', initialPurchaseType = 'token' }) => {
  const [activeTab, setActiveTab] = useState<'topup' | 'redeem'>(initialTab);
  
  useEffect(() => {
    if (isOpen) {
        setActiveTab(initialTab);
        setPurchaseType(initialPurchaseType);
    }
  }, [isOpen, initialTab, initialPurchaseType]);
  
  // Redeem State
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState('');

  const [purchaseType, setPurchaseType] = useState<'token' | 'subscription'>(initialPurchaseType);
  const [amount, setAmount] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("10");
  const [polling, setPolling] = useState(false);
  const subscriptionPrices: Record<number, number> = {30: 7, 90: 18, 180: 34, 365: 65};
  const originalPrices: Record<number, number> = {90: 21, 180: 42, 365: 84};
  const savingsMap: Record<number, number> = {90: 3, 180: 8, 365: 19};
  const [subscriptionDuration, setSubscriptionDuration] = useState<number>(30);
  
  // Ref for polling interval
  const pollInterval = useRef<any>(null);
  const initialBalance = useRef<number>(0);

  const handleRedeem = async () => {
    if (!redeemCode) return;
    setRedeemLoading(true);
    setRedeemError('');
    
    try {
				  const deviceHash = await getMachineHash();
				  const res = await apiRedeemVoucher(token, redeemCode, userId, deviceHash);
      
      if (res.subscription_active) {
        const expiry = typeof res.subscription_expiry === 'string' ? res.subscription_expiry : undefined;
        onSuccess(undefined, 'subscription', expiry, 'voucher');
      } else {
        const added = typeof res.amount_added === 'number' ? res.amount_added : undefined;
        onSuccess(added, 'token', undefined, 'voucher');
      }
      
      onClose();
    } catch (e: any) {
      setRedeemError(e.message || "Redemption failed");
    } finally {
      setRedeemLoading(false);
    }
  };

  // Get initial balance when modal opens
  useEffect(() => {
    if (isOpen) {
        apiGetBalance(token).then(b => initialBalance.current = b).catch(() => {});
        setResult(null);
        setError(null);
    }
    return () => stopPolling();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (purchaseType === 'token') {
        setCustomAmount("10");
        setAmount(10);
      } else {
        setSubscriptionDuration(30);
        setAmount(subscriptionPrices[30]);
      }
    }
  }, [isOpen, purchaseType]);

  useEffect(() => {
    if (purchaseType === 'subscription') {
      setAmount(subscriptionPrices[subscriptionDuration]);
    }
  }, [purchaseType, subscriptionDuration]);

  const stopPolling = () => {
      if (pollInterval.current) {
          clearInterval(pollInterval.current);
          pollInterval.current = null;
      }
      setPolling(false);
  };

		  const startPolling = (transactionId: number | string, type: 'token' | 'subscription', tokensPack?: number) => {
	      if (pollInterval.current) return;
	      setPolling(true);
	      pollInterval.current = setInterval(async () => {
	          try {
	              const check = await apiCheckPaypalStatus(token, transactionId);
	              if (check.status === 'paid') {
	                  stopPolling();
	                  if (type === 'subscription') {
	                      const expiry = typeof check.subscription_expiry === 'string' ? check.subscription_expiry : undefined;
	                      onSuccess(undefined, 'subscription', expiry, 'paypal');
	                  } else {
	                      const added = typeof tokensPack === 'number' && tokensPack > 0 
	                        ? tokensPack 
	                        : undefined;
	                      onSuccess(added, 'token', undefined, 'paypal');
	                  }
	                  onClose();
	                  return;
	              }

	              const currentBal = await apiGetBalance(token);
	              if (currentBal > initialBalance.current) {
	                  stopPolling();
	                  const delta = (Number(currentBal) || 0) - (Number(initialBalance.current) || 0);
	                  const added = delta > 0 ? delta : undefined;
	                  onSuccess(added, 'token', undefined, 'paypal');
	                  onClose();
	              }
	          } catch (e) {
	              console.error("Polling error", e);
	          }
	      }, 3000);
	  };

  const usdFromIdr = (idr: number) => {
    if (!usdRate || typeof usdRate !== 'number' || usdRate <= 0) return 0;
    const base = idr / usdRate;
    const withPercent = base * 1.0349;
    const total = withPercent + 0.49;
    return Math.floor(total * 10) / 10;
  };
  const paypalUsd = (idr: number) => {
    const v = usdFromIdr(idr);
    return Math.max(v, MIN_PAYPAL_USD);
  };

  const startPaypal = async (type: 'token' | 'subscription', amt: number, tokensPack?: number) => {
    if (type === 'subscription' && !amt) {
      setError("Invalid subscription amount");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiCreatePaypal(token, amt, type, userId, tokensPack);
      setResult(res);
      if (res.paymentUrl) {
        handleOpenLink(res.paymentUrl);
      }
      if (res.transactionId) {
        startPolling(res.transactionId, type, tokensPack);
      }
    } catch (e: any) {
      setError(e.message || "Payment creation failed");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value.replace(/\D/g, '')) || 0;
      setCustomAmount(val.toString());
      setAmount(val);
  };
  
  const handleOpenLink = (url:string) => {
      import('@tauri-apps/api/shell').then(({ open }) => open(url));
  };

  const formattedAmount = `$${amount}`;
  const MIN_PAYPAL_USD = 3;
  const tokenIdr20 = 22500;
  const tokenIdr50 = 52500;
  const tokenIdr100 = 102500;
  const tokenIdr150 = 152500;
  const subIdrOld: Record<number, number> = {30: 119000, 90: 359000, 180: 709000, 365: 1419000};
  const subIdrNow: Record<number, number> = {30: 99000, 90: 279000, 180: 569000, 365: 999000};
  const usdSub30 = usdRate && usdRate>0 ? usdFromIdr(subIdrNow[30]) : 0;
  const usdSub90 = usdRate && usdRate>0 ? usdFromIdr(subIdrNow[90]) : 0;
  const usdSub180 = usdRate && usdRate>0 ? usdFromIdr(subIdrNow[180]) : 0;
  const usdSub365 = usdRate && usdRate>0 ? usdFromIdr(subIdrNow[365]) : 0;

  const PaypalLogo: React.FC<{size?: number}> = ({ size = 10 }) => (
    <img src={paypalLogoUrl} alt="PayPal" style={{height: size}} />
  );

  const LynkLogo: React.FC<{size?: number}> = ({ size = 10 }) => (
    <img src={lynkLogoUrl} alt="Lynk.id" style={{height: size}} />
  );

  const LogoBox: React.FC<{children: React.ReactNode}> = ({ children }) => (
    <div style={{background:'#f0f0f0', borderRadius:6, padding:6, display:'inline-flex', alignItems:'center'}}>{children}</div>
  );

  const ImageSquare: React.FC<{src:string; alt:string}> = ({ src, alt }) => (
    <div style={{position:'relative', width:'100%', paddingTop:'100%', borderRadius:6, background:'#111'}}>
      <img src={src} alt={alt} style={{position:'absolute', inset:8, width:'calc(100% - 16px)', height:'calc(100% - 16px)', objectFit:'contain', borderRadius:6}} />
    </div>
  );

  const pressHandlers = {
    onMouseEnter:(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.filter = 'brightness(1.05)'; },
    onMouseLeave:(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'none'; },
    onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(0.98)'; e.currentTarget.style.transition = 'transform 120ms ease'; },
    onMouseUp:   (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'scale(1)'; }
  };

				  const handleTopUp = async () => {
    if (purchaseType === 'token') {
      // amount berasal dari konversi kurs USD, tidak ada minimum $3
    } else {
      if (!subscriptionPrices[subscriptionDuration]) {
        setError("Invalid subscription duration");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setResult(null);

				  		try {
						  const res = await apiCreatePaypal(token, amount, purchaseType, userId);
	      setResult(res);
	      if (res.paymentUrl) {
	          handleOpenLink(res.paymentUrl);
	      }
      if (res.transactionId) {
          startPolling(res.transactionId, purchaseType);
      }
    } catch (e: any) {
      setError(e.message || "Payment creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, bottom:0,
      background:'rgba(0,0,0,0.8)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center'
    }} onClick={onClose}>
      <div style={{
        background:'#1e1e1e', padding:25, borderRadius:8, width:'90vw', maxWidth:1100, maxHeight:'90vh', overflowY:'auto', overflowX:'hidden', boxSizing:'border-box'
      }} onClick={e=>e.stopPropagation()}>
        
        <div style={{display:'flex', borderBottom:'1px solid #333', marginBottom:15}}>
            <div style={{padding:10, cursor:'pointer', borderBottom: activeTab==='topup'?'2px solid #4caf50':'none', color: activeTab==='topup'?'#fff':'#888'}} onClick={()=>setActiveTab('topup')}>Top Up</div>
            <div style={{padding:10, cursor:'pointer', borderBottom: activeTab==='redeem'?'2px solid #4caf50':'none', color: activeTab==='redeem'?'#fff':'#888'}} onClick={()=>setActiveTab('redeem')}>Redeem Voucher</div>
        </div>

        {activeTab === 'topup' ? (
          <>
            <h3 style={{marginTop:0}}>Top Up</h3>

            {error && <div style={{color:'#f44336', marginBottom:10, fontSize:12}}>{error}</div>}

            {result && !result.paymentUrl && (
              <div style={{marginBottom:15, padding:10, background:'#333', borderRadius:4}}>
                <p style={{margin:0}}>{result.message}</p>
              </div>
            )}

            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:14}}>
              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={token20000Img} alt="Metabayn Token Voucher 20.000 – Credit Top-Up for Metadata Processing" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn Token Voucher 20.000 – Credit Top-Up for Metadata Processing</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {tokenIdr20.toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(tokenIdr20).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/zv3ee2mgeqmv/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('token', usdFromIdr(tokenIdr20), 20000)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={token50000Img} alt="Metabayn Token Voucher 50.000 – Credit Top-Up for Metadata Processing" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn Token Voucher 50.000 – Credit Top-Up for Metadata Processing</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {tokenIdr50.toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(tokenIdr50).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/9jx88435lxvg/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('token', usdFromIdr(tokenIdr50), 50000)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={token100000Img} alt="Metabayn Token Voucher 100.000 – Credit Top-Up for Metadata Processing" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn Token Voucher 100.000 – Credit Top-Up for Metadata Processing</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {tokenIdr100.toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(tokenIdr100).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/7ov88ro116v3/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('token', usdFromIdr(tokenIdr100), 100000)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={token150000Img} alt="Metabayn Token Voucher 150.000 – Credit Top-Up for Metadata Processing" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn Token Voucher 150.000 – Credit Top-Up for Metadata Processing</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {tokenIdr150.toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(tokenIdr150).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/0vpzeno5ggpm/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('token', usdFromIdr(tokenIdr150), 150000)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={sub30Img} alt="Metabayn API Key Mode Subscription - 30 Days" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn API Key Mode Subscription - 30 Days</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>Rp {subIdrOld[30].toLocaleString('id-ID')}</span>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(subIdrOld[30]).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:4}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {subIdrNow[30].toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdSub30.toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/ogk61lj0jerr/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('subscription', usdSub30)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={sub90Img} alt="Metabayn API Key Mode Subscription - 3 Months" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn API Key Mode Subscription - 3 Months</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>Rp {subIdrOld[90].toLocaleString('id-ID')}</span>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(subIdrOld[90]).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:4}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {subIdrNow[90].toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdSub90.toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/g76e3j7d2kkj/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('subscription', usdSub90)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={sub180Img} alt="Metabayn API Key Mode Subscription - 6 Months" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn API Key Mode Subscription - 6 Months</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>Rp {subIdrOld[180].toLocaleString('id-ID')}</span>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(subIdrOld[180]).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:4}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {subIdrNow[180].toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdSub180.toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/nzdlj6v7r9o3/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('subscription', usdSub180)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>

              <div style={{border:'1px solid #444', borderRadius:8, background:'#2a2a2a', padding:10}}>
                <ImageSquare src={sub365Img} alt="Metabayn API Key Mode Subscription - 1 Year" />
                <div style={{marginTop:12, fontWeight:600}}>Metabayn API Key Mode Subscription - 1 Year</div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:8}}>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>Rp {subIdrOld[365].toLocaleString('id-ID')}</span>
                  <span style={{color:'#aaa', textDecoration:'line-through'}}>{usdRate && usdRate>0 ? `$${usdFromIdr(subIdrOld[365]).toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginTop:4}}>
                  <span style={{fontWeight:700, color:'#fff'}}>Rp {subIdrNow[365].toLocaleString('id-ID')}</span>
                  <span style={{fontWeight:700, color:'#fff'}}>{usdRate && usdRate>0 ? `$${usdSub365.toFixed(1)}` : 'USD N/A'}</span>
                </div>
                <div style={{display:'flex', gap:8, marginTop:10}}>
                  <button disabled={loading} onClick={()=>handleOpenLink('http://lynk.id/miswarr/2qke7wd2kzlj/checkout')} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><LynkLogo /></LogoBox>
                  </button>
                  <button disabled={loading || !usdRate || usdRate<=0} onClick={()=>startPaypal('subscription', usdSub365)} {...pressHandlers} style={{flex:1, padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:6, cursor:loading?'wait':'pointer'}}>
                    <LogoBox><PaypalLogo /></LogoBox>
                  </button>
                </div>
              </div>
            </div>

            <div style={{marginTop:10, padding:10, background:'#2a2a2a', borderRadius:4, fontSize:10, color:'#cccccc99', textAlign:'center', fontStyle:'italic', maxWidth:'100%', boxSizing:'border-box'}}>
              <p style={{margin:0, whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word'}}>Please enter a valid and active email during checkout as the voucher code will be sent to this email.</p>
              <p style={{margin:'6px 0 0 0', color:'#ffb84d92', whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word'}}>If you encounter any issues, please contact the admin via WhatsApp at +628996701661.</p>
            </div>
          </>
        ) : (
          <>
            <h3 style={{marginTop:0}}>Redeem Voucher</h3>
            <div style={{marginBottom:15}}>
                <label style={{display:'block', marginBottom:5, fontSize:12, color:'#888'}}>Voucher Code</label>
                <input 
                    type="text" 
                    style={{width:'100%', padding:10, background:'#333', color:'#fff', border:'1px solid #444', borderRadius:4}}
                    placeholder="Enter Code"
                    value={redeemCode}
                    onChange={e => setRedeemCode(e.target.value)}
                />
            </div>

            {redeemError && <div style={{color:'#f44336', marginBottom:10, fontSize:12}}>{redeemError}</div>}
            
            <button disabled={redeemLoading} onClick={handleRedeem} style={{
                width:'100%', padding:12, background:'#4caf50', color:'#fff', border:'none', borderRadius:4, cursor:redeemLoading?'wait':'pointer', fontWeight:'bold'
            }}>
                {redeemLoading ? 'Redeeming...' : 'Redeem'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TopUpModal;
