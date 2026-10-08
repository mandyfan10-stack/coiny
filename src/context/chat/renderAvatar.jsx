import React from 'react';
import { Users, Megaphone, Bookmark, User, Bot, CloudSun, Brain, Zap } from 'lucide-react';
import PrivateStorageImage from '../../components/PrivateStorageImage';
import { firstAvatarLetter, resolveAvatarToken } from './avatarFallback';

export {
  chatAvatarFallback,
  firstAvatarLetter,
  personAvatarFallback,
  resolveAvatarToken,
} from './avatarFallback';

const TOKEN_VISUALS = Object.freeze({
  group: { bg: '#6499c2', Icon: Users },
  channel: { bg: '#a18ac5', Icon: Megaphone },
  saved: { bg: '#6499c2', Icon: Bookmark, iconProps: { fill: 'currentColor' } },
  user: { bg: '#6499c2', Icon: User },
  coin: { bg: '#c59b6c', Icon: User },
  bot: { bg: '#c58282', Icon: Bot },
  weather: { bg: '#bba067', Icon: CloudSun },
  quiz: { bg: '#a18ac5', Icon: Brain },
  spy: { bg: '#84929e', Icon: User },
  zap: { bg: '#bba067', Icon: Zap },
});

function tokenVisual(token) {
  const visual = TOKEN_VISUALS[token];
  if (!visual) return null;
  const { bg, Icon, iconProps } = visual;
  return (
    <div className="premium-avatar-container" style={{ background: bg }}>
      <Icon className="premium-avatar-icon" {...iconProps} />
    </div>
  );
}

function letterAvatar(letter) {
  const colors = ['#6b93c1', '#a58ac5', '#76a883', '#c68c72', '#6ca9ae', '#b79a63'];
  const color = colors[(letter.codePointAt(0) || 0) % colors.length];
  return (
    <div className="premium-avatar-container letter-avatar" style={{ background: color }}>
      <span className="avatar-text">{letter}</span>
    </div>
  );
}

function visualFor(value) {
  if (value == null || value === '') return tokenVisual('user');
  if (typeof value !== 'string') return value;
  return tokenVisual(resolveAvatarToken(value)) || letterAvatar(firstAvatarLetter(value) || '•');
}

/**
 * Render chat/list avatar (URL, emoji, or premium icon container).
 * String fallbacks are tokens (`user`, `group`, `channel`) or a name (first letter).
 */
export function renderAvatar(avatar, fallback = '👤') {
  const avatarStr = typeof avatar === 'string' ? avatar : (typeof avatar?.avatar === 'string' ? avatar.avatar : '');
  const fallbackVisual = visualFor(fallback);
  const isUrl = Boolean(avatarStr && (
    avatarStr.startsWith('http') || avatarStr.startsWith('data:image') || avatarStr.startsWith('storage://')
  ));
  if (isUrl) {
    return (
      <PrivateStorageImage
        src={avatarStr}
        alt=""
        fallback={fallbackVisual}
        style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
      />
    );
  }

  if (avatarStr) return visualFor(avatarStr);
  return fallbackVisual;
}
