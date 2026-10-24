import { useEffect, useRef, useCallback, useState } from 'react';
import {
  parseInviteParam,
  clearInviteParamFromUrl,
  getPendingInvite,
  savePendingInvite,
  clearPendingInvite,
  cleanInviteIdentifier
} from '../utils/inviteLink';

export function useInviteHandler({
  currentUser,
  chats = [],
  createChat,
  joinChatByInvite,
  setActiveChatId,
  openSavedMessages
}) {
  const requestRef = useRef(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef({ userId: currentUser?.id });
  if (sessionRef.current.userId !== currentUser?.id) {
    sessionRef.current = { userId: currentUser?.id };
    requestRef.current = null;
  }
  const session = sessionRef.current;
  const [view, setView] = useState({ status: 'idle' });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const resolveTarget = useCallback(async (targetRaw, retry = false) => {
    if (!mountedRef.current || sessionRef.current !== session) return;
    const target = cleanInviteIdentifier(targetRaw);
    if (!target) return;
    savePendingInvite(target);
    if (!currentUser) return;
    const previous = requestRef.current;
    if (previous?.session === session && previous.target === target
      && (previous.status === 'loading' || !retry)) return;

    const request = { target, session, status: 'loading' };
    requestRef.current = request;
    const isCurrent = () => mountedRef.current && sessionRef.current === session && requestRef.current === request;
    setView({ ...request, error: '' });
    try {
      const cleanTarget = target.toLowerCase();
      const isSelf = cleanTarget === (currentUser.username || '').toLowerCase() || target === currentUser.id;
      const existing = !isSelf && chats.find((chat) => {
        if (chat.id === target || chat.username?.toLowerCase() === cleanTarget) return true;
        // A group containing this person is not their personal conversation.
        return chat.type === 'personal' && chat.members?.some((member) =>
          member.id !== currentUser.id && (member.id === target || member.username?.toLowerCase() === cleanTarget));
      });
      let resolvedChat;
      if (isSelf) {
        resolvedChat = await openSavedMessages?.({ activate: false });
      } else if (existing) {
        resolvedChat = existing;
      } else if (joinChatByInvite) {
        resolvedChat = await joinChatByInvite(target);
      } else {
        resolvedChat = await createChat?.(target, 'personal', [], { activate: false, throwOnError: true });
      }
      if (!isCurrent()) return;
      if (!resolvedChat?.id) throw new Error('Чат по ссылке не был открыт.');
      setActiveChatId(resolvedChat.id);
      request.status = 'success';
      if (getPendingInvite() === target) clearPendingInvite();
      setView({ status: 'idle' });
    } catch (error) {
      if (!isCurrent()) return;
      request.status = 'error';
      const message = error?.code === 'P0002'
        ? 'Пользователь или чат по этой ссылке не найден.'
        : error?.code === '42501'
          ? 'Ссылка недействительна или доступ к чату закрыт.'
          : 'Не удалось открыть чат по ссылке. Проверьте соединение и попробуйте ещё раз.';
      setView({ ...request, error: message });
    }
  }, [currentUser, session, chats, createChat, joinChatByInvite, setActiveChatId, openSavedMessages]);

  useEffect(() => {
    const urlInvite = parseInviteParam();
    if (urlInvite) {
      savePendingInvite(urlInvite);
      clearInviteParamFromUrl();
    }
    const pending = getPendingInvite() || urlInvite;
    if (pending) void resolveTarget(pending);
  }, [resolveTarget]);

  useEffect(() => {
    const handleCustomInvite = (event) => {
      if (event.detail?.invite) void resolveTarget(event.detail.invite, true);
    };
    window.addEventListener('coiny:open-invite', handleCustomInvite);
    return () => window.removeEventListener('coiny:open-invite', handleCustomInvite);
  }, [resolveTarget]);

  const dismiss = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    if (getPendingInvite() === request?.target) clearPendingInvite();
    setView({ status: 'idle' });
  }, []);
  const state = view.session === session ? view : { status: 'idle' };
  return { ...state, retry: () => resolveTarget(state.target, true), dismiss };
}
