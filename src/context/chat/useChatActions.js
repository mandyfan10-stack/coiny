import { useCallback } from 'react';
import { dataService } from '../../services/dataLayer';
import {
  importPublicKey,
  deriveSymmetricKey,
  encryptMessage,
  requireE2EEKey
} from '../../utils/e2eeHelper';
import {
  saveOfflineAttachment,
  saveCachedMessage,
  deleteCachedMessage,
  updateCachedMessageFields
} from '../../utils/indexedDbHelper';
import { createManagedObjectUrl } from '../../utils/objectUrlRegistry';
import {
  cloneReactions,
  isAllowedReactionEmoji,
  normalizeReactions,
  toggleUserReaction,
} from '../../utils/reactionUtils';
import { playSound } from '../../utils/sounds';
import { createOfflineQueueItem } from '../../services/offlineQueueCore.js';
import { isSavedMessagesChat, requiresPersonalE2EE } from '../../utils/savedMessages';

/**
 * Chat mutations: create/delete, send, reactions, members, settings.
 */
export function useChatActions({
  currentUser,
  chats,
  setChats,
  activeChatId,
  setActiveChatId,
  activeChat,
  fetchChats,
  setOfflineQueue,
  e2eePrivateKeyRef,
  sharedKeysCacheRef,
  setSharedKeysCache
}) {
  const markMessagesAsRead = useCallback(async (chatId) => {
    if (!currentUser || !chatId) return;
    try {
      await dataService.markMessagesAsRead(chatId, currentUser.id);

      setChats((prevChats) => prevChats.map((c) => {
        if (c.id === chatId) {
          const updatedMessages = c.messages.map((m) => {
            if (m.senderId !== currentUser.id && !m.read) {
              updateCachedMessageFields(m.id, { read: true });
              return { ...m, read: true };
            }
            return m;
          });
          return { ...c, messages: updatedMessages, unread_count: 0 };
        }
        return c;
      }));
    } catch (e) {
      console.error(e);
    }
  }, [currentUser, setChats]);

  const createChat = useCallback(async (target, type = 'personal', initialMembers = []) => {
    if (!currentUser) return null;
    try {
      const newChat = await dataService.createChat(currentUser.id, target, type, initialMembers);
      if (newChat) {
        let createdChat = newChat;
        if (!dataService.isLive()) {
          setChats((prev) => [newChat, ...prev]);
        } else if (type === 'personal') {
          const targetProfile = (typeof target === 'object' && target?.id)
            ? target
            : {
                id: newChat.targetUserId || newChat.target_profile_id,
                name: newChat.name,
                username: newChat.username,
                avatar: newChat.avatar,
                avatarColor: newChat.avatarColor,
                bio: newChat.bio,
                banner: newChat.banner
              };
          createdChat = {
            ...newChat,
            name: newChat.name || targetProfile.display_name || targetProfile.username || targetProfile.name || String(target),
            avatar: newChat.avatar || targetProfile.avatar || '👤',
            avatarColor: newChat.avatarColor || targetProfile.avatar_color || targetProfile.avatarColor,
            username: newChat.username || targetProfile.username || '',
            bio: newChat.bio || targetProfile.bio || '',
            banner: newChat.banner || targetProfile.banner || null,
            createdBy: currentUser.id,
            pinned: false,
            notifications: true,
            messages: [],
            members: [{
              id: currentUser.id,
              name: currentUser.name || currentUser.username || 'Вы',
              username: currentUser.username,
              avatar: currentUser.avatar || '👤',
              avatarColor: currentUser.avatarColor,
              bio: currentUser.bio || '',
              banner: currentUser.banner || null,
              role: 'member'
            }, {
              id: targetProfile.id,
              name: targetProfile.display_name || targetProfile.username || targetProfile.name || newChat.name,
              username: targetProfile.username || newChat.username,
              avatar: targetProfile.avatar || newChat.avatar || '👤',
              avatarColor: targetProfile.avatar_color || targetProfile.avatarColor || newChat.avatarColor,
              bio: targetProfile.bio || newChat.bio || '',
              banner: targetProfile.banner || newChat.banner || null,
              role: 'member'
            }].filter((member) => member.id),
            settings: {
              only_admins_can_post: false,
              allow_media: true,
              allow_add_members: false,
              allow_pin_messages: true
            }
          };
          setChats((previous) => {
            const existingIndex = previous.findIndex((chat) => chat.id === createdChat.id);
            if (existingIndex === -1) return [createdChat, ...previous];
            return previous.map((chat) => (chat.id === createdChat.id ? { ...createdChat, ...chat } : chat));
          });
          fetchChats().catch((error) => console.error('Failed to refresh chats after opening personal chat:', error));
        } else {
          const memberProfiles = (Array.isArray(initialMembers) ? initialMembers : [])
            .filter((member) => member && member.id && member.id !== currentUser.id)
            .map((member) => ({
              id: member.id,
              name: member.display_name || member.name || member.username || 'Пользователь',
              username: member.username,
              avatar: member.avatar || '👤',
              avatarColor: member.avatar_color || member.avatarColor,
              role: 'member'
            }));
          createdChat = {
            ...newChat,
            name: newChat.name || target,
            type,
            avatar: newChat.avatar || (type === 'channel' ? '📢' : '👥'),
            avatarColor: newChat.avatarColor || (type === 'channel'
              ? 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)'
              : 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)'),
            createdBy: currentUser.id,
            pinned: false,
            notifications: true,
            messages: [],
            members: [{
              id: currentUser.id,
              name: currentUser.name || currentUser.username || 'Вы',
              username: currentUser.username,
              avatar: currentUser.avatar || '🪙',
              avatarColor: currentUser.avatarColor,
              role: 'admin'
            }, ...memberProfiles],
            settings: {
              only_admins_can_post: type === 'channel',
              allow_media: true,
              allow_add_members: true,
              allow_pin_messages: true
            }
          };
          setChats((previous) => (
            previous.some((chat) => chat.id === createdChat.id) ? previous : [createdChat, ...previous]
          ));
          fetchChats().catch((error) => console.error('Failed to refresh chats after creation:', error));
        }
        setActiveChatId(createdChat.id);
        return createdChat;
      }
      return null;
    } catch (e) {
      alert(e.message);
      return null;
    }
  }, [currentUser, fetchChats, setChats, setActiveChatId]);

  const deleteChat = useCallback(async (chatId) => {
    if (!currentUser || !chatId) return false;
    const chatToDelete = chats.find((c) => c.id === chatId);
    if (!chatToDelete) return false;
    try {
      await dataService.deleteChat(currentUser.id, chatId, chatToDelete.type, chatToDelete.createdBy);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
      }
      return true;
    } catch (e) {
      console.error(e);
      alert(`Не удалось удалить чат: ${e.message}`);
      return false;
    }
  }, [currentUser, chats, activeChatId, setChats, setActiveChatId]);

  const clearChatMessages = useCallback(async (chatId) => {
    try {
      await dataService.clearChatMessages(chatId);
      setChats((prevChats) => prevChats.map((c) => (c.id === chatId ? { ...c, messages: [] } : c)));
      return true;
    } catch (e) {
      console.error(e);
      alert(`Не удалось очистить историю: ${e.message}`);
      return false;
    }
  }, [setChats]);

  const sendMessage = useCallback(async (text, replyToId = null, media = null, offlineMediaBlob = null, offlineMediaType = null, customMessageId = null) => {
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText && !media && !offlineMediaBlob) return;
    if (!currentUser || !activeChatId) return;

    const messageId = customMessageId || crypto.randomUUID();

    const optimisticMsg = {
      id: messageId,
      senderId: currentUser.id,
      senderName: currentUser.name || 'Вы',
      text: typeof text === 'string' ? text : '',
      media: media,
      replyTo: replyToId,
      read: false,
      timestamp: new Date(),
      isOptimistic: true,
      isPending: !navigator.onLine
    };

    let hasOfflineMedia = false;
    let tempMediaUrl = media;

    if (offlineMediaBlob) {
      try {
        await saveOfflineAttachment(messageId, offlineMediaBlob, currentUser.id);
        tempMediaUrl = createManagedObjectUrl(`offline:${messageId}`, offlineMediaBlob);
        optimisticMsg.media = tempMediaUrl;
        hasOfflineMedia = true;
        optimisticMsg.isPending = true;
      } catch (e) {
        console.error('Offline media cache failed:', e);
      }
    }

    setChats((prevChats) => prevChats.map((c) => {
      if (c.id === activeChatId) {
        return { ...c, messages: [...c.messages, optimisticMsg] };
      }
      return c;
    }));

    saveCachedMessage(optimisticMsg, activeChatId, currentUser.id);

    playSound('outgoing');

    if (!dataService.isLive() && activeChat) {
      const isEchoBot = activeChat.id === 'echo_bot' || activeChat.username === 'echo_bot' || activeChat.name === 'echo_bot';
      const isWeatherBot = activeChat.id === 'weather_bot' || activeChat.username === 'weather_bot' || activeChat.name === 'weather_bot';
      const isQuizBot = activeChat.id === 'quiz_bot' || activeChat.username === 'quiz_bot' || activeChat.name === 'quiz_bot';

      let botResponse = '';
      let botId = '';
      let botName = '';

      if (isEchoBot) {
        botResponse = `🤖 Эхо: ${text || 'Медиа'} ✨`;
        botId = 'echo_bot';
        botName = 'Эхо Бот';
      } else if (isWeatherBot) {
        botResponse = `🌤️ Прогноз погоды для ${text || 'города'}: +22°C, Ясно, ветер 4 м/с. Влажность 52%.`;
        botId = 'weather_bot';
        botName = 'Погода Бот';
      } else if (isQuizBot) {
        botResponse = '🧠 Викторина: Отличный выбор! Вопрос 1/5: Какая криптовалюта была создана первой?\n1. Ethereum\n2. Bitcoin\n3. Solana';
        botId = 'quiz_bot';
        botName = 'Викторина Бот';
      }

      if (botResponse) {
        setTimeout(() => {
          const botMsg = {
            id: crypto.randomUUID(),
            senderId: botId,
            senderName: botName,
            text: botResponse,
            media: null,
            replyTo: replyToId,
            read: false,
            timestamp: new Date(),
            isOptimistic: false,
            isPending: false
          };
          setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, messages: [...c.messages, botMsg] } : c)));
          playSound('incoming');
        }, 1000);
      }
    }

    if (!navigator.onLine || hasOfflineMedia) {
      setOfflineQueue((prev) => [...prev, createOfflineQueueItem({
        chatId: activeChatId,
        senderId: currentUser.id,
        text,
        replyToId,
        media: tempMediaUrl,
        optimisticId: messageId,
        hasOfflineMedia,
        mediaType: offlineMediaType
      })]);
      return;
    }

    (async () => {
      try {
        let textToSend = text;
        let mediaToSend = media;

        const requiresE2EE = requiresPersonalE2EE(activeChat);
        if (requiresE2EE) {
          const otherMember = activeChat.members?.find((m) => m.id !== currentUser.id);
          let sharedKey = sharedKeysCacheRef.current[activeChatId];

          if (!sharedKey) {
            if (!e2eePrivateKeyRef.current || !otherMember?.publicKey) {
              requireE2EEKey(null);
            }
            const otherPublicKeyObj = await importPublicKey(otherMember.publicKey);
            sharedKey = await deriveSymmetricKey(e2eePrivateKeyRef.current, otherPublicKeyObj);
            setSharedKeysCache((prev) => ({ ...prev, [activeChatId]: sharedKey }));
          }

          requireE2EEKey(sharedKey);
          if (text) {
            const encryptedText = await encryptMessage(text, sharedKey);
            textToSend = `e2ee:aes-gcm:${encryptedText.ciphertext}:${encryptedText.iv}`;
          }
          if (media) {
            const encryptedMedia = await encryptMessage(media, sharedKey);
            mediaToSend = `e2ee:aes-gcm:${encryptedMedia.ciphertext}:${encryptedMedia.iv}`;
          }
        }

        await dataService.sendMessage(activeChatId, currentUser.id, textToSend, replyToId, mediaToSend, messageId);
        // Persist confirmed status to IndexedDB cache
        updateCachedMessageFields(messageId, { isOptimistic: false, isPending: false });

        // Confirm delivery locally even if the INSERT realtime event is coalesced
        // with an existing optimistic bubble.
        setChats((prevChats) => prevChats.map((c) => {
          if (c.id !== activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (
              m.id === messageId
                ? { ...m, isOptimistic: false, isPending: false }
                : m
            ))
          };
        }));
      } catch (error) {
        console.error('Send failed:', error);
        const isNetwork = !navigator.onLine || error.message?.includes('FetchError') || error.message?.includes('failed to fetch');
        if (isNetwork) {
          updateCachedMessageFields(messageId, { isPending: true });
          setChats((prevChats) => prevChats.map((c) => {
            if (c.id === activeChatId) {
              return {
                ...c,
                messages: c.messages.map((m) => (m.id === messageId ? { ...m, isPending: true } : m))
              };
            }
            return c;
          }));

          setOfflineQueue((prev) => [...prev, createOfflineQueueItem({
            chatId: activeChatId,
            senderId: currentUser.id,
            text,
            replyToId,
            media,
            optimisticId: messageId,
            hasOfflineMedia: false
          })]);
        } else {
          deleteCachedMessage(messageId);
          setChats((prevChats) => prevChats.map((c) => {
            if (c.id === activeChatId) {
              return { ...c, messages: c.messages.filter((m) => m.id !== messageId) };
            }
            return c;
          }));
          alert(`Не удалось отправить сообщение: ${error.message}`);
        }
      }
    })();
  }, [activeChatId, currentUser, activeChat, setSharedKeysCache, setChats, setOfflineQueue, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const deleteMessage = useCallback(async (chatId, messageId) => {
    try {
      deleteCachedMessage(messageId);
      await dataService.deleteMessage(messageId);
      setChats((prevChats) => prevChats.map((c) => {
        if (c.id === chatId) {
          return { ...c, messages: c.messages.filter((m) => m.id !== messageId) };
        }
        return c;
      }));
    } catch (e) {
      console.error(e);
    }
  }, [setChats]);

  const toggleReaction = useCallback(async (chatId, messageId, emoji) => {
    if (!isAllowedReactionEmoji(emoji)) return;

    const userKey = currentUser ? currentUser.id : 'current';
    let previousReactions = null;

    setChats((prevChats) => prevChats.map((c) => {
      if (c.id !== chatId) return c;
      return {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id !== messageId) return m;
          previousReactions = cloneReactions(normalizeReactions(m.reactions));
          const next = toggleUserReaction(previousReactions, emoji, userKey);
          updateCachedMessageFields(messageId, { reactions: next });
          return { ...m, reactions: next };
        }),
      };
    }));

    try {
      if (dataService.isLive()) {
        const serverReactions = await dataService.toggleReaction(messageId, emoji);
        if (Array.isArray(serverReactions)) {
          const normalized = normalizeReactions(serverReactions);
          updateCachedMessageFields(messageId, { reactions: normalized });
          setChats((prevChats) => prevChats.map((c) => {
            if (c.id !== chatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) => (
                m.id === messageId
                  ? { ...m, reactions: normalized }
                  : m
              )),
            };
          }));
        }
      }
    } catch (err) {
      console.error(err);
      if (previousReactions) {
        updateCachedMessageFields(messageId, { reactions: previousReactions });
        setChats((prevChats) => prevChats.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (
              m.id === messageId ? { ...m, reactions: previousReactions } : m
            )),
          };
        }));
      }
    }
  }, [currentUser, setChats]);

  const updateChatAvatar = useCallback(async (chatId, base64Avatar) => {
    if (!currentUser || !chatId) return;
    try {
      await dataService.updateChatAvatar(chatId, base64Avatar);
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, avatar: base64Avatar } : c)));
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }, [currentUser, setChats]);

  const updateChatSettings = useCallback(async (chatId, newSettings) => {
    if (!currentUser || !chatId) return false;
    try {
      await dataService.updateChatSettings(chatId, newSettings);
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, settings: newSettings } : c)));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [currentUser, setChats]);

  const toggleMemberRole = useCallback(async (chatId, profileId, currentRole) => {
    if (!currentUser || !chatId || !profileId) return false;
    const targetRole = currentRole === 'admin' ? 'member' : 'admin';
    try {
      await dataService.toggleMemberRole(chatId, profileId, targetRole);
      setChats((prev) => prev.map((c) => {
        if (c.id === chatId) {
          return {
            ...c,
            members: c.members.map((m) => (m.id === profileId ? { ...m, role: targetRole } : m))
          };
        }
        return c;
      }));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [currentUser, setChats]);

  const addMemberToChat = useCallback(async (chatId, username) => {
    if (!currentUser || !chatId || !username.trim()) return { error: 'Неверные данные' };
    try {
      const newMember = await dataService.addMemberToChat(chatId, username);
      setChats((prev) => prev.map((c) => {
        if (c.id === chatId) {
          if (c.members.some((m) => m.id === newMember.id)) return c;
          return { ...c, members: [...c.members, newMember] };
        }
        return c;
      }));
      return { success: true, profile: newMember };
    } catch (e) {
      return { error: e.message };
    }
  }, [currentUser, setChats]);

  const openSavedMessages = useCallback(async () => {
    if (!currentUser) return null;
    const existing = chats.find((c) => isSavedMessagesChat(c));
    if (existing) {
      setActiveChatId(existing.id);
      return existing;
    }

    if (dataService.isLive()) {
      try {
        const { supabase } = await import('../../supabaseClient');
        const { data: savedChatId, error: savedErr } = await supabase
          .rpc('ensure_saved_messages_chat');
        if (savedErr) throw savedErr;
        if (fetchChats) await fetchChats();
        if (savedChatId) {
          setActiveChatId(savedChatId);
        }
        return savedChatId ? { id: savedChatId, name: 'Избранное' } : null;
      } catch (err) {
        console.error('Failed to open saved messages:', err);
        return null;
      }
    } else {
      const savedMock = {
        id: `chat-saved-${currentUser.id}`,
        name: 'Избранное',
        type: 'personal',
        avatar: '🔖',
        pinned: true,
        createdBy: currentUser.id,
        members: [{ id: currentUser.id, name: currentUser.name || 'Вы' }],
        messages: []
      };
      setChats((prev) => [savedMock, ...prev.filter((c) => c.id !== savedMock.id)]);
      setActiveChatId(savedMock.id);
      return savedMock;
    }
  }, [currentUser, chats, fetchChats, setActiveChatId, setChats]);

  const joinChatByInvite = useCallback(async (invite) => {
    if (!currentUser) return null;
    try {
      const res = await dataService.joinChatByInvite(currentUser.id, invite);
      if (res && res.id) {
        if (fetchChats) {
          await fetchChats();
        }
        return res;
      }
      return null;
    } catch (err) {
      console.error('Failed to join chat by invite:', err);
      throw err;
    }
  }, [currentUser, fetchChats]);

  return {
    markMessagesAsRead,
    createChat,
    joinChatByInvite,
    openSavedMessages,
    deleteChat,
    clearChatMessages,
    sendMessage,
    deleteMessage,
    toggleReaction,
    updateChatAvatar,
    updateChatSettings,
    toggleMemberRole,
    addMemberToChat
  };
}
