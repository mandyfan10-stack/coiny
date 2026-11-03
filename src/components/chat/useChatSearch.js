import { useCallback, useEffect, useMemo, useState } from 'react';
import { clampMatchIndex, cycleMatchIndex, findMessageMatches, isFindShortcut } from './chatAreaModel.ts';

/**
 * In-chat message search: query, match navigation and the Ctrl/Cmd+F / Escape
 * hotkeys. `scrollToMessage` brings the current match into view.
 */
export default function useChatSearch({ activeChat, scrollToMessage }) {
  const activeChatId = activeChat?.id;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const matchedMessages = useMemo(
    () => findMessageMatches(activeChat?.messages, searchQuery),
    [searchQuery, activeChat?.messages],
  );

  useEffect(() => {
    const clamped = clampMatchIndex(currentMatchIndex, matchedMessages.length);
    if (clamped !== currentMatchIndex) setCurrentMatchIndex(clamped);
  }, [matchedMessages.length, currentMatchIndex]);

  const resetSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  }, []);

  useEffect(() => { resetSearch(); }, [activeChatId, resetSearch]);

  const goToMatch = useCallback((step) => {
    if (matchedMessages.length === 0) return;
    const nextIndex = cycleMatchIndex(currentMatchIndex, matchedMessages.length, step);
    setCurrentMatchIndex(nextIndex);
    scrollToMessage(matchedMessages[nextIndex]?.id);
  }, [matchedMessages, currentMatchIndex, scrollToMessage]);

  const handleNextMatch = useCallback(() => goToMatch(1), [goToMatch]);
  const handlePrevMatch = useCallback(() => goToMatch(-1), [goToMatch]);

  const handleSearchChange = useCallback((nextQuery) => {
    setSearchQuery(nextQuery);
    setCurrentMatchIndex(0);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((previous) => {
      const next = !previous;
      if (!next) {
        setSearchQuery('');
        setCurrentMatchIndex(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isSearchOpen && matchedMessages[currentMatchIndex]) {
      scrollToMessage(matchedMessages[currentMatchIndex].id);
    }
  }, [isSearchOpen, currentMatchIndex, matchedMessages, scrollToMessage]);

  useEffect(() => {
    const handleGlobalKeyDown = (event) => {
      if (isFindShortcut(event)) {
        if (activeChatId) {
          event.preventDefault();
          setIsSearchOpen(true);
        }
      } else if (event.key === 'Escape' && isSearchOpen) {
        event.preventDefault();
        resetSearch();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeChatId, isSearchOpen, resetSearch]);

  const currentMatchId = isSearchOpen ? matchedMessages[currentMatchIndex]?.id ?? null : null;

  return {
    isSearchOpen,
    searchQuery,
    currentMatchIndex,
    matchCount: matchedMessages.length,
    currentMatchId,
    handleSearchChange,
    handleNextMatch,
    handlePrevMatch,
    handleCloseSearch: resetSearch,
    handleToggleSearch,
  };
}
