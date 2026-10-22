import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachRemoteAudioElement,
  isScreenTrack,
  removeVideoSender,
  replaceOrAddVideoTrack,
  stopStreamTracks
} from '../src/context/calls/mediaTrackHelpers.js';
import { secureCallChannel } from '../src/context/calls/secureCallChannel.js';
import {
  ICE_SERVERS,
  createPeerConnection,
  getIceConfiguration,
  refreshIceConfiguration
} from '../src/context/calls/iceServers.ts';

function createChannel() {
  const sent = [];
  const listeners = [];
  const channel = {
    marker: 'channel-value',
    async send(message) {
      sent.push(message);
      return 'sent';
    },
    on(type, filter, callback) {
      listeners.push({ type, filter, callback });
      return channel;
    },
    subscribe(callback) {
      callback?.('SUBSCRIBED');
      return channel;
    }
  };
  return { channel, listeners, sent };
}

test('screen-track detection handles browser labels without false positives', () => {
  for (const label of ['Screen 1', 'WINDOW capture', 'Display Media', 'desktop']) {
    assert.equal(isScreenTrack({ label }), true, label);
  }
  assert.equal(isScreenTrack({ label: 'FaceTime HD Camera' }), false);
  assert.equal(isScreenTrack({}), false);
});

test('video sender helpers remove, replace, or add the active video track', async () => {
  const audioSender = { track: { kind: 'audio' } };
  const oldVideoTrack = { kind: 'video', id: 'old-video' };
  const newVideoTrack = { kind: 'video', id: 'new-video' };
  const replacements = [];
  const videoSender = {
    track: oldVideoTrack,
    async replaceTrack(track) {
      replacements.push(track);
    }
  };
  const removed = [];
  const added = [];
  const stream = { id: 'camera-stream' };
  const connection = {
    getSenders: () => [audioSender, videoSender],
    removeTrack: (sender) => removed.push(sender),
    addTrack: (...args) => added.push(args)
  };

  removeVideoSender(connection);
  await replaceOrAddVideoTrack(connection, newVideoTrack, stream);

  assert.deepEqual(removed, [videoSender]);
  assert.deepEqual(replacements, [newVideoTrack]);
  assert.deepEqual(added, []);

  const connectionWithoutVideo = {
    getSenders: () => [audioSender],
    removeTrack: () => assert.fail('audio sender must not be removed'),
    addTrack: (...args) => added.push(args)
  };
  removeVideoSender(connectionWithoutVideo);
  await replaceOrAddVideoTrack(connectionWithoutVideo, newVideoTrack, stream);
  assert.deepEqual(added, [[newVideoTrack, stream]]);
});

test('stream teardown stops every track and accepts an absent stream', () => {
  const stopped = [];
  stopStreamTracks(null);
  stopStreamTracks({
    getTracks: () => [
      { stop: () => stopped.push('audio') },
      { stop: () => stopped.push('video') }
    ]
  });
  assert.deepEqual(stopped, ['audio', 'video']);
});

