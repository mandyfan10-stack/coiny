import { hasNewerMessageRevision, preserveMessageRevisions } from '../../utils/messageContent.ts';
import { useState, useCallback, useEffect, useRef } from 'react';
import { dataService } from '../../services/dataLayer';
import {
  getOfflineAttachment,
  getCachedMessages,
  saveCachedMessages,
  saveCachedMessagesBatch,
  getCachedMessagesForChat,
  getCachedMessagesBeforeTimestamp,
  saveCachedChatList,
  getCachedChatList
} from '../../utils/indexedDbHelper';
import { loadOfflineQueue } from '../../services/offlineQueue';
import { createManagedObjectUrl } from '../../utils/objectUrlRegistry';
import { decryptMessageFields, resolveSharedKey } from './decryptHelpers';
import { compareMessages, getMessageCursor } from '../../utils/messageCursor.ts';
import { createHistorySnapshot, retainCachedMessage } from '../../utils/messageHistory.js';

/**
 * Load / paginate chat list and message history with E2EE decrypt.
 */
export function useChatLoader({
  currentUser,
  setChats,
  chatsRef,
  e2eePrivateKeyRef,
  sharedKeysCacheRef,
  setSharedKeysCache,
  activeChatId,
  e2eePrivateKey,
  readCachedMessages = getCachedMessagesForChat
}) {
  const [messagePagination, setMessagePagination] = useState({});
  const [isChatLoading, setIsChatLoading] = useState({});
  const [isSyncing, setIsSyncing] = useState({});
  const [historyLoadStatus, setHistoryLoadStatus] = useState({});
  const loadRequestsRef = useRef(new Map());
  const historySnapshotsRef = useRef(new Map());
  const currentUserId = currentUser?.id;
  const sessionRef = useRef({ userId: currentUserId, active: true });
  if (sessionRef.current.userId !== currentUserId) {
    sessionRef.current = { userId: currentUserId, active: true };
  }
  const session = sessionRef.current;
  const isCurrentSession = useCallback(() => sessionRef.current === session && session.active, [session]);
  const setSessionSharedKeys = useCallback((updater) => {
    if (!isCurrentSession()) return;
    setSharedKeysCache((previous) => {
      if (!isCurrentSession()) return previous;
      return typeof updater === 'function' ? updater(previous) : updater;
    });
  }, [isCurrentSession, setSharedKeysCache]);

  useEffect(() => {
    session.active = true;
    return () => { session.active = false; };
  }, [session]);

  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    const requests = loadRequestsRef.current;
    requests.clear();
    historySnapshotsRef.current.clear();
    setMessagePagination({});
    setHistoryLoadStatus({});
    setIsChatLoading({});
    setIsSyncing({});
    return () => { requests.clear(); };
  }, [session]);

  // Instant 0ms Chat List Hydration from IndexedDB
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    getCachedChatList(currentUserId).then((cached) => {
      if (active && isCurrentSession() && Array.isArray(cached) && cached.length > 0) {
        setChats((prev) => (active && isCurrentSession() && (!prev || prev.length === 0) ? cached : prev));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [currentUserId, isCurrentSession, setChats]);

  const prewarmTopChats = useCallback((chatList) => {
    if (!Array.isArray(chatList) || chatList.length === 0 || !currentUser || !isCurrentSession()) return;
    const topChats = chatList.slice(0, 5);

    const runPrewarm = async () => {
      for (const chat of topChats) {
        if (!isCurrentSession()) return;
        if (!chat || chat.id === activeChatIdRef.current) continue;
        try {
          const cached = await getCachedMessages(chat.id, currentUserId);
          if (!isCurrentSession()) return;
          if (cached && cached.length > 1) {
            setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
              if (isCurrentSession() && c.id === chat.id && (!c.messages || c.messages.length <= 1)) {
                return { ...c, messages: cached };
              }
              return c;
            }));
            continue;
          }

          const msgsRaw = await dataService.loadChatMessages(chat.id, 50);
          if (!isCurrentSession()) return;
          const msgs = Array.isArray(msgsRaw) ? msgsRaw : [];
          if (msgs.length === 0) continue;

          const sharedKey = await resolveSharedKey({
            chatId: chat.id,
            chat,
            currentUserId: currentUser.id,
            e2eePrivateKey: e2eePrivateKeyRef.current,
            sharedKeysCache: sharedKeysCacheRef.current,
            setSharedKeysCache: setSessionSharedKeys
          });

          const decrypted = await Promise.all(
            msgs.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
          );
          if (!isCurrentSession()) return;

          saveCachedMessages(chat.id, decrypted, currentUserId);
          setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
            if (isCurrentSession() && c.id === chat.id && (!c.messages || c.messages.length <= 1)) {
              return { ...c, messages: decrypted };
            }
            return c;
          }));
        } catch {
          // Prewarm runs silently without interrupting UI
        }
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => runPrewarm(), { timeout: 3000 });
    } else {
      setTimeout(runPrewarm, 500);
    }
  }, [currentUser, currentUserId, isCurrentSession, setChats, setSessionSharedKeys, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const fetchChats = useCallback(async () => {
    if (!currentUserId || !isCurrentSession()) return;
    try {
      const data = await dataService.fetchChats(currentUserId);
      if (!isCurrentSession()) return;
      // Guard non-array payloads (RPC/edge/proxy) so we never throw "X is not iterable".
      const list = Array.isArray(data) ? data : [];

      const formattedChats = await Promise.all(list.map(async (chat) => {
        const members = Array.isArray(chat?.members) ? chat.members : [];
        const rawMessages = Array.isArray(chat?.messages) ? chat.messages : [];
        const otherMember = chat.type === 'personal'
          ? members.find((m) => m.id !== currentUserId)
          : null;

        let sharedKey = null;
        if (chat.type === 'personal' && otherMember && e2eePrivateKeyRef.current) {
          sharedKey = sharedKeysCacheRef.current[chat.id];
          if (!sharedKey && otherMember.publicKey) {
            sharedKey = await resolveSharedKey({
              chatId: chat.id,
              chat: { ...chat, members },
              currentUserId,
              e2eePrivateKey: e2eePrivateKeyRef.current,
              sharedKeysCache: sharedKeysCacheRef.current,
              setSharedKeysCache: setSessionSharedKeys
            });
          }
        }

        const messages = await Promise.all(
          rawMessages.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
        );

        return { ...chat, members, messages };
      }));
      if (!isCurrentSession()) return;

      const parsed = await loadOfflineQueue(currentUserId);
      if (!isCurrentSession()) return;
      const localQueue = Array.isArray(parsed) ? parsed : [];

      for (const q of localQueue) {
        if (q?.hasOfflineMedia && q.optimisticId) {
          try {
            const blob = await getOfflineAttachment(q.optimisticId, currentUserId);
            if (!isCurrentSession()) return;
            if (blob) q.media = createManagedObjectUrl(`offline:${q.optimisticId}`, blob);
          } catch (e) {
            console.error(e);
          }
        }
      }

      const updatedChats = formattedChats.map((c) => {
        const baseMessages = Array.isArray(c.messages) ? c.messages : [];
        const pendingMsgs = localQueue
          .filter((q) => q && q.chatId === c.id)
          .map((q) => ({
            id: q.optimisticId,
            senderId: currentUserId,
            senderName: currentUser?.name || 'Вы',
            text: q.text,
            media: q.media,
            replyTo: q.replyToId,
            read: false,
            timestamp: new Date(),
            isPending: !q.isFailed,
            isFailed: !!q.isFailed,
            isOptimistic: true
          }));

        return pendingMsgs.length > 0
          ? { ...c, messages: [...baseMessages, ...pendingMsgs] }
          : { ...c, messages: baseMessages };
      });

      setChats((previousChats) => {
        if (!isCurrentSession()) return previousChats;
        const prev = Array.isArray(previousChats) ? previousChats : [];
        return updatedChats.map((nextChat) => {
          const existingChat = prev.find((chat) => chat.id === nextChat.id);
          const nextMessages = Array.isArray(nextChat.messages) ? nextChat.messages : [];
          if (!existingChat?.messages?.length) {
            return { ...nextChat, messages: nextMessages };
          }

          const existingList = Array.isArray(existingChat.messages) ? existingChat.messages : [];
          const refreshedById = new Map(nextMessages.map((message) => [message.id, message]));
          const existingMessages = existingList.map((message) => {
            const refreshed = refreshedById.get(message.id);
            if (!refreshed) return message;

            // Prefer decrypted local plaintext when already unlocked; always take
            // server-side delivery/read/reaction state so receipts survive refresh.
            const keepLocalBody = (!message.isLocked || refreshed.isLocked) && !hasNewerMessageRevision(refreshed, message);
            return {
              ...message,
              ...refreshed,
              text: keepLocalBody ? message.text : refreshed.text,
              editedAt: keepLocalBody ? message.editedAt : refreshed.editedAt,
              forwardedFrom: keepLocalBody ? message.forwardedFrom : refreshed.forwardedFrom,
              media: keepLocalBody ? message.media : refreshed.media,
              isLocked: keepLocalBody ? message.isLocked : refreshed.isLocked,
              read: Boolean(message.read || refreshed.read),
              reads: refreshed.reads?.length ? refreshed.reads : message.reads,
              reactions: refreshed.reactions ?? message.reactions
            };
          });

          const knownMessageIds = new Set(existingMessages.map((message) => message.id));
          const missingPreviewMessages = nextMessages.filter(
            (message) => !knownMessageIds.has(message.id)
          );

          return {
            ...nextChat,
            messages: [...existingMessages, ...missingPreviewMessages].sort(
              (left, right) => new Date(left.timestamp) - new Date(right.timestamp)
            )
          };
        });
      });

      // Smart Pre-warming: quietly cache top chats in idle moments
      prewarmTopChats(updatedChats);
      saveCachedChatList(updatedChats, currentUserId);
      return updatedChats;
    } catch (e) {
      if (isCurrentSession()) console.error('Failed to load chats', e);
    }
  }, [currentUserId, currentUser?.name, isCurrentSession, setSessionSharedKeys, setChats, e2eePrivateKeyRef, sharedKeysCacheRef, prewarmTopChats]);

  const loadActiveChatMessages = useCallback(async (chatId) => {
    if (!chatId || !currentUser || !isCurrentSession()) return;
    const existingChat = chatsRef.current.find((chat) => chat.id === chatId);
    const initialMessages = existingChat?.messages || [];
    const request = {
      baselineIds: new Set(initialMessages.map((message) => message.id)),
      pendingIds: new Set(initialMessages.filter((message) => message.isPending || message.isOptimistic || message.isFailed).map((message) => message.id))
    };
    loadRequestsRef.current.set(chatId, request);
    const isCurrentRequest = () => isCurrentSession()
      && loadRequestsRef.current.get(chatId) === request;
    setIsChatLoading((prev) => ({ ...prev, [chatId]: !existingChat?.messages?.length }));
    setIsSyncing((prev) => ({ ...prev, [chatId]: true }));
    setHistoryLoadStatus((prev) => ({ ...prev, [chatId]: 'loading' }));
    try {
      const msgsRaw = await dataService.loadChatMessages(chatId, 100);
      if (!isCurrentRequest()) return;
      if (!Array.isArray(msgsRaw)) throw new Error('Некорректный ответ сервера при загрузке истории.');
      const msgs = msgsRaw;
      const chat = chatsRef.current.find((c) => c.id === chatId);
      if (!chat) return;

      const sharedKey = await resolveSharedKey({
        chatId,
        chat,
        currentUserId: currentUser.id,
        e2eePrivateKey: e2eePrivateKeyRef.current,
        sharedKeysCache: sharedKeysCacheRef.current,
        setSharedKeysCache: setSessionSharedKeys
      });

      const decryptedMsgs = await Promise.all(
        msgs.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
      );
      if (!isCurrentRequest()) return;
      const snapshot = createHistorySnapshot(decryptedMsgs, 100);
      historySnapshotsRef.current.set(chatId, snapshot);

      // Seamless Merge: preserve local optimistic & unlocked bodies without visual jumps
      setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
        if (c.id !== chatId || !isCurrentRequest()) return c;
        const existingMessages = Array.isArray(c.messages) ? c.messages : [];
        const existingById = new Map(existingMessages.map((m) => [m.id, m]));

        const merged = decryptedMsgs.map((incoming) => {
          const confirmed = { ...incoming, isPending: false, isOptimistic: false, isFailed: false };
          const existing = existingById.get(incoming.id);
          if (!existing) return confirmed;
          const keepLocalBody = (!existing.isLocked || incoming.isLocked) && !hasNewerMessageRevision(incoming, existing);
          return {
            ...existing,
            ...confirmed,
            text: keepLocalBody ? existing.text : incoming.text,
            editedAt: keepLocalBody ? existing.editedAt : incoming.editedAt,
            forwardedFrom: keepLocalBody ? existing.forwardedFrom : incoming.forwardedFrom,
            media: keepLocalBody ? existing.media : incoming.media,
            isLocked: keepLocalBody ? existing.isLocked : incoming.isLocked,
            read: Boolean(existing.read || incoming.read),
            reads: incoming.reads?.length ? incoming.reads : existing.reads,
            reactions: incoming.reactions ?? existing.reactions
          };
        });

        const incomingIds = new Set(decryptedMsgs.map((m) => m.id));

        // Seamless Merge: preserve older history already in memory so SWR doesn't truncate chat
        const olderHistory = existingMessages.filter(
          (m) => !incomingIds.has(m.id) && !m.isPending && !m.isOptimistic && !m.isFailed
            && snapshot.oldestCursor && compareMessages(m, snapshot.oldestCursor) < 0
        );

        // Retain optimistic / pending messages not yet reflected on server
        const pending = existingMessages.filter(
          (m) => (m.isPending || m.isOptimistic || m.isFailed) && !incomingIds.has(m.id)
        );
        // A SELECT started before a new INSERT cannot establish its deletion.
        // Protect arrivals and pending sends that became confirmed meanwhile,
        // only for this snapshot; a later refresh can reconcile real deletions.
        const retainedIds = new Set([...olderHistory, ...pending].map((message) => message.id));
        const concurrent = existingMessages.filter((message) => !incomingIds.has(message.id)
          && !retainedIds.has(message.id)
          && (!request.baselineIds.has(message.id) || request.pendingIds.has(message.id)));
        for (const message of [...concurrent, ...pending]) snapshot.ids.add(message.id);
        const candidates = [...olderHistory, ...merged, ...pending, ...concurrent].sort(
          compareMessages
        );
        const finalMessages = preserveMessageRevisions(c.messages || [], candidates);

        saveCachedMessagesBatch(chatId, finalMessages, currentUserId, snapshot);
        return { ...c, messages: finalMessages };
      }));

      setMessagePagination((prev) => ({ ...prev, [chatId]: {
        loading: false, hasMore: snapshot.hasMore, cursor: getMessageCursor(decryptedMsgs[0])
      } }));
      setHistoryLoadStatus((prev) => ({ ...prev, [chatId]: 'loaded' }));
    } catch (e) {
      if (isCurrentRequest()) {
        console.error('Failed to load chat history', e);
        setHistoryLoadStatus((prev) => ({ ...prev, [chatId]: 'error' }));
      }
    } finally {
      if (isCurrentRequest()) {
        setIsSyncing((prev) => ({ ...prev, [chatId]: false }));
        setIsChatLoading((prev) => ({ ...prev, [chatId]: false }));
      }
    }
  }, [currentUser, currentUserId, isCurrentSession, setSessionSharedKeys, setChats, chatsRef, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const loadOlderMessages = useCallback(async (chatId) => {
    if (!currentUser || !isCurrentSession()) return 0;
    const chat = chatsRef.current.find((c) => c.id === chatId);
    const pagination = messagePagination[chatId];
    if (!chat || pagination?.loading || pagination?.hasMore === false || !chat.messages?.length) return 0;

    setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: true } }));
    try {
      // Pending messages never become history cursors. Keep the server cursor
      // separate from cached history so cache gaps cannot skip server rows.
      const oldestConfirmed = [...chat.messages]
        .filter((message) => !message.isPending && !message.isOptimistic && !message.isFailed)
        .sort(compareMessages)[0];
      const oldestCursor = navigator.onLine
        ? pagination?.cursor || getMessageCursor(oldestConfirmed)
        : getMessageCursor(oldestConfirmed);
      if (!oldestCursor) {
        setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: false } }));
        return 0;
      }

      // 1. Instant 0ms pagination from local IndexedDB cache
      const cachedOlder = await getCachedMessagesBeforeTimestamp(chatId, oldestCursor, 30, currentUserId);
      if (!isCurrentSession()) return 0;
      const knownIds = new Set(chat.messages.map((message) => message.id));
      const unseenCached = cachedOlder.filter((message) => !knownIds.has(message.id));
      if (unseenCached.length > 0) {
        setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
          if (c.id !== chatId || !isCurrentSession()) return c;
          const currentMessages = Array.isArray(c.messages) ? c.messages : [];
          const known = new Set(currentMessages.map((message) => message.id));
          const candidates = [...unseenCached.filter((message) => !known.has(message.id)), ...currentMessages].sort(compareMessages);
          const finalMessages = preserveMessageRevisions(c.messages || [], candidates);
          return { ...c, messages: finalMessages };
        }));
        setMessagePagination((prev) => ({ ...prev, [chatId]: {
          ...prev[chatId], loading: false, hasMore: true
        } }));
        return unseenCached.length;
      }

      // 2. If local cache is exhausted or offline, handle network
      if (!navigator.onLine) {
        setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: false } }));
        return 0;
      }

      const olderRaw = await dataService.loadChatMessages(chatId, 30, oldestCursor);
      if (!isCurrentSession()) return 0;
      if (!Array.isArray(olderRaw)) throw new Error('Некорректный ответ сервера при загрузке истории.');
      const older = olderRaw;

      const sharedKey = await resolveSharedKey({
        chatId,
        chat,
        currentUserId: currentUser.id,
        e2eePrivateKey: e2eePrivateKeyRef.current,
        sharedKeysCache: sharedKeysCacheRef.current,
        setSharedKeysCache: setSessionSharedKeys
      });

      const decrypted = await Promise.all(
        older.map((message) => decryptMessageFields(message, sharedKey, chat.type === 'personal'))
      );
      if (!isCurrentSession()) return 0;

      setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
        if (c.id !== chatId || !isCurrentSession()) return c;
        const currentMessages = Array.isArray(c.messages) ? c.messages : [];
        const known = new Set(currentMessages.map((message) => message.id));
        const candidates = [...decrypted.filter((message) => !known.has(message.id)), ...currentMessages].sort(compareMessages);
        const finalMessages = preserveMessageRevisions(c.messages || [], candidates);
        saveCachedMessagesBatch(chatId, finalMessages, currentUserId);
        return { ...c, messages: finalMessages };
      }));
      setMessagePagination((prev) => ({ ...prev, [chatId]: {
        loading: false, hasMore: older.length === 30, cursor: getMessageCursor(decrypted[0]) || oldestCursor
      } }));
      return decrypted.length;
    } catch (error) {
      if (!isCurrentSession()) return 0;
      console.error('Failed to load older messages', error);
      setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: false } }));
      return 0;
    }
  }, [currentUser, currentUserId, isCurrentSession, messagePagination, setSessionSharedKeys, setChats, chatsRef, e2eePrivateKeyRef, sharedKeysCacheRef]);

  // Stale-While-Revalidate: Telegram-style instant 0ms history hydration on chat selection
  useEffect(() => {
    if (!activeChatId || !currentUserId || !isCurrentSession()) return;

    let isMounted = true;
    const currentChat = chatsRef.current.find((c) => c.id === activeChatId);
    const inMemoryCount = currentChat?.messages?.length || 0;

    // Do not show full-page loading spinner if we already have some messages in memory
    if (inMemoryCount > 0) {
      setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
    }

    // Always hydrate from IndexedDB to show full cached history (not just preview messages)
    readCachedMessages(activeChatId, currentUserId).then((cached) => {
      if (!isMounted || !isCurrentSession()) return;
      if (Array.isArray(cached) && cached.length > 0) {
        const snapshot = historySnapshotsRef.current.get(activeChatId);
        const eligibleCache = snapshot ? cached.filter((message) => retainCachedMessage(message, snapshot)) : cached;
        setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
          if (c.id !== activeChatId || !isMounted || !isCurrentSession()) return c;
          const currentMsgs = Array.isArray(c.messages) ? c.messages : [];

          // Late cache hydration must not overwrite newer bodies, receipts or reactions.
          const currentById = new Map(currentMsgs.map((message) => [message.id, message]));
          const request = loadRequestsRef.current.get(activeChatId);
          // Cache hydration is old history, not a new live arrival. Do not
          // classify messages already added in memory during the request as old.
          if (request) for (const message of eligibleCache) {
            if (message.isPending || message.isOptimistic || message.isFailed) request.pendingIds.add(message.id);
            else if (!currentById.has(message.id)) request.baselineIds.add(message.id);
          }
          const cachedIds = new Set(eligibleCache.map((m) => m.id));
          const merged = eligibleCache.map((message) => {
            const current = currentById.get(message.id);
            if (!current) return message;
            const keepCurrentBody = (!current.isLocked || message.isLocked) && !hasNewerMessageRevision(message, current);
            return {
              ...message, ...current,
              text: keepCurrentBody ? current.text : message.text,
              editedAt: keepCurrentBody ? current.editedAt : message.editedAt,
              forwardedFrom: keepCurrentBody ? current.forwardedFrom : message.forwardedFrom,
              media: keepCurrentBody ? current.media : message.media,
              isLocked: keepCurrentBody ? current.isLocked : message.isLocked,
              read: Boolean(current.read || message.read),
              reads: current.reads?.length ? current.reads : message.reads
            };
          });
          const additional = currentMsgs.filter((message) => !cachedIds.has(message.id));
          const candidates = [...merged, ...additional].sort(compareMessages);
          const finalMessages = preserveMessageRevisions(c.messages || [], candidates);
          if (snapshot) saveCachedMessagesBatch(activeChatId, finalMessages, currentUserId, snapshot);
          return { ...c, messages: finalMessages };
        }));
        setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
      }
    }).catch(() => { /* A cache miss/error cannot change the network loading state. */ });

    return () => {
      isMounted = false;
    };
  }, [activeChatId, currentUserId, isCurrentSession, setChats, chatsRef, readCachedMessages]);

  // Contract: active encrypted chat reloads after the private key becomes available
  useEffect(() => {
    const requests = loadRequestsRef.current;
    if (activeChatId) {
      loadActiveChatMessages(activeChatId);
    }
    return () => {
      if (!activeChatId) return;
      if (!isCurrentSession()) return;
      requests.delete(activeChatId);
      setIsSyncing((prev) => ({ ...prev, [activeChatId]: false }));
      setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
    };
  }, [activeChatId, e2eePrivateKey, isCurrentSession, loadActiveChatMessages]);

  return {
    messagePagination,
    isChatLoading,
    isSyncing,
    historyLoadStatus,
    fetchChats,
    loadActiveChatMessages,
    loadOlderMessages
  };
}
