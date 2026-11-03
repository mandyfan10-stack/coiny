// @ts-check
import { supabase, isSupabaseConfigured } from '../supabaseClient.js';
import { requireClient, toISO } from './serviceUtils.ts';
import { compareMessages } from '../utils/messageCursor.ts';

// .or() accepts raw PostgREST syntax; quote values rather than interpolating
// unescaped cursor fields into its filter expression.
/** @param {unknown} value */
const filterValue = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

/**
 * Pagination cursor: the oldest loaded message, or (legacy) a bare timestamp.
 * @typedef {{ id: string, timestamp: Date | string } | Date | string | null} MessageCursor
 */

/** @param {MessageCursor} cursor */
const isRowCursor = cursor => Boolean(cursor && typeof cursor === 'object' && 'id' in cursor && cursor.id);

/**
 * @param {object} [deps] injectable for tests
 * @param {typeof supabase} [deps.client]
 * @param {boolean} [deps.configured]
 * @param {Pick<Storage, 'getItem'> | undefined} [deps.storage]
 * @param {boolean} [deps.e2eeV2Enabled]
 */
export const createMessageService = ({
  client = supabase,
  configured = isSupabaseConfigured,
  storage = globalThis.localStorage,
  e2eeV2Enabled = Boolean(import.meta.env && import.meta.env.VITE_E2EE_V2_ENABLED === 'true')
} = {}) => ({
  /**
   * Newest-first page of messages before `beforeCursor`, returned oldest-first.
   * @param {string} chatId
   * @param {number} [limit]
   * @param {MessageCursor} [beforeCursor]
   */
  loadChatMessages: async (chatId, limit = 100, beforeCursor = null) => {
    if (configured) {
      const live = requireClient(client);
      let query = live
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      const rowCursor = isRowCursor(beforeCursor)
        ? /** @type {{ id: string, timestamp: Date | string }} */ (beforeCursor)
        : null;
      if (rowCursor?.id && rowCursor.timestamp) {
        const timestamp = filterValue(toISO(rowCursor.timestamp));
        const id = filterValue(rowCursor.id);
        query = query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`);
      } else if (beforeCursor) {
        // Compatibility for consumers that only have a timestamp.
        query = query.lt('created_at', /** @type {string} */ (toISO(/** @type {Date | string} */ (beforeCursor))));
      }
      const { data, error } = await query;
      if (error) throw error;

      const messageIds = (data || []).map((message) => message.id);
      /** @type {{ message_id: string, profile_id: string }[]} */
      let reads = [];
      if (messageIds.length > 0) {
        const { data: readsData } = await live
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
          editedAt: message.edited_at,
          forwardedFromRaw: message.forwarded_from,
          timestamp: new Date(message.created_at)
        };
      }).reverse();
    }

    const saved = storage?.getItem('tg-chats-mock');
    if (saved) {
      const chats = JSON.parse(saved);
      const chat = chats.find((/** @type {{ id: string }} */ candidate) => candidate.id === chatId);
      if (chat) {
        /** @type {import('../types').ChatMessage[]} */
        const stored = chat.messages;
        const messages = stored.map((message) => ({ ...message, timestamp: new Date(message.timestamp) }))
          .filter((message) => !beforeCursor || (isRowCursor(beforeCursor)
            ? compareMessages(message, /** @type {{ id: string, timestamp: Date | string }} */ (beforeCursor)) < 0
            : new Date(message.timestamp) < new Date(/** @type {Date | string} */ (beforeCursor))))
          .sort(compareMessages);
        return messages.slice(-limit);
      }
    }
    return [];
  },

  /** @param {string} chatId */
  clearChatMessages: async (chatId) => {
    if (configured) {
      const { error } = await requireClient(client).from('messages').delete().eq('chat_id', chatId);
      if (error) throw error;
    }
    return true;
  },

  /**
   * Public v2 API: plaintext and legacy positional fields are not accepted.
   * @param {{ cryptoVersion: number, chatId: string, id: string, senderDeviceId: string, encryptedPayload: string }} message
   */
  sendMessage: async (message) => {
    if (!message || typeof message !== 'object' || message.cryptoVersion !== 2 || !message.chatId || !message.id || !message.senderDeviceId || !message.encryptedPayload) {
      throw new Error('Invalid CryptoEnvelopeV2 message payload.');
    }
    if (!configured) throw new Error('E2EE v2 is unavailable in mock mode.');
    const live = requireClient(client);
    const { data: { user }, error: userError } = await live.auth.getUser();
    if (userError || !user) throw userError || new Error('Authentication is required.');

    const encryptedPayload = String(message.encryptedPayload);
    const byteaPayload = encryptedPayload.startsWith('\\x')
      ? encryptedPayload
      : `\\x${Array.from(
          Uint8Array.from(atob(encryptedPayload), (character) => character.charCodeAt(0)),
          (byte) => byte.toString(16).padStart(2, '0')
        ).join('')}`;
    const { data, error } = await live.from('messages').insert({
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

  /**
   * Compare-and-set edit: fails if the message changed since it was loaded.
   * @param {string} messageId
   * @param {string} text
   * @param {string | null} [expectedEditedAt]
   */
  editMessage: async (messageId, text, expectedEditedAt = null) => {
    if (!configured) return { text, edited_at: new Date().toISOString() };
    const live = requireClient(client);
    const { data: current, error: readError } = await live.from('messages').select('text, edited_at').eq('id', messageId).single();
    if (readError) throw readError;
    const { data, error } = await live.rpc('edit_message_text', {
      p_message_id: messageId, p_text: text, p_expected_text: current.text, p_expected_edited_at: expectedEditedAt
    });
    if (error) throw error;
    if (!data) throw new Error('Сообщение изменено или удалено. Обновите чат и попробуйте снова.');
    return data;
  },

  /** @param {string} messageId */
  deleteMessage: async (messageId) => {
    if (configured) {
      const { error } = await requireClient(client).from('messages').delete().eq('id', messageId);
      if (error) throw error;
    }
  },

  /**
   * Live mode toggles one emoji server-side; mock mode echoes the new reaction list.
   * @template T
   * @param {string} messageId
   * @param {string | T} emojiOrReactions
   */
  toggleReaction: async (messageId, emojiOrReactions) => {
    if (configured) {
      const emoji = typeof emojiOrReactions === 'string' ? emojiOrReactions : null;
      if (!emoji) throw new Error('toggleReaction requires an emoji string in live mode');
      const { data, error } = await requireClient(client).rpc('toggle_message_reaction', {
        p_message_id: messageId,
        p_emoji: emoji
      });
      if (error) throw error;
      return data;
    }
    return emojiOrReactions;
  },

  /**
   * @param {string} chatId
   * @param {string} [_userId] unused; the server reads auth.uid()
   */
  markMessagesAsRead: async (chatId, _userId) => {
    if (!configured) return;
    const { data, error } = await requireClient(client).rpc('mark_chat_as_read', { p_chat_id: chatId });
    if (error) throw error;
    return data;
  }
});

export const messageService = createMessageService();
