import {
  decryptOfflineAttachment,
  decryptOfflineQueuePayload,
  encryptOfflineAttachment,
  encryptOfflineQueuePayload,
  generateOfflineQueueKey
} from './offlineQueueCrypto.js';

const DB_NAME = 'CoinyOfflineDB';
const DB_VERSION = 8;
const ATTACHMENT_STORE_NAME = 'offline-attachments';
const E2EE_KEY_STORE_NAME = 'e2ee-keys';
const OFFLINE_QUEUE_STORE_NAME = 'offline-queue';
const LOCAL_KEY_STORE_NAME = 'local-crypto-keys';
const MLS_STATE_STORE_NAME = 'mls-state';
const CRYPTO_OUTBOX_STORE_NAME = 'crypto-outbox';
const CRYPTO_INBOX_STORE_NAME = 'crypto-inbox';
const MESSAGES_CACHE_STORE_NAME = 'messages-cache';
const MESSAGES_CACHE_V2_STORE_NAME = 'messages-cache-v2';
const CHATS_CACHE_STORE_NAME = 'chats-cache';
const MEDIA_CACHE_STORE_NAME = 'media-cache';
const OFFLINE_QUEUE_KEY_ID = 'offline-queue-aes-gcm-v1';
const LEGACY_QUEUE_STORAGE_KEY = 'tg-offline-queue';

let dbPromise = null;
const localKeyPromises = new Map();

function ensureStores(db) {
  for (const storeName of [
    ATTACHMENT_STORE_NAME,
    E2EE_KEY_STORE_NAME,
    OFFLINE_QUEUE_STORE_NAME,
    LOCAL_KEY_STORE_NAME,
    MLS_STATE_STORE_NAME,
    CRYPTO_OUTBOX_STORE_NAME,
    CRYPTO_INBOX_STORE_NAME,
    MESSAGES_CACHE_STORE_NAME
  ]) {
    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
  }

  if (!db.objectStoreNames.contains(MESSAGES_CACHE_V2_STORE_NAME)) {
    const msgStore = db.createObjectStore(MESSAGES_CACHE_V2_STORE_NAME, { keyPath: 'id' });
    msgStore.createIndex('by-chat', 'chatId', { unique: false });
    msgStore.createIndex('by-chat-timestamp', ['chatId', 'timestampIso'], { unique: false });
  }

  if (!db.objectStoreNames.contains(CHATS_CACHE_STORE_NAME)) {
    db.createObjectStore(CHATS_CACHE_STORE_NAME, { keyPath: 'id' });
  }

  if (!db.objectStoreNames.contains(MEDIA_CACHE_STORE_NAME)) {
    const mediaStore = db.createObjectStore(MEDIA_CACHE_STORE_NAME, { keyPath: 'key' });
    mediaStore.createIndex('by-accessed', 'lastAccessedAt', { unique: false });
  }
}

function openDatabase(version) {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }
  return new Promise((resolve, reject) => {
    const request = typeof version === 'number'
      ? indexedDB.open(DB_NAME, version)
      : indexedDB.open(DB_NAME);

    request.onupgradeneeded = (event) => ensureStores(event.target.result);
    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        localKeyPromises.clear();
      };
      db.onclose = () => {
        dbPromise = null;
        localKeyPromises.clear();
      };
      resolve(db);
    };
    request.onerror = (event) => reject(event.target.error || new Error('IndexedDB open failed'));
    request.onblocked = () => {
      console.warn('IndexedDB upgrade is blocked; close other Coiny tabs and retry.');
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error || new Error('IndexedDB request failed'));
  });
}

