// @ts-check
import { isSupabaseConfigured, supabase } from '../supabaseClient.js';
import { requireClient } from './serviceUtils.ts';

/** Legacy positional API. New E2EE v2 code must never import this adapter. */
export const createV1MessageCompatibilityAdapter = ({
  client = supabase,
  configured = isSupabaseConfigured,
  randomUUID = () => crypto.randomUUID(),
  now = () => new Date()
} = {}) => ({
  /**
   * @param {string} chatId
   * @param {string} senderId
   * @param {string} text
   * @param {string | null | undefined} replyToId
   * @param {string | null | undefined} media
   * @param {string | null} [customId] client-generated id (optimistic/offline sends)
   * @param {{ forwardedFrom?: { name: string } | string | null }} [metadata] the offline queue passes a JSON or E2EE-encrypted string
   */
  async sendMessage(chatId, senderId, text, replyToId, media, customId = null, metadata = {}) {
    const finalId = customId || randomUUID();
    if (configured) {
      const { data, error } = await requireClient(client).from('messages').insert({
        id: finalId,
        chat_id: chatId,
        sender_id: senderId,
        text,
        media,
        reply_to: replyToId,
        ...(metadata.forwardedFrom ? { forwarded_from: metadata.forwardedFrom } : {})
      }).select().single();
      if (error) throw error;
      return data;
    }
    return {
      id: finalId,
      senderId,
      senderName: 'Вы',
      ...(metadata.forwardedFrom ? { forwardedFromRaw: metadata.forwardedFrom } : {}),
      text,
      timestamp: now(),
      replyTo: replyToId,
      media,
      read: false,
      reactions: []
    };
  }
});

export const v1MessageCompatibilityAdapter = createV1MessageCompatibilityAdapter();
