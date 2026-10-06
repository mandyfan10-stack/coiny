import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNetworkError,
  createOfflineQueueItem
} from '../src/services/offlineQueueCore.js';
import { processOfflineQueueItem } from '../src/services/offlineQueue.js';

test('isNetworkError detects fetch/network failure messages', () => {
  assert.equal(isNetworkError(new Error('TypeError: failed to fetch')), true);
  assert.equal(isNetworkError(new Error('FetchError: timeout')), true);
  assert.equal(isNetworkError(new Error('NetworkError when attempting to fetch resource')), true);
  assert.equal(isNetworkError(new Error('permission denied')), false);
});

test('processOfflineQueueItem sends plaintext group message without E2EE', async () => {
  const calls = [];
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: 'queued group msg',
    optimisticId: 'opt-1',
    replyToId: null
  });

  const result = await processOfflineQueueItem(item, {
    chat: { type: 'group', name: 'Community', members: [] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    sendMessage: async (chatId, senderId, text, replyToId, media, customId) => {
      calls.push({ chatId, senderId, text, replyToId, media, customId });
      return { id: customId, text };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'queued group msg');
  assert.equal(calls[0].customId, 'opt-1');
  assert.equal(result.data.id, 'opt-1');
  assert.equal(result.finalMediaUrl, null);
});

test('processOfflineQueueItem uploads offline media then deletes local attachment', async () => {
  const deleted = [];
  const uploaded = [];
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: '🎤 Голосовое сообщение',
    optimisticId: 'opt-media',
    hasOfflineMedia: true,
    mediaType: 'audio'
  });

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });

  const result = await processOfflineQueueItem(item, {
    chat: { type: 'group', name: 'Community', members: [] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    getAttachment: async (id) => {
      assert.equal(id, 'opt-media');
      return blob;
    },
    deleteAttachment: async (id) => { deleted.push(id); },
    extensionForMedia: () => 'webm',
    storage: {
      from: () => ({
        upload: async (path, body, opts) => {
          uploaded.push({ path, body, opts });
          return { error: null };
        }
      })
    },
    sendMessage: async (_c, _s, text, _r, media, customId) => ({
      id: customId,
      text,
      media
    })
  });

  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].path, /group-1\/user-1\/msg_opt-media/);
  assert.equal(deleted[0], 'opt-media');
  assert.match(result.finalMediaUrl, /^storage:\/\/chat-attachments\//);
});

test('processOfflineQueueItem fails when offline media blob is missing', async () => {
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: 'media',
    optimisticId: 'missing',
    hasOfflineMedia: true
  });

  await assert.rejects(
    () => processOfflineQueueItem(item, {
      chat: { type: 'group', name: 'G', members: [] },
      currentUser: { id: 'user-1' },
      e2eePrivateKey: null,
      sharedKey: null,
      getAttachment: async () => null,
      extensionForMedia: () => 'bin',
      sendMessage: async () => ({ id: 'x' })
    }),
    /локальном хранилище/
  );
});

test('offline media survives a send failure and a 409 upload retry completes it', async () => {
  const deleted = [];
  let uploadAttempt = 0;
  let sendAttempt = 0;
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: 'retry media',
    optimisticId: 'opt-retry-media',
    hasOfflineMedia: true,
    mediaType: 'image'
  });
  const deps = {
    chat: { type: 'group', name: 'G', members: [] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    getAttachment: async () => new Blob(['image'], { type: 'image/webp' }),
    deleteAttachment: async (id) => { deleted.push(id); },
    extensionForMedia: () => 'webp',
    storage: {
      from: () => ({
        upload: async () => {
          uploadAttempt += 1;
          return uploadAttempt === 1
            ? { error: null }
            : { error: { statusCode: '409', message: 'The resource already exists' } };
        }
      })
    },
    sendMessage: async () => {
      sendAttempt += 1;
      if (sendAttempt === 1) throw new Error('failed to fetch');
      return { id: item.optimisticId };
    }
  };

  await assert.rejects(() => processOfflineQueueItem(item, deps), /failed to fetch/);
  assert.deepEqual(deleted, [], 'the only local copy must survive until the message insert succeeds');

  const result = await processOfflineQueueItem(item, deps);
  assert.equal(result.data.id, item.optimisticId);
  assert.deepEqual(deleted, [item.optimisticId]);
});

