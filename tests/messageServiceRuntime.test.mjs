import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageService } from '../src/services/messageService.js';
import { createV1MessageCompatibilityAdapter } from '../src/services/v1MessageCompatibilityAdapter.js';
import { getMessageCursor } from '../src/utils/messageCursor.ts';

function createClient({
  resultFor = () => ({ data: null, error: null }),
  userResult = { data: { user: { id: 'auth-user' } }, error: null },
  rpcResult = { data: null, error: null }
} = {}) {
  const calls = [];
  const createQuery = (table) => {
    const steps = [];
    const query = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'lt', 'or', 'in', 'insert', 'delete', 'single']) {
      query[method] = (...args) => {
        const step = { method, args };
        steps.push(step);
        calls.push({ table, ...step });
        return query;
      };
    }
    query.then = (resolve, reject) => Promise.resolve(resultFor(table, steps)).then(resolve, reject);
    return query;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: async () => {
          calls.push({ method: 'getUser' });
          return userResult;
        }
      },
      from(table) {
        calls.push({ method: 'from', table });
        return createQuery(table);
      },
      async rpc(name, args) {
        calls.push({ method: 'rpc', name, args });
        return typeof rpcResult === 'function' ? rpcResult(name, args) : rpcResult;
      }
    }
  };
}

test('live message loading paginates, joins receipts, maps fields, and restores chronological order', async () => {
  const newer = {
    id: 'message-2',
    sender_id: 'user-2',
    text: null,
    media: null,
    media_path: 'chat/message-2.webp',
    crypto_version: 2,
    sender_device_id: 'device-2',
    encrypted_payload: '\\x0203',
    reply_to: 'message-1',
    read: false,
    reactions: [{ emoji: '👍', count: 1, users: ['reader-1'] }],
    created_at: '2026-08-20T12:00:00.000Z'
  };
  const older = {
    id: 'message-1',
    sender_id: 'user-1',
    text: 'hello',
    media: 'storage://chat-attachments/file.webp',
    media_path: null,
    crypto_version: null,
    sender_device_id: null,
    encrypted_payload: null,
    reply_to: null,
    read: true,
    reactions: null,
    created_at: '2026-08-20T11:00:00.000Z'
  };
  const { client, calls } = createClient({
    resultFor: (table) => table === 'messages'
      ? { data: [newer, older], error: null }
      : {
          data: [
            { message_id: 'message-2', profile_id: 'reader-1' },
            { message_id: 'message-2', profile_id: 'reader-2' }
          ],
          error: null
        }
  });
  const service = createMessageService({ client, configured: true, e2eeV2Enabled: false });
  const before = new Date('2026-08-20T13:00:00.000Z');

  const messages = await service.loadChatMessages('chat-1', 25, before);

  assert.deepEqual(messages.map(({ id }) => id), ['message-1', 'message-2']);
  assert.equal(messages[0].cryptoVersion, 1);
  assert.equal(messages[0].read, true);
  assert.deepEqual(messages[0].reactions, []);
  assert.ok(messages[0].timestamp instanceof Date);
  assert.equal(messages[1].requiresUpdate, true);
  assert.equal(messages[1].read, true);
  assert.deepEqual(messages[1].reads, ['reader-1', 'reader-2']);
  assert.equal(messages[1].mediaPath, 'chat/message-2.webp');
  assert.ok(calls.some((call) => call.table === 'messages' && call.method === 'eq'
    && call.args[0] === 'chat_id' && call.args[1] === 'chat-1'));
  assert.ok(calls.some((call) => call.table === 'messages' && call.method === 'limit'
    && call.args[0] === 25));
  assert.ok(calls.some((call) => call.table === 'messages' && call.method === 'lt'
    && call.args[1] === before.toISOString()));
  assert.ok(calls.some((call) => call.table === 'message_reads' && call.method === 'in'
    && call.args[0] === 'message_id'
    && call.args[1].join(',') === 'message-2,message-1'));
});