async function getStoreValue(storeName, key) {
  const db = await initOfflineDB();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function putStoreValue(storeName, key, value) {
  const db = await initOfflineDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const result = await requestResult(transaction.objectStore(storeName).put(value, key));
  await transactionComplete(transaction);
  return result;
}

async function deleteStoreValue(storeName, key) {
  const db = await initOfflineDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const result = await requestResult(transaction.objectStore(storeName).delete(key));
  await transactionComplete(transaction);
  return result;
}

async function getLocalCryptoKey() {
  if (!localKeyPromises.has(OFFLINE_QUEUE_KEY_ID)) {
    localKeyPromises.set(OFFLINE_QUEUE_KEY_ID, (async () => {
      const existing = await getStoreValue(LOCAL_KEY_STORE_NAME, OFFLINE_QUEUE_KEY_ID);
      if (typeof CryptoKey !== 'undefined' && existing instanceof CryptoKey) return existing;
      const generated = await generateOfflineQueueKey();
      await putStoreValue(LOCAL_KEY_STORE_NAME, OFFLINE_QUEUE_KEY_ID, generated);
      return generated;
    })().catch((error) => {
      localKeyPromises.delete(OFFLINE_QUEUE_KEY_ID);
      throw error;
    }));
  }
  return localKeyPromises.get(OFFLINE_QUEUE_KEY_ID);
}

function userContext(userId) {
  return String(userId || 'anonymous');
}

export function initOfflineDB() {
  if (dbPromise) return dbPromise;
  dbPromise = openDatabase(DB_VERSION).catch((error) => {
    if (error?.name === 'VersionError') return openDatabase(undefined);
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export function getOfflineDbSchemaVersion() {
  return DB_VERSION;
}

export async function saveEncryptedOfflineQueue(userId, queue) {
  const context = `queue:${userContext(userId)}`;
  const key = await getLocalCryptoKey();
  const record = await encryptOfflineQueuePayload(Array.isArray(queue) ? queue : [], key, context);
  await putStoreValue(OFFLINE_QUEUE_STORE_NAME, context, record);
}

export async function loadEncryptedOfflineQueue(userId) {
  const context = `queue:${userContext(userId)}`;
  const record = await getStoreValue(OFFLINE_QUEUE_STORE_NAME, context);
  if (record) {
    try {
      const queue = await decryptOfflineQueuePayload(record, await getLocalCryptoKey(), context);
      return Array.isArray(queue) ? queue : [];
    } catch (error) {
      console.error('Encrypted offline queue cannot be decrypted:', error);
      return [];
    }
  }

  // One-time migration from versions that persisted queue plaintext.
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_STORAGE_KEY) || '[]');
    localStorage.removeItem(LEGACY_QUEUE_STORAGE_KEY);
    if (Array.isArray(legacy) && legacy.length) {
      await saveEncryptedOfflineQueue(userId, legacy);
      return legacy;
    }
  } catch {
    localStorage.removeItem(LEGACY_QUEUE_STORAGE_KEY);
  }
  return [];
}

export async function saveOfflineAttachment(optimisticId, blob, userId = 'anonymous') {
  const context = `attachment:${userContext(userId)}:${optimisticId}`;
  const encryptedBlob = await encryptOfflineAttachment(blob, await getLocalCryptoKey(), context);
  await putStoreValue(ATTACHMENT_STORE_NAME, optimisticId, {
    version: 1,
    blob: encryptedBlob,
    mimeType: blob.type || 'application/octet-stream',
    size: blob.size,
    userId: userContext(userId)
  });
}

export async function getOfflineAttachment(optimisticId, userId = 'anonymous') {
  const record = await getStoreValue(ATTACHMENT_STORE_NAME, optimisticId);
  if (!record) return null;
  if (record instanceof Blob) return record; // Legacy plaintext record; rewritten on next enqueue.
  if (record.version !== 1 || !(record.blob instanceof Blob)) return null;
  if (record.userId !== userContext(userId)) return null;
  const context = `attachment:${record.userId}:${optimisticId}`;
  return decryptOfflineAttachment(
    record.blob,
    await getLocalCryptoKey(),
    record.mimeType,
    context
  );
}

export function deleteOfflineAttachment(optimisticId) {
  return deleteStoreValue(ATTACHMENT_STORE_NAME, optimisticId);
}

export function savePrivateKey(userId, key, publicKey = null) {
  return putStoreValue(E2EE_KEY_STORE_NAME, userId, {
    key,
    publicKey,
    storedAt: new Date().toISOString()
  });
}

export function isPrivateKeyRecordCurrent(record, publicKey) {
  return Boolean(record?.key && typeof record.publicKey === 'string' && record.publicKey === publicKey);
}

export function getPrivateKey(userId) {
  return getStoreValue(E2EE_KEY_STORE_NAME, userId);
}

export function deletePrivateKey(userId) {
  return deleteStoreValue(E2EE_KEY_STORE_NAME, userId);
}

export function saveCurrentE2EEDeviceId(userId, deviceId) {
  return putStoreValue(LOCAL_KEY_STORE_NAME, `e2ee-device:${userContext(userId)}`, String(deviceId));
}

export function getCurrentE2EEDeviceId(userId) {
  return getStoreValue(LOCAL_KEY_STORE_NAME, `e2ee-device:${userContext(userId)}`);
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

/** Atomically persist an MLS state transition and its encrypted upload record. */
export async function commitConversationCryptoTransition(userId, chatId, serializedState, outboxRecord) {
  const owner = userContext(userId);
  const stateContext = `mls-state:${owner}:${chatId}`;
  const outboxContext = `mls-outbox:${owner}:${outboxRecord.id}`;
  const key = await getLocalCryptoKey();
  const [encryptedState, encryptedOutbox] = await Promise.all([
    encryptOfflineQueuePayload(serializedState, key, stateContext),
    encryptOfflineQueuePayload(outboxRecord, key, outboxContext)
  ]);
  const db = await initOfflineDB();
  const transaction = db.transaction([MLS_STATE_STORE_NAME, CRYPTO_OUTBOX_STORE_NAME], 'readwrite');
  transaction.objectStore(MLS_STATE_STORE_NAME).put(encryptedState, stateContext);
  transaction.objectStore(CRYPTO_OUTBOX_STORE_NAME).put({
    context: outboxContext,
    payload: encryptedOutbox,
    createdAt: new Date().toISOString()
  }, outboxRecord.id);
  await transactionComplete(transaction);
}

/** Atomically persist a receive-state transition and its replay-protected inbox receipt. */
export async function commitConversationDecryptTransition(userId, chatId, serializedState, inboxRecord) {
  const owner = userContext(userId);
  const stateContext = `mls-state:${owner}:${chatId}`;
  const inboxContext = `mls-inbox:${owner}:${inboxRecord.id}`;
  const key = await getLocalCryptoKey();
  const [encryptedState, encryptedInbox] = await Promise.all([
    encryptOfflineQueuePayload(serializedState, key, stateContext),
    encryptOfflineQueuePayload(inboxRecord, key, inboxContext)
  ]);
  const db = await initOfflineDB();
  const transaction = db.transaction([MLS_STATE_STORE_NAME, CRYPTO_INBOX_STORE_NAME], 'readwrite');
  transaction.objectStore(MLS_STATE_STORE_NAME).put(encryptedState, stateContext);
  transaction.objectStore(CRYPTO_INBOX_STORE_NAME).put({
    context: inboxContext,
    payload: encryptedInbox,
    receivedAt: new Date().toISOString()
  }, inboxRecord.id);
  await transactionComplete(transaction);
}

export async function loadConversationCryptoState(userId, chatId) {
  const context = `mls-state:${userContext(userId)}:${chatId}`;
  const record = await getStoreValue(MLS_STATE_STORE_NAME, context);
  if (!record) return null;
  return decryptOfflineQueuePayload(record, await getLocalCryptoKey(), context);
}

export async function clearOfflineDatabase() {
  const db = await initOfflineDB().catch(() => null);
  db?.close();
  dbPromise = null;
  localKeyPromises.clear();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error || new Error('IndexedDB delete failed'));
    request.onblocked = () => reject(new Error('IndexedDB delete is blocked by another Coiny tab.'));
  });
}

