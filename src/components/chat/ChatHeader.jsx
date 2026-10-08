import { ArrowLeft, Lock, MoreVertical, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useE2EE } from '../../context/E2EEContext';
import { isSavedMessagesChat, requiresPersonalE2EE, savedMessagesDisplayName } from '../../utils/savedMessages';
import { chatAvatarFallback } from '../../context/chat/avatarFallback';
import { triggerHaptic } from '../../hooks/useMessageTouch';
import IconButton from '../ui/IconButton';
import Avatar from '../ui/Avatar';

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
  const isSaved = isSavedMessagesChat(activeChat, currentUser?.id);
  const title = isSaved ? savedMessagesDisplayName(activeChat, currentUser?.id) : activeChat.name;
  const otherMember = (activeChat.members || []).find((member) => member?.id && member.id !== currentUser?.id);
  const showE2eeLock = requiresPersonalE2EE(activeChat, currentUser?.id)
    && Boolean(e2eePrivateKey)
    && Boolean(otherMember?.publicKey || otherMember?.hasE2ee);

  return (
    <header className="chat-header" onClick={toggleInfo}>
      <div className="chat-header-info">
        <IconButton
          label="Назад"
          className="chat-back-btn"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic(10);
            setActiveChatId(null);
          }}
        >
          <ArrowLeft size={20} />
        </IconButton>
        <Avatar size={40} className="chat-avatar header-avatar">{renderAvatar(activeChat.avatar, chatAvatarFallback(activeChat))}</Avatar>
        <div className="chat-header-meta">
          <h4 className="chat-header-name">
            <span className="chat-header-title" title={title}>{title}</span>
            {showE2eeLock && (
              <Lock
                size={15}
                className="e2ee-header-lock-icon"
                title="Сквозное шифрование включено"
              />
            )}
          </h4>
          <span className={`chat-header-status ${isTypingText ? 'typing' : ''} ${isSyncing && !isTypingText ? 'syncing' : ''}`}>
            {isTypingText || (isSyncing ? 'Обновление...' : getChatStatus(activeChat))}
          </span>
        </div>
      </div>
      <div className="chat-header-actions" onClick={(e) => e.stopPropagation()}>
        <IconButton
          label="Поиск в чате"
          active={isSearchOpen}
          className={`chat-header-btn ${isSearchOpen ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(8);
            onToggleSearch?.();
          }}
          title="Поиск в чате (Ctrl+F)"
          aria-expanded={isSearchOpen}
          data-testid="chat-header-search-btn"
        >
          <Search size={22} />
        </IconButton>
        <IconButton label="Информация" className="chat-header-btn" onClick={toggleInfo}>
          <MoreVertical size={20} />
        </IconButton>
      </div>
    </header>
  );
}
