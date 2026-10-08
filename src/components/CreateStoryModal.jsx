import './Stories.css';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { isSupabaseConfigured } from '../supabaseClient';
import {
  X,
  Camera,
  RefreshCw,
  Image as ImageIcon,
  Send,
  RotateCcw,
  Clock
} from 'lucide-react';
import { uploadSanitizedPublicImage } from '../services/publicMediaService';
import { triggerHaptic } from '../hooks/useMessageTouch';

const QUICK_EMOJIS = ['🔥', '❤️', '😂', '👍', '✨', '🪙', '😍', '🎉'];

export default function CreateStoryModal() {
  const {
    currentUser,
    isCreateStoryOpen,
    setIsCreateStoryOpen,
    publishStory
  } = useChat();

  const [mode, setMode] = useState('camera'); // 'camera' | 'editor'
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [caption, setCaption] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async (facing = facingMode) => {
    stopCamera();
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Камера не поддерживается вашим браузером');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
      setCameraError(null);
    } catch (err) {
      console.warn('Camera access error:', err);
      setCameraError('Доступ к камере заблокирован или не поддерживается');
      setCameraActive(false);
    }
  }, [facingMode, stopCamera]);

  // Lifecycle when modal opens/closes
  useEffect(() => {
    if (isCreateStoryOpen) {
      setImageFile(null);
      setImagePreview('');
      setCaption('');
      setMode('camera');
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isCreateStoryOpen, startCamera, stopCamera]);

  if (!currentUser) return null;

  const handleClose = () => {
    stopCamera();
    setImageFile(null);
    setImagePreview('');
    setCaption('');
    setMode('camera');
    setIsCreateStoryOpen(false);
  };

  const handleToggleCamera = () => {
    triggerHaptic(12);
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    startCamera(nextFacing);
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current || !cameraActive) return;

    triggerHaptic([15, 30, 20]);
    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 220);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // If front camera, mirror image naturally
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `story-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setImageFile(file);
      setImagePreview(URL.createObjectURL(blob));
      stopCamera();
      setMode('editor');
    }, 'image/jpeg', 0.92);
  };

  const handleFileSelect = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      alert('Пожалуйста, выберите файл изображения!');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target.result);
      stopCamera();
      setMode('editor');
    };
    reader.readAsDataURL(file);
  };

  const handleRetake = () => {
    setImageFile(null);
    setImagePreview('');
    setCaption('');
    setMode('camera');
    startCamera();
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const uploadImageToSupabase = async (file) => {
    if (isSupabaseConfigured) {
      const { reference } = await uploadSanitizedPublicImage(file, 'story');
      return reference;
    }
    return imagePreview;
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!imageFile) {
      alert('Пожалуйста, сделайте фото или выберите изображение!');
      return;
    }

    setIsSubmitting(true);
    triggerHaptic(18);
    try {
      const mediaUrl = await uploadImageToSupabase(imageFile);
      const story = await publishStory(mediaUrl, caption.trim());
      if (story) {
        handleClose();
      }
    } catch (err) {
      console.error(err);
      alert(`Ошибка при публикации истории: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`settings-modal-overlay story-studio-overlay ${isCreateStoryOpen ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`story-studio-card ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        {/* Shutter flash effect */}
        <div className={`story-studio-flash ${isFlashActive ? 'active' : ''}`} />

        {/* =========================================================
            MODE 1: CAMERA VIEWFINDER
           ========================================================= */}
        {mode === 'camera' && (
          <div className="story-studio-camera-layer">
            <video
              ref={videoRef}
              className={`story-camera-stream ${facingMode === 'user' ? 'mirrored' : ''}`}
              playsInline
              autoPlay
              muted
            />

            {/* If camera is not available or disabled */}
            {!cameraActive && (
              <div className="story-camera-fallback">
                <Camera size={54} className="story-fallback-icon" />
                <h4 className="story-fallback-title">Создание истории</h4>
                <p className="story-fallback-desc">
                  {cameraError || 'Включите камеру или выберите готовое фото из галереи устройства'}
                </p>
                <button
                  type="button"
                  className="story-pick-gallery-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon size={18} />
                  <span>Выбрать из галереи</span>
                </button>
              </div>
            )}

            {/* Top camera controls */}
            <div className="story-studio-topbar">
              <button
                type="button"
                className="story-studio-icon-btn"
                onClick={handleClose}
                aria-label="Закрыть"
              >
                <X size={22} />
              </button>

              <div className="story-duration-pill" title="Время жизни истории в Telegram">
                <Clock size={13} />
                <span>24 часа</span>
              </div>

              {cameraActive && (
                <button
                  type="button"
                  className="story-studio-icon-btn"
                  onClick={handleToggleCamera}
                  aria-label="Переключить камеру"
                  title="Переключить камеру"
                >
                  <RefreshCw size={19} />
                </button>
              )}
            </div>

            {/* Bottom Camera Toolbar: Gallery | Shutter | Placeholder */}
            {cameraActive && <div className="story-studio-bottom-toolbar">
              {/* Gallery button */}
              <button
                type="button"
                className="story-toolbar-btn gallery"
                onClick={() => fileInputRef.current?.click()}
                title="Выбрать из файлов"
              >
                <ImageIcon size={22} />
              </button>

              {/* Shutter capture button */}
              <button
                type="button"
                className="story-shutter-btn"
                onClick={handleCapturePhoto}
                disabled={!cameraActive}
                aria-label="Сделать снимок"
                title={cameraActive ? 'Сделать фото' : 'Камера недоступна'}
              >
                <div className="story-shutter-inner" />
              </button>

              {/* Extra camera flip button for bottom bar on mobile */}
              <button
                type="button"
                className="story-toolbar-btn flip"
                onClick={handleToggleCamera}
                disabled={!cameraActive}
                title="Перевернуть камеру"
              >
                <RefreshCw size={20} />
              </button>
            </div>}
          </div>
        )}

        {/* =========================================================
            MODE 2: STORY EDITOR (Image preview + Telegram-style caption)
           ========================================================= */}
        {mode === 'editor' && (
          <div className="story-studio-editor-layer">
            <img
              src={imagePreview}
              alt="Story Preview"
              className="story-editor-media"
            />
            <div className="story-editor-gradient-top" />
            <div className="story-editor-gradient-bottom" />

            {/* Top Editor Bar */}
            <div className="story-studio-topbar">
              <button
                type="button"
                className="story-studio-retake-btn"
                onClick={handleRetake}
              >
                <RotateCcw size={16} />
                <span>Переснять</span>
              </button>

              <div className="story-duration-pill">
                <Clock size={13} />
                <span>24 часа</span>
              </div>

              <button
                type="button"
                className="story-studio-icon-btn"
                onClick={handleClose}
                aria-label="Закрыть"
              >
                <X size={22} />
              </button>
            </div>

            {/* Floating In-Story Caption & Publishing Box */}
            <form onSubmit={handleSubmit} className="story-editor-caption-container">
              {/* Quick Emojis strip */}
              <div className="story-quick-emojis">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="story-quick-emoji-btn"
                    onClick={() => setCaption((prev) => `${prev} ${emoji}`.trim())}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Caption input pill with Telegram send button */}
              <div className="story-caption-pill">
                <input
                  type="text"
                  className="story-caption-input"
                  placeholder="Добавить подпись..."
                  value={caption}
                  maxLength={150}
                  onChange={(e) => setCaption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  autoFocus
                />

                <button
                  type="submit"
                  className="story-publish-send-btn"
                  disabled={isSubmitting}
                  title="Опубликовать историю"
                >
                  {isSubmitting ? (
                    <div className="spinner story-publish-spinner" />
                  ) : (
                    <Send size={18} className="story-send-icon" />
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="file-upload-input-hidden"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFileSelect(e.target.files[0]);
            }
          }}
        />
      </div>
    </div>
  );
}