/**
 * Normalize message object for relational indexing in messages-cache-v2
 */
export function normalizeCachedMessage(m, chatId, userId) {
  if (!m || !m.id) return null;
  const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp || Date.now());
  const validTs = isNaN(ts.getTime()) ? new Date() : ts;
  return {
    id: String(m.id),
    chatId: String(chatId || m.chatId || m.chat_id || ''),
    userId: userContext(userId),
    senderId: m.senderId || m.sender_id || '',
    senderName: m.senderName || '',
    text: typeof m.text === 'string' ? m.text : '',
    media: m.media || null,
    mediaPath: m.mediaPath || m.media_path || null,
    replyTo: m.replyTo || m.reply_to || null,
    read: Boolean(m.read),
    reads: Array.isArray(m.reads) ? m.reads : [],
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    timestampIso: validTs.toISOString(),
    isOptimistic: Boolean(m.isOptimistic),
    isPending: Boolean(m.isPending),
    isLocked: Boolean(m.isLocked),
    isFailed: Boolean(m.isFailed)
  };
}

/**
 * Denormalize cached message row to runtime ChatMessage format
 */
export function denormalizeCachedMessage(row) {
  if (!row) return null;
  return {
    ...row,
    timestamp: new Date(row.timestampIso)
  };
}

/**
 * Persist or update a single message in messages-cache-v2
 */
