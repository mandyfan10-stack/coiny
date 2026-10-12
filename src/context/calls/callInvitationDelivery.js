export const CALL_INVITATION_TTL_MS = 60_000;
export const CALL_INVITATION_RETRY_MS = 1_500;

/** Realtime broadcasts are ephemeral; a server ACK is not a peer receipt. */
export function createCallInvitationDelivery({
  send,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  let active = null;
  let timer = null;

  const stop = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    active = null;
  };
  const isCurrent = (chatId, callId) => active?.chatId === chatId
    && active.payload.callId === callId && active.payload.expiresAt > now();

  const attempt = async (invitation) => {
    if (active !== invitation) return;
    if (invitation.payload.expiresAt <= now()) { stop(); return; }
    // Keep the deadline running even if encryption or the transport stalls.
    timer = schedule(() => attempt(invitation), Math.min(
      CALL_INVITATION_RETRY_MS, invitation.payload.expiresAt - now()
    ));
    if (invitation.sending) return;
    invitation.sending = true;
    try {
      // Each attempt passes through secureCallChannel and creates a fresh
      // encrypted event, preserving the MLS and replay-protection semantics.
      await send(invitation.chatId, 'incoming-call', invitation.payload);
    } catch {
      // The transport reports the failure; keep retrying until the deadline.
    } finally {
      invitation.sending = false;
    }
  };

  return {
    start(chatId, payload, recipients) {
      stop();
      if (!payload.callId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now()) return;
      active = { chatId, payload, pending: new Set(recipients), sending: false };
      if (!active.pending.size) { stop(); return; }
      void attempt(active);
    },
    acknowledge(chatId, callId, responderId) {
      if (!isCurrent(chatId, callId)) return;
      active.pending.delete(responderId);
      if (!active.pending.size) stop();
    },
    isCurrent,
    stop
  };
}
