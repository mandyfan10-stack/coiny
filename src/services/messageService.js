import { supabase, isSupabaseConfigured } from '../supabaseClient.js';
import { toISO } from './serviceUtils.ts';
import { compareMessages } from '../utils/messageCursor.ts';

// .or() accepts raw PostgREST syntax; quote values rather than interpolating
// unescaped cursor fields into its filter expression.
const filterValue = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

export const createMessageService = ({
  client = supabase,
  configured = isSupabaseConfigured,
  storage = globalThis.localStorage,
  e2eeV2Enabled = Boolean(import.meta.env && import.meta.env.VITE_E2EE_V2_ENABLED === 'true')
} = {}) => ({
  loadChatMessages: async (chatId, limit = 100, beforeCursor = null) => {
    if (configured) {
      let query = client
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (beforeCursor?.id && beforeCursor.timestamp) {
        const timestamp = filterValue(toISO(beforeCursor.timestamp));
        const id = filterValue(beforeCursor.id);
        query = query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`);
      } else if (beforeCursor) {
        // Compatibility for consumers that only have a timestamp.
        query = query.lt('created_at', toISO(beforeCursor));
      }
      const { data, error } = await query;
      if (error) throw error;

      const messageIds = (data || []).map((message) => message.id);
      let reads = [];
      if (messageIds.length > 0) {
        const { data: readsData } = await client
          .from('message_reads')
          .select('message_id, profile_id')
          .in('message_id', messageIds);
        reads = readsData || [];
      }

      return (data || []).map((message) => {
        const messageReads = reads.filter((receipt) => receipt.message_id === message.id);
        return {
          id: message.id,
          senderId: message.sender_id,
          text: message.text,
          media: message.media,
          mediaPath: message.media_path,
          cryptoVersion: message.crypto_version || 1,
          senderDeviceId: message.sender_device_id,
          encryptedPayload: message.encrypted_payload,
          requiresUpdate: message.crypto_version === 2 && !e2eeV2Enabled,
          replyTo: message.reply_to,
          read: message.read || messageReads.length > 0,
          reads: messageReads.map((receipt) => receipt.profile_id),
          reactions: message.reactions || [],
          createdAt: message.created_at,
          timestamp: new Date(message.created_at)
        };
      }).reverse();
    }

    const saved = storage?.getItem('tg-chats-mock');
    if (saved) {
      const chats = JSON.parse(saved);
      const chat = chats.find((candidate) => candidate.id === chatId);
      if (chat) {
        const messages = chat.messages.map((message) => ({ ...message, timestamp: new Date(message.timestamp) }))
          .filter((message) => !beforeCursor || (beforeCursor.id
            ? compareMessages(message, beforeCursor) < 0
            : new Date(message.timestamp) < new Date(beforeCursor)))
          .sort(compareMessages);
        return messages.slice(-limit);
      }
    }
    return [];
  },

  clearChatMessages: async (chatId) => {
    if (configured) {
      const { error } = await client.from('messages').delete().eq('chat_id', chatId);
      if (error) throw error;
    }
    return true;
  },

  /** Public v2 API: plaintext and legacy positional fields are not accepted. */
  sendMessage: async (message) => {
    if (!message || typeof message !== 'object' || message.cryptoVersion !== 2 || !message.chatId || !message.id || !message.senderDeviceId || !message.encryptedPayload) {
      throw new Error('Invalid CryptoEnvelopeV2 message payload.');
    }
    if (!configured) throw new Error('E2EE v2 is unavailable in mock mode.');
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw userError || new Error('Authentication is required.');

    const encryptedPayload = String(message.encryptedPayload);
    const byteaPayload = encryptedPayload.startsWith('\\x')
      ? encryptedPayload
      : `\\x${Array.from(
          Uint8Array.from(atob(encryptedPayload), (character) => character.charCodeAt(0)),
          (byte) => byte.toString(16).padStart(2, '0')
        ).join('')}`;
    const { data, error } = await client.from('messages').insert({
      id: message.id,
      chat_id: message.chatId,
      sender_id: user.id,
      crypto_version: 2,
      sender_device_id: message.senderDeviceId,
      encrypted_payload: byteaPayload,
      text: null,
      media: null,
      media_path: null,
      reply_to: null,
      read: false,
      reactions: []
    }).select().single();
    if (error) throw error;
    return data;
  },

  deleteMessage: async (messageId) => {
    if (configured) {
      const { error } = await client.from('messages').delete().eq('id', messageId);
      if (error) throw error;
    }
  },

  toggleReaction: async (messageId, emojiOrReactions) => {
    if (configured) {
      const emoji = typeof emojiOrReactions === 'string' ? emojiOrReactions : null;
      if (!emoji) throw new Error('toggleReaction requires an emoji string in live mode');
      const { data, error } = await client.rpc('toggle_message_reaction', {
        p_message_id: messageId,
        p_emoji: emoji
      });
      if (error) throw error;
      return data;
    }
    return emojiOrReactions;
  },

  markMessagesAsRead: async (chatId, _userId) => {
    if (!configured) return;
    const { data, error } = await client.rpc('mark_chat_as_read', { p_chat_id: chatId });
    if (error) throw error;
    return data;
  }
});

export const messageService = createMessageService();
