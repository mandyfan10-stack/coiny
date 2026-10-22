function sdpFingerprint(payload) {
  if (!payload?.sdp || typeof payload.sdp !== 'string') return null;
  return payload.sdp.match(/^a=fingerprint:([^\r\n]+)$/m)?.[1]?.trim() || null;
}

/**
 * Encrypt every v2 call broadcast as an MLS application event. The proxy keeps
 * the RealtimeChannel chaining API intact for existing call code.
 */
export function secureCallChannel(channel, {
  chatId,
  cryptoVersion,
  encryptEvent,
  decryptEvent,
  shouldSend = () => true
}) {
  if (cryptoVersion !== 2) return channel;

  const streamId = crypto.randomUUID();
  // A peer can keep its subscription while this client reloads or adds a chat.
  // Older peers only compare counters; randomize the start to avoid overlap.
  const counterSeed = crypto.getRandomValues(new Uint32Array(2));
  let sendCounter = (counterSeed[0] & 0x000fffff) * 0x100000000 + counterSeed[1];
  const replayWindows = new Map();
  let proxy;

  const protect = async (event, payload) => {
    sendCounter += 1;
    const envelope = await encryptEvent(chatId, 'call-signal', {
      event,
      payload,
      streamId,
      counter: sendCounter,
      dtlsFingerprint: sdpFingerprint(payload)
    });
    return { e2ee: 2, envelope };
  };

  const unprotect = async (expectedEvent, wrapped) => {
    if (wrapped?.e2ee !== 2 || !wrapped.envelope) throw new Error('Plaintext call signaling rejected for E2EE v2 chat.');
    if (wrapped.envelope.chatId !== chatId || wrapped.envelope.eventType !== 'call-signal') {
      throw new Error('Call signaling envelope is bound to another conversation.');
    }
    const decoded = await decryptEvent(wrapped.envelope);
    if (decoded?.event !== expectedEvent || !Number.isSafeInteger(decoded?.counter) || decoded.counter < 1) {
      throw new Error('Invalid call signaling event.');
    }
    if (decoded.streamId !== undefined && (typeof decoded.streamId !== 'string'
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decoded.streamId))) {
      throw new Error('Invalid call signaling stream.');
    }
    const sender = wrapped.envelope.senderDeviceId;
    const replayId = JSON.stringify([decoded.streamId ?? null, decoded.counter]);
    const seen = replayWindows.get(sender) || [];
    if (seen.includes(replayId)) throw new Error('Replayed call signaling event.');
    seen.push(replayId);
    if (seen.length > 256) seen.shift();
    replayWindows.set(sender, seen);
    if (decoded.dtlsFingerprint !== sdpFingerprint(decoded.payload)) {
      throw new Error('DTLS fingerprint binding mismatch.');
    }
    return decoded.payload;
  };

  proxy = new Proxy(channel, {
    get(target, property) {
      if (property === 'send') {
        return async (message) => {
          if (message?.type !== 'broadcast') return target.send(message);
          const payload = await protect(message.event, message.payload);
          // Cancellation can happen while the worker is encrypting an invite.
          if (!shouldSend(message)) return 'cancelled';
          return target.send({ ...message, payload });
        };
      }
      if (property === 'on') {
        return (type, filter, callback) => {
          if (type !== 'broadcast') {
            target.on(type, filter, callback);
          } else {
            target.on(type, filter, async (message) => {
              try {
                const payload = await unprotect(filter.event, message.payload);
                await callback({ ...message, payload });
              } catch (error) {
                console.error('Rejected call signaling event:', error instanceof Error ? error.message : 'invalid event');
              }
            });
          }
          return proxy;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  return proxy;
}
