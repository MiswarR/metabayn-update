import React, { useEffect, useState } from 'react';
import { translations } from '../utils/translations'

export default function VideoPlayerWindow() {
  const lang = (() => {
    try {
      const v = localStorage.getItem('app_lang')
      return v === 'id' || v === 'en' ? v : 'en'
    } catch {
      return 'en'
    }
  })()
  const t = (translations as any)[lang] || (translations as any)['en']
  const [videoId, setVideoId] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    // Parse query parameters
    const params = new URLSearchParams(window.location.search);
    const vId = params.get('video_id');
    const vTitle = params.get('title');

    if (vId) setVideoId(vId);
    if (vTitle) setTitle(vTitle);

    // Set document title
    if (vTitle) document.title = vTitle;
  }, []);

  if (!videoId) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh', 
        background: '#000', 
        color: '#fff' 
      }}>
        {t?.video?.loading || 'Loading Video...'}
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
        title={title}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ display: 'block' }}
      />
    </div>
  );
}
