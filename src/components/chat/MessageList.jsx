import React from 'react';
import MessageBubble from './MessageBubble';
import { formatDateDivider, getFirstUnreadIndex, needsDateDivider } from './chatAreaModel.ts';

const UNREAD_DIVIDER_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '14px 0', position: 'relative' };
const UNREAD_LABEL_STYLE = { background: 'var(--accent-color, #2481cc)', color: '#fff', fontSize: '11px', padding: '3px 12px', borderRadius: '12px', fontWeight: '500', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' };

/**
 * Message rows for the active chat with date and unread dividers plus the
 * history load notices. Scroll ownership stays with `useChatScroll`.
 * `bubbleProps` are forwarded unchanged to every MessageBubble.
 */
export default function MessageList({
  activeChat,
  currentUser,
  historyStatus,
  onRetryHistory,
  messagesEndRef,
  isSelected,
  currentMatchId,
  bubbleProps,
}) {
  const messages = activeChat.messages;
  const firstUnreadIndex = getFirstUnreadIndex(messages, activeChat.unread_count, currentUser?.id);

  return (
    <div className="messages-list">
      {historyStatus === 'error' && (
        <div className="chat-history-notice" role="alert">
          <span>Не удалось загрузить сообщения</span>
          <button type="button" onClick={onRetryHistory}>Повторить</button>
        </div>
      )}
      {messages.length === 0 && historyStatus === 'loaded' && (
        <div className="chat-history-empty" role="status">Здесь пока нет сообщений</div>
      )}
      {messages.map((msg, index) => {
        const dateDividerText = needsDateDivider(messages[index - 1], msg) ? formatDateDivider(msg.timestamp) : null;
        return (
          <React.Fragment key={msg.id}>
            {dateDividerText && (
              <div className="chat-date-divider">
                <span>{dateDividerText}</span>
              </div>
            )}
            {index === firstUnreadIndex && firstUnreadIndex >= 0 && (
              <div className="unread-messages-divider" style={UNREAD_DIVIDER_STYLE}>
                <span style={UNREAD_LABEL_STYLE}>Непрочитанные сообщения</span>
              </div>
            )}
            <MessageBubble
              {...bubbleProps}
              msg={msg}
              index={index}
              activeChat={activeChat}
              currentUser={currentUser}
              selected={isSelected(msg.id)}
              isSearchMatchTarget={currentMatchId === msg.id}
            />
          </React.Fragment>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