test('remote audio attachment creates one reusable autoplay element', () => {
  const elements = new Map();
  const appended = [];
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tagName) => {
      assert.equal(tagName, 'audio');
      return { play: () => undefined };
    },
    body: {
      appendChild: (element) => {
        elements.set(element.id, element);
        appended.push(element);
      }
    }
  };
  globalThis.window = {};

  try {
    const firstStream = { id: 'remote-1' };
    const secondStream = { id: 'remote-2' };
    const first = attachRemoteAudioElement('remote-audio', firstStream);
    const second = attachRemoteAudioElement('remote-audio', secondStream);

    assert.equal(first, second);
    assert.equal(appended.length, 1);
    assert.equal(first.autoplay, true);
    assert.equal(first.playsInline, true);
    assert.equal(first.className, 'webrtc-remote-audio-feed');
    assert.equal(first.muted, false);
    assert.equal(first.volume, 1);
    assert.equal(first.srcObject, secondStream);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('remote audio attachment retries autoplay after a user gesture', async () => {
  const listeners = new Map();
  const removed = [];
  let playCalls = 0;
  const audioElement = {
    play() {
      playCalls += 1;
      return playCalls === 1 ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve();
    }
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalWarn = console.warn;
  globalThis.document = {
    getElementById: () => null,
    createElement: () => audioElement,
    body: { appendChild() {} }
  };
  globalThis.window = {
    addEventListener: (type, callback, options) => listeners.set(type, { callback, options }),
    removeEventListener: (type, callback) => removed.push({ type, callback })
  };
  console.warn = () => {};

  try {
    attachRemoteAudioElement('remote-audio', { id: 'stream' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual([...listeners.keys()], ['click', 'touchstart', 'keydown']);
    assert.equal(listeners.get('click').options.once, true);
    listeners.get('click').callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(playCalls, 2);
    assert.deepEqual(removed.map(({ type }) => type), ['click', 'touchstart', 'keydown']);
    assert.ok(removed.every(({ callback }) => callback === listeners.get('click').callback));
  } finally {
    console.warn = originalWarn;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('legacy call channels remain untouched', () => {
  const { channel } = createChannel();
  assert.equal(secureCallChannel(channel, { chatId: 'chat-1', cryptoVersion: 1 }), channel);
});

test('ICE configuration falls back to STUN with direct connectivity enabled', async () => {
  const configuration = await refreshIceConfiguration();
  assert.equal(configuration, getIceConfiguration());
  assert.equal(configuration.iceTransportPolicy, 'all');
  assert.equal(configuration.iceServers, ICE_SERVERS);
  assert.ok(ICE_SERVERS.length > 0);
  assert.ok(ICE_SERVERS.every(({ urls }) => String(urls).startsWith('stun:')));
});

test('peer connections use the latest ICE configuration', () => {
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const constructedWith = [];
  class MockPeerConnection {
    constructor(configuration) {
      constructedWith.push(configuration);
    }
  }
  globalThis.RTCPeerConnection = MockPeerConnection;

  try {
    const connection = createPeerConnection();
    assert.ok(connection instanceof MockPeerConnection);
    assert.deepEqual(constructedWith, [getIceConfiguration()]);
  } finally {
    globalThis.RTCPeerConnection = originalPeerConnection;
  }
});

test('ICE configuration accepts only authenticated TURN servers and defaults to relay-only', async () => {
  const calls = [];
  const credentialClient = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return {
          data: {
            available: true,
            iceServers: [
              { urls: 'turn:relay.example.test:3478', username: 'alice', credential: 'secret-1' },
              {
                urls: ['turns:relay.example.test:5349', 'stun:ignored.example.test'],
                username: 'bob',
                credential: 'secret-2'
              },
              { urls: 'stun:not-a-relay.example.test', username: 'user', credential: 'secret' },
              { urls: 'turn:missing-credential.example.test', username: 'user' },
              null
            ]
          },
          error: null
        };
      }
    }
  };

  const relayOnly = await refreshIceConfiguration({}, credentialClient);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'turn-credentials');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(relayOnly.iceTransportPolicy, 'relay');
  assert.deepEqual(relayOnly.iceServers.slice(ICE_SERVERS.length), [
    { urls: ['turn:relay.example.test:3478'], username: 'alice', credential: 'secret-1' },
    { urls: ['turns:relay.example.test:5349'], username: 'bob', credential: 'secret-2' }
  ]);

  const directAllowed = await refreshIceConfiguration({ allowDirectConnection: true }, credentialClient);
  assert.equal(directAllowed.iceTransportPolicy, 'all');
  assert.equal(directAllowed.iceServers.length, ICE_SERVERS.length + 2);
});

test('ICE configuration safely falls back when credentials fail', async () => {
  const errorClient = {
    functions: { invoke: async () => ({ data: null, error: new Error('unavailable') }) }
  };
  const throwingClient = {
    functions: { invoke: async () => { throw new Error('network failure'); } }
  };

  for (const client of [errorClient, throwingClient]) {
    const configuration = await refreshIceConfiguration({}, client);
    assert.equal(configuration.iceTransportPolicy, 'all');
    assert.equal(configuration.iceServers, ICE_SERVERS);
  }
});

test('v2 call channel encrypts broadcasts and preserves the channel API', async () => {
  const { channel, listeners, sent } = createChannel();
  const encrypted = [];
  const proxy = secureCallChannel(channel, {
    chatId: 'chat-1',
    cryptoVersion: 2,
    encryptEvent: async (chatId, eventType, payload) => {
      encrypted.push({ chatId, eventType, payload });
      return { cipherText: `encrypted-${payload.counter}` };
    },
    decryptEvent: async () => assert.fail('decrypt must not run while sending')
  });

  assert.equal(proxy.marker, 'channel-value');
  assert.equal(proxy.subscribe(() => {}), channel);
  assert.equal(proxy.on('presence', { event: 'sync' }, () => {}), proxy);
  assert.equal(listeners[0].type, 'presence');

  const presence = { type: 'presence', event: 'track', payload: { online: true } };
  await proxy.send(presence);
  assert.equal(sent[0], presence);

  const offer = {
    type: 'broadcast',
    event: 'offer',
    payload: { sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n' }
  };
  await proxy.send(offer);
  await proxy.send({ ...offer, event: 'answer' });

  const { counter, streamId } = encrypted[0].payload;
  assert.ok(Number.isSafeInteger(counter) && counter > 0);
  assert.match(streamId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);

  assert.deepEqual(encrypted, [
    {
      chatId: 'chat-1',
      eventType: 'call-signal',
      payload: {
        event: 'offer',
        payload: offer.payload,
        streamId,
        counter,
        dtlsFingerprint: 'sha-256 AA:BB'
      }
    },
    {
      chatId: 'chat-1',
      eventType: 'call-signal',
      payload: {
        event: 'answer',
        payload: offer.payload,
        streamId,
        counter: counter + 1,
        dtlsFingerprint: 'sha-256 AA:BB'
      }
    }
  ]);
  assert.deepEqual(sent.slice(1), [
    { ...offer, payload: { e2ee: 2, envelope: { cipherText: `encrypted-${counter}` } } },
    { ...offer, event: 'answer', payload: { e2ee: 2, envelope: { cipherText: `encrypted-${counter + 1}` } } }
  ]);
});

test('v2 call channel decrypts a bound signaling event exactly once', async () => {
  const { channel, listeners } = createChannel();
  const received = [];
  const proxy = secureCallChannel(channel, {
    chatId: 'chat-1',
    cryptoVersion: 2,
    encryptEvent: async () => assert.fail('encrypt must not run while receiving'),
    decryptEvent: async (envelope) => envelope.decoded
  });
  assert.equal(proxy.on('broadcast', { event: 'offer' }, (message) => received.push(message)), proxy);

  const payload = { sdp: 'v=0\r\na=fingerprint:sha-256 11:22\r\n' };
  const envelope = {
    chatId: 'chat-1',
    eventType: 'call-signal',
    senderDeviceId: 'device-a',
    decoded: {
      event: 'offer',
      payload,
      counter: 1,
      dtlsFingerprint: 'sha-256 11:22'
    }
  };
  await listeners[0].callback({ payload: { e2ee: 2, envelope }, transport: 'realtime' });

  assert.deepEqual(received, [{ payload, transport: 'realtime' }]);
});

test('v2 call channel checks cancellation after asynchronous encryption', async () => {
  const { channel, sent } = createChannel();
  let cancelled = false;
  let finish;
  const proxy = secureCallChannel(channel, {
    chatId: 'chat-1', cryptoVersion: 2,
    encryptEvent: () => new Promise((resolve) => { finish = resolve; }),
    decryptEvent: async () => ({}),
    shouldSend: () => !cancelled
  });
  const sending = proxy.send({ type: 'broadcast', event: 'incoming-call', payload: { callId: 'call-1' } });
  cancelled = true;
  finish({ cipherText: 'encrypted' });
  assert.equal(await sending, 'cancelled');
  assert.equal(sent.length, 0);
});

test('v2 call channel rejects plaintext, replayed, cross-chat, and fingerprint-mismatched events', async () => {
  const { channel, listeners } = createChannel();
  const received = [];
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const proxy = secureCallChannel(channel, {
    chatId: 'chat-1',
    cryptoVersion: 2,
    encryptEvent: async () => ({}),
    decryptEvent: async (envelope) => envelope.decoded
  });
  proxy.on('broadcast', { event: 'offer' }, (message) => received.push(message));
  const listener = listeners[0].callback;
  const payload = { sdp: 'a=fingerprint:sha-256 AA:BB\r\n' };
  const validEnvelope = {
    chatId: 'chat-1',
    eventType: 'call-signal',
    senderDeviceId: 'device-a',
    decoded: { event: 'offer', payload, counter: 7, dtlsFingerprint: 'sha-256 AA:BB' }
  };

  try {
    await listener({ payload });
    await listener({ payload: { e2ee: 2, envelope: { ...validEnvelope, chatId: 'chat-2' } } });
    await listener({
      payload: {
        e2ee: 2,
        envelope: {
          ...validEnvelope,
          decoded: { ...validEnvelope.decoded, event: 'answer', counter: 6 }
        }
      }
    });
    await listener({ payload: { e2ee: 2, envelope: validEnvelope } });
    await listener({ payload: { e2ee: 2, envelope: validEnvelope } });
    await listener({
      payload: {
        e2ee: 2,
        envelope: {
          ...validEnvelope,
          decoded: { ...validEnvelope.decoded, counter: 8, dtlsFingerprint: 'sha-256 FF:FF' }
        }
      }
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(received.length, 1);
  assert.equal(errors.length, 5);
  assert.match(errors[0], /Plaintext call signaling rejected/);
  assert.match(errors[1], /bound to another conversation/);
  assert.match(errors[2], /Invalid call signaling event/);
  assert.match(errors[3], /Replayed call signaling event/);
  assert.match(errors[4], /DTLS fingerprint binding mismatch/);
});

test('fresh v2 streams from a recreated sender reach an unchanged receiver', async () => {
  const { channel, listeners } = createChannel();
  const received = [];
  const receiver = secureCallChannel(channel, {
    chatId: 'chat-1', cryptoVersion: 2,
    encryptEvent: async () => assert.fail('receiver must not encrypt'),
    decryptEvent: async envelope => envelope.decoded
  });
  receiver.on('broadcast', { event: 'incoming-call' }, message => received.push(message.payload.callId));
  const streams = new Set();
  for (let recreation = 0; recreation < 3; recreation++) {
    const { channel: transport, sent } = createChannel();
    const sender = secureCallChannel(transport, {
      chatId: 'chat-1', cryptoVersion: 2,
      encryptEvent: async (chatId, eventType, decoded) => ({ chatId, eventType, senderDeviceId: 'same-device', decoded }),
      decryptEvent: async () => assert.fail('sender must not decrypt')
    });
    await sender.send({ type: 'broadcast', event: 'incoming-call', payload: { callId: `call-${recreation}` } });
    streams.add(sent[0].payload.envelope.decoded.streamId);
    await listeners[0].callback(sent[0]);
  }
  assert.deepEqual(received, ['call-0', 'call-1', 'call-2']);
  assert.equal(streams.size, 3);
});

test('v2 stream replay windows bind counters to both the stream and sender device, while accepting legacy events', async () => {
  const { channel, listeners } = createChannel();
  const received = [], errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    secureCallChannel(channel, {
      chatId: 'chat-1', cryptoVersion: 2,
      encryptEvent: async () => ({}), decryptEvent: async envelope => envelope.decoded
    }).on('broadcast', { event: 'incoming-call' }, message => received.push(message.payload.callId));
    const deliver = (senderDeviceId, streamId, callId) => listeners[0].callback({ payload: { e2ee: 2, envelope: {
      chatId: 'chat-1', eventType: 'call-signal', senderDeviceId,
      decoded: { event: 'incoming-call', payload: { callId }, counter: 1, dtlsFingerprint: null,
        ...(streamId === undefined ? {} : { streamId }) }
    } } });
    const first = 'a36c3235-d19d-43a0-b95a-a00512c30224';
    const second = 'bf09ce84-0160-43ac-baa8-a185610a0482';
    await deliver('device-a', first, 'first-stream');
    await deliver('device-a', first, 'replayed-first-stream');
    await deliver('device-a', second, 'second-stream');
    await deliver('device-a', second, 'replayed-second-stream');
    await deliver('device-b', first, 'another-device');
    await deliver('device-a', undefined, 'legacy');
    await deliver('device-a', undefined, 'replayed-legacy');
    for (const invalid of ['', null, 4, {}, 'not-a-session']) await deliver('device-a', invalid, 'invalid');
    assert.deepEqual(received, ['first-stream', 'second-stream', 'another-device', 'legacy']);
    assert.equal(errors.filter(error => error.includes('Replayed call signaling event.')).length, 3);
    assert.equal(errors.filter(error => error.includes('Invalid call signaling stream.')).length, 5);
  } finally { console.error = originalError; }
});

test('recreated v2 senders remain compatible with receivers using the legacy counter-only window', async () => {
  const legacySeen = Array.from({ length: 256 }, (_, index) => index + 1);
  const accepted = [];
  for (let recreation = 0; recreation < 3; recreation++) {
    const { channel, sent } = createChannel();
    const sender = secureCallChannel(channel, {
      chatId: 'chat-1', cryptoVersion: 2,
      encryptEvent: async (_chatId, _type, decoded) => ({ decoded }),
      decryptEvent: async () => ({})
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await sender.send({ type: 'broadcast', event: 'incoming-call', payload: { callId: `call-${recreation}` } });
      const counter = sent.at(-1).payload.envelope.decoded.counter;
      assert.ok(Number.isSafeInteger(counter) && counter > 0);
      assert.equal(legacySeen.includes(counter), false);
      legacySeen.push(counter);
      if (legacySeen.length > 256) legacySeen.shift();
      accepted.push(counter);
    }
  }
  assert.equal(new Set(accepted).size, 9);
  for (let index = 0; index < accepted.length; index += 3) {
    assert.equal(accepted[index + 1], accepted[index] + 1);
    assert.equal(accepted[index + 2], accepted[index] + 2);
  }
});
