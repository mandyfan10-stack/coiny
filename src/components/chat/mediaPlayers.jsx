import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, VolumeX, Volume2, Maximize2 } from 'lucide-react';
import StickerMessage from '../StickerMessage';
import useResolvedMedia from '../../hooks/useResolvedMedia';

function AttachmentUnavailable({ compact = false }) {
  return (
    <div className={'bubble-media-error' + (compact ? ' bubble-media-error-compact' : '')}>
      Вложение недоступно
    </div>
  );
}

function DecryptedImage({ mediaUrl, chatId, onOpen }) {
  const { url, loading, error } = useResolvedMedia(mediaUrl, chatId, 'image/png');
  if (loading) {
    return (
      <div className="bubble-media-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '150px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
        <div className="spinner" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', width: '20px', height: '20px' }}></div>
      </div>
    );
  }
  if (error || !url) return <AttachmentUnavailable />;
  return (
    <button type="button" className="bubble-media-open" onClick={(event) => { event.stopPropagation(); onOpen?.(url); }} aria-label="Открыть изображение">
      <img src={url} alt="Изображение" className="bubble-media" />
    </button>
  );
}

function DecryptedVideoPlayer({ mediaUrl, chatId }) {
  const { url, loading, error } = useResolvedMedia(mediaUrl, chatId, 'video/webm');
  if (loading) {
    return (
      <div className="bubble-media-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
        <div className="spinner" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', width: '20px', height: '20px' }}></div>
      </div>
    );
  }
  if (error || !url) return <AttachmentUnavailable />;
  return <VideoMessagePlayer videoUrl={url} />;
}

function DecryptedRegularVideoPlayer({ mediaUrl, chatId, onOpen }) {
  const { url, loading, error } = useResolvedMedia(mediaUrl, chatId, 'video/mp4');
  if (loading) {
    return (
      <div className="bubble-media-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '160px', background: 'rgba(0,0,0,0.1)', borderRadius: '12px' }}>
        <div className="spinner" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', width: '24px', height: '24px' }}></div>
      </div>
    );
  }
  if (error || !url) return <AttachmentUnavailable />;
  return <RegularVideoPlayer videoUrl={url} onOpen={onOpen} />;
}

function DecryptedVoicePlayer({ mediaUrl, chatId, duration }) {
  const { url, loading, error } = useResolvedMedia(mediaUrl, chatId, 'audio/webm');
  if (loading) {
    return (
      <div className="voice-player-bubble-loading" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }}>
        <div className="spinner" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', width: '12px', height: '12px' }}></div>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Загрузка голосового сообщения...</span>
      </div>
    );
  }
  if (error || !url) return <AttachmentUnavailable compact />;
  return <VoiceMessagePlayer audioUrl={url} duration={duration} />;
}

function DecryptedSticker({ mediaUrl, chatId }) {
  const { url, loading, error } = useResolvedMedia(mediaUrl, chatId);
  if (loading) {
    return (
      <div
        className="bubble-media-loading"
        style={{ width: '130px', height: '130px', borderRadius: '12px' }}
      />
    );
  }
  if (error || !url) return <AttachmentUnavailable />;
  return <StickerMessage mediaUrl={url} sourceUrl={mediaUrl} />;
}

