import React from 'react';
import { translations } from '../utils/translations'

interface CustomModalProps {
  isOpen: boolean;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  onClose: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
}

export default function CustomModal({
  isOpen,
  type,
  title,
  message,
  onClose,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
  secondaryDisabled
}: CustomModalProps) {
  if (!isOpen) return null;
  const lang = (() => {
    try {
      const v = window?.localStorage?.getItem('app_lang')
      return v === 'id' || v === 'en' ? v : 'en'
    } catch {
      return 'en'
    }
  })()
  const t = (translations as any)[lang] || (translations as any)['en']

  // Colors based on type
  let iconColor = '#3b82f6'; // info (blue)
  let iconBg = 'rgba(59, 130, 246, 0.1)';
  let iconPath = "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"; // info icon

  if (type === 'success') {
    iconColor = '#10b981'; // green
    iconBg = 'rgba(16, 185, 129, 0.1)';
    iconPath = "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z";
  } else if (type === 'error') {
    iconColor = '#ef4444'; // red
    iconBg = 'rgba(239, 68, 68, 0.1)';
    iconPath = "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z";
  } else if (type === 'warning') {
    iconColor = '#f59e0b'; // amber
    iconBg = 'rgba(245, 158, 11, 0.1)';
    iconPath = "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z";
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 10000, // Higher than TopUp page
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div style={{
        backgroundColor: '#18181b', // Zinc-900 matches app theme
        border: '1px solid #27272a',
        borderRadius: '16px',
        padding: '24px',
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        transform: 'translateY(0)',
        animation: 'slideUp 0.3s ease-out'
      }}>
        {/* Icon */}
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
          color: iconColor
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={iconPath} />
          </svg>
        </div>

        {/* Content */}
        <h3 style={{ 
          margin: '0 0 8px 0', 
          color: '#fff', 
          fontSize: '18px', 
          fontWeight: 600 
        }}>
          {title}
        </h3>
        
        <p style={{ 
          margin: '0 0 24px 0', 
          color: '#a1a1aa', 
          fontSize: '14px', 
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap'
        }}>
          {message}
        </p>

        {/* Button */}
        {onPrimary ? (
          <div style={{ display: 'flex', width: '100%', gap: 10 }}>
            <button
              className="btn-click-anim"
              onClick={onSecondary || onClose}
              disabled={!!secondaryDisabled}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: 'transparent',
                color: '#fff',
                border: '1px solid #3f3f46',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: secondaryDisabled ? 'not-allowed' : 'pointer',
                opacity: secondaryDisabled ? 0.6 : 1
              }}
            >
              {secondaryLabel || (t?.modal?.close || 'Close')}
            </button>
            <button
              className="btn-click-anim"
              onClick={onPrimary}
              disabled={!!primaryDisabled}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: primaryDisabled ? 'not-allowed' : 'pointer',
                opacity: primaryDisabled ? 0.7 : 1
              }}
            >
              {primaryLabel || (t?.modal?.ok || 'OK')}
            </button>
          </div>
        ) : (
          <button 
            className="btn-click-anim"
            onClick={onClose}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#fff',
              color: '#000',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            {type === 'error' ? (t?.modal?.close || 'Close') : (t?.modal?.ok || 'OK')}
          </button>
        )}
      </div>
    </div>
  );
}
