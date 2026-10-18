# Drafts, editing and forwarding

## User behavior

- Draft text and the reply reference are saved separately for each account and chat on the current device. Switching chats, editing a previous message and forwarding do not clear the draft. The sidebar shows “Черновик”. Drafts are not synchronized between devices.
- An author's confirmed v1 text messages and ordinary media captions can be edited through the message actions. Arrow Up in an empty composer opens the latest editable message; Escape cancels. Successful edits keep the message ID, reply, creation time and position, and display “изменено”. Failed requests retain the typed edit.
- Message actions support forwarding one message or selecting several. The destination can be a writable chat or Saved Messages, with an optional separate comment. The sender attribution is preserved; source replies, reactions and read receipts are not copied. Retrying a partially completed operation skips acknowledged messages and the comment.
- Editing and starting a forward require an internet connection. If sending loses its connection, the existing offline queue retains the outgoing message and its attribution. Locked, unconfirmed and unsupported v2 messages cannot be edited or forwarded.

## Storage and security

Drafts use IndexedDB version 9, the `chat-drafts` store, account/chat associated data and the existing non-exportable device AES key. The store contains encrypted text and reply data. Simultaneous tabs use an atomic first-key initialization.

`messages.edited_at` is assigned by a database trigger. The `edit_message_text` RPC uses RLS, verifies the author and compares both the original wire text and revision. Stale editors cannot overwrite another accepted edit. Existing read/reaction handling and v2 immutability remain in place.

`messages.forwarded_from` contains a JSON sender name, encrypted separately with the destination chat key when the chat requires E2EE. Ordinary message text remains compatible with older clients. Private attachments are downloaded with the current user's storage permissions, decrypted at the source, uploaded to a new destination path and encrypted with the destination key. Source keys and private attachment paths are not shared with the recipient. Existing attachment type and size limits apply.

## Deployment

`supabase/migrations/20261018120247_message_editing.sql` adds nullable metadata columns, the guarded edit timestamp and the edit RPC; no existing messages are rewritten. It was applied to the hosted project before releasing client version 1.20.79. The filename matches its recorded remote migration version.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- `npx playwright test --config playwright.ui.config.mjs tests/ui/message-operations.spec.mjs` covers Chromium and WebKit, desktop and touch layouts, encrypted drafts, successful/failed edits, partial forwarding, private media encryption, Saved Messages, focus and visual viewport resizing.
- `tests/ui/history-loading.spec.mjs` verifies that a delayed history reply cannot undo an edit received during loading.
- `supabase/tests/message_editing.test.sql` checks permissions, author-only edits, revision conflicts, server timestamps, attribution preservation and read-receipt compatibility. It can be run with `supabase test db` against a local Supabase instance.
