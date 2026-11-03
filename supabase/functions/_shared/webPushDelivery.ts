export interface PushRecipient { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string }

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && (
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
    );
  } catch { return false; }
}

export async function matchesPushSecret(candidate: string, expected: string): Promise<boolean> {
  if (expected.length < 32 || candidate.length > 1024) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(candidate)), crypto.subtle.digest('SHA-256', encode(expected))
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function deliverPushBatch(recipients: readonly PushRecipient[], message: { id: string; chat_id: string }, deps: {
  send: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}): Promise<{ delivered: number; failed: number }> {
  let delivered = 0, failed = 0;
  // Bound concurrent outbound requests and never log endpoints or key material.
  for (let offset = 0; offset < recipients.length; offset += 10) {
    await Promise.all(recipients.slice(offset, offset + 10).map(async recipient => {
      if (!isAllowedPushEndpoint(recipient.endpoint)) { failed += 1; return; }
      try {
        await deps.send({ endpoint: recipient.endpoint, keys: { p256dh: recipient.p256dh, auth: recipient.auth } }, JSON.stringify({
          data: { ownerId: recipient.owner_id, chatId: message.chat_id, messageId: message.id }
        }));
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) await deps.remove(recipient.id);
        failed += 1;
      }
    }));
  }
  return { delivered, failed };
}
