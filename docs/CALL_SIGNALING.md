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
Retries stop once every invited member has acknowledged, a personal call is
answered or ended, the deadline passes, or the sender logs out/unmounts. In a
group, one member accepting or declining only acknowledges that member.

An incoming invitation never resets an active call. Expired or cancelled
invitations are ignored. Cancellation is checked again after asynchronous
encryption so a pending worker operation cannot ring the peer after hangup.
Accept/reject events carry the call ID and are checked against the current
chat/call/peer. Older clients without call IDs retain their existing behavior;
new senders retry until answer/termination/deadline if an old receiver cannot
send the new receipt.

Acceptance is repeated for up to 60 seconds until `call-accepted-received`
confirms receipt by the inviting application. Repeated acceptance is
idempotent. Other signaling events use the subscription queue with a
10-second expiry and retries for non-OK transport results. Account/call
changes cancel stale acceptance. This is bounded foreground delivery, not
offline call notifications.

## Media lifetime and recovery

`useCallTransport` owns media for one account and call ID. Profile/theme and
crypto callback updates use current refs without recreating the microphone or
peer connections. Account changes, confirmed removal of the active chat or
membership, and hangup stop media. A terminal encrypted hangup gets at most
three seconds to leave its subscribed channel after local media stops.
Late microphone, camera and screen permission results are stopped when their
call lifetime has ended.

Each connection has one `callPeerSession` controller. SDP, camera changes and
ICE recovery share a serialized queue, bounded retries, negotiation IDs and
stale-candidate filtering. Duplicate offers replay a cached answer using a
fresh encrypted envelope; candidates repeat until a real connection exists.
Polite rollback handles offer collisions and rebinds the live audio sender
because Chromium can otherwise retain a live track with stopped outgoing RTP.
Rebinding resolves the current microphone/processed track after each native
replacement, so a concurrent processing toggle cannot restore a stopped track.
An elected offerer handles `restart-request`; a bounded fallback supports
older clients. Recovery refreshes TURN configuration before a new ICE offer.

Brief disconnection gets a three-second grace period. Failed connections
recover independently, so one group participant does not restart healthy
peers. Presence loss alone does not close a working media path; absent,
unconnected peers are removed after a 15-second grace period. Exhausted
attempts expose the retry action rather than an indefinite connecting state.
Confirmed roster removal closes that participant's connection immediately,
even if their client keeps signaling. Current membership also gates queued
negotiation and encrypted sends; healthy remaining participants stay connected.

TURN credentials are cached per account/client until their server expiry,
with a 30-second safety margin. Concurrent requests share one operation;
requests time out after three seconds. Account changes invalidate pending
requests. Existing direct/relay policy remains unchanged. Preparing ICE and
the microphone concurrently avoids an unnecessary sequential setup wait.

## Quality measurements

The call's expandable quality panel samples native WebRTC stats every two
seconds. It shows selected-route RTT, interval packet loss, audio jitter and
average jitter-buffer delay when the browser supports them. Unsupported and
first-interval values remain unknown. Group values show the maximum across
peers. RTT is a network round trip, not microphone-to-speaker latency.
Diagnostics contain no candidate addresses, stats IDs, SDP or credentials.

No fixed RTT improvement is implied: actual delay depends on both users'
networks and the selected direct/TURN route. Local host-only fixtures verify
recovery and advancing RTP, not latency between users in Russia or TURN
availability. Relay deployment/location changes require separate approval.

Regression coverage includes late subscription, recipient reconnect,
dropped broadcasts, transient encryption failure, duplicate invitations,
hangup before subscription, cancellation during encryption, expired and
superseded call IDs. The live two-account test runs normal calling and holds
the recipient's actual invitation-channel joins until 4.5 seconds after call
initiation; both must send and receive advancing audio RTP and clean it up on
hangup. Local provider fixtures additionally exercise dropped acceptance,
SDP and candidates, simultaneous recovery, group isolation, profile updates,
voice processing changes and late capture cancellation.

Live diagnostics retain only allowlisted protocol milestones and relative
timings. They exclude account/chat IDs, URLs, credentials, envelopes and
message contents, and decode both JSON and realtime-js binary frame headers.