test('lost insert response accepts only the matching existing optimistic message', async () => {
  const item = createOfflineQueueItem({
    chatId: 'group-1', senderId: 'user-1', text: 'once', optimisticId: 'stable-id'
  });
  const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
  const baseDeps = {
    chat: { type: 'group', name: 'G', members: [] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    sendMessage: async () => { throw duplicate; }
  };

  const result = await processOfflineQueueItem(item, {
    ...baseDeps,
    findMessageById: async () => ({ id: 'stable-id', chat_id: 'group-1', sender_id: 'user-1' })
  });
  assert.equal(result.data.id, 'stable-id');

  await assert.rejects(() => processOfflineQueueItem(item, {
    ...baseDeps,
    findMessageById: async () => ({ id: 'stable-id', chat_id: 'other-chat', sender_id: 'user-1' })
  }), (error) => error === duplicate);
});

test('offline personal messages derive, cache, and use an E2EE shared key', async () => {
  const item = createOfflineQueueItem({
    chatId: 'personal-1',
    senderId: 'user-1',
    text: 'secret text',
    media: 'storage://chat-attachments/personal-1/file.webp',
    optimisticId: 'encrypted-offline-1'
  });
  const privateKey = { id: 'private-key' };
  const importedPublicKey = { id: 'public-key' };
  const derivedKey = { id: 'shared-key' };
  const requiredKeys = [];
  const sent = [];
  let cachedKey = null;

  const result = await processOfflineQueueItem(item, {
    chat: {
      type: 'personal',
      members: [
        { id: 'user-1' },
        { id: 'user-2', publicKey: '{"kty":"EC"}' }
      ]
    },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: privateKey,
    sharedKey: null,
    importPublicKey: async (serialized) => {
      assert.equal(serialized, '{"kty":"EC"}');
      return importedPublicKey;
    },
    deriveSymmetricKey: async (actualPrivate, actualPublic) => {
      assert.equal(actualPrivate, privateKey);
      assert.equal(actualPublic, importedPublicKey);
      return derivedKey;
    },
    encryptMessage: async (plaintext, key) => {
      assert.equal(key, derivedKey);
      return { ciphertext: `cipher-${plaintext}`, iv: 'iv' };
    },
    encryptFileForE2EE: async () => assert.fail('there is no offline media blob'),
    requireE2EEKey: (key) => requiredKeys.push(key),
    onSharedKey: (key) => { cachedKey = key; },
    sendMessage: async (...args) => {
      sent.push(args);
      return { id: item.optimisticId };
    }
  });

  assert.equal(cachedKey, derivedKey);
  assert.deepEqual(requiredKeys, [derivedKey]);
  assert.equal(sent[0][2], 'e2ee:aes-gcm:cipher-secret text:iv');
  assert.equal(sent[0][4], 'e2ee:aes-gcm:cipher-storage://chat-attachments/personal-1/file.webp:iv');
  assert.equal(result.data.id, item.optimisticId);
});

test('offline personal messages fail closed when E2EE key material is missing', async () => {
  const item = createOfflineQueueItem({
    chatId: 'personal-1',
    senderId: 'user-1',
    text: 'secret',
    optimisticId: 'missing-key-1'
  });
  const missingKeyError = new Error('E2EE key required');

  await assert.rejects(() => processOfflineQueueItem(item, {
    chat: { type: 'personal', members: [{ id: 'user-1' }, { id: 'user-2' }] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    importPublicKey: async () => assert.fail('missing public key must stop before import'),
    deriveSymmetricKey: async () => assert.fail('missing keys must stop before derivation'),
    encryptMessage: async () => assert.fail('missing keys must stop before encryption'),
    encryptFileForE2EE: async () => assert.fail('missing keys must stop before encryption'),
    requireE2EEKey: () => { throw missingKeyError; },
    sendMessage: async () => assert.fail('missing keys must stop before send')
  }), (error) => error === missingKeyError);
});

test('saved-message aliases cannot send offline personal text or files without E2EE keys', async () => {
  for (const alias of ['Избранное', 'Saved Messages', 'Saved Messages 🔖', 'saved_messages', '@saved-messages']) {
    const item = createOfflineQueueItem({
      chatId: 'personal-1', senderId: 'user-1', text: 'private text',
      optimisticId: 'spoofed-saved', hasOfflineMedia: true
    });
    await assert.rejects(() => processOfflineQueueItem(item, {
      chat: {
        type: 'personal', name: alias, username: alias, createdBy: 'user-1',
        members: [{ id: 'user-1' }, { id: 'user-2' }]
      },
      currentUser: { id: 'user-1' }, e2eePrivateKey: null, sharedKey: null,
      getAttachment: async () => assert.fail('key failure must precede reading or uploading the file'),
      sendMessage: async () => assert.fail('plaintext must not reach the send service')
    }), /ключ/i);
  }
});

test('verified, self-owned saved messages still send without a personal E2EE key', async () => {
  const sent = [];
  const item = createOfflineQueueItem({
    chatId: 'saved', senderId: 'user-1', text: 'my notes', optimisticId: 'saved-note'
  });
  const result = await processOfflineQueueItem(item, {
    chat: {
      type: 'personal', name: 'Renamed notes', createdBy: 'user-1',
      savedMessagesOwnerId: 'user-1', members: [{ id: 'user-1' }]
    },
    currentUser: { id: 'user-1' }, e2eePrivateKey: null, sharedKey: null,
    sendMessage: async (...args) => { sent.push(args); return { id: item.optimisticId }; }
  });
  assert.equal(result.data.id, 'saved-note');
  assert.equal(sent[0][2], 'my notes');
});

test('offline media surfaces upload errors other than deterministic 409 conflicts', async () => {
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: 'image',
    optimisticId: 'upload-error-1',
    hasOfflineMedia: true,
    mediaType: 'image'
  });
  const uploadError = { statusCode: 500, message: 'storage unavailable' };

  await assert.rejects(() => processOfflineQueueItem(item, {
    chat: { type: 'group', members: [] },
    currentUser: { id: 'user-1' },
    e2eePrivateKey: null,
    sharedKey: null,
    getAttachment: async () => new Blob(['image'], { type: 'image/webp' }),
    extensionForMedia: () => 'webp',
    storage: {
      from: () => ({ upload: async () => ({ error: uploadError }) })
    },
    sendMessage: async () => assert.fail('failed upload must stop before send')
  }), (error) => error === uploadError);
});

test('delivered messages remain successful when local attachment cleanup fails', async () => {
  const item = createOfflineQueueItem({
    chatId: 'group-1',
    senderId: 'user-1',
    text: 'image',
    optimisticId: 'cleanup-error-1',
    hasOfflineMedia: true,
    mediaType: 'image'
  });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    const result = await processOfflineQueueItem(item, {
      chat: { type: 'group', members: [] },
      currentUser: { id: 'user-1' },
      e2eePrivateKey: null,
      sharedKey: null,
      getAttachment: async () => new Blob(['image'], { type: 'image/webp' }),
      extensionForMedia: () => 'webp',
      storage: {
        from: () => ({ upload: async () => ({ error: null }) })
      },
      sendMessage: async () => ({ id: item.optimisticId }),
      deleteAttachment: async () => { throw new Error('IndexedDB cleanup failed'); }
    });

    assert.equal(result.data.id, item.optimisticId);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'Failed to delete delivered offline attachment:');
  } finally {
    console.error = originalError;
  }
});

test('isNetworkError detects the browser offline state without an exception message', () => {
  const originalNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false }
  });
  try {
    assert.equal(isNetworkError({}), true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    });
  }
});