test('live message loading skips receipt query for an empty page and surfaces query errors', async () => {
  const empty = createClient({ resultFor: () => ({ data: [], error: null }) });
  const emptyService = createMessageService({ client: empty.client, configured: true });
  assert.deepEqual(await emptyService.loadChatMessages('chat-1'), []);
  assert.equal(empty.calls.filter((call) => call.table === 'message_reads').length, 0);

  const queryError = new Error('messages unavailable');
  const failed = createClient({ resultFor: () => ({ data: null, error: queryError }) });
  const failedService = createMessageService({ client: failed.client, configured: true });
  await assert.rejects(() => failedService.loadChatMessages('chat-1'), (error) => error === queryError);
});

test('mock message loading restores dates, limits history, and tolerates missing chats', async () => {
  const storage = {
    getItem(key) {
      assert.equal(key, 'tg-chats-mock');
      return JSON.stringify([{
        id: 'chat-1',
        messages: [
          { id: 'message-1', timestamp: '2026-08-20T10:00:00.000Z' },
          { id: 'message-2', timestamp: '2026-08-20T11:00:00.000Z' }
        ]
      }]);
    }
  };
  const service = createMessageService({ client: null, configured: false, storage });

  const messages = await service.loadChatMessages('chat-1', 1);
  assert.deepEqual(messages.map(({ id }) => id), ['message-2']);
  assert.ok(messages[0].timestamp instanceof Date);
  assert.deepEqual(await service.loadChatMessages('missing'), []);
});

