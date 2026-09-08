import { useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { dataService } from '../../services/dataLayer';
import {
  importPublicKey,
  deriveSymmetricKey,
  decryptMessage
} from '../../utils/e2eeHelper';
import { playSound } from '../../utils/sounds';
import { showIncomingNotification } from '../../services/notificationService';
import {
  saveCachedMessage,
  deleteCachedMessage,
  updateCachedMessageFields
} from '../../utils/indexedDbHelper';

/**
 * Supabase realtime: messages, members, presence, typing, stories; mock bootstrap.
 */
export function useChatRealtime({
  currentUser,
  realtimeChatIds,
  setChats,
  fetchChats,
  fetchStories,
  markMessagesAsRead,
  setSharedKeysCache,
  e2eePrivateKeyRef,
  sharedKeysCacheRef,
  activeChatIdRef,
  setActiveChatId,
  setOnlineUsers,
  setTypingStatuses,
  typingChannelRef,
  typingTimeoutsRef
}) {
  const currentUserId = currentUser?.id;
  // Load the sidebar once per signed-in user. Do not tie this to
  // realtimeChatIds — that string changes after the first fetch and would
  // refetch + tear down every realtime channel on startup.
  useEffect(() => {
    if (!currentUserId) return undefined;
    fetchChats();
    if (dataService.isLive()) fetchStories();
    return undefined;
  }, [currentUserId, fetchChats, fetchStories]);

  useEffect(() => {
    if (dataService.isLive()) {
      if (currentUser) {
        const msgChannel = supabase
          .channel('db-messages')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
            const newMsg = payload.new;

            const isMe = newMsg.sender_id === currentUser.id;
            if (!isMe) {
              playSound('incoming');
              if (newMsg.chat_id === activeChatIdRef.current) {
                markMessagesAsRead(newMsg.chat_id);
              }
            }

            let decryptedText = newMsg.text;
            let decryptedMedia = newMsg.media;
            let isDecrypted = true;

            if (newMsg.text?.startsWith('e2ee:aes-gcm:') || newMsg.media?.startsWith('e2ee:aes-gcm:')) {
              let sharedKey = sharedKeysCacheRef.current[newMsg.chat_id];
              if (!sharedKey && e2eePrivateKeyRef.current) {
                try {
                  const { data: membersRaw } = await supabase
                    .from('chat_members')
                    .select('profile_id, profiles(public_key, has_e2ee)')
                    .eq('chat_id', newMsg.chat_id);

                  const otherMember = membersRaw?.find((m) => m.profile_id !== currentUser.id);
                  if (otherMember?.profiles?.public_key) {
                    const otherPublicKeyObj = await importPublicKey(otherMember.profiles.public_key);
                    sharedKey = await deriveSymmetricKey(e2eePrivateKeyRef.current, otherPublicKeyObj);
                    setSharedKeysCache((prev) => ({ ...prev, [newMsg.chat_id]: sharedKey }));
                  }
                } catch (err) {
                  console.error(err);
                }
              }

              if (sharedKey) {
                if (newMsg.text?.startsWith('e2ee:aes-gcm:')) {
                  try {
                    const parts = newMsg.text.replace('e2ee:aes-gcm:', '').split(':');
                    decryptedText = await decryptMessage(parts[0], parts[1], sharedKey);
                  } catch {
                    decryptedText = 'Зашифрованное сообщение';
                    isDecrypted = false;
                  }
                }
                if (newMsg.media?.startsWith('e2ee:aes-gcm:') && isDecrypted) {
                  try {
                    const parts = newMsg.media.replace('e2ee:aes-gcm:', '').split(':');
                    decryptedMedia = await decryptMessage(parts[0], parts[1], sharedKey);
                  } catch {
                    decryptedMedia = null;
                  }
                }
              } else {
                decryptedText = 'Зашифрованное сообщение';
                isDecrypted = false;
                decryptedMedia = null;
              }
            }

            setChats((prevChats) => {
              const chat = prevChats.find((c) => c.id === newMsg.chat_id);
              if (!chat) return prevChats;

              const senderName = chat.members.find((m) => m.id === newMsg.sender_id)?.name || 'Пользователь';

              const formattedMsg = {
                id: newMsg.id,
                senderId: newMsg.sender_id,
                senderName,
                text: decryptedText,
                media: decryptedMedia,
                replyTo: newMsg.reply_to,
                // Preserve local read receipts already applied via message_reads realtime
                read: chat.messages.find((m) => m.id === newMsg.id)?.read || newMsg.read,
                reads: chat.messages.find((m) => m.id === newMsg.id)?.reads,
                reactions: newMsg.reactions || [],
                timestamp: new Date(newMsg.created_at),
                isLocked: !isDecrypted,
                isOptimistic: false,
                isPending: false
              };

              const existingIndex = chat.messages.findIndex((m) => m.id === newMsg.id);
              if (existingIndex !== -1) {
                // Own optimistic bubble (same client id) or a race with message_reads:
                // update local IndexedDB cache with confirmed status and merge into state
                updateCachedMessageFields(newMsg.id, {
                  isOptimistic: false,
                  isPending: false,
                  read: formattedMsg.read,
                  reads: formattedMsg.reads
                });
                const nextMessages = chat.messages.map((m, index) => (
                  index === existingIndex
                    ? {
                        ...formattedMsg,
                        // Keep decrypted plaintext the sender already shows
                        text: isMe && m.text && !String(m.text).startsWith('e2ee:')
                          ? m.text
                          : formattedMsg.text,
                        media: isMe && m.media && !String(m.media || '').startsWith('e2ee:')
                          ? m.media
                          : formattedMsg.media,
                        read: m.read || formattedMsg.read,
                        reads: m.reads || formattedMsg.reads
                      }
                    : m
                ));
                return prevChats.map((c) => (
                  c.id === newMsg.chat_id ? { ...c, messages: nextMessages } : c
                ));
              }

              if (!isMe && currentUser?.notificationsEnabled !== false && chat.notifications !== false) {
                try {
                  showIncomingNotification({
                    title: chat.type === 'personal' ? senderName : `${senderName} (${chat.name})`,
                    body: formattedMsg.text || (formattedMsg.media ? 'Вложение' : 'Новое сообщение'),
                    tag: chat.id,
                    onClick: () => {
                      if (typeof setActiveChatId === 'function') {
                        setActiveChatId(chat.id);
                      }
                    }
                  });
                } catch {
                  /* ignore notification dispatch errors */
                }
              }

              saveCachedMessage(formattedMsg, newMsg.chat_id, currentUser.id);

              return prevChats.map((c) => {
                if (c.id === newMsg.chat_id) {
                  return {
                    ...c,
                    messages: [...c.messages, formattedMsg]
                  };
                }
                return c;
              });
            });
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
            const deletedMsgId = payload.old.id;
            deleteCachedMessage(deletedMsgId);
            setChats((prevChats) => prevChats.map((c) => ({
              ...c,
              messages: c.messages.filter((m) => m.id !== deletedMsgId)
            })));
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
            const updatedMsg = payload.new;
            updateCachedMessageFields(updatedMsg.id, {
              read: updatedMsg.read,
              reactions: updatedMsg.reactions || []
            });
            setChats((prevChats) => prevChats.map((c) => {
              if (c.id === updatedMsg.chat_id) {
                return {
                  ...c,
                  messages: c.messages.map((m) => (m.id === updatedMsg.id ? {
                    ...m,
                    read: updatedMsg.read,
                    reactions: updatedMsg.reactions || []
                  } : m))
                };
              }
              return c;
            }));
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads' }, (payload) => {
            const receipt = payload.new;
            updateCachedMessageFields(receipt.message_id, { read: true });
            setChats((prevChats) => prevChats.map((chat) => ({
              ...chat,
              messages: chat.messages.map((message) => (
                message.id === receipt.message_id
                  ? {
                      ...message,
                      read: true,
                      reads: [...new Set([...(message.reads || []), receipt.profile_id])]
                    }
                  : message
              ))
            })));
          })
          .subscribe();

        let memberRefreshTimer = 0;
        const memberChannel = supabase
          .channel('db-members')
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_members',
            filter: `profile_id=eq.${currentUser.id}`
          }, () => {
            window.clearTimeout(memberRefreshTimer);
            memberRefreshTimer = window.setTimeout(() => {
              fetchChats();
            }, 250);
          })
          .subscribe();

        const presenceChannel = supabase.channel('online-users', {
          config: {
            private: true,
            // Presence groups every connection using this key into one array.
            // That keeps the user online until their last device disconnects.
            presence: { key: currentUser.id }
          }
        });
        presenceChannel
          .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            const onlineIds = Object.keys(state);

            setOnlineUsers((prevOnline) => {
              const nextOnline = new Set(onlineIds);
              const wentOffline = [...prevOnline].filter((id) => !nextOnline.has(id));

              if (wentOffline.length > 0) {
                setChats((prevChats) => prevChats.map((chat) => {
                  if (chat.type === 'personal') {
                    const other = chat.members?.find((m) => m.id !== currentUser.id);
                    if (other && wentOffline.includes(other.id)) {
                      const updatedMembers = chat.members.map((m) => (
                        m.id === other.id ? { ...m, lastSeen: new Date().toISOString() } : m
                      ));
                      return {
                        ...chat,
                        members: updatedMembers,
                        lastSeen: new Date().toISOString()
                      };
                    }
                  }
                  return chat;
                }));
              }
              return nextOnline;
            });
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await presenceChannel.track({
                id: currentUser.id,
                online_at: new Date().toISOString()
              });
            }
          });

        const handleTyping = (payload) => {
            const { userId, chatId, isTyping, userName } = payload.payload;
            const timeoutKey = `${chatId}:${userId}`;
            if (typingTimeoutsRef.current[timeoutKey]) {
              clearTimeout(typingTimeoutsRef.current[timeoutKey]);
              delete typingTimeoutsRef.current[timeoutKey];
            }
            if (isTyping) {
              setTypingStatuses((prev) => {
                const chatStatuses = { ...prev[chatId], [userId]: userName };
                return { ...prev, [chatId]: chatStatuses };
              });
              typingTimeoutsRef.current[timeoutKey] = setTimeout(() => {
                setTypingStatuses((prev) => {
                  const chatStatuses = { ...prev[chatId] };
                  delete chatStatuses[userId];
                  return { ...prev, [chatId]: chatStatuses };
                });
                delete typingTimeoutsRef.current[timeoutKey];
              }, 6000);
            } else {
              setTypingStatuses((prev) => {
                const chatStatuses = { ...prev[chatId] };
                delete chatStatuses[userId];
                return { ...prev, [chatId]: chatStatuses };
              });
            }
          };
        const typingChannels = new Map(
          String(realtimeChatIds || '').split(',').filter(Boolean).map((chatId) => {
            const channel = supabase.channel(`typing:chat:${chatId}`, { config: { private: true } });
            channel.on('broadcast', { event: 'typing' }, handleTyping).subscribe();
            return [chatId, channel];
          })
        );
        typingChannelRef.current = typingChannels;

        const storiesChannel = supabase
          .channel('db-stories')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, () => {
            fetchStories();
          })
          .subscribe();

        return () => {
          window.clearTimeout(memberRefreshTimer);
          for (const timeout of Object.values(typingTimeoutsRef.current)) clearTimeout(timeout);
          typingTimeoutsRef.current = {};
          msgChannel.unsubscribe();
          memberChannel.unsubscribe();
          presenceChannel.unsubscribe();
          for (const channel of typingChannels.values()) channel.unsubscribe();
          storiesChannel.unsubscribe();
          typingChannelRef.current = null;
        };
      }
    }
  }, [
    currentUser,
    realtimeChatIds,
    fetchChats,
    fetchStories,
    markMessagesAsRead,
    setSharedKeysCache,
    setChats,
    setOnlineUsers,
    setTypingStatuses,
    e2eePrivateKeyRef,
    sharedKeysCacheRef,
    activeChatIdRef,
    setActiveChatId,
    typingChannelRef,
    typingTimeoutsRef
  ]);
}