function VoiceMessagePlayer({ audioUrl, duration = 0 }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [maxDuration, setMaxDuration] = useState(duration || 0);
  const audioRef = useRef(null);

  // Safely probe WebM duration on an off-screen Audio probe without corrupting the main player's currentTime
  useEffect(() => {
    if (!audioUrl) return;

    if (duration > 0) {
      setMaxDuration(duration);
    }

    let probe = new Audio();
    probe.preload = 'metadata';
    probe.src = audioUrl;

    const handleProbeCompute = () => {
      if (probe && probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
        setMaxDuration(probe.duration);
        probe.src = '';
      } else if (probe && probe.duration === Infinity) {
        const onSeeked = () => {
          if (probe) {
            probe.removeEventListener('seeked', onSeeked);
            if (probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
              setMaxDuration(probe.duration);
            }
            probe.src = '';
          }
        };
        probe.addEventListener('seeked', onSeeked);
        probe.currentTime = 1e101;
      }
    };

    probe.addEventListener('loadedmetadata', handleProbeCompute);
    probe.addEventListener('durationchange', handleProbeCompute);

    return () => {
      if (probe) {
        probe.removeEventListener('loadedmetadata', handleProbeCompute);
        probe.removeEventListener('durationchange', handleProbeCompute);
        probe.src = '';
        probe = null;
      }
    };
  }, [audioUrl, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };

    const handleTimeUpdate = () => {
      if (audio.paused) {
        setCurrentTime(audio.currentTime);
      }
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setMaxDuration(audio.duration);
      }
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setMaxDuration(audio.duration);
      }
      audio.currentTime = 0;
      setCurrentTime(0);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    setIsPlaying(false);
    setCurrentTime(0);
    audio.currentTime = 0;

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [audioUrl]);

  // Smooth 60fps progress update loop while playing
  useEffect(() => {
    if (!isPlaying) return undefined;
    let animId;
    const updateSmoothProgress = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
        if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
          setMaxDuration(audio.duration);
        }
      }
      animId = requestAnimationFrame(updateSmoothProgress);
    };
    animId = requestAnimationFrame(updateSmoothProgress);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  const togglePlay = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
    } else {
      if (audio.ended || (maxDuration > 0 && audio.currentTime >= maxDuration - 0.05)) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      audio.play().catch(err => console.error("Error playing audio:", err));
    }
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    const val = parseFloat(e.target.value);
    audio.currentTime = val;
    setCurrentTime(val);
  };

  const formatTime = (time) => {
    if (isNaN(time) || time === Infinity || time < 0) return '0:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = maxDuration > 0 ? Math.min(100, Math.max(0, (currentTime / maxDuration) * 100)) : 0;

  return (
    <div className="voice-player-bubble" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <button className="voice-play-btn" onClick={togglePlay} aria-label={isPlaying ? "Пауза" : "Воспроизвести"}>
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>
      <div className="voice-player-details">
        <input
          type="range"
          className="voice-seek-bar"
          min={0}
          max={maxDuration || 100}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
          style={{ '--voice-progress': `${progressPercent}%` }}
        />
        <div className="voice-player-meta">
          <span>{formatTime(currentTime)} / {formatTime(maxDuration)}</span>
        </div>
      </div>
    </div>
  );
}

