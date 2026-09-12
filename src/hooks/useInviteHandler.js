import { useEffect, useRef, useCallback } from 'react';
import {
  parseInviteParam,
  clearInviteParamFromUrl,
  getPendingInvite,
  savePendingInvite,
  clearPendingInvite,
  cleanInviteIdentifier
} from '../utils/inviteLink';

/**
 * Handles incoming invite links when user is authenticated.
 * Resolves self-invites to Saved Messages, navigates to existing chats,
 * or creates a personal chat for a newly invited user.
 */
export function useInviteHandler({
  currentUser,
  chats = [],
  createChat,
  setActiveChatId,
  openSavedMessages
}) {
  const handledRef = useRef(null);
  const isResolvingRef = useRef(false);

  const resolveTarget = useCallback(async (targetRaw) => {
    if (!currentUser) return;
    const target = cleanInviteIdentifier(targetRaw);
    if (!target) return;

    if (handledRef.current === target || isResolvingRef.current) return;

    const cleanTarget = target.toLowerCase();
    const currentUsername = (currentUser.username || '').toLowerCase();
    const isSelf = cleanTarget === currentUsername || target === currentUser.id;

    if (isSelf) {
      handledRef.current = target;
      clearPendingInvite();
      if (openSavedMessages) {
        await openSavedMessages();
      }
      return;
    }

    // Check if chat already exists in local list
    const existing = chats.find((c) => {
      if (c.username && c.username.toLowerCase() === cleanTarget) return true;
      if (c.id === target) return true;
      if (c.members && c.members.some((m) => (m.username && m.username.toLowerCase() === cleanTarget) || m.id === target)) {
        return true;
      }
      return false;
    });

    if (existing) {
      handledRef.current = target;
      clearPendingInvite();
      setActiveChatId(existing.id);
      return;
    }

    // If chat does not exist, create personal chat with target user
    isResolvingRef.current = true;
    try {
      const newChat = await createChat(target, 'personal');
      if (newChat) {
        setActiveChatId(newChat.id);
      }
    } catch (err) {
      console.warn('Could not resolve invite link for target:', target, err);
    } finally {
      handledRef.current = target;
      clearPendingInvite();
      isResolvingRef.current = false;
    }
  }, [currentUser, chats, createChat, setActiveChatId, openSavedMessages]);

  useEffect(() => {
    // 1. If invite param is present in URL, extract and persist to sessionStorage, then clean URL.
    const urlInvite = parseInviteParam();
    if (urlInvite) {
      savePendingInvite(urlInvite);
      clearInviteParamFromUrl();
    }

    const targetRaw = getPendingInvite() || urlInvite;
    if (targetRaw) {
      resolveTarget(targetRaw);
    }
  }, [resolveTarget]);

  useEffect(() => {
    const handleCustomInvite = (e) => {
      const invite = e.detail?.invite;
      if (invite) {
        handledRef.current = null;
        resolveTarget(invite);
      }
    };
    window.addEventListener('coiny:open-invite', handleCustomInvite);
    return () => window.removeEventListener('coiny:open-invite', handleCustomInvite);
  }, [resolveTarget]);
}
