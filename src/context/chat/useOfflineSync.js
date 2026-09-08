import { useState, useEffect, useCallback, useRef } from 'react';
import { dataService } from '../../services/dataLayer';
import {
  loadOfflineQueue,
  saveOfflineQueue,
  processOfflineQueueItem,
  isNetworkError
} from '../../services/offlineQueue';
import {
  deleteOfflineAttachment,
  saveCachedMessage,
  deleteCachedMessage
} from '../../utils/indexedDbHelper';
import { revokeManagedObjectUrl } from '../../utils/objectUrlRegistry';

/**
 * Offline queue state and sync when the client comes back online.
 */
export function useOfflineSync({
  currentUser,
  chats,
  setChats,
  e2eePrivateKeyRef,
  sharedKeysCacheRef,
  setSharedKeysCache
}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueOwnerId, setQueueOwnerId] = useState(null);
  const offlineQueueRef = useRef([]);
  const chatsRef = useRef(chats);
  const currentUserRef = useRef(currentUser);
  const syncPromiseRef = useRef(null);
  const syncRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef({ userId: currentUser?.id ?? null, generation: 0 });

  chatsRef.current = chats;
  currentUserRef.current = currentUser;
  const renderedUserId = currentUser?.id ?? null;
  if (sessionRef.current.userId !== renderedUserId) {
    sessionRef.current = {
      userId: renderedUserId,
      generation: sessionRef.current.generation + 1
    };
    offlineQueueRef.current = [];
  }

  const updateOfflineQueue = useCallback((updater) => {
    const next = typeof updater === 'function'
      ? updater(offlineQueueRef.current)
      : updater;
    offlineQueueRef.current = next;
    setOfflineQueue(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current = {
        ...sessionRef.current,
        generation: sessionRef.current.generation + 1
      };
    };
  }, []);

  useEffect(() => {
    let active = true;
    const userId = currentUser?.id ?? null;
    setQueueLoaded(false);
    setQueueOwnerId(null);
    updateOfflineQueue([]);
    loadOfflineQueue(userId)
      .then((queue) => {
        if (active) {
          updateOfflineQueue((current) => {
            const currentIds = new Set(current.map((item) => item.queueId));
            return [...queue.filter((item) => !currentIds.has(item.queueId)), ...current];
          });
        }
      })
      .catch((error) => console.error('Failed to load encrypted offline queue:', error))
      .finally(() => {
        if (active) {
          setQueueOwnerId(userId);
          setQueueLoaded(true);
        }
      });
    return () => { active = false; };
  }, [currentUser?.id, updateOfflineQueue]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!queueLoaded || queueOwnerId !== (currentUser?.id ?? null)) return;
    saveOfflineQueue(currentUser?.id, offlineQueue)
      .catch((error) => console.error('Failed to persist encrypted offline queue:', error));
  }, [currentUser?.id, offlineQueue, queueLoaded, queueOwnerId]);

  const markMessageAsFailed = useCallback((chatId, optimisticId) => {
    setChats((prevChats) => prevChats.map((c) => {
      if (c.id === chatId) {
        return {
          ...c,
          messages: c.messages.map((m) => (m.id === optimisticId ? { ...m, isFailed: true, isPending: false } : m))
        };
      }
      return c;
    }));
    updateOfflineQueue((prev) => prev.map((q) => (q.optimisticId === optimisticId ? { ...q, isFailed: true, isPending: false } : q)));
  }, [setChats, updateOfflineQueue]);

  const syncOfflineMessages = useCallback(() => {
    if (!mountedRef.current || !dataService.isLive()) return Promise.resolve();
    if (syncPromiseRef.current) {
      syncRequestedRef.current = true;
      return syncPromiseRef.current;
    }
    syncRequestedRef.current = false;

    const session = { ...sessionRef.current };
    const isCurrentSession = () => mountedRef.current
      && sessionRef.current.generation === session.generation
      && sessionRef.current.userId === session.userId;

    const syncPromise = (async () => {
      while (isCurrentSession()) {
        const item = offlineQueueRef.current.find((queued) => !queued.isFailed);
        if (!item) break;
        try {
          const chat = chatsRef.current.find((candidate) => candidate.id === item.chatId);
          const sessionUser = currentUserRef.current;
          if (!chat || !sessionUser || sessionUser.id !== session.userId) break;
          const { data, finalMediaUrl } = await processOfflineQueueItem(item, {
            chat,
            currentUser: sessionUser,
            e2eePrivateKey: e2eePrivateKeyRef.current,
            sharedKey: sharedKeysCacheRef.current[item.chatId] || null,
            onSharedKey: (sharedKey) => {
              if (isCurrentSession()) {
                setSharedKeysCache((prev) => ({ ...prev, [chat.id]: sharedKey }));
              }
            },
            deleteAttachment: async (optimisticId) => {
              if (isCurrentSession()) await deleteOfflineAttachment(optimisticId);
            }
          });

          if (!isCurrentSession()) break;
          if (data) {
            deleteCachedMessage(item.optimisticId);
            saveCachedMessage({
              id: data.id,
              senderId: currentUser?.id,
              text: item.text,
              media: finalMediaUrl,
              replyTo: item.replyToId,
              timestamp: new Date(),
              isPending: false,
              isOptimistic: false
            }, item.chatId, currentUser?.id);

            setChats((prevChats) => prevChats.map((c) => {
              if (c.id === item.chatId) {
                return {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id === item.optimisticId) {
                      return {
                        ...m,
                        id: data.id,
                        media: finalMediaUrl,
                        isPending: false,
                        isOptimistic: false
                      };
                    }
                    return m;
                  })
                };
              }
              return c;
            }));

            updateOfflineQueue((prev) => prev.filter((q) => q.queueId !== item.queueId));
            revokeManagedObjectUrl(`offline:${item.optimisticId}`);
          }
        } catch (err) {
          if (!isCurrentSession()) break;
          console.error('Failed to sync offline message:', err);
          if (isNetworkError(err)) {
            syncRequestedRef.current = false;
            setIsOnline(false);
            break;
          } else {
            markMessageAsFailed(item.chatId, item.optimisticId);
          }
        }
      }
    })();
    syncPromiseRef.current = syncPromise;
    const finishSync = () => {
      if (syncPromiseRef.current !== syncPromise) return;
      syncPromiseRef.current = null;
      const sessionChanged = sessionRef.current.generation !== session.generation;
      if (mountedRef.current && (syncRequestedRef.current || sessionChanged)
        && offlineQueueRef.current.some((item) => !item.isFailed)) {
        syncRequestedRef.current = false;
        queueMicrotask(() => { syncOfflineMessages(); });
      }
    };
    void syncPromise.then(finishSync, finishSync);
    return syncPromise;
  }, [currentUser?.id, markMessageAsFailed, setSharedKeysCache, setChats, e2eePrivateKeyRef, sharedKeysCacheRef, updateOfflineQueue]);

  const retrySendMessage = useCallback(async (optimisticId) => {
    const item = offlineQueueRef.current.find((q) => q.optimisticId === optimisticId);
    if (!item) return;

    setChats((prevChats) => prevChats.map((c) => {
      if (c.id === item.chatId) {
        return {
          ...c,
          messages: c.messages.map((m) => (m.id === optimisticId ? { ...m, isFailed: false, isPending: true } : m))
        };
      }
      return c;
    }));

    updateOfflineQueue((prev) => prev.map((q) => (q.optimisticId === optimisticId ? { ...q, isFailed: false, isPending: true } : q)));

    if (navigator.onLine) {
      setIsOnline(true);
      setTimeout(() => { syncOfflineMessages(); }, 50);
    }
  }, [syncOfflineMessages, setChats, updateOfflineQueue]);

  const deleteFailedMessage = useCallback(async (optimisticId) => {
    const item = offlineQueueRef.current.find((q) => q.optimisticId === optimisticId);
    if (!item) return;

    setChats((prevChats) => prevChats.map((c) => {
      if (c.id === item.chatId) {
        return { ...c, messages: c.messages.filter((m) => m.id !== optimisticId) };
      }
      return c;
    }));

    updateOfflineQueue((prev) => prev.filter((q) => q.optimisticId !== optimisticId));
    revokeManagedObjectUrl(`offline:${optimisticId}`);
    try {
      await deleteOfflineAttachment(optimisticId);
    } catch (e) {
      console.error(e);
    }
  }, [setChats, updateOfflineQueue]);

  useEffect(() => {
    if (queueLoaded && queueOwnerId === (currentUser?.id ?? null) && isOnline && offlineQueue.length > 0) {
      syncOfflineMessages();
    }
  }, [currentUser?.id, isOnline, offlineQueue.length, queueLoaded, queueOwnerId, syncOfflineMessages]);

  return {
    isOnline,
    setIsOnline,
    offlineQueue,
    setOfflineQueue: updateOfflineQueue,
    markMessageAsFailed,
    syncOfflineMessages,
    retrySendMessage,
    deleteFailedMessage
  };
}
