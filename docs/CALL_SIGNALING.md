# Call invitation delivery

Call invitations use the existing private, chat-scoped Supabase Realtime
channels. E2EE v2 broadcasts still pass through `secureCallChannel` and MLS;
each retry creates a fresh encrypted event. No backend API or schema changes
are required.

A new outgoing call has a random `callId` and a 60-second deadline. While
waiting for the intended recipients, the sender retries every 1.5 seconds,
including when its channel has not subscribed yet or encryption temporarily
fails. A server broadcast ACK confirms transport acceptance only. The
receiver sends `call-received` after validating/decrypting the invitation.
Retries stop once every invited member has acknowledged, the call is answered
or ended, the deadline passes, or the sender logs out/unmounts.

An incoming invitation never resets an active call. Expired or cancelled
invitations are ignored. Cancellation is checked again after asynchronous
encryption so a pending worker operation cannot ring the peer after hangup.
Accept/reject events carry the call ID and are checked against the current
chat/call/peer. Older clients without call IDs retain their existing behavior;
new senders retry until answer/termination/deadline if an old receiver cannot
send the new receipt.

Other signaling events use the existing subscription queue, now with a
10-second expiry and retries for non-OK transport results. Account changes
clear queued events. This is bounded foreground delivery, not offline call
notifications.

Regression coverage includes late subscription, recipient reconnect,
dropped broadcasts, transient encryption failure, duplicate invitations,
hangup before subscription, cancellation during encryption, expired and
superseded call IDs. The live two-account test runs normal calling and holds
the recipient's actual invitation-channel joins until 4.5 seconds after call
initiation; both must connect remote audio and clean it up on hangup.

Live diagnostics retain only allowlisted protocol milestones and relative
timings. They exclude account/chat IDs, URLs, credentials, envelopes and
message contents, and decode both JSON and realtime-js binary frame headers.
