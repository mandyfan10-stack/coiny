import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import lottie from 'lottie-web';
import { loadStickerAnimation } from '../utils/stickerAnimation';

export default function StickerMessage({ mediaUrl, sourceUrl = mediaUrl }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  // Parse file extension to identify format
  const isLottie = sourceUrl && (sourceUrl.endsWith('.json') || sourceUrl.includes('.json?'));
  const isVideo = sourceUrl && (sourceUrl.endsWith('.webm') || sourceUrl.includes('.webm?'));

  useEffect(() => {
    setError(null);
    if (!isLottie || !containerRef.current) return;

    let anim = null;
    let active = true;
    const controller = new AbortController();
    void loadStickerAnimation(mediaUrl, { signal: controller.signal }).then(animationData => {
      if (!active) return;
      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData,
      });
    }).catch(err => {
      if (!active) return;
      console.error('Lottie load failed:', err);
      setError(mediaUrl);
    });

    return () => {
      active = false;
      controller.abort();
      if (anim) {
        anim.destroy();
      }
    };
  }, [mediaUrl, isLottie]);

  if (error && error === mediaUrl) {
    return (
      <div className="sticker-fallback" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '130px', height: '130px', backgroundColor: 'var(--bg-input)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
        <Image size={32} />
      </div>
    );
  }

  if (isLottie) {
    return (
      <div 
        ref={containerRef} 
        className="sticker-container sticker-animated" 
        style={{ width: '130px', height: '130px' }} 
      />
    );
  }

  if (isVideo) {
    return (
      <video
        src={mediaUrl}
        autoPlay
        loop
        muted
        playsInline
        className="sticker-container sticker-video"
        style={{ width: '130px', height: '130px', objectFit: 'contain' }}
      />
    );
  }

  // Fallback: WebP/Static Sticker
  return (
    <img
      src={mediaUrl}
      alt="Стикер"
      className="sticker-container sticker-static"
      style={{ width: '130px', height: '130px', objectFit: 'contain' }}
      onError={() => setError(mediaUrl)}
    />
  );
}
