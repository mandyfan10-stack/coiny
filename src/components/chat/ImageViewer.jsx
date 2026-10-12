import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { VoiceMessagePlayer } from './mediaPlayers';
import { prepareFiniteMediaDuration } from '../../utils/mediaDuration';
import IconButton from '../ui/IconButton';
import './ImageViewer.css';

function viewerControls(viewer) {
  if (!viewer) return [];
  return [...viewer.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], video[controls], audio[controls], [tabindex]:not([tabindex="-1"]):not([data-focus-guard])')]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
}

function isAudioUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('data:audio/') ||
    lower.includes('audio_') ||
    lower.includes('.ogg') ||
    lower.includes('.mp3') ||
    lower.includes('.wav') ||
    lower.includes('.m4a') ||
    lower.includes('.aac') ||
    lower.includes('.opus')
  );
}

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (isAudioUrl(url)) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('data:video/') ||
    lower.includes('.mp4') ||
    (lower.includes('.webm') && !lower.includes('audio_')) ||
    lower.includes('.mov') ||
    lower.includes('.ogv') ||
    lower.includes('.mkv') ||
    lower.includes('video')
  );
}

export default function ImageViewer({ imageUrl, isVideo: isVideoProp, onClose }) {
  const videoRef = useRef(null);
  const closeButtonRef = useRef(null);
  const viewerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [videoReady, setVideoReady] = useState(false);
  const [renderType, setRenderType] = useState(() => {
    if (isAudioUrl(imageUrl)) return 'audio';
    if (typeof isVideoProp === 'boolean') return isVideoProp ? 'video' : 'image';
    return isVideoUrl(imageUrl) ? 'video' : 'image';
  });

  useEffect(() => {
    if (isAudioUrl(imageUrl)) {
      setRenderType('audio');
    } else if (typeof isVideoProp === 'boolean') {
      setRenderType(isVideoProp ? 'video' : 'image');
    } else {
      setRenderType(isVideoUrl(imageUrl) ? 'video' : 'image');
    }
  }, [imageUrl, isVideoProp]);

  useEffect(() => {
    setVideoReady(false);
    if (renderType !== 'video') return undefined;

    const video = videoRef.current;
    if (!video) return undefined;

    const handleError = () => setVideoReady(true);
    const cleanupDuration = prepareFiniteMediaDuration(video, () => {
      setVideoReady(true);
      video.play().catch(() => {});
    });

    video.addEventListener('error', handleError);
    return () => {
      cleanupDuration();
      video.removeEventListener('error', handleError);
    };
  }, [imageUrl, renderType]);

  // If it's a blob: URL and we aren't sure, inspect the blob type via fetch
  useEffect(() => {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('blob:')) return;
    if (typeof isVideoProp === 'boolean') return;

    let active = true;
    fetch(imageUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (active && blob && blob.type) {
          if (blob.type.startsWith('audio/')) {
            setRenderType('audio');
          } else if (blob.type.startsWith('video/')) {
            setRenderType('video');
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [imageUrl, isVideoProp]);

  useEffect(() => {
    if (!imageUrl) return undefined;
    const returnFocus = document.activeElement;
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    const keepFocusInside = event => {
      if (!viewerRef.current?.contains(event.target)) closeButtonRef.current?.focus({ preventScroll: true });
    };
    closeButtonRef.current?.focus({ preventScroll: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', keepFocusInside);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [imageUrl]);

  if (!imageUrl) return null;

  const content = (
    <div
      ref={viewerRef}
      className="chat-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={renderType === 'audio' ? 'Аудио' : renderType === 'video' ? 'Просмотр видео' : 'Просмотр изображения'}
      onClick={onClose}
    >
      {/* Guards let the browser traverse native video/audio controls normally. */}
      <span className="chat-image-viewer-focus-guard" tabIndex={0} data-focus-guard aria-hidden="true"
        onFocus={() => viewerControls(viewerRef.current).at(-1)?.focus({ preventScroll: true })} />
      <IconButton
        ref={closeButtonRef}
        className="chat-image-viewer-close"
        onClick={onClose}
        label="Закрыть просмотр"
      >
        <X size={26} />
      </IconButton>
      {renderType === 'audio' ? (
        <div
          className="chat-image-viewer-audio-container"
          onClick={(event) => event.stopPropagation()}
        >
          <VoiceMessagePlayer audioUrl={imageUrl} />
        </div>
      ) : renderType === 'video' ? (
        <video
          ref={videoRef}
          src={imageUrl}
          controls={videoReady}
          preload="metadata"
          playsInline
          aria-busy={!videoReady}
          className="chat-image-viewer-video"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <img
          src={imageUrl}
          alt="Просмотр изображения"
          onClick={(event) => event.stopPropagation()}
          onError={() => {
            // Auto fallback to video if image decoding fails on decrypted blob
            setRenderType('video');
          }}
        />
      )}
      <span className="chat-image-viewer-focus-guard" tabIndex={0} data-focus-guard aria-hidden="true"
        onFocus={() => closeButtonRef.current?.focus({ preventScroll: true })} />
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }

  return content;
}
