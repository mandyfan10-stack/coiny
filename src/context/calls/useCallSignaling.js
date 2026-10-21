import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { dataService } from '../../services/dataLayer';
import { secureCallChannel } from './secureCallChannel';
import { createCallInvitationDelivery } from './callInvitationDelivery';

const BUSY_CALL_STATUSES = new Set(['calling', 'incoming', 'connected']);

/**
 * Private chat-scoped call signaling (incoming / accepted / rejected) + queue flush.
 * @param {{ onRemoteEnd?: () => void }} options onRemoteEnd tears down media when peer rejects.
 */
export function useCallSignaling({
  currentUser,
  chats,
  signalingChannelKey,
  callState,
  setCallState,
  onRemoteEnd,
  encryptEvent,
  decryptEvent
}) {
  const globalSignalingChannelRef = useRef(null);
  const pendingSignalingMessagesRef = useRef(new Map());
  const onRemoteEndRef = useRef(onRemoteEnd);
  const chatsRef = useRef(chats);
  const encryptEventRef = useRef(encryptEvent);
  const decryptEventRef = useRef(decryptEvent);
  const callStateRef = useRef(callState);
  const invitationDeliveryRef = useRef(null);
  const endedInvitationsRef = useRef(new Map());
  const accountRef = useRef(currentUser?.id);
  accountRef.current = currentUser?.id;
  onRemoteEndRef.current = onRemoteEnd;
  chatsRef.current = chats;
  encryptEventRef.current = encryptEvent;
  decryptEventRef.current = decryptEvent;
  callStateRef.current = callState;
  const currentUserId = currentUser?.id;

  const acceptedIsCurrent = useCallback((chatId, payload) => {
    const active = callStateRef.current;
    const queued = pendingSignalingMessagesRef.current.get(chatId)?.some(item => item.event === 'call-accepted'
      && item.payload === payload && item.expiresAt > Date.now() && item.accountId === accountRef.current);
    return queued && accountRef.current === payload.responderId && active?.chatId === chatId
      && active.callId === payload.callId && ['incoming', 'connected'].includes(active.status)
      && (!payload.targetId || active.otherUserId === payload.targetId);
  }, []);
  const terminalIsCurrent = useCallback((chatId, payload) => {
    const active = callStateRef.current;
    return !BUSY_CALL_STATUSES.has(active?.status)
      || (active.chatId === chatId && active.callId === payload.callId);
  }, []);

  const transmit = useCallback(async (chatId, event, payload) => {
    const channels = globalSignalingChannelRef.current || [];
    const channel = channels.find((item) => item.topic === `realtime:call:chat:${chatId}`);
    if (channel?.callSubscriptionStatus !== 'SUBSCRIBED') return false;
    if (event === 'incoming-call' && !invitationDeliveryRef.current.isCurrent(chatId, payload.callId)) return true;
    if (event === 'call-accepted' && !acceptedIsCurrent(chatId, payload)) return true;
    if (event === 'call-rejected' && !terminalIsCurrent(chatId, payload)) return true;
    try {
      const result = await channel.send({ type: 'broadcast', event, payload });
      if (result === 'cancelled') return event === 'incoming-call';
      if (result !== 'ok') throw new Error('Call signaling transport did not acknowledge the broadcast.');
      return true;
    } catch (error) {
      console.error('Failed to send call signaling message:', error instanceof Error ? error.message : 'transport failure');
      return false;
    }
  }, [acceptedIsCurrent, terminalIsCurrent]);

  if (!invitationDeliveryRef.current) {
    invitationDeliveryRef.current = createCallInvitationDelivery({ send: transmit });
  }

  const flushPending = useCallback(async (chatId) => {
    const pending = pendingSignalingMessagesRef.current.get(chatId) || [];
    for (const item of pending) {
      if (item.sending || item.expiresAt <= Date.now()) continue;
      item.sending = true;
      if (item.accountId !== accountRef.current || (item.event === 'call-accepted' && !acceptedIsCurrent(chatId, item.payload))) {
        item.expiresAt = 0;
      } else if (await transmit(chatId, item.event, item.payload)) {
        // A server ACK only confirms arrival at Realtime. Keep acceptance alive
        // until the inviting application confirms it has processed this call.
        if (item.event !== 'call-accepted') item.expiresAt = 0;
      }
      item.sending = false;
    }
    // Read the current queue: another event may have arrived during encryption.
    const remaining = (pendingSignalingMessagesRef.current.get(chatId) || [])
      .filter((item) => item.expiresAt > Date.now());
    if (remaining.length) pendingSignalingMessagesRef.current.set(chatId, remaining);
    else pendingSignalingMessagesRef.current.delete(chatId);
  }, [transmit, acceptedIsCurrent]);
  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;

  const sendSignalingMessage = useCallback((chatId, event, payload) => {
    if (!dataService.isLive() || !chatId) return;
    if (event === 'incoming-call') {
      const chat = chatsRef.current.find((item) => item.id === chatId);
      const recipients = (chat?.members || [])
        .map((member) => member.id).filter((id) => id !== payload.callerId && id !== 'current');
      invitationDeliveryRef.current.start(chatId, payload, recipients);
      return;
    }
    if (event === 'call-rejected') {
      invitationDeliveryRef.current.stop();
      if (payload.callId) endedInvitationsRef.current.set(payload.callId, Date.now() + 60_000);
    }
    if (event === 'call-accepted') payload = { ...payload, targetId: callStateRef.current?.otherUserId };
    const pending = pendingSignalingMessagesRef.current.get(chatId) || [];
    if (!pending.some((item) => item.event === event && item.payload.callId === payload.callId
      && item.payload.responderId === payload.responderId && item.payload.senderId === payload.senderId)) {
      pending.push({ event, payload, accountId: accountRef.current,
        expiresAt: Date.now() + (event === 'call-accepted' ? 60_000 : 10_000), sending: false });
    }
    pendingSignalingMessagesRef.current.set(chatId, pending);
    void flushPending(chatId);
  }, [flushPending]);
  const sendSignalingMessageRef = useRef(sendSignalingMessage);
  sendSignalingMessageRef.current = sendSignalingMessage;

  useEffect(() => {
    const delivery = invitationDeliveryRef.current;
    const pending = pendingSignalingMessagesRef.current;
    const ended = endedInvitationsRef.current;
    const timer = setInterval(() => {
      for (const chatId of pendingSignalingMessagesRef.current.keys()) void flushPending(chatId);
    }, 1_500);
    return () => {
      clearInterval(timer);
      delivery.stop();
      pending.clear();
      ended.clear();
    };
  }, [currentUserId, flushPending]);

  const callStatus = callState?.status;
  const callId = callState?.callId;
  const otherUserId = callState?.otherUserId;
  const crossDialAccepted = callState?.crossDialAccepted;
  useEffect(() => {
    if (crossDialAccepted && callStatus === 'connected' && callId && currentUserId) {
      sendSignalingMessage(callState.chatId, 'call-accepted', { responderId: currentUserId, callId });
    }
  }, [crossDialAccepted, callStatus, callId, currentUserId, callState?.chatId, sendSignalingMessage]);
  useEffect(() => {
    if (!callStatus || ['idle', 'ended'].includes(callStatus)
      || (callStatus === 'connected' && otherUserId)) {
      invitationDeliveryRef.current.stop();
    }
    for (const [chatId, items] of pendingSignalingMessagesRef.current) {
      const current = items.filter(item => item.event !== 'call-accepted' || acceptedIsCurrent(chatId, item.payload));
      if (current.length) pendingSignalingMessagesRef.current.set(chatId, current);
      else pendingSignalingMessagesRef.current.delete(chatId);
    }
  }, [callStatus, callId, otherUserId, acceptedIsCurrent]);

  useEffect(() => {
    const previousChannels = Array.isArray(globalSignalingChannelRef.current)
      ? globalSignalingChannelRef.current
      : globalSignalingChannelRef.current ? [globalSignalingChannelRef.current] : [];
    previousChannels.forEach((channel) => channel.unsubscribe());
    globalSignalingChannelRef.current = [];

    if (!dataService.isLive() || !currentUserId) return;

    const channels = chatsRef.current.map((chat) => {
      const signalingChannel = secureCallChannel(
        supabase.channel(`call:chat:${chat.id}`, { config: { private: true, broadcast: { ack: true } } }),
        {
          chatId: chat.id,
          cryptoVersion: chat.cryptoVersion,
          encryptEvent: (...args) => encryptEventRef.current(...args),
          decryptEvent: (...args) => decryptEventRef.current(...args),
          shouldSend: (message) => accountRef.current === currentUserId && globalSignalingChannelRef.current.includes(signalingChannel)
            && (message.event !== 'incoming-call'
              || invitationDeliveryRef.current.isCurrent(chat.id, message.payload.callId))
            && (message.event !== 'call-accepted' || acceptedIsCurrent(chat.id, message.payload))
            && (message.event !== 'call-rejected' || terminalIsCurrent(chat.id, message.payload))
        }
      );
      signalingChannel
        .on('broadcast', { event: 'incoming-call' }, (payload) => {
          if (accountRef.current !== currentUserId || !globalSignalingChannelRef.current.includes(signalingChannel)) return;
          const {
            callerId,
            callerName,
            callerAvatar,
            callerAvatarColor,
            chatId,
            callId,
            expiresAt
          } = payload.payload || {};
          const chatRecord = chatsRef.current.find((candidate) => candidate.id === chat.id);
          const caller = chatRecord?.members?.find((member) => member.id === callerId);
          if (!chatId || chatId !== chat.id || !caller || callerId === currentUserId) return;
          for (const [id, deadline] of endedInvitationsRef.current) {
            if (deadline <= Date.now()) endedInvitationsRef.current.delete(id);
          }
          if (callId && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()
            || endedInvitationsRef.current.has(callId))) return;
          if (callId) sendSignalingMessageRef.current(chatId, 'call-received', { callId, responderId: currentUserId });
          // Busy guard: never clobber an active call (C2).
          setCallState((prev) => {
            // Two users may dial each other before either invitation arrives.
            // Keep the lower caller id's invitation on both clients. Both have
            // already asked to call, so the yielding client accepts that call.
            const crossDial = chatRecord.type === 'personal' && prev.status === 'calling'
              && prev.isOutgoing && prev.chatId === chatId && prev.otherUserId === callerId
              && callId && prev.callId && callId !== prev.callId;
            const acceptCrossDial = crossDial && String(callerId) < String(currentUserId);
            if (BUSY_CALL_STATUSES.has(prev.status) && !acceptCrossDial) return prev;
            return {
              status: acceptCrossDial ? 'connected' : 'incoming',
              ...(acceptCrossDial ? { crossDialAccepted: true } : {}),
              ownerId: currentUserId,
              chatId,
              callId,
              expiresAt,
              duration: 0,
              muted: false,
              isOutgoing: false,
              callerInfo: {
                name: caller.name || callerName,
                avatar: caller.avatar || callerAvatar,
                avatarColor: caller.avatarColor || callerAvatarColor
              },
              otherUserId: callerId,
              webrtcState: acceptCrossDial ? 'connecting' : 'disconnected',
              isRemoteScreenSharing: false,
              isLocalSpeaking: false,
              isRemoteSpeaking: false
            };
          });
        })
        .on('broadcast', { event: 'call-received' }, ({ payload }) => {
          if (accountRef.current !== currentUserId || !globalSignalingChannelRef.current.includes(signalingChannel)) return;
          if (!chatsRef.current.find((item) => item.id === chat.id)?.members?.some((member) => member.id === payload?.responderId)) return;
          invitationDeliveryRef.current.acknowledge(chat.id, payload.callId, payload.responderId);
        })
        .on('broadcast', { event: 'call-accepted' }, (payload) => {
          if (accountRef.current !== currentUserId || !globalSignalingChannelRef.current.includes(signalingChannel)) return;
          const { responderId, callId, targetId } = payload.payload || {};
          if (targetId && targetId !== currentUserId) return;
          const chatRecord = chatsRef.current.find((candidate) => candidate.id === chat.id);
          if (!chatRecord?.members?.some((member) => member.id === responderId) || responderId === currentUserId) return;
          const active = callStateRef.current;
          if (active?.chatId !== chat.id || (callId && active.callId !== callId)
            || !['calling', 'connected'].includes(active.status)
            || (active.otherUserId && active.otherUserId !== responderId)) return;
          if (chatRecord.type === 'group') invitationDeliveryRef.current.acknowledge(chat.id, callId, responderId);
          else invitationDeliveryRef.current.stop();
          sendSignalingMessageRef.current(chat.id, 'call-accepted-received', { callId, responderId, senderId: currentUserId });
          setCallState((prev) => (prev.status === 'calling' && prev.chatId === chat.id
            && (!callId || prev.callId === callId)
            ? { ...prev, status: 'connected', otherUserId: responderId || prev.otherUserId }
            : prev));
        })
        .on('broadcast', { event: 'call-accepted-received' }, ({ payload }) => {
          if (accountRef.current !== currentUserId || !globalSignalingChannelRef.current.includes(signalingChannel) || !payload
            || payload.responderId !== currentUserId) return;
          const member = chatsRef.current.find(item => item.id === chat.id)?.members?.some(item => item.id === payload.senderId);
          if (!member || payload.senderId === currentUserId) return;
          const pending = pendingSignalingMessagesRef.current.get(chat.id) || [];
          for (const item of pending) {
            if (item.event === 'call-accepted' && item.payload.callId === payload.callId
              && (!item.payload.targetId || item.payload.targetId === payload.senderId)) item.expiresAt = 0;
          }
        })
        .on('broadcast', { event: 'call-rejected' }, ({ payload }) => {
          if (accountRef.current !== currentUserId || !globalSignalingChannelRef.current.includes(signalingChannel)) return;
          const { callId, senderId, callerId } = payload || {};
          const chatRecord = chatsRef.current.find((candidate) => candidate.id === chat.id);
          if (senderId && (!chatRecord?.members?.some((member) => member.id === senderId) || senderId === currentUserId)) return;
          if (chatRecord?.type === 'group') {
            invitationDeliveryRef.current.acknowledge(chat.id, callId, senderId);
            // The inviter can cancel outstanding ringing. Another invitee's
            // decline only acknowledges that person's invitation delivery.
            if (callId && callerId === senderId) endedInvitationsRef.current.set(callId, Date.now() + 60_000);
          } else if (callId) endedInvitationsRef.current.set(callId, Date.now() + 60_000);
          const active = callStateRef.current;
          if (active?.chatId !== chat.id || (callId && active.callId !== callId)
            || (senderId && active.otherUserId && senderId !== active.otherUserId)) return;
          // Declining one invitation is not ending the group's conversation.
          // Actual participants leave via the existing media-channel hangup.
          if (chatRecord?.type === 'group' && active.status === 'connected') return;
          if (callId) endedInvitationsRef.current.set(callId, Date.now() + 60_000);
          invitationDeliveryRef.current.stop();
          // Full teardown via shared end path (C4), not status-only reset.
          if (typeof onRemoteEndRef.current === 'function') {
            onRemoteEndRef.current();
          } else {
            setCallState((prev) => ((prev.status === 'calling' || prev.status === 'connected')
              ? { ...prev, status: 'ended' }
              : prev));
          }
        })
        .subscribe((status) => {
          signalingChannel.callSubscriptionStatus = status;
          if (status !== 'SUBSCRIBED') return;

          void flushPendingRef.current(chat.id);
        });
      return signalingChannel;
    });

    globalSignalingChannelRef.current = channels;
    return () => {
      channels.forEach((channel) => channel.unsubscribe());
      if (globalSignalingChannelRef.current === channels) globalSignalingChannelRef.current = [];
    };
  }, [currentUserId, signalingChannelKey, setCallState, acceptedIsCurrent, terminalIsCurrent]);

  return { sendSignalingMessage, globalSignalingChannelRef, pendingSignalingMessagesRef };
}
