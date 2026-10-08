import { Send, Paperclip, Smile, Mic, X, Play, Pause, Lock, Trash2, CornerUpLeft, Camera, Video } from 'lucide-react';
import { CHAT_MEDIA_ACCEPT } from '../../utils/mediaValidation';
import { getReplyType } from '../../utils/mobileActionSheetUtils';
import MediaPickerPanel from './MediaPickerPanel';
import IconButton from '../ui/IconButton';
import { triggerHaptic } from '../../hooks/useMessageTouch';
import './ChatComposer.css';

/** Presentational composer; ChatArea retains messaging, recording and scroll state. */
export default function ChatComposer({
  activeChat,
  canPost,
  canSendMedia,
  recipientMissingE2EE,
  replyingTo,
  setReplyingTo,
  inputVal,
  handleInputChange,
  handleKeyPress,
  handlePaste,
  handleSend,
  handleEmojiClick,
  showEmojiPicker,
  setShowEmojiPicker,
  emojiRef,
  installedStickers,
  sendMessage,
  fileInputRef,
  handleFileChange,
  uploading,
  isRecording,
  isRecordingStarting,
  isRecordingLocked,
  isRecordingPaused,
  isLockActive,
  recordMode,
  recordDuration,
  formatDuration,
  stopRecordingAndSend,
  pauseRecording,
  resumeRecording,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  videoPreviewRef,
  footerRef,
  textareaRef,
  openSettings
}) {
  return <>
      {/* Input Area */}
      {!canPost ? (
        <footer className="chat-footer-input restricted" ref={footerRef}>
          <div className="restricted-input-bar">
            <span>{activeChat?.requiresUpdate
              ? 'Для этого чата требуется версия Coiny с поддержкой E2EE v2. Отправка заблокирована.'
              : activeChat?.type === 'channel'
                ? 'Только администраторы могут отправлять сообщения в этот канал'
                : 'Только администраторы могут отправлять сообщения в эту группу'}</span>
          </div>
        </footer>
      ) : (
        <footer className="chat-footer-input" ref={footerRef}>
        {recipientMissingE2EE && (
          <div className="e2ee-waiting-banner">
            <Lock size={14} className="e2ee-banner-icon" />
            <span>Ожидание настройки ключей шифрования собеседником...</span>
          </div>
        )}

        {/* Reply Bar Overlay */}
        {replyingTo && (
          <div className="reply-indicator-bar">
            <CornerUpLeft size={16} className="reply-bar-icon" />
            <div className="reply-bar-meta">
              <span className="reply-bar-title">Ответ пользователю {replyingTo.senderName}</span>
              <p className="reply-bar-desc">
                {(() => {
                  const info = getReplyType(replyingTo);
                  if (info.type === 'image') return <><Camera size={13} className="reply-media-svg" /> Фото</>;
                  if (info.type === 'video') return <><Video size={13} className="reply-media-svg" /> Видео</>;
                  if (info.type === 'video_note') return <><Video size={13} className="reply-media-svg" /> Видеосообщение</>;
                  if (info.type === 'voice') return <><Mic size={13} className="reply-media-svg" /> Голосовое сообщение</>;
                  if (info.type === 'sticker') return <><Smile size={13} className="reply-media-svg" /> Стикер</>;
                  return info.text;
                })()}
              </p>
            </div>
            <IconButton label="Отменить ответ" className="reply-bar-close" onClick={() => setReplyingTo(null)}>
              <X size={16} />
            </IconButton>
          </div>
        )}

        <div className="input-row">
          {isRecording ? (
            <div className={`recording-panel ${isRecordingLocked ? 'locked' : ''}`}>
              <div className={`record-dot ${isRecordingPaused ? 'paused' : ''}`} />
              {isRecordingLocked && (
                <div className="record-locked-badge">
                  <Lock size={13} />
                </div>
              )}
              <span className="record-timer">{formatDuration(recordDuration)}</span>

              {!isRecordingLocked ? (
                <>
                  <div className="record-wave">
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                  </div>
                  <span className="record-cancel-hint">← Проведите влево для отмены</span>
                </>
              ) : (
                <div className="record-locked-controls">
                  <IconButton
                    type="button"
                    className="record-control-btn btn-trash"
                    onClick={() => stopRecordingAndSend(true)}
                    label="Удалить запись"
                  >
                    <Trash2 size={18} />
                  </IconButton>

                  <IconButton
                    type="button"
                    className="record-control-btn btn-pause-resume"
                    onClick={isRecordingPaused ? resumeRecording : pauseRecording}
                    label={isRecordingPaused ? "Продолжить запись" : "Приостановить запись"}
                  >
                    {isRecordingPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
                  </IconButton>

                  <IconButton
                    type="button"
                    className="record-control-btn btn-send"
                    onClick={() => stopRecordingAndSend(false)}
                    label="Отправить"
                  >
                    <Send size={18} />
                  </IconButton>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Attachment button */}
              {canSendMedia && !recipientMissingE2EE && (
                <div className="attach-wrapper">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept={CHAT_MEDIA_ACCEPT}
                    style={{ display: 'none' }}
                    disabled={uploading}
                  />
                  <IconButton
                    type="button"
                    className="input-action-btn"
                    onClick={() => fileInputRef.current?.click()}
                    label="Прикрепить изображение или файл"
                    disabled={uploading}
                  >
                    {uploading ? (
                      <div className="spinner" style={{ width: '18px', height: '18px', borderColor: 'var(--text-secondary)', borderTopColor: 'var(--accent-color)' }} />
                    ) : (
                      <Paperclip size={22} />
                    )}
                  </IconButton>
                </div>
              )}

              {/* Text Area */}
              <div className="input-textarea-wrapper">
                <textarea
                  ref={textareaRef}
                  aria-label="Сообщение"
                  placeholder={recipientMissingE2EE ? "Шифрование недоступно..." : "Напишите сообщение..."}
                  value={inputVal}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyPress}
                  onPaste={handlePaste}
                  rows={1}
                  disabled={recipientMissingE2EE}
                />

                {/* Emoji / Sticker / GIF picker */}
                <div className="emoji-wrapper" ref={emojiRef} onMouseDown={(e) => e.stopPropagation()}>
                  <IconButton
                    type="button"
                    className={`input-action-btn emoji-trigger ${showEmojiPicker ? 'active' : ''}`}
                    active={showEmojiPicker}
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    label="Смайлы, стикеры и GIF"
                  >
                    <Smile size={22} />
                  </IconButton>

                  <MediaPickerPanel
                    isOpen={showEmojiPicker}
                    onClose={() => setShowEmojiPicker(false)}
                    onSelectEmoji={handleEmojiClick}
                    onSelectSticker={(stickerTag, fileUrl) => {
                      sendMessage(stickerTag, replyingTo?.id, fileUrl);
                      setReplyingTo(null);
                    }}
                    onSelectGif={(gifUrl) => {
                      sendMessage('', replyingTo?.id, gifUrl);
                      setReplyingTo(null);
                    }}
                    installedStickers={installedStickers}
                    onOpenStickerSettings={() => {
                      openSettings('stickers');
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Send Action */}
          {inputVal.trim() && !recipientMissingE2EE ? (
            <IconButton
              className="send-message-btn"
              onClick={(event) => { triggerHaptic(15); handleSend(event); }}
              label="Отправить"
            >
              <Send size={20} />
            </IconButton>
          ) : canSendMedia && !recipientMissingE2EE ? (
            <div style={{ position: 'relative' }}>
              {isRecording && !isRecordingLocked && (
                <div className={`recording-lock-indicator ${isLockActive ? 'active' : ''}`}>
                  <div className="lock-arrow-up">▲</div>
                  <div className="lock-icon-wrapper">
                    <Lock size={15} />
                  </div>
                </div>
              )}
              <IconButton
                type="button"
                className={`send-message-btn record-message-btn ${isRecording ? 'recording' : ''} ${isRecordingStarting ? 'recording-starting' : ''}`}
                onPointerDown={(event) => { triggerHaptic(25); handlePointerDown(event); }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onContextMenu={(event) => event.preventDefault()}
                label={isRecordingStarting
                  ? 'Подготовка записи…'
                  : recordMode === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'}
                aria-label={isRecordingStarting
                  ? 'Подготовка записи'
                  : recordMode === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'}
                aria-pressed={isRecording || isRecordingStarting}
                disabled={uploading || isRecordingLocked}
              >
                {recordMode === 'voice' ? <Mic size={20} /> : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                )}
              </IconButton>
            </div>
          ) : (
            <IconButton
              className="send-message-btn"
              disabled
              label={recipientMissingE2EE ? "Ожидание настройки собеседником" : "Отправка медиа ограничена"}
              style={{ opacity: 0.4, cursor: 'not-allowed' }}
            >
              <Send size={20} />
            </IconButton>
          )}
        </div>
      </footer>
      )}

      {/* Video Recording Live Preview Overlay */}
      {isRecording && recordMode === 'video' && (
        <div className={`video-record-preview-overlay ${isRecordingPaused ? 'paused' : ''}`}>
          <div className="video-record-circle">
            <video ref={videoPreviewRef} muted playsInline autoPlay />
            {isRecordingPaused && (
              <div className="video-paused-overlay">
                <Pause size={32} />
              </div>
            )}
          </div>
          <div className="video-record-timer">
            {formatDuration(recordDuration)}
          </div>
          <div className="video-record-hint">
            {isRecordingPaused ? (
              <>Запись приостановлена<br />Нажмите кнопку воспроизведения внизу для продолжения</>
            ) : isRecordingLocked ? (
              <>Запись заблокирована<br />Используйте кнопки управления внизу для паузы или отправки</>
            ) : (
              <>Запись круглого видеосообщения<br />Отпустите кнопку для отправки, проведите влево для отмены, проведите вверх для блокировки</>
            )}
          </div>
        </div>
      )}
  </>;
}
