import React, { useEffect, useState } from 'react';

export default function VideoPlayerWindow() {
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
        Loading Video...
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
