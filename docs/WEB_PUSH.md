# Background notifications

Web Push delivers a generic “Новое сообщение” notification after the web/PWA tab
has closed. The browser and operating system must support Web Push. iOS requires
an installed Home Screen web app. Capacitor Android and Electron need their own
native push integration; this change does not claim background delivery there.

The feature is optional: without `VITE_WEB_PUSH_PUBLIC_KEY`, the existing local
notifications continue to work and no push subscriptions are registered.

## Delivery and privacy

1. The user grants notification permission from Settings. The browser creates a
   subscription using the public VAPID key.
2. An authenticated RPC stores the endpoint and subscription keys in a private
   table, bound to the current account. Clients cannot list these credentials.
3. A message INSERT queues a pg_net request after commit. Its body contains only
   the message ID. Missing configuration never prevents sending a message.
4. The authenticated dispatcher re-checks membership, chat notification settings,
   read receipts and freshness, then sends encrypted Web Push payloads. It skips
   the sender. Payloads contain routing identifiers, without text or attachments.
5. The worker focuses the existing app or opens the deployed base path. The app
   waits for authentication and opens the chat only for the recipient account.

Expired endpoints (404/410) are removed; other provider failures remain eligible
for a later notification. A failed pg_net request is not automatically retried.
This is best-effort notification delivery; messages remain in Supabase regardless.
TTL is 60 seconds, message freshness is five minutes, and subscriptions expire
after 90 days without a client refresh. Registration is limited to ten devices per
account. Sign-out and disabling notifications remove/invalidate this device's
subscription. The two operations run serially with pending registrations.

A browser service-worker registration has one push subscription. When several
accounts use separate tabs, the last synchronized account owns background
delivery; the other tabs retain their foreground Realtime connections.

Only recognized browser push providers are accepted to prevent endpoints from
becoming arbitrary server-side HTTP destinations. Add new providers deliberately
in both the registration RPC and `webPushDelivery.ts`.

## Enable on a hosted project

Apply the committed migration through the normal migration workflow and deploy
`send-web-push` with JWT verification disabled (the function validates a dedicated
webhook secret). The SQL trigger stays inactive until its Vault entries exist.

Generate one VAPID key pair with a trusted Web Push tool and a separate random
webhook secret of at least 32 characters. Keep private values out of Git and client
builds. Configure these **Edge Function secrets**:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Public key from the generated pair |
| `VAPID_PRIVATE_KEY` | Private key from the same pair |
| `VAPID_SUBJECT` | Operator contact, such as a real `mailto:` address |
| `WEB_PUSH_WEBHOOK_SECRET` | Random webhook secret |

Create these **Supabase Vault entries** through the dashboard:

| Name | Value |
| --- | --- |
| `coiny_push_url` | `https://<project-ref>.supabase.co/functions/v1/send-web-push` |
| `coiny_push_webhook_secret` | Same value as `WEB_PUSH_WEBHOOK_SECRET` |

Set GitHub Actions repository **variable** `VITE_WEB_PUSH_PUBLIC_KEY` to the public
VAPID key and build a new release. For local development put it in `.env`.
The release workflow supplies this public value to web, Android and Windows
builds; it contains no private credential.

## Verification before release

- Run `npm test`, typecheck, lint, `npm run test:ui` and the SQL tests under
  `supabase/tests` after resetting a local Supabase instance.
- On a test account, enable notifications, close all app tabs, send a message from
  a second account and verify delivery and chat navigation.
- Repeat with a muted chat, a removed member, disabled notifications and sign-out.
- Check pg_net responses and Edge Function logs for delivery failures. Never log
  subscription endpoints, keys, message payloads or the webhook secret.
- Verify the browser/PWA on each supported operating system. Unit and mock-browser
  tests do not replace a provider-backed closed-tab test.
