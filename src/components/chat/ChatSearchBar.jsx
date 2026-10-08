import React, { useEffect, useRef } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import IconButton from '../ui/IconButton';
import SearchField from '../ui/SearchField';
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
      <SearchField
          inputRef={inputRef}
          className="chat-search-input-wrapper"
          inputClassName="chat-search-input"
          placeholder="Поиск в чате..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          label="Поисковый запрос"
          data-testid="chat-search-input"
      >
        {isQueryEntered && (
          <IconButton
            label="Очистить поиск"
            className="chat-search-clear-btn"
            onClick={() => {
              onSearchChange('');
              inputRef.current?.focus();
            }}
            data-testid="chat-search-clear-btn"
          >
            <X size={18} />
          </IconButton>
        )}
      </SearchField>

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
        <IconButton
          label="Предыдущее совпадение"
          className="chat-search-nav-btn"
          onClick={onPrevMatch}
          disabled={!hasMatches}
          title="Предыдущее совпадение (Shift+Enter)"
          data-testid="chat-search-prev-btn"
        >
          <ChevronUp size={18} />
        </IconButton>
        <IconButton
          label="Следующее совпадение"
          className="chat-search-nav-btn"
          onClick={onNextMatch}
          disabled={!hasMatches}
          title="Следующее совпадение (Enter)"
          data-testid="chat-search-next-btn"
        >
          <ChevronDown size={18} />
        </IconButton>
      </div>

      <IconButton
        label="Закрыть поиск"
        className="chat-search-close-btn"
        onClick={onClose}
        title="Закрыть поиск (Esc)"
        data-testid="chat-search-close-btn"
      >
        <X size={18} />
      </IconButton>
    </div>
  );
}
