import React, { useEffect, useRef } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import './ChatSearchBar.css';

export default function ChatSearchBar({
  searchQuery,
  onSearchChange,
  totalMatches,
  currentMatchIndex,
  onPrevMatch,
  onNextMatch,
  onClose
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus the search input when search bar opens
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        onPrevMatch();
      } else {
        onNextMatch();
      }
    }
  };

  const hasMatches = totalMatches > 0;
  const isQueryEntered = Boolean(searchQuery.trim());

  let counterText = '';
  if (isQueryEntered) {
    if (totalMatches === 0) {
      counterText = 'Нет результатов';
    } else {
      counterText = `${currentMatchIndex + 1} из ${totalMatches}`;
    }
  }

  return (
    <div
      className="chat-search-bar"
      role="search"
      aria-label="Поиск сообщений"
      data-testid="chat-search-bar"
    >
      <div className="chat-search-input-wrapper">
        <Search size={16} className="chat-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="chat-search-input"
          placeholder="Поиск в чате..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Поисковый запрос"
          data-testid="chat-search-input"
        />
        {isQueryEntered && (
          <button
            type="button"
            className="chat-search-clear-btn"
            onClick={() => {
              onSearchChange('');
              inputRef.current?.focus();
            }}
            title="Очистить"
            aria-label="Очистить поиск"
            data-testid="chat-search-clear-btn"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {isQueryEntered && (
        <span
          className={`chat-search-counter ${totalMatches === 0 ? 'no-results' : ''}`}
          aria-live="polite"
          data-testid="chat-search-counter"
        >
          {counterText}
        </span>
      )}

      <div className="chat-search-nav-btns">
        <button
          type="button"
          className="chat-search-nav-btn"
          onClick={onPrevMatch}
          disabled={!hasMatches}
          title="Предыдущее совпадение (Shift+Enter)"
          aria-label="Предыдущее совпадение"
          data-testid="chat-search-prev-btn"
        >
          <ChevronUp size={18} />
        </button>
        <button
          type="button"
          className="chat-search-nav-btn"
          onClick={onNextMatch}
          disabled={!hasMatches}
          title="Следующее совпадение (Enter)"
          aria-label="Следующее совпадение"
          data-testid="chat-search-next-btn"
        >
          <ChevronDown size={18} />
        </button>
      </div>

      <button
        type="button"
        className="chat-search-close-btn"
        onClick={onClose}
        title="Закрыть поиск (Esc)"
        aria-label="Закрыть поиск"
        data-testid="chat-search-close-btn"
      >
        <X size={18} />
      </button>
    </div>
  );
}
