import { isSupabaseConfigured, supabase } from '../supabaseClient.js';

/** Legacy positional API. New E2EE v2 code must never import this adapter. */
export const createV1MessageCompatibilityAdapter = ({
  client = supabase,
  configured = isSupabaseConfigured,
  randomUUID = () => crypto.randomUUID(),
  now = () => new Date()
} = {}) => ({
  async sendMessage(chatId, senderId, text, replyToId, media, customId = null, metadata = {}) {
    const finalId = customId || randomUUID();
    if (configured) {
      const { data, error } = await client.from('messages').insert({
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
