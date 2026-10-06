import React, { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';

function formatDateDivider(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера';
  }
  const isThisYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: isThisYear ? undefined : 'numeric'
  });
}

/**
 * Presentational messages window + scroll-to-bottom control.
 * Scroll pagination / auto-scroll policy stay owned by ChatArea.
 */
export default function MessageList({
  activeChat,
  currentUser,
  renderAvatar,
  chatBodyRef,
  messagesEndRef,
  chatBodyStyle,
  handleScroll,
  showScrollBottom,
  onScrollToBottom,
  showMsgActionsId,
  setShowMsgActionsId,
  retryMenuMsgId,
  setRetryMenuMsgId,
  setReplyingTo,
  setOpenedImageUrl,
  deleteMessage,
  toggleReaction,
  retrySendMessage,
  deleteFailedMessage,
  emojis
}) {
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  useEffect(() => {
    setHoveredMessageId(null);
    setShowMsgActionsId(null);
  }, [activeChat.id, setShowMsgActionsId]);
  return (
    <>
      <div
        className="chat-body"
        ref={chatBodyRef}
        onScroll={handleScroll}
        style={chatBodyStyle}
      >
        <div className="messages-list">
          {activeChat.messages.map((msg, index) => {
            const prevMsg = activeChat.messages[index - 1];
            const showDateDivider = !prevMsg || (
              new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
            );
            const dateDividerText = showDateDivider ? formatDateDivider(msg.timestamp) : null;
            return (
              <React.Fragment key={msg.id}>
                {dateDividerText && (
                  <div className="chat-date-divider">
                    <span>{dateDividerText}</span>
                  </div>
                )}
                <MessageBubble
                  msg={msg}
                  index={index}
                  activeChat={activeChat}
                  currentUser={currentUser}
                  renderAvatar={renderAvatar}
                  showMsgActionsId={showMsgActionsId}
                  setShowMsgActionsId={setShowMsgActionsId}
                  hoveredMessageId={hoveredMessageId}
                  setHoveredMessageId={setHoveredMessageId}
                  retryMenuMsgId={retryMenuMsgId}
                  setRetryMenuMsgId={setRetryMenuMsgId}
                  setReplyingTo={setReplyingTo}
                  setOpenedImageUrl={setOpenedImageUrl}
                  deleteMessage={deleteMessage}
                  toggleReaction={toggleReaction}
                  retrySendMessage={retrySendMessage}
                  deleteFailedMessage={deleteFailedMessage}
                  emojis={emojis}
                />
              </React.Fragment>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {showScrollBottom && (
        <button
          className="scroll-bottom-btn"
          onClick={onScrollToBottom}
        >
          <ArrowDown size={18} />
        </button>
      )}
    </>
  );
}