export async function saveCachedMessage(message, chatId, userId) {
  if (!message || !message.id || typeof indexedDB === 'undefined') return;
  const norm = normalizeCachedMessage(message, chatId, userId);
  if (!norm || !norm.chatId) return;

  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readwrite');
    tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME).put(norm);
    await transactionComplete(tx);
  } catch (err) {
    console.warn('Failed to save message in messages-cache-v2:', err);
  }
}

/**
 * Batch saves messages in messages-cache-v2 (relational storage per message)
 */
export async function saveCachedMessagesBatch(chatId, messages, userId) {
  if (!chatId || !Array.isArray(messages) || messages.length === 0 || typeof indexedDB === 'undefined') return;
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME);

    for (const m of messages) {
      const norm = normalizeCachedMessage(m, chatId, userId);
      if (norm) {
        store.put(norm);
      }
    }
    await transactionComplete(tx);

    // Also update legacy store for backwards compatibility
    await saveCachedMessages(chatId, messages, userId);
  } catch (err) {
    console.warn('Failed to save messages batch in IndexedDB:', err);
  }
}

/**
 * Retrieve messages for a chat from messages-cache-v2 sorted chronologically
 */
export async function getCachedMessagesForChat(chatId, userId, limit = 200) {
  if (!chatId || typeof indexedDB === 'undefined') return [];
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readonly');
    const store = tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME);
    const index = store.index('by-chat-timestamp');

    const lowerBound = [String(chatId), ''];
    const upperBound = [String(chatId), '\uffff'];
    const range = IDBKeyRange.bound(lowerBound, upperBound);

    return new Promise((resolve) => {
      const results = [];
      const req = index.openCursor(range, 'prev'); // Most recent first
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(denormalizeCachedMessage(cursor.value));
          cursor.continue();
        } else {
          if (results.length === 0) {
            // Fallback to legacy messages-cache if v2 has no entries for this chat yet
            getCachedMessages(chatId, userId).then((legacy) => {
              resolve(Array.isArray(legacy) ? legacy : []);
            }).catch(() => resolve([]));
          } else {
            resolve(results.reverse()); // Chronological order
          }
        }
      };
      req.onerror = () => {
        getCachedMessages(chatId, userId).then((legacy) => {
          resolve(Array.isArray(legacy) ? legacy : []);
        }).catch(() => resolve([]));
      };
    });
  } catch (err) {
    console.warn('Failed to read messages-cache-v2:', err);
    return getCachedMessages(chatId, userId).catch(() => []);
  }
}

/**
 * Retrieve messages for a chat from messages-cache-v2 that occurred before a given timestamp, sorted chronologically
 */