function VideoMessagePlayer({ videoUrl }) {
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const progressRingRef = useRef(null);
  const r = 88;
  const circ = 2 * Math.PI * r;
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasEnded, setHasEnded] = useState(false);
  const isCalculatingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frame = null;
    let durationTimer = null;
    let durationSeeked = null;
    isCalculatingRef.current = false;

    // Use the media clock on display frames instead of sparse timeupdate
    // events. Update only the ring, without rerendering the message.
    const drawProgress = () => {
      if (isCalculatingRef.current) return;
      const fraction = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(1, Math.max(0, video.currentTime / video.duration)) : 0;
      const offset = String(circ * (1 - fraction));
      const ring = progressRingRef.current;
      if (ring && ring.getAttribute('stroke-dashoffset') !== offset) {
        ring.setAttribute('stroke-dashoffset', offset);
      }
    };
    const stopFrames = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const tick = () => {
      frame = null;
      drawProgress();
      if (!video.paused && !video.ended && !video.seeking && !document.hidden) {
        frame = requestAnimationFrame(tick);
      }
    };
    const startFrames = () => {
      drawProgress();
      if (frame === null && !video.paused && !video.ended && !video.seeking && !document.hidden) {
        frame = requestAnimationFrame(tick);
      }
    };
    const handleTimeUpdate = () => {
      if (frame === null) drawProgress();
    };
    const handleEnded = () => {
      stopFrames();
      drawProgress();
      setIsPlaying(false);
      setHasEnded(true);
    };
    const handlePlay = () => {
      setIsPlaying(true);
      setHasEnded(false);
      drawProgress();
    };
    const handlePause = () => {
      stopFrames();
      drawProgress();
      setIsPlaying(false);
    };
    const handleWaiting = () => {
      stopFrames();
      drawProgress();
    };
    const handleSeeked = () => startFrames();
    const handleVisibility = () => {
      if (document.hidden) stopFrames();
      else startFrames();
    };

    const handleDurationCompute = () => {
      if (video.duration === Infinity && !isCalculatingRef.current) {
        isCalculatingRef.current = true;
        video.currentTime = 1e101;
        
        durationSeeked = () => {
          video.removeEventListener('seeked', durationSeeked);
          durationSeeked = null;
          video.currentTime = 0;
          durationTimer = setTimeout(() => {
            isCalculatingRef.current = false;
            startFrames();
          }, 150);
        };
        video.addEventListener('seeked', durationSeeked);
      }
    };

    drawProgress();
    const handleRateChange = () => drawProgress();
    video.addEventListener('ratechange', handleRateChange);
    video.addEventListener('playing', startFrames);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('seeking', handleWaiting);
    video.addEventListener('seeked', handleSeeked);
    document.addEventListener('visibilitychange', handleVisibility);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadedmetadata', handleDurationCompute);
    video.addEventListener('durationchange', handleDurationCompute);

    video.play().catch(() => {
      setIsPlaying(false);
    });

    return () => {
      stopFrames();
      clearTimeout(durationTimer);
      if (durationSeeked) video.removeEventListener('seeked', durationSeeked);
      video.removeEventListener('ratechange', handleRateChange);
      video.removeEventListener('playing', startFrames);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('seeking', handleWaiting);
      video.removeEventListener('seeked', handleSeeked);
      document.removeEventListener('visibilitychange', handleVisibility);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleDurationCompute);
      video.removeEventListener('durationchange', handleDurationCompute);
    };
  }, [videoUrl, circ]);

  const togglePlaybackAndMute = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      if (hasEnded) video.currentTime = 0;
      video.muted = false;
      setIsMuted(false);
      video.play().then(() => setIsPlaying(true)).catch(err => console.error(err));
    } else {
      if (isPlaying) {
        video.pause();
      } else {
        if (hasEnded) video.currentTime = 0;
        video.play().then(() => setIsPlaying(true)).catch(err => console.error(err));
      }
    }
  };

  const handleMuteBtnClick = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };


  return (
    <div className="round-video-wrapper" onClick={togglePlaybackAndMute}>
      <video
        ref={videoRef}
        src={videoUrl}
        className="round-video-element"
        muted={isMuted}
        playsInline
        autoPlay
      />
      
      <svg className="video-progress-ring" viewBox="0 0 184 184">
        <circle
          ref={progressRingRef}
          className="video-progress-ring-circle"
          cx="92"
          cy="92"
          r={r}
          stroke="var(--accent-color)"
          strokeWidth="3"
          fill="transparent"
          strokeDasharray={circ}
          strokeDashoffset={circ}
          transform="rotate(-90 92 92)"
        />
      </svg>

      {!isPlaying && (
        <div className="video-mute-icon-overlay" style={{ top: '55%', left: '50%', transform: 'translate(-50%, -50%)', width: '36px', height: '36px', fontSize: '14px', position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Play size={16} fill="currentColor" style={{ marginLeft: '2px' }} />
        </div>
      )}

      <div className="video-mute-icon-overlay" onClick={handleMuteBtnClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </div>
    </div>
  );
}

function RegularVideoPlayer({ videoUrl, onOpen }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime || 0);
    const onLoadedMetadata = () => setDuration(video.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(video.duration || 0);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoUrl]);

  const togglePlay = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !duration) return;
    const seekTime = (Number(e.target.value) / 100) * duration;
    video.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const formatVideoTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="regular-video-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className="regular-video-element"
        playsInline
        muted={isMuted}
        onClick={togglePlay}
      />

      {/* Center Play button overlay when paused */}
      {!isPlaying && (
        <button
          type="button"
          className="regular-video-center-btn"
          onClick={togglePlay}
          aria-label="Воспроизвести видео"
        >
          <Play size={24} fill="currentColor" style={{ marginLeft: '3px' }} />
        </button>
      )}

      {/* Bottom controls bar */}
      <div className={`regular-video-controls ${!isPlaying || isHovered ? 'visible' : ''}`}>
        <button
          type="button"
          className="regular-video-ctrl-btn"
          onClick={togglePlay}
          title={isPlaying ? 'Пауза' : 'Воспроизвести'}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
        </button>

        <span className="regular-video-time">
          {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
        </span>

        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progressPercent}
          onChange={handleSeek}
          className="regular-video-seek"
          style={{ '--video-progress': `${progressPercent}%` }}
        />

        <button
          type="button"
          className="regular-video-ctrl-btn"
          onClick={toggleMute}
          title={isMuted ? 'Включить звук' : 'Выключить звук'}
        >
          {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        <button
          type="button"
          className="regular-video-ctrl-btn"
          onClick={(e) => {
            e.stopPropagation();
            const video = videoRef.current;
            if (video && typeof video.requestFullscreen === 'function') {
              video.requestFullscreen().catch(() => {
                onOpen?.(videoUrl);
              });
            } else if (onOpen) {
              onOpen(videoUrl);
            }
          }}
          title="Во весь экран"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}

export {
  AttachmentUnavailable,
  DecryptedImage,
  DecryptedVideoPlayer,
  DecryptedRegularVideoPlayer,
  DecryptedVoicePlayer,
  DecryptedSticker,
  VoiceMessagePlayer,
  VideoMessagePlayer,
  RegularVideoPlayer
};
