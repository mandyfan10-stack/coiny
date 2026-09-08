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
  e2eePrivateKey
}) {
  const [messagePagination, setMessagePagination] = useState({});
  const [isChatLoading, setIsChatLoading] = useState({});
  const [isSyncing, setIsSyncing] = useState({});

  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const currentUserId = currentUser?.id;

  // Instant 0ms Chat List Hydration from IndexedDB
  useEffect(() => {
    if (!currentUserId) return;
    getCachedChatList(currentUserId).then((cached) => {
      if (Array.isArray(cached) && cached.length > 0) {
        setChats((prev) => (!prev || prev.length === 0 ? cached : prev));
      }
    }).catch(() => {});
  }, [currentUserId, setChats]);

  const prewarmTopChats = useCallback((chatList) => {
    if (!Array.isArray(chatList) || chatList.length === 0 || !currentUser) return;
    const topChats = chatList.slice(0, 5);

    const runPrewarm = async () => {
      for (const chat of topChats) {
        if (!chat || chat.id === activeChatIdRef.current) continue;
        try {
          const cached = await getCachedMessages(chat.id, currentUserId);
          if (cached && cached.length > 1) {
            setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
              if (c.id === chat.id && (!c.messages || c.messages.length <= 1)) {
                return { ...c, messages: cached };
              }
              return c;
            }));
            continue;
          }

          const msgsRaw = await dataService.loadChatMessages(chat.id, 50);
          const msgs = Array.isArray(msgsRaw) ? msgsRaw : [];
          if (msgs.length === 0) continue;

          const sharedKey = await resolveSharedKey({
            chatId: chat.id,
            chat,
            currentUserId: currentUser.id,
            e2eePrivateKey: e2eePrivateKeyRef.current,
            sharedKeysCache: sharedKeysCacheRef.current,
            setSharedKeysCache
          });

          const decrypted = await Promise.all(
            msgs.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
          );

          saveCachedMessages(chat.id, decrypted, currentUserId);
          setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
            if (c.id === chat.id && (!c.messages || c.messages.length <= 1)) {
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
  }, [currentUser, currentUserId, setChats, setSharedKeysCache, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const fetchChats = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const data = await dataService.fetchChats(currentUserId);
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
              setSharedKeysCache
            });
          }
        }

        const messages = await Promise.all(
          rawMessages.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
        );

        return { ...chat, members, messages };
      }));

      const parsed = await loadOfflineQueue(currentUserId);
      const localQueue = Array.isArray(parsed) ? parsed : [];

      for (const q of localQueue) {
        if (q?.hasOfflineMedia && q.optimisticId) {
          try {
            const blob = await getOfflineAttachment(q.optimisticId, currentUserId);
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
            const keepLocalBody = !message.isLocked || refreshed.isLocked;
            return {
              ...message,
              ...refreshed,
              text: keepLocalBody ? message.text : refreshed.text,
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
    } catch (e) {
      console.error('Failed to load chats', e);
    }
  }, [currentUserId, currentUser?.name, setSharedKeysCache, setChats, e2eePrivateKeyRef, sharedKeysCacheRef, prewarmTopChats]);

  const loadActiveChatMessages = useCallback(async (chatId) => {
    if (!chatId || !currentUser) return;
    setIsSyncing((prev) => ({ ...prev, [chatId]: true }));
    try {
      const msgsRaw = await dataService.loadChatMessages(chatId, 100);
      const msgs = Array.isArray(msgsRaw) ? msgsRaw : [];
      const chat = chatsRef.current.find((c) => c.id === chatId);
      if (!chat) return;

      const sharedKey = await resolveSharedKey({
        chatId,
        chat,
        currentUserId: currentUser.id,
        e2eePrivateKey: e2eePrivateKeyRef.current,
        sharedKeysCache: sharedKeysCacheRef.current,
        setSharedKeysCache
      });

      const decryptedMsgs = await Promise.all(
        msgs.map((m) => decryptMessageFields(m, sharedKey, chat.type === 'personal'))
      );

      // Seamless Merge: preserve local optimistic & unlocked bodies without visual jumps
      setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
        if (c.id !== chatId) return c;
        const existingMessages = Array.isArray(c.messages) ? c.messages : [];
        const existingById = new Map(existingMessages.map((m) => [m.id, m]));

        const merged = decryptedMsgs.map((incoming) => {
          const existing = existingById.get(incoming.id);
          if (!existing) return incoming;
          const keepLocalBody = !existing.isLocked || incoming.isLocked;
          return {
            ...existing,
            ...incoming,
            text: keepLocalBody ? existing.text : incoming.text,
            media: keepLocalBody ? existing.media : incoming.media,
            isLocked: keepLocalBody ? existing.isLocked : incoming.isLocked,
            read: Boolean(existing.read || incoming.read),
            reads: incoming.reads?.length ? incoming.reads : existing.reads,
            reactions: incoming.reactions ?? existing.reactions
          };
        });

        const incomingIds = new Set(decryptedMsgs.map((m) => m.id));

        // Seamless Merge: preserve older history already in memory so SWR doesn't truncate chat
        const oldestIncomingTime = decryptedMsgs.length > 0
          ? new Date(decryptedMsgs[0].timestamp).getTime()
          : Infinity;
        const olderHistory = existingMessages.filter(
          (m) => !incomingIds.has(m.id) && !m.isPending && !m.isOptimistic && new Date(m.timestamp).getTime() < oldestIncomingTime
        );

        // Retain optimistic / pending messages not yet reflected on server
        const pending = existingMessages.filter(
          (m) => (m.isPending || m.isOptimistic) && !incomingIds.has(m.id)
        );
        const finalMessages = [...olderHistory, ...merged, ...pending].sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        saveCachedMessagesBatch(chatId, finalMessages, currentUserId);
        return { ...c, messages: finalMessages };
      }));

      setMessagePagination((prev) => ({ ...prev, [chatId]: { loading: false, hasMore: msgs.length >= 100 } }));
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing((prev) => ({ ...prev, [chatId]: false }));
      setIsChatLoading((prev) => ({ ...prev, [chatId]: false }));
    }
  }, [currentUser, currentUserId, setSharedKeysCache, setChats, chatsRef, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const loadOlderMessages = useCallback(async (chatId) => {
    const chat = chatsRef.current.find((c) => c.id === chatId);
    const pagination = messagePagination[chatId];
    if (!chat || pagination?.loading || pagination?.hasMore === false || !chat.messages?.length) return 0;

    setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: true } }));
    try {
      const oldestTimestamp = chat.messages[0]?.timestamp;

      // 1. Instant 0ms pagination from local IndexedDB cache
      const cachedOlder = await getCachedMessagesBeforeTimestamp(chatId, oldestTimestamp, 30);
      if (Array.isArray(cachedOlder) && cachedOlder.length > 0) {
        setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
          if (c.id !== chatId) return c;
          const currentMessages = Array.isArray(c.messages) ? c.messages : [];
          const known = new Set(currentMessages.map((message) => message.id));
          const finalMessages = [...cachedOlder.filter((message) => !known.has(message.id)), ...currentMessages];
          return { ...c, messages: finalMessages };
        }));
        setMessagePagination((prev) => ({ ...prev, [chatId]: { loading: false, hasMore: true } }));
        return cachedOlder.length;
      }

      // 2. If local cache is exhausted or offline, handle network
      if (!navigator.onLine) {
        setMessagePagination((prev) => ({ ...prev, [chatId]: { loading: false, hasMore: false } }));
        return 0;
      }

      const olderRaw = await dataService.loadChatMessages(chatId, 30, oldestTimestamp);
      const older = Array.isArray(olderRaw) ? olderRaw : [];

      const sharedKey = await resolveSharedKey({
        chatId,
        chat,
        currentUserId: currentUser.id,
        e2eePrivateKey: e2eePrivateKeyRef.current,
        sharedKeysCache: sharedKeysCacheRef.current,
        setSharedKeysCache
      });

      const decrypted = await Promise.all(
        older.map((message) => decryptMessageFields(message, sharedKey, chat.type === 'personal'))
      );

      setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
        if (c.id !== chatId) return c;
        const currentMessages = Array.isArray(c.messages) ? c.messages : [];
        const known = new Set(currentMessages.map((message) => message.id));
        const finalMessages = [...decrypted.filter((message) => !known.has(message.id)), ...currentMessages];
        saveCachedMessagesBatch(chatId, finalMessages, currentUserId);
        return { ...c, messages: finalMessages };
      }));
      setMessagePagination((prev) => ({ ...prev, [chatId]: { loading: false, hasMore: older.length === 30 } }));
      return decrypted.length;
    } catch (error) {
      console.error('Failed to load older messages', error);
      setMessagePagination((prev) => ({ ...prev, [chatId]: { ...prev[chatId], loading: false } }));
      return 0;
    }
  }, [currentUser, currentUserId, messagePagination, setSharedKeysCache, setChats, chatsRef, e2eePrivateKeyRef, sharedKeysCacheRef]);

  // Stale-While-Revalidate: Telegram-style instant 0ms history hydration on chat selection
  useEffect(() => {
    if (!activeChatId) return;

    let isMounted = true;
    const currentChat = chatsRef.current.find((c) => c.id === activeChatId);
    const inMemoryCount = currentChat?.messages?.length || 0;

    // Do not show full-page loading spinner if we already have some messages in memory
    if (inMemoryCount > 0) {
      setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
    }

    // Always hydrate from IndexedDB to show full cached history (not just preview messages)
    getCachedMessagesForChat(activeChatId, currentUserId).then((cached) => {
      if (!isMounted) return;
      if (Array.isArray(cached) && cached.length > 0) {
        setChats((prev) => (Array.isArray(prev) ? prev : []).map((c) => {
          if (c.id !== activeChatId) return c;
          const currentMsgs = Array.isArray(c.messages) ? c.messages : [];

          // If current chat already has more messages loaded (e.g. user paginated 100+ items), preserve them
          if (currentMsgs.length > cached.length) {
            const cachedById = new Map(cached.map((m) => [m.id, m]));
            return {
              ...c,
              messages: currentMsgs.map((m) => {
                const cm = cachedById.get(m.id);
                return cm ? { ...cm, ...m } : m;
              })
            };
          }

          const pending = currentMsgs.filter((m) => m.isPending || m.isOptimistic);
          const cachedIds = new Set(cached.map((m) => m.id));
          const uniquePending = pending.filter((m) => !cachedIds.has(m.id));
          return { ...c, messages: [...cached, ...uniquePending] };
        }));
        setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
      } else {
        setIsChatLoading((prev) => ({ ...prev, [activeChatId]: inMemoryCount === 0 }));
      }
    }).catch(() => {
      if (isMounted) {
        setIsChatLoading((prev) => ({ ...prev, [activeChatId]: false }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeChatId, currentUserId, setChats, chatsRef]);

  // Contract: active encrypted chat reloads after the private key becomes available
  useEffect(() => {
    if (activeChatId) {
      loadActiveChatMessages(activeChatId);
    }
  }, [activeChatId, e2eePrivateKey, loadActiveChatMessages]);

  return {
    messagePagination,
    isChatLoading,
    isSyncing,
    fetchChats,
    loadActiveChatMessages,
    loadOlderMessages
  };
}