export async function getCachedMessagesBeforeTimestamp(chatId, beforeTimestamp, limit = 30) {
  if (!chatId || !beforeTimestamp || typeof indexedDB === 'undefined') return [];
  try {
    const beforeDate = new Date(beforeTimestamp);
    if (isNaN(beforeDate.getTime())) return [];
    const beforeIso = beforeDate.toISOString();

    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readonly');
    const store = tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME);
    const index = store.index('by-chat-timestamp');

    const lowerBound = [String(chatId), ''];
    const upperBound = [String(chatId), beforeIso];
    const range = IDBKeyRange.bound(lowerBound, upperBound, false, true);

    return new Promise((resolve) => {
      const results = [];
      const req = index.openCursor(range, 'prev'); // Most recent before timestamp
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(denormalizeCachedMessage(cursor.value));
          cursor.continue();
        } else {
          resolve(results.reverse()); // Chronological order
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('Failed to read messages before timestamp:', err);
    return [];
  }
}

/**
 * Delete a single cached message by message ID
 */
export async function deleteCachedMessage(messageId) {
  if (!messageId || typeof indexedDB === 'undefined') return;
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readwrite');
    tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME).delete(String(messageId));
    await transactionComplete(tx);
  } catch (err) {
    console.warn('Failed to delete cached message:', err);
  }
}

/**
 * Update specific fields (reactions, read status, text) of a cached message
 */
export async function updateCachedMessageFields(messageId, updates) {
  if (!messageId || !updates || typeof indexedDB === 'undefined') return;
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MESSAGES_CACHE_V2_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME);
    const existing = await requestResult(store.get(String(messageId)));
    if (existing) {
      const merged = { ...existing, ...updates };
      store.put(merged);
    }
    await transactionComplete(tx);
  } catch (err) {
    console.warn('Failed to update cached message fields:', err);
  }
}

/**
 * Persist the entire chat list for instantaneous 0ms startup
 */
export async function saveCachedChatList(chats, userId) {
  if (!Array.isArray(chats) || typeof indexedDB === 'undefined') return;
  const owner = userContext(userId);
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(CHATS_CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CHATS_CACHE_STORE_NAME);

    const entry = {
      id: `chats:${owner}`,
      owner,
      chats: chats.map((c) => ({
        id: c.id,
        name: c.name,
        avatar: c.avatar,
        avatarColor: c.avatarColor,
        username: c.username,
        type: c.type,
        pinned: c.pinned,
        notifications: c.notifications,
        settings: c.settings,
        members: c.members,
        unreadCount: c.unreadCount || 0,
        messages: Array.isArray(c.messages)
          ? c.messages.slice(-5).map((m) => ({
              ...m,
              timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
            }))
          : []
      })),
      updatedAt: Date.now()
    };
    store.put(entry);
    await transactionComplete(tx);
  } catch (err) {
    console.warn('Failed to save cached chat list:', err);
  }
}

/**
 * Retrieve the cached chat list for instantaneous 0ms startup
 */
export async function getCachedChatList(userId) {
  if (typeof indexedDB === 'undefined') return null;
  const owner = userContext(userId);
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(CHATS_CACHE_STORE_NAME, 'readonly');
    const row = await requestResult(tx.objectStore(CHATS_CACHE_STORE_NAME).get(`chats:${owner}`));
    if (row && Array.isArray(row.chats)) {
      return row.chats.map((c) => ({
        ...c,
        messages: Array.isArray(c.messages)
          ? c.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }))
          : []
      }));
    }
    return null;
  } catch (err) {
    console.warn('Failed to read cached chat list:', err);
    return null;
  }
}

const MAX_MEDIA_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB
const MAX_MEDIA_CACHE_COUNT = 500;

/**
 * Save a media Blob (avatar, photo, voice) in media-cache with LRU eviction
 */
export async function saveCachedMedia(key, blob, mimeType) {
  if (!key || !(blob instanceof Blob) || typeof indexedDB === 'undefined') return;
  const cleanKey = String(key).trim();
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MEDIA_CACHE_STORE_NAME);

    const record = {
      key: cleanKey,
      blob,
      mimeType: mimeType || blob.type || 'application/octet-stream',
      size: blob.size || 0,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now()
    };

    store.put(record);
    await transactionComplete(tx);

    enforceMediaCacheLru().catch(() => {});
  } catch (err) {
    console.warn('Failed to save cached media:', err);
  }
}

let pendingTouchMediaKeys = new Set();
let touchMediaTimeout = null;