test('live history pages visit every ID when more than one page shares a timestamp', async () => {
  const rows = Array.from({ length: 135 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    chat_id: 'chat-1', sender_id: 'peer', text: 'row',
    created_at: '2026-10-06T12:00:00.123456Z'
  })).reverse();
  const { client, calls } = createClient({
    resultFor(table, steps) {
      if (table !== 'messages') return { data: [], error: null };
      let page = [...rows];
      for (const { method, args } of steps) {
        if (method === 'lt') page = page.filter(row => row[args[0]] < args[1]);
        if (method === 'or') {
          const match = args[0].match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.(.+)\)$/);
          assert.ok(match, 'valid PostgREST compound filter required');
          const timestamp = JSON.parse(match[1]);
          assert.equal(JSON.parse(match[2]), timestamp);
          const id = JSON.parse(match[3]);
          page = page.filter(row => row.created_at < timestamp || (row.created_at === timestamp && row.id < id));
        }
      }
      const order = steps.filter(step => step.method === 'order');
      page.sort((left, right) => {
        for (const { args: [column, { ascending }] } of order) {
          if (left[column] !== right[column]) return (left[column] < right[column] ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
      return { data: page.slice(0, steps.find(step => step.method === 'limit').args[0]), error: null };
    }
  });
  const service = createMessageService({ client, configured: true });
  const ids = [];
  let cursor = null;
  for (let index = 0; index < 4; index++) {
    const page = await service.loadChatMessages('chat-1', index === 0 ? 100 : 30, cursor);
    ids.push(...page.map(row => row.id));
    if (!page.length) break;
    cursor = getMessageCursor(page[0]);
    assert.equal(cursor.timestamp, '2026-10-06T12:00:00.123456Z');
  }
  assert.equal(ids.length, rows.length);
  assert.equal(new Set(ids).size, rows.length);
  assert.deepEqual([...ids].sort(), rows.map(row => row.id).sort());
  assert.ok(calls.some(call => call.method === 'order' && call.args[0] === 'id'));
});

test('mock history uses the same compound cursor and keeps older timestamp-only callers working', async () => {
  const timestamp = '2026-10-06T12:00:00.123456Z';
  const storage = { getItem: () => JSON.stringify([{ id: 'chat-1', messages: [
    { id: 'a', timestamp: '2026-10-06T11:00:00Z' },
    ...['c', 'b', 'd'].map(id => ({ id, timestamp, createdAt: timestamp }))
  ] }]) };
  const service = createMessageService({ client: null, configured: false, storage });
  assert.deepEqual((await service.loadChatMessages('chat-1', 2)).map(row => row.id), ['c', 'd']);
  assert.deepEqual((await service.loadChatMessages('chat-1', 2, { id: 'c', timestamp })).map(row => row.id), ['a', 'b']);
  assert.deepEqual((await service.loadChatMessages('chat-1', 2, timestamp)).map(row => row.id), ['a']);
});

test('v2 send rejects malformed and mock-mode payloads before database access', async () => {
  const mockService = createMessageService({ client: null, configured: false });
  await assert.rejects(() => mockService.sendMessage(null), /Invalid CryptoEnvelopeV2/);
  await assert.rejects(() => mockService.sendMessage({ cryptoVersion: 1 }), /Invalid CryptoEnvelopeV2/);
  await assert.rejects(() => mockService.sendMessage({
    id: 'message-1',
    chatId: 'chat-1',
    cryptoVersion: 2,
    senderDeviceId: 'device-1',
    encryptedPayload: 'AQI='
  }), /unavailable in mock mode/);
});

test('v2 send trusts the authenticated user and writes only encrypted columns', async () => {
  const insertedRows = [];
  const { client, calls } = createClient({
    userResult: { data: { user: { id: 'authenticated-user' } }, error: null },
    resultFor: (_table, steps) => {
      const insert = steps.find((step) => step.method === 'insert');
      if (insert) insertedRows.push(insert.args[0]);
      return { data: { id: 'message-1' }, error: null };
    }
  });
  const service = createMessageService({ client, configured: true });

  const result = await service.sendMessage({
    id: 'message-1',
    chatId: 'chat-1',
    cryptoVersion: 2,
    senderDeviceId: 'device-1',
    encryptedPayload: 'AQI=',
    senderId: 'spoofed-user',
    text: 'must not be stored'
  });

  assert.deepEqual(result, { id: 'message-1' });
  assert.equal(calls.filter((call) => call.method === 'getUser').length, 1);
  assert.deepEqual(insertedRows, [{
    id: 'message-1',
    chat_id: 'chat-1',
    sender_id: 'authenticated-user',
    crypto_version: 2,
    sender_device_id: 'device-1',
    encrypted_payload: '\\x0102',
    text: null,
    media: null,
    media_path: null,
    reply_to: null,
    read: false,
    reactions: []
  }]);
});

test('v2 send preserves bytea hex and surfaces auth or insert failures', async () => {
  const authError = new Error('auth failed');
  const authFailure = createClient({ userResult: { data: { user: null }, error: authError } });
  const authService = createMessageService({ client: authFailure.client, configured: true });
  await assert.rejects(() => authService.sendMessage({
    id: 'message-1', chatId: 'chat-1', cryptoVersion: 2,
    senderDeviceId: 'device-1', encryptedPayload: '\\x0102'
  }), (error) => error === authError);

  const insertError = new Error('insert failed');
  const rows = [];
  const insertFailure = createClient({
    resultFor: (_table, steps) => {
      rows.push(steps.find((step) => step.method === 'insert').args[0]);
      return { data: null, error: insertError };
    }
  });
  const insertService = createMessageService({ client: insertFailure.client, configured: true });
  await assert.rejects(() => insertService.sendMessage({
    id: 'message-1', chatId: 'chat-1', cryptoVersion: 2,
    senderDeviceId: 'device-1', encryptedPayload: '\\x0102'
  }), (error) => error === insertError);
  assert.equal(rows[0].encrypted_payload, '\\x0102');
});

test('message mutations use scoped deletes and server-side RPCs', async () => {
  const rpcCalls = [];
  const { client, calls } = createClient({
    resultFor: () => ({ data: null, error: null }),
    rpcResult: (name, args) => {
      rpcCalls.push({ name, args });
      return { data: name === 'mark_chat_as_read' ? 3 : [{ emoji: '👍', count: 1 }], error: null };
    }
  });
  const service = createMessageService({ client, configured: true });

  assert.equal(await service.clearChatMessages('chat-1'), true);
  await service.deleteMessage('message-1');
  assert.deepEqual(await service.toggleReaction('message-1', '👍'), [{ emoji: '👍', count: 1 }]);
  assert.equal(await service.markMessagesAsRead('chat-1', 'ignored-user'), 3);

  assert.ok(calls.some((call) => call.method === 'delete' && call.table === 'messages'));
  assert.ok(calls.some((call) => call.method === 'eq' && call.args.join(',') === 'chat_id,chat-1'));
  assert.ok(calls.some((call) => call.method === 'eq' && call.args.join(',') === 'id,message-1'));
  assert.deepEqual(rpcCalls, [
    { name: 'toggle_message_reaction', args: { p_message_id: 'message-1', p_emoji: '👍' } },
    { name: 'mark_chat_as_read', args: { p_chat_id: 'chat-1' } }
  ]);
  await assert.rejects(() => service.toggleReaction('message-1', []), /requires an emoji string/);
});

test('message mutation failures are surfaced and mock mutations stay local', async () => {
  const mutationError = new Error('mutation failed');
  const failedDelete = createClient({ resultFor: () => ({ data: null, error: mutationError }) });
  const deleteService = createMessageService({ client: failedDelete.client, configured: true });
  await assert.rejects(() => deleteService.clearChatMessages('chat-1'), (error) => error === mutationError);
  await assert.rejects(() => deleteService.deleteMessage('message-1'), (error) => error === mutationError);

  const failedRpc = createClient({ rpcResult: { data: null, error: mutationError } });
  const rpcService = createMessageService({ client: failedRpc.client, configured: true });
  await assert.rejects(() => rpcService.toggleReaction('message-1', '👍'), (error) => error === mutationError);
  await assert.rejects(() => rpcService.markMessagesAsRead('chat-1'), (error) => error === mutationError);

  const mockService = createMessageService({ client: null, configured: false, storage: null });
  assert.equal(await mockService.clearChatMessages('chat-1'), true);
  assert.equal(await mockService.deleteMessage('message-1'), undefined);
  assert.deepEqual(await mockService.toggleReaction('message-1', [{ emoji: '👍' }]), [{ emoji: '👍' }]);
  assert.equal(await mockService.markMessagesAsRead('chat-1'), undefined);
});

test('legacy positional send preserves its stable id and database field mapping', async () => {
  const insertedRows = [];
  const { client } = createClient({
    resultFor: (_table, steps) => {
      insertedRows.push(steps.find((step) => step.method === 'insert').args[0]);
      return { data: { id: 'stable-id' }, error: null };
    }
  });
  const adapter = createV1MessageCompatibilityAdapter({ client, configured: true });

  const result = await adapter.sendMessage(
    'chat-1', 'user-1', 'hello', 'reply-1', 'storage://chat-attachments/file.webp', 'stable-id'
  );

  assert.deepEqual(result, { id: 'stable-id' });
  assert.deepEqual(insertedRows, [{
    id: 'stable-id',
    chat_id: 'chat-1',
    sender_id: 'user-1',
    text: 'hello',
    media: 'storage://chat-attachments/file.webp',
    reply_to: 'reply-1'
  }]);
});

test('legacy positional send creates deterministic mock bubbles and surfaces insert failures', async () => {
  const timestamp = new Date('2026-08-20T14:00:00.000Z');
  const mockAdapter = createV1MessageCompatibilityAdapter({
    client: null,
    configured: false,
    randomUUID: () => 'generated-id',
    now: () => timestamp
  });
  assert.deepEqual(await mockAdapter.sendMessage('chat-1', 'user-1', 'hello', null, null), {
    id: 'generated-id',
    senderId: 'user-1',
    senderName: 'Вы',
    text: 'hello',
    timestamp,
    replyTo: null,
    media: null,
    read: false,
    reactions: []
  });

  const insertError = new Error('insert failed');
  const failed = createClient({ resultFor: () => ({ data: null, error: insertError }) });
  const liveAdapter = createV1MessageCompatibilityAdapter({ client: failed.client, configured: true });
  await assert.rejects(
    () => liveAdapter.sendMessage('chat-1', 'user-1', 'hello', null, null, 'message-1'),
    (error) => error === insertError
  );
});
