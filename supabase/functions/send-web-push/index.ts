import 'jsr:@supabase/functions-js@2.112.2/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.112.2';
import webpush from 'npm:web-push@3.6.7';
import { deliverPushBatch, matchesPushSecret, type PushRecipient } from '../_shared/webPushDelivery.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('WEB_PUSH_WEBHOOK_SECRET') || '';
  if (!await matchesPushSecret(request.headers.get('x-push-secret') || '', secret)) return new Response('Forbidden', { status: 403 });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY'), privateKey = Deno.env.get('VAPID_PRIVATE_KEY'), subject = Deno.env.get('VAPID_SUBJECT');
  if (!url || !key || !publicKey || !privateKey || !subject) return new Response('Push is not configured', { status: 503 });
  let messageId;
  try {
    const body = await request.text();
    if (body.length > 1024) return new Response('Payload too large', { status: 413 });
    messageId = JSON.parse(body).messageId;
  } catch { return new Response('Invalid request', { status: 400 }); }
  if (typeof messageId !== 'string' || !uuid.test(messageId)) return new Response('Invalid message id', { status: 400 });

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: message, error } = await client.from('messages').select('id,chat_id').eq('id', messageId).maybeSingle();
    if (error) throw error;
    if (!message) return new Response(null, { status: 204 });
    let cursor: string | null = null;
    let delivered = 0, failed = 0;
    for (;;) {
      const response: { data: unknown; error: unknown } = await client.rpc('get_message_push_recipients', { p_message_id: messageId, p_after: cursor });
      if (response.error) throw response.error;
      if (!Array.isArray(response.data)) throw new Error('Invalid recipient response');
      const recipients: PushRecipient[] = response.data;
      if (!recipients.length) break;
      const result = await deliverPushBatch(recipients, message, {
        send: (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 60, urgency: 'normal', timeout: 5000 }),
        remove: async id => {
          const { error: removeError } = await client.rpc('delete_expired_push_subscription', { p_id: id });
          if (removeError) throw removeError;
        }
      });
      delivered += result.delivered; failed += result.failed;
      cursor = recipients[recipients.length - 1].id;
      if (recipients.length < 100) break;
    }
    return Response.json({ delivered, failed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Never expose provider responses: they can contain subscription credentials.
    return new Response('Push delivery failed', { status: 502 });
  }
});