function queueTouchMediaAccess(key) {
  if (typeof indexedDB === 'undefined' || !key) return;
  pendingTouchMediaKeys.add(String(key).trim());
  if (touchMediaTimeout) return;
  touchMediaTimeout = setTimeout(async () => {
    touchMediaTimeout = null;
    const keys = Array.from(pendingTouchMediaKeys);
    pendingTouchMediaKeys.clear();
    if (keys.length === 0) return;
    try {
      const db = await initOfflineDB();
      const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(MEDIA_CACHE_STORE_NAME);
      const now = Date.now();
      for (const k of keys) {
        const record = await requestResult(store.get(k));
        if (record) {
          record.lastAccessedAt = now;
          store.put(record);
        }
      }
      await transactionComplete(tx);
    } catch {
      // background touch error can safely be ignored
    }
  }, 1000);
}

/**
 * Retrieve a cached media Blob by key with non-blocking readonly transaction
 */
export async function getCachedMedia(key) {
  if (!key || typeof indexedDB === 'undefined') return null;
  const cleanKey = String(key).trim();
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readonly');
    const store = tx.objectStore(MEDIA_CACHE_STORE_NAME);
    const record = await requestResult(store.get(cleanKey));

    if (record && record.blob instanceof Blob) {
      queueTouchMediaAccess(cleanKey);
      return record.blob;
    }
    return null;
  } catch (err) {
    console.warn('Failed to get cached media:', err);
    return null;
  }
}

/**
 * Enforces LRU eviction on media-cache if item count > 500 or size > 150 MB
 */
