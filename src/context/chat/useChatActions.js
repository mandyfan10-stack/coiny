import { useCallback, useRef } from 'react';
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
import { resolveSharedKey } from './decryptHelpers';
import { canEditMessage, preferMessageBody } from '../../utils/messageContent.ts';
import { prepareForwardMedia } from '../../services/forwardMedia';
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
  fetchChats,
  setOfflineQueue,
  e2eePrivateKeyRef,
  sharedKeysCacheRef,
  setSharedKeysCache
}) {
  // A logout invalidates old operations even when the same account signs in again.
  const sessionRef = useRef({ userId: currentUser?.id });
  if (sessionRef.current.userId !== currentUser?.id) sessionRef.current = { userId: currentUser?.id };
  const session = sessionRef.current;
  const isCurrentSession = useCallback(() => sessionRef.current === session, [session]);
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

  const createChat = useCallback(async (target, type = 'personal', initialMembers = [], options = {}) => {
    if (!currentUser) return null;
    try {
      const newChat = await dataService.createChat(currentUser.id, target, type, initialMembers);
      if (!isCurrentSession()) return null;
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
              publicKey: targetProfile.public_key || targetProfile.publicKey || null,
              hasE2ee: targetProfile.has_e2ee || targetProfile.hasE2ee || false,
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
        if (options.activate !== false) setActiveChatId(createdChat.id);
        return createdChat;
      }
      return null;
    } catch (e) {
      if (options.throwOnError) throw e;
      alert(e.message);
      return null;
    }
  }, [currentUser, isCurrentSession, fetchChats, setChats, setActiveChatId]);

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
      if (dataService.isLive()) {
        await fetchChats();
      } else {
        setChats((prevChats) => prevChats.map((c) => (c.id === chatId ? { ...c, messages: [] } : c)));
      }
      return true;
    } catch (e) {
      console.error(e);
      alert(`Не удалось очистить историю: ${e.message}`);
      return false;
    }
  }, [fetchChats, setChats]);

  const sendMessage = useCallback(async (text, replyToId = null, media = null, offlineMediaBlob = null, offlineMediaType = null, customMessageId = null, options = {}) => {
    const targetChatId = options.chatId || activeChatId;
    const sendingChat = chats.find(chat => chat.id === targetChatId)
      || (options.chat?.id === targetChatId ? options.chat : null);
    if (!sendingChat || sendingChat.requiresUpdate) return false;
    const wireText = text || '';
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText && !media && !offlineMediaBlob) return;
    if (!currentUser || !targetChatId || !isCurrentSession()) return false;
    if (options.requireConfirmation && !navigator.onLine) return false;

    const messageId = customMessageId || crypto.randomUUID();

    const optimisticMsg = {
      id: messageId,
      senderId: currentUser.id,
      senderName: currentUser.name || 'Вы',
      forwardedFrom: options.forwardedFrom || null,
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
        if (!isCurrentSession()) return false;
        tempMediaUrl = createManagedObjectUrl(`offline:${messageId}`, offlineMediaBlob);
        optimisticMsg.media = tempMediaUrl;
        hasOfflineMedia = true;
        optimisticMsg.isPending = true;
      } catch (e) {
        if (!isCurrentSession()) return false;
        console.error('Offline media cache failed:', e);
      }
    }

    setChats((prevChats) => prevChats.map((c) => {
      if (c.id === targetChatId) {
        return { ...c, messages: [...c.messages, optimisticMsg] };
      }
      return c;
    }));

    saveCachedMessage(optimisticMsg, targetChatId, currentUser.id);

    playSound('outgoing');

    if (!dataService.isLive() && sendingChat) {
      const isEchoBot = sendingChat.id === 'echo_bot' || sendingChat.username === 'echo_bot' || sendingChat.name === 'echo_bot';
      const isWeatherBot = sendingChat.id === 'weather_bot' || sendingChat.username === 'weather_bot' || sendingChat.name === 'weather_bot';
      const isQuizBot = sendingChat.id === 'quiz_bot' || sendingChat.username === 'quiz_bot' || sendingChat.name === 'quiz_bot';

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
          setChats((prev) => prev.map((c) => (c.id === targetChatId ? { ...c, messages: [...c.messages, botMsg] } : c)));
          playSound('incoming');
        }, 1000);
      }
    }

    if (!navigator.onLine || hasOfflineMedia) {
      setOfflineQueue((prev) => [...prev, createOfflineQueueItem({
        chatId: targetChatId,
        senderId: currentUser.id,
        text: wireText,
        forwardedFrom: options.forwardedFrom,
        replyToId,
        media: tempMediaUrl,
        optimisticId: messageId,
        hasOfflineMedia,
        mediaType: offlineMediaType
      })]);
      return messageId;
    }

    return (async () => {
      try {
        let textToSend = wireText;
        let mediaToSend = media;
        let forwardedFromToSend = options.forwardedFrom ? JSON.stringify({ name: options.forwardedFrom.name.slice(0, 128) }) : null;

        const requiresE2EE = requiresPersonalE2EE(sendingChat, currentUser.id);
        if (requiresE2EE) {
          const otherMember = sendingChat.members?.find((m) => m.id !== currentUser.id);
          let sharedKey = sharedKeysCacheRef.current[targetChatId];

          if (!sharedKey) {
            if (!e2eePrivateKeyRef.current || !otherMember?.publicKey) {
              requireE2EEKey(null);
            }
            const otherPublicKeyObj = await importPublicKey(otherMember.publicKey);
            if (!isCurrentSession()) return false;
            sharedKey = await deriveSymmetricKey(e2eePrivateKeyRef.current, otherPublicKeyObj);
            if (!isCurrentSession()) return false;
            setSharedKeysCache((prev) => ({ ...prev, [targetChatId]: sharedKey }));
          }

          requireE2EEKey(sharedKey);
          if (wireText) {
            const encryptedText = await encryptMessage(wireText, sharedKey);
            textToSend = `e2ee:aes-gcm:${encryptedText.ciphertext}:${encryptedText.iv}`;
          }
          if (forwardedFromToSend) {
            const encrypted = await encryptMessage(forwardedFromToSend, sharedKey);
            forwardedFromToSend = `e2ee:aes-gcm:${encrypted.ciphertext}:${encrypted.iv}`;
          }
          if (media) {
            const encryptedMedia = await encryptMessage(media, sharedKey);
            mediaToSend = `e2ee:aes-gcm:${encryptedMedia.ciphertext}:${encryptedMedia.iv}`;
          }
        }

        if (!isCurrentSession()) return false;
        await dataService.sendMessage(targetChatId, currentUser.id, textToSend, replyToId, mediaToSend, messageId, { forwardedFrom: forwardedFromToSend });
        if (!isCurrentSession()) return false;
        // Persist confirmed status to IndexedDB cache
        updateCachedMessageFields(messageId, { isOptimistic: false, isPending: false });

        // Confirm delivery locally even if the INSERT realtime event is coalesced
        // with an existing optimistic bubble.
        setChats((prevChats) => prevChats.map((c) => {
          if (c.id !== targetChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (
              m.id === messageId
                ? { ...m, isOptimistic: false, isPending: false }
                : m
            ))
          };
        }));
        return messageId;
      } catch (error) {
        if (!isCurrentSession()) return false;
        console.error('Send failed:', error);
        const isNetwork = !navigator.onLine || error.message?.includes('FetchError') || error.message?.includes('failed to fetch');
        if (isNetwork && !options.requireConfirmation) {
          updateCachedMessageFields(messageId, { isPending: true });
          setChats((prevChats) => prevChats.map((c) => {
            if (c.id === targetChatId) {
              return {
                ...c,
                messages: c.messages.map((m) => (m.id === messageId ? { ...m, isPending: true } : m))
              };
            }
            return c;
          }));

          setOfflineQueue((prev) => [...prev, createOfflineQueueItem({
            chatId: targetChatId,
            senderId: currentUser.id,
            text: wireText,
            forwardedFrom: options.forwardedFrom,
            replyToId,
            media,
            optimisticId: messageId,
            hasOfflineMedia: false
          })]);
          return messageId;
        } else {
          deleteCachedMessage(messageId);
          setChats((prevChats) => prevChats.map((c) => {
            if (c.id === targetChatId) {
              return { ...c, messages: c.messages.filter((m) => m.id !== messageId) };
            }
            return c;
          }));
          if (!options.requireConfirmation) alert(`Не удалось отправить сообщение: ${error.message}`);
        }
        return false;
      }
    })();
  }, [chats, activeChatId, currentUser, isCurrentSession, setSharedKeysCache, setChats, setOfflineQueue, e2eePrivateKeyRef, sharedKeysCacheRef]);

  const sendStoryReply = useCallback(async (story, text) => {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!currentUser || !story?.userId || story.userId === currentUser.id || !body) {
      throw new Error('Не удалось определить получателя ответа.');
    }
    const ensureOwner = () => {
      if (!isCurrentSession()) throw new Error('Аккаунт изменился.');
    };
    let targetChat = chats.find(chat => chat.type === 'personal'
      && chat.members?.some(member => member.id === currentUser.id)
      && chat.members?.some(member => member.id === story.userId));
    if (!targetChat) {
      const profile = dataService.isLive() ? await dataService.fetchProfile(story.userId)
        : { id: story.userId, name: story.userName, avatar: story.userAvatar };
      ensureOwner();
      if (!profile || profile.id !== story.userId) throw new Error('Профиль автора истории недоступен.');
      targetChat = await createChat(profile, 'personal', [], { activate: false, throwOnError: true });
    }
    ensureOwner();
    if (!targetChat) throw new Error('Не удалось открыть личный чат.');
    // A just-created chat may not have reached the next render yet. Carry its
    // verified destination and keys explicitly instead of using the active chat.
    const result = await sendMessage(`Ответ на историю: ${body}`, null, null, null, null, null,
      { chatId: targetChat.id, chat: targetChat, requireConfirmation: true });
    ensureOwner();
    if (!result) throw new Error('Не удалось отправить ответ. Текст сохранён.');
    return result;
  }, [currentUser, isCurrentSession, chats, createChat, sendMessage]);

  const editMessage = useCallback(async (chatId, message, text) => {
    if (!currentUser || !canEditMessage(message, currentUser.id)) throw new Error('Это сообщение нельзя изменить.');
    if (message.media && !canEditMessage({ ...message, text }, currentUser.id)) throw new Error('Используйте обычный текст для подписи вложения.');
    if (!navigator.onLine) throw new Error('Для изменения сообщения подключитесь к интернету.');
    const chat = chats.find(item => item.id === chatId);
    if (!chat || chat.requiresUpdate) throw new Error('Чат недоступен.');
    let wireText = text;
    if (requiresPersonalE2EE(chat, currentUser.id)) {
      const key = await resolveSharedKey({ chatId, chat, currentUserId: currentUser.id,
        e2eePrivateKey: e2eePrivateKeyRef.current, sharedKeysCache: sharedKeysCacheRef.current, setSharedKeysCache });
      requireE2EEKey(key);
      const encrypted = await encryptMessage(wireText, key);
      wireText = `e2ee:aes-gcm:${encrypted.ciphertext}:${encrypted.iv}`;
    }
    if (!isCurrentSession()) throw new Error('Аккаунт изменился.');
    const edited = await dataService.editMessage(message.id, wireText, message.editedAt || null);
    if (!isCurrentSession()) return false;
    const fields = { text, editedAt: edited.edited_at };
    setChats(previous => previous.map(item => item.id === chatId ? { ...item,
      messages: item.messages.map(old => {
        if (old.id !== message.id) return old;
        const updated = preferMessageBody(old, { ...old, ...fields });
        updateCachedMessageFields(message.id, updated).catch(() => {});
        return updated;
      }) } : item));
    return true;
  }, [currentUser, isCurrentSession, chats, setChats, e2eePrivateKeyRef, sharedKeysCacheRef, setSharedKeysCache]);

  const forwardMessages = useCallback(async (sourceChatId, targetChatId, messages, comment = '', onSent = () => {}) => {
    if (!currentUser || !navigator.onLine) throw new Error('Для пересылки подключитесь к интернету.');
    const source = chats.find(chat => chat.id === sourceChatId);
    const target = chats.find(chat => chat.id === targetChatId);
    if (!source || !target || target.requiresUpdate) throw new Error('Чат недоступен.');
    const own = target.createdBy === currentUser.id || target.members?.some(member => member.id === currentUser.id && member.role === 'admin');
    if (target.type === 'channel' && !own || target.settings?.only_admins_can_post && !own) throw new Error('В этот чат могут писать только администраторы.');
    if (messages.some(message => message.cryptoVersion === 2 || message.isLocked || message.requiresUpdate || message.isPending || message.isOptimistic || message.isFailed)) throw new Error('Одно из сообщений пока недоступно для пересылки.');
    if (target.type !== 'personal' && messages.some(message => message.media) && target.settings?.allow_media === false && !own) throw new Error('В этом чате запрещена отправка медиа.');
    const guard = () => { if (!isCurrentSession()) throw new Error('Аккаунт изменился.'); };
    if (comment.trim()) {
      guard();
      if (!await sendMessage(comment, null, null, null, null, null, { chatId: targetChatId })) throw new Error('Не удалось отправить комментарий.');
      onSent(null);
    }
    for (const message of messages) {
      guard();
      const id = crypto.randomUUID();
      const media = await prepareForwardMedia(message, source, target, currentUser.id, id, {
        e2eePrivateKey: e2eePrivateKeyRef.current, sharedKeysCache: sharedKeysCacheRef.current, setSharedKeysCache, guard
      });
      guard();
      const name = message.forwardedFrom?.name || message.senderName || source.members?.find(member => member.id === message.senderId)?.name || 'Пользователь';
      if (!await sendMessage(message.text || '', null, media, null, null, id, { chatId: targetChatId, forwardedFrom: { name } })) throw new Error('Не удалось переслать сообщение. Уже отправленные сообщения сохранены.');
      onSent(message.id);
    }
    return true;
  }, [currentUser, isCurrentSession, chats, sendMessage, e2eePrivateKeyRef, sharedKeysCacheRef, setSharedKeysCache]);

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

  const openSavedMessages = useCallback(async (options = {}) => {
    if (!currentUser) return null;
    const existing = chats.find((c) => isSavedMessagesChat(c, currentUser.id));
    if (existing) {
      if (options.activate !== false) setActiveChatId(existing.id);
      return existing;
    }

    if (dataService.isLive()) {
      try {
        const { supabase } = await import('../../supabaseClient');
        const { data: savedChatId, error: savedErr } = await supabase
          .rpc('ensure_saved_messages_chat');
        if (savedErr) throw savedErr;
        if (fetchChats) await fetchChats();
        if (savedChatId && options.activate !== false) {
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
        savedMessagesOwnerId: currentUser.id,
        members: [{ id: currentUser.id, name: currentUser.name || 'Вы' }],
        messages: []
      };
      setChats((prev) => [savedMock, ...prev.filter((c) => c.id !== savedMock.id)]);
      if (options.activate !== false) setActiveChatId(savedMock.id);
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
    sendStoryReply,
    deleteMessage,
    editMessage,
    forwardMessages,
    toggleReaction,
    updateChatAvatar,
    updateChatSettings,
    toggleMemberRole,
    addMemberToChat
  };
}
