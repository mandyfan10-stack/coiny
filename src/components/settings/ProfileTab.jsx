import React from 'react';
import { UserCircle, Copy, Upload } from 'lucide-react';
import ProfilePreview from './ProfilePreview';
import { personAvatarFallback } from '../../context/chat/avatarFallback';
import { buildInviteLink } from '../../utils/inviteLink';
import styles from './ProfileTab.module.css';

export default function ProfileTab({
  currentUser,
  renderAvatar,
  name,
  setName,
  bio,
  setBio,
  copied,
  handleCopyInviteLink,
  avatarInputRef,
  handleAvatarUpload,
  isUploadingAvatar,
  bannerInputRef,
  handleBannerUpload,
  handleBannerRemove,
  isUploadingBanner,
}) {
  return (
    <>
      <div className={styles.previewSection}>
        <ProfilePreview
          variant="compact"
          currentUser={currentUser}
          renderAvatar={renderAvatar}
          avatarFallback={personAvatarFallback({ ...currentUser, name: name || currentUser.name })}
          displayName={name || currentUser.name}
          onAvatarClick={() => avatarInputRef.current?.click()}
          avatarActionDisabled={isUploadingAvatar}
          avatarOverlay={isUploadingAvatar ? <span className={styles.uploading}>Загрузка…</span> : <Upload size={20} />}
          onBannerClick={() => bannerInputRef.current?.click()}
          onBannerRemove={handleBannerRemove}
          isUploadingBanner={isUploadingBanner}
        />
        <input 
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          style={{ display: 'none' }}
        />
        <input 
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          onChange={handleBannerUpload}
          style={{ display: 'none' }}
        />
      </div>

          <div className="settings-section">
            <h5 className="section-title"><UserCircle size={16} /> Профиль</h5>
            
            <div className="input-group">
              <label htmlFor="name-input">Имя</label>
              <input
                id="name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ваше имя"
              />
            </div>

            <div className="input-group">
              <label htmlFor="username-input">Имя пользователя (@)</label>
              <input
                id="username-input"
                type="text"
                value={`@${currentUser.username}`}
                disabled
                className="disabled-input"
              />
            </div>

            <div className="input-group">
              <label>Ссылка для приглашения</label>
              <div className="invite-link-wrapper">
                <input
                  type="text"
                  value={buildInviteLink(currentUser?.username)}
                  readOnly
                  className="invite-link-input"
                />
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className={`invite-copy-btn ${copied ? 'copied' : ''}`}
                >
                  <Copy size={14} />
                  <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                </button>
              </div>
              <span className="input-help-text">Отправьте эту ссылку друзьям, чтобы они могли начать чат с вами.</span>
            </div>

            <div className="input-group">
              <label htmlFor="bio-input">О себе</label>
              <textarea
                id="bio-input"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Напишите что-нибудь о себе..."
                rows={2}
              />
            </div>
          </div>
    </>
  );
}