async function enforceMediaCacheLru() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readonly');
    const store = tx.objectStore(MEDIA_CACHE_STORE_NAME);
    const index = store.index('by-accessed');

    const entries = [];
    let totalBytes = 0;

    await new Promise((resolve, reject) => {
      const req = index.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const val = cursor.value;
          totalBytes += val.size || 0;
          entries.push({ key: val.key, size: val.size || 0, accessed: val.lastAccessedAt || 0 });
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    if (entries.length > MAX_MEDIA_CACHE_COUNT || totalBytes > MAX_MEDIA_CACHE_BYTES) {
      entries.sort((a, b) => a.accessed - b.accessed);

      const keysToDelete = [];
      let bytesToFree = Math.max(0, totalBytes - MAX_MEDIA_CACHE_BYTES * 0.8);
      const countToFree = Math.max(0, entries.length - MAX_MEDIA_CACHE_COUNT * 0.8);

      for (const item of entries) {
        if (keysToDelete.length < countToFree || bytesToFree > 0) {
          keysToDelete.push(item.key);
          bytesToFree -= item.size;
        } else {
          break;
        }
      }

      if (keysToDelete.length > 0) {
        const delTx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite');
        const delStore = delTx.objectStore(MEDIA_CACHE_STORE_NAME);
        for (const k of keysToDelete) {
          delStore.delete(k);
        }
        await transactionComplete(delTx);
      }
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Get stats about cached messages and media for Settings UI
 */
export async function getCacheStorageStats() {
  if (typeof indexedDB === 'undefined') {
    return { messageCount: 0, chatCount: 0, mediaCount: 0, mediaBytes: 0 };
  }
  try {
    const db = await initOfflineDB();
    const storeNames = [
      MESSAGES_CACHE_V2_STORE_NAME,
      CHATS_CACHE_STORE_NAME,
      MEDIA_CACHE_STORE_NAME
    ].filter((name) => db.objectStoreNames.contains(name));

    if (storeNames.length === 0) {
      return { messageCount: 0, chatCount: 0, mediaCount: 0, mediaBytes: 0 };
    }

    const tx = db.transaction(storeNames, 'readonly');

    // 1. Attach listeners immediately so onsuccess handlers fire synchronously
    const msgCountPromise = storeNames.includes(MESSAGES_CACHE_V2_STORE_NAME)
      ? requestResult(tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME).count()).catch(() => 0)
      : Promise.resolve(0);

    const chatCountPromise = storeNames.includes(CHATS_CACHE_STORE_NAME)
      ? requestResult(tx.objectStore(CHATS_CACHE_STORE_NAME).count()).catch(() => 0)
      : Promise.resolve(0);

    // Also inspect chats cache to count preview messages if messages-cache-v2 is empty
    let previewMsgCount = 0;
    let chatsCursorPromise = Promise.resolve();
    if (storeNames.includes(CHATS_CACHE_STORE_NAME)) {
      chatsCursorPromise = new Promise((resolve) => {
        const req = tx.objectStore(CHATS_CACHE_STORE_NAME).openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            if (Array.isArray(val?.chats)) {
              for (const c of val.chats) {
                if (Array.isArray(c?.messages)) {
                  previewMsgCount += c.messages.length;
                }
              }
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      });
    }

    // 2. Iterate mediaStore
    let mediaBytes = 0;
    let mediaCount = 0;
    let mediaPromise = Promise.resolve();
    if (storeNames.includes(MEDIA_CACHE_STORE_NAME)) {
      mediaPromise = new Promise((resolve) => {
        const cursorReq = tx.objectStore(MEDIA_CACHE_STORE_NAME).openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            mediaCount++;
            mediaBytes += cursor.value.size || 0;
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => resolve();
      });
    }

    const [v2Count, chatCount] = await Promise.all([
      msgCountPromise,
      chatCountPromise,
      chatsCursorPromise,
      mediaPromise
    ]);

    const totalMessages = (v2Count && v2Count > 0) ? v2Count : previewMsgCount;

    return {
      messageCount: totalMessages || 0,
      chatCount: chatCount || 0,
      mediaCount,
      mediaBytes
    };
  } catch (err) {
    console.warn('Failed to get cache storage stats:', err);
    return { messageCount: 0, chatCount: 0, mediaCount: 0, mediaBytes: 0 };
  }
}

/**
 * Clear all message, chat, and media caches without touching auth tokens or E2EE keys
 */
export async function clearMediaAndMessageCache() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await initOfflineDB();
    const tx = db.transaction(
      [MESSAGES_CACHE_V2_STORE_NAME, MESSAGES_CACHE_STORE_NAME, CHATS_CACHE_STORE_NAME, MEDIA_CACHE_STORE_NAME],
      'readwrite'
    );
    tx.objectStore(MESSAGES_CACHE_V2_STORE_NAME).clear();
    tx.objectStore(MESSAGES_CACHE_STORE_NAME).clear();
    tx.objectStore(CHATS_CACHE_STORE_NAME).clear();
    tx.objectStore(MEDIA_CACHE_STORE_NAME).clear();
    await transactionComplete(tx);
  } catch (err) {
    console.warn('Failed to clear media and message cache:', err);
  }
}

/**
 * Persists up to 100 recent messages for a chat to IndexedDB (legacy fallback)
 */
export async function saveCachedMessages(chatId, messages, userId) {
  if (!chatId || !Array.isArray(messages) || messages.length === 0) return;
  if (typeof indexedDB === 'undefined') return;
  const context = `chat-messages:${userContext(userId)}:${chatId}`;
  try {
    const trimmed = messages.slice(-100).map((m) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
    }));
    await putStoreValue(MESSAGES_CACHE_STORE_NAME, context, trimmed);
  } catch (err) {
    console.warn('Failed to cache messages in IndexedDB:', err);
  }
}

/**
 * Retrieves cached messages for a chat from IndexedDB (legacy fallback)
 */
export async function getCachedMessages(chatId, userId) {
  if (!chatId || typeof indexedDB === 'undefined') return null;
  const context = `chat-messages:${userContext(userId)}:${chatId}`;
  try {
    const raw = await getStoreValue(MESSAGES_CACHE_STORE_NAME, context);
    if (!Array.isArray(raw)) return null;
    return raw.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp)
    }));
  } catch (err) {
    console.warn('Failed to read cached messages from IndexedDB:', err);
    return null;
  }
}

/**
 * Removes cached messages for a chat from IndexedDB
 */
export async function clearCachedMessages(chatId, userId) {
  if (!chatId || typeof indexedDB === 'undefined') return;
  const context = `chat-messages:${userContext(userId)}:${chatId}`;
  try {
    await deleteStoreValue(MESSAGES_CACHE_STORE_NAME, context);
  } catch (err) {
    console.warn('Failed to clear cached messages from IndexedDB:', err);
  }
}

