import { ArrowLeft, Lock, MoreVertical, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useE2EE } from '../../context/E2EEContext';
import { isSavedMessagesChat, requiresPersonalE2EE, savedMessagesDisplayName } from '../../utils/savedMessages';
import { chatAvatarFallback } from '../../context/chat/avatarFallback';
import { triggerHaptic } from '../../hooks/useMessageTouch';

export default function ChatHeader({
  activeChat,
  renderAvatar,
  getChatStatus,
  isTypingText,
  isSyncing,
  isInfoOpen,
  setIsInfoOpen,
  setActiveChatId,
  isSearchOpen = false,
  onToggleSearch
}) {
  const { currentUser } = useAuth();
  const { e2eePrivateKey } = useE2EE();
  const toggleInfo = () => {
    triggerHaptic(8);
    setIsInfoOpen(!isInfoOpen);
  };
  const isSaved = isSavedMessagesChat(activeChat);
  const title = isSaved ? savedMessagesDisplayName(activeChat) : activeChat.name;
  const otherMember = (activeChat.members || []).find((member) => member?.id && member.id !== currentUser?.id);
  const showE2eeLock = requiresPersonalE2EE(activeChat)
    && Boolean(e2eePrivateKey)
    && Boolean(otherMember?.publicKey || otherMember?.hasE2ee);

  return (
    <header className="chat-header" onClick={toggleInfo}>
      <div className="chat-header-info">
        <button
          type="button"
          className="chat-back-btn"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic(10);
            setActiveChatId(null);
          }}
          title="Назад"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="chat-avatar header-avatar">{renderAvatar(activeChat.avatar, chatAvatarFallback(activeChat))}</div>
        <div className="chat-header-meta">
          <h4 className="chat-header-name">
            {title}
            {showE2eeLock && (
              <Lock
                size={15}
                className="e2ee-header-lock-icon"
                title="Сквозное шифрование включено"
                style={{ color: '#2ecc71', marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }}
              />
            )}
          </h4>
          <span className={`chat-header-status ${isTypingText ? 'typing' : ''} ${isSyncing && !isTypingText ? 'syncing' : ''}`}>
            {isTypingText || (isSyncing ? 'Обновление...' : getChatStatus(activeChat))}
          </span>
        </div>
      </div>
      <div className="chat-header-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`chat-header-btn ${isSearchOpen ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(8);
            onToggleSearch?.();
          }}
          title="Поиск в чате (Ctrl+F)"
          aria-label="Поиск в чате"
          data-testid="chat-header-search-btn"
        >
          <Search size={19} />
        </button>
        <button type="button" className="chat-header-btn" onClick={toggleInfo} title="Информация">
          <MoreVertical size={20} />
        </button>
      </div>
    </header>
  );
}
