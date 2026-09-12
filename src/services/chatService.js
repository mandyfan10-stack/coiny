import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { isMockOnlyBotProfile, isMockOnlyBotUsername } from '../utils/mockOnlyBots';
import { isSavedMessagesChat, SAVED_MESSAGES_DISPLAY_NAME } from '../utils/savedMessages';


function buildDefaultMockChats() {
  return [
    {
      id: 'mock-saved-messages',
      name: SAVED_MESSAGES_DISPLAY_NAME,
      type: 'personal',
      avatar: '🔖',
      avatarColor: '#5a9ae6',
      bio: 'Ваши сохраненные сообщения',
      username: 'saved_messages',
      createdBy: 'system',
      pinned: true,
      notifications: false,
      members: [],
      settings: { only_admins_can_post: false, allow_media: true, allow_add_members: false, allow_pin_messages: true },
      lastSeen: null,
      messages: []
    },
    {
      id: 'mock-echo-bot',
      name: 'Echo Bot 🤖',
      type: 'personal',
      avatar: '🤖',
      avatarColor: '#6cc452',
      bio: 'Я эхо-бот. Отправь мне сообщение.',
      username: 'echo_bot',
      createdBy: 'system',
      pinned: false,
      notifications: true,
      members: [],
      settings: { only_admins_can_post: false, allow_media: true, allow_add_members: false, allow_pin_messages: true },
      lastSeen: null,
      messages: []
    },
    {
      id: 'mock-quiz-bot',
      name: 'Quiz Master 🧠',
      type: 'personal',
      avatar: '🧠',
      avatarColor: '#e6905a',
      bio: 'Отвечай на вопросы.',
      username: 'quiz_bot',
      createdBy: 'system',
      pinned: false,
      notifications: true,
      members: [],
      settings: { only_admins_can_post: false, allow_media: true, allow_add_members: false, allow_pin_messages: true },
      lastSeen: null,
      messages: []
    },
    {
      id: 'mock-weather-bot',
      name: 'Weather Bot 🌤️',
      type: 'personal',
      avatar: '🌤️',
      avatarColor: '#5ad8e6',
      bio: 'Узнай погоду.',
      username: 'weather_bot',
      createdBy: 'system',
      pinned: false,
      notifications: true,
      members: [],
      settings: { only_admins_can_post: false, allow_media: true, allow_add_members: false, allow_pin_messages: true },
      lastSeen: null,
      messages: []
    },
    {
      id: 'mock-coiny-news',
      name: 'Coiny News 🚀',
      type: 'channel',
      avatar: '🚀',
      avatarColor: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
      bio: 'Официальные новости.',
      username: 'coiny_news',
      createdBy: 'system',
      pinned: false,
      notifications: true,
      members: [],
      settings: { only_admins_can_post: true, allow_media: true, allow_add_members: true, allow_pin_messages: true },
      lastSeen: null,
      messages: [{ id: 'msg-news-1', senderId: 'system', senderName: 'Coiny News 🚀', text: 'Добро пожаловать в Coiny!', timestamp: new Date().toISOString(), read: true, reactions: [] }]
    },
    {
      id: 'mock-coiny-community',
      name: 'Coiny Community 👥',
      type: 'group',
      avatar: '👥',
      avatarColor: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
      bio: 'Общение пользователей.',
      username: '',
      createdBy: 'system',
      pinned: false,
      notifications: true,
      members: [],
      settings: { only_admins_can_post: false, allow_media: true, allow_add_members: true, allow_pin_messages: true },
      lastSeen: null,
      messages: []
    }
  ];
}

const CHAT_SELECT = 'id, name, type, avatar, avatar_color, bio, username, created_by, settings';

export const chatService = {
  fetchChats: async (userId) => {
    if (isSupabaseConfigured) {
      const { data: memberships, error: membershipError } = await supabase
        .from('chat_members')
        .select('chat_id, notifications, pinned')
        .eq('profile_id', userId);
      if (membershipError) throw membershipError;

      const memberChatIds = [...new Set((memberships || []).map((row) => row.chat_id).filter(Boolean))];
      const [memberChatsResult, createdChatsResult] = await Promise.all([
        memberChatIds.length > 0
          ? supabase.from('chats').select(CHAT_SELECT).in('id', memberChatIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('chats').select(CHAT_SELECT).eq('created_by', userId)
      ]);
      if (memberChatsResult.error) throw memberChatsResult.error;
      if (createdChatsResult.error) throw createdChatsResult.error;

      const chatsById = new Map();
      for (const chat of [...(memberChatsResult.data || []), ...(createdChatsResult.data || [])]) {
        if (chat?.id) chatsById.set(chat.id, chat);
      }
      let rawChats = [...chatsById.values()];

      const hasSaved = rawChats.some((c) =>
        isSavedMessagesChat({
          type: c.type,
          name: c.name,
          username: c.username,
        }) && (c.created_by === userId || !c.created_by)
      );
      if (!hasSaved) {
        try {
          const { data: savedChatId, error: savedErr } = await supabase
            .rpc('ensure_saved_messages_chat');
          if (savedErr) throw savedErr;

          const { data: savedChat, error: savedChatErr } = await supabase
            .from('chats')
            .select(CHAT_SELECT)
            .eq('id', savedChatId)
            .single();
          if (savedChatErr) throw savedChatErr;
          if (savedChat && !rawChats.some(chat => chat.id === savedChat.id)) {
            rawChats.unshift(savedChat);
          }
        } catch (e) {
          console.warn('Failed to auto-create Saved Messages:', e);
        }
      }

      const chatList = rawChats;
      const chatIds = chatList.map(c => c.id);

      if (chatIds.length === 0) return [];

      const { data: e2eeConversations } = await supabase
        .from('e2ee_conversations')
        .select('chat_id, protocol_version, activation_epoch')
        .in('chat_id', chatIds);
      const e2eeConversationMap = new Map((e2eeConversations || []).map((row) => [row.chat_id, row]));

      const MEMBER_PROFILE_SELECT =
        'chat_id, profile_id, role, profiles(display_name, username, avatar, avatar_color, bio, last_seen, public_key, has_e2ee, banner)';
      const MEMBER_PROFILE_SELECT_LEGACY =
        'chat_id, profile_id, role, profiles(display_name, username, avatar, avatar_color, bio, last_seen, public_key, has_e2ee)';
      let membersResult = await supabase
        .from('chat_members')
        .select(MEMBER_PROFILE_SELECT)
        .in('chat_id', chatIds);
      if (
        membersResult.error
        && (membersResult.error.code === '42703'
          || String(membersResult.error.message || '').includes('banner'))
      ) {
        membersResult = await supabase
          .from('chat_members')
          .select(MEMBER_PROFILE_SELECT_LEGACY)
          .in('chat_id', chatIds);
      }
      if (membersResult.error) throw membersResult.error;
      const allMembersRaw = membersResult.data;

      const { data: latestMessages, error: latestMessagesError } = await supabase
        .rpc('get_latest_chat_messages', { p_chat_ids: chatIds });
      if (latestMessagesError) throw latestMessagesError;

      const latestMessagesMap = {};
      (latestMessages || []).forEach(message => {
        latestMessagesMap[message.chat_id] = message;
      });

      return (chatList || []).map((chat) => {
        const membersRaw = (allMembersRaw || []).filter(m => m.chat_id === chat.id);
        const membership = (memberships || []).find(m => m.chat_id === chat.id);

        const formattedMembers = membersRaw.map(m => ({
          id: m.profile_id,
          name: m.profiles?.display_name || m.profiles?.username || 'Пользователь',
          username: m.profiles?.username || '',
          avatar: m.profiles?.avatar || '👤',
          avatarColor: m.profiles?.avatar_color || '#ccc',
          bio: m.profiles?.bio || '',
          role: m.role || 'member',
          lastSeen: m.profiles?.last_seen || null,
          publicKey: m.profiles?.public_key || null,
          hasE2ee: m.profiles?.has_e2ee || false,
          banner: m.profiles?.banner || null
        }));

        const otherMember = chat.type === 'personal'
          ? formattedMembers.find(m => m.id !== userId)
          : null;

        // Live mode: hide legacy personal chats with mock-only demo bots.
        if (chat.type === 'personal' && isMockOnlyBotProfile(otherMember)) {
          return null;
        }

        const latestMsg = latestMessagesMap[chat.id] || null;
        const cryptoConversation = e2eeConversationMap.get(chat.id) || null;
        let messages = [];
        if (latestMsg) {
          messages = [{
            id: latestMsg.id,
            senderId: latestMsg.sender_id,
            senderName: formattedMembers.find(member => member.id === latestMsg.sender_id)?.name || 'Пользователь',
            text: latestMsg.text,
            media: latestMsg.media,
            cryptoVersion: latestMsg.crypto_version || 1,
            senderDeviceId: latestMsg.sender_device_id,
            encryptedPayload: latestMsg.encrypted_payload,
            requiresUpdate: latestMsg.crypto_version === 2 && import.meta.env.VITE_E2EE_V2_ENABLED !== 'true',
            replyTo: latestMsg.reply_to,
            read: latestMsg.legacy_read || (latestMsg.read_by || []).length > 0,
            reads: latestMsg.read_by || [],
            reactions: latestMsg.reactions || [],
            timestamp: new Date(latestMsg.created_at)
          }];
        }

        const defaultSettings = {
          only_admins_can_post: chat.type === 'channel',
          allow_media: true,
          allow_add_members: true,
          allow_pin_messages: true
        };

        return {
          id: chat.id,
          name: otherMember ? otherMember.name : chat.name,
          type: chat.type,
          avatar: otherMember ? otherMember.avatar : chat.avatar,
          avatarColor: otherMember ? otherMember.avatarColor : chat.avatar_color,
          bio: otherMember ? otherMember.bio : chat.bio,
          username: otherMember ? otherMember.username : chat.username,
          banner: otherMember ? otherMember.banner : (chat.banner || null),
          createdBy: chat.created_by,
          pinned: membership?.pinned || false,
          notifications: membership?.notifications ?? true,
          members: formattedMembers,
          settings: chat.settings ? { ...defaultSettings, ...chat.settings } : defaultSettings,
          cryptoVersion: cryptoConversation?.protocol_version || 1,
          cryptoEpoch: cryptoConversation?.activation_epoch ?? null,
          requiresUpdate: Boolean(cryptoConversation && import.meta.env.VITE_E2EE_V2_ENABLED !== 'true'),
          lastSeen: otherMember ? otherMember.lastSeen : null,
          messages
        };
      }).filter(Boolean);
    }

    const saved = localStorage.getItem('tg-chats-mock');
    let chats = [];
    try {
      const parsed = saved ? JSON.parse(saved) : [];
      chats = Array.isArray(parsed) ? parsed : [];
    } catch {
      chats = [];
    }

    if (!chats || chats.length === 0) {
      chats = buildDefaultMockChats();
      localStorage.setItem('tg-chats-mock', JSON.stringify(chats));
    }

    try {
      return chats.map((chat) => ({
        ...chat,
        members: Array.isArray(chat.members) ? chat.members : [],
        messages: (Array.isArray(chat.messages) ? chat.messages : []).map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }))
      }));
    } catch {
      return [];
    }
  },

  searchProfiles: async (query, excludeUserId, limit = 10, signal) => {
    const cleanQuery = String(query || '').trim().replace(/^@+/, '').toLowerCase();
    if (!cleanQuery) return [];

    if (!isSupabaseConfigured) {
      const mockUsers = JSON.parse(localStorage.getItem('tg-mock-users') || '[]');
      return mockUsers
        .filter(user => user.id !== excludeUserId)
        .filter(user => (
          String(user.username || '').toLowerCase().includes(cleanQuery)
          || String(user.name || user.display_name || '').toLowerCase().includes(cleanQuery)
        ))
        .slice(0, limit);
    }

    const escapedQuery = cleanQuery.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escapedQuery}%`;
    const createQuery = column => {
      let request = supabase
        .from('profiles')
        .select('id, username, display_name, avatar, avatar_color, bio, banner')
        .neq('id', excludeUserId)
        .ilike(column, pattern)
        .limit(limit);
      if (signal) request = request.abortSignal(signal);
      return request;
    };

    const [usernameResult, displayNameResult] = await Promise.all([
      createQuery('username'),
      createQuery('display_name')
    ]);
    if (usernameResult.error) throw usernameResult.error;
    if (displayNameResult.error) throw displayNameResult.error;

    const uniqueProfiles = new Map();
    [...(usernameResult.data || []), ...(displayNameResult.data || [])]
      .forEach(profile => {
        // Never surface mock-only demo bots in live Supabase search.
        if (isMockOnlyBotProfile(profile)) return;
        uniqueProfiles.set(profile.id, profile);
      });
    return [...uniqueProfiles.values()]
      .map(profile => ({ ...profile }))
      .slice(0, limit);
  },

  createChat: async (userId, target, type, initialMembers = []) => {
    if (isSupabaseConfigured) {
      if (type === 'personal') {
        let profile = typeof target === 'object' && target?.id ? target : null;
        if (!profile) {
          const cleanTarget = String(target || '').trim().replace(/^@+/, '').toLowerCase();
          if (isMockOnlyBotUsername(cleanTarget)) {
            throw new Error('Этот бот доступен только в demo/mock-режиме (без Supabase).');
          }
          const { data, error } = await supabase
            .from('profiles')
            .select('id, username, display_name, avatar, avatar_color, bio, banner')
            .eq('username', cleanTarget)
            .single();
          if (error || !data) {
            throw new Error(`Пользователь с никнеймом "${target}" не найден.`);
          }
          profile = data;
        }
        if (isMockOnlyBotProfile(profile)) {
          throw new Error('Этот бот доступен только в demo/mock-режиме (без Supabase).');
        }
        if (profile.id === userId) {
          throw new Error('Вы не можете создать чат с самим собой.');
        }

        const { data: personalChatId, error: personalChatError } = await supabase
          .rpc('ensure_personal_chat', { p_target_profile_id: profile.id });
        if (personalChatError) throw personalChatError;
        if (!personalChatId) throw new Error('Сервер не вернул идентификатор личного чата.');
        return {
          id: personalChatId,
          targetUserId: profile.id,
          name: profile.display_name || profile.username,
          type: 'personal',
          avatar: profile.avatar || '👤',
          avatarColor: profile.avatar_color,
          username: profile.username,
          bio: profile.bio || '',
          banner: profile.banner || null
        };
      }

      const memberIds = [...new Set(
        (Array.isArray(initialMembers) ? initialMembers : [])
          .map(member => typeof member === 'object' ? member.id : member)
          .filter(profileId => profileId && profileId !== userId)
      )];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const { data: newChatId, error: createError } = await supabase
          .rpc('create_managed_chat', {
            p_name: target,
            p_type: type,
            p_member_ids: memberIds
          })
          .abortSignal(controller.signal);
        if (createError) throw createError;
        if (!newChatId) throw new Error('Сервер не вернул идентификатор созданного чата.');
        return { id: newChatId, name: target, type };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error('Создание заняло слишком много времени. Проверьте соединение и повторите попытку.');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (type === 'personal') {
      const cleanTarget = String(typeof target === 'object' ? (target?.username || target?.id || '') : target).trim().replace(/^@+/, '').toLowerCase();
      const mockUsers = JSON.parse(localStorage.getItem('tg-mock-users') || '[]');
      const targetUser = typeof target === 'object' && target?.id
        ? target
        : (mockUsers.find(u => (u.username && u.username.toLowerCase() === cleanTarget) || u.id === cleanTarget) || {
            id: `mock-user-${cleanTarget || Date.now()}`,
            username: cleanTarget,
            name: cleanTarget,
            display_name: cleanTarget,
            avatar: '👤'
          });

      const memberObjects = [
        { id: userId, name: 'Вы', avatar: '🪙' },
        {
          id: targetUser.id,
          name: targetUser.display_name || targetUser.name || targetUser.username || cleanTarget,
          username: targetUser.username || cleanTarget,
          avatar: targetUser.avatar || '👤'
        }
      ];

      return {
        id: `chat-mock-${Date.now()}`,
        targetUserId: targetUser.id,
        name: targetUser.display_name || targetUser.name || targetUser.username || cleanTarget,
        username: targetUser.username || cleanTarget,
        type: 'personal',
        avatar: targetUser.avatar || '👤',
        avatarColor: targetUser.avatar_color || targetUser.avatarColor || 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
        pinned: false,
        notifications: true,
        bio: targetUser.bio || 'Новый контакт',
        createdBy: userId,
        settings: {
          only_admins_can_post: false,
          allow_media: true,
          allow_add_members: false,
          allow_pin_messages: true
        },
        members: memberObjects,
        messages: []
      };
    }

    const isGroup = type === 'group';
    const isChannel = type === 'channel';
    const name = target;

    const memberObjects = [{ id: userId, name: 'Вы', avatar: '🪙' }];
    if (Array.isArray(initialMembers)) {
      for (const m of initialMembers) {
        const memberId = typeof m === 'object' ? m.id : m;
        const memberName = typeof m === 'object' ? (m.display_name || m.username || m.name) : `User-${m}`;
        const memberAvatar = typeof m === 'object' ? (m.avatar || '👤') : '👤';
        if (memberId && memberId !== userId && !memberObjects.some(mo => mo.id === memberId)) {
          memberObjects.push({ id: memberId, name: memberName, avatar: memberAvatar });
        }
      }
    }

    return {
      id: `chat-mock-${Date.now()}`,
      name: name,
      type: type,
      avatar: isChannel ? '📢' : (isGroup ? '👥' : '👤'),
      avatarColor: isChannel ? 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' : 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
      pinned: false,
      notifications: true,
      bio: isChannel ? 'Новый канал' : (isGroup ? 'Новая группа' : 'Новый контакт'),
      createdBy: userId,
      settings: {
        only_admins_can_post: isChannel,
        allow_media: true,
        allow_add_members: true,
        allow_pin_messages: true
      },
      members: memberObjects,
      messages: []
    };
  },

  deleteChat: async (userId, chatId, chatType, createdBy) => {
    if (isSupabaseConfigured) {
      const isCreator = createdBy === userId;
      const isPersonal = chatType === 'personal';

      if (isPersonal || isCreator) {
        const { error } = await supabase
          .from('chats')
          .delete()
          .eq('id', chatId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chat_members')
          .delete()
          .eq('chat_id', chatId)
          .eq('profile_id', userId);
        if (error) throw error;
      }
      return true;
    }
    return true;
  },

  addMemberToChat: async (chatId, username) => {
    if (isSupabaseConfigured) {
      const cleanUsername = username.trim().toLowerCase();
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar, avatar_color, bio')
        .eq('username', cleanUsername)
        .single();

      if (profileErr || !profile) {
        throw new Error(`Пользователь с никнеймом "${username}" не найден.`);
      }

      const { error: insertErr } = await supabase
        .from('chat_members')
        .insert({ chat_id: chatId, profile_id: profile.id });

      if (insertErr) throw insertErr;

      return {
        id: profile.id,
        name: profile.display_name || profile.username,
        username: profile.username,
        avatar: profile.avatar || '👤',
        avatarColor: profile.avatar_color || '#ccc',
        bio: profile.bio || ''
      };
    }

    const mockUsers = JSON.parse(localStorage.getItem('tg-mock-users') || '[]');
    const user = mockUsers.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) {
      throw new Error(`Пользователь с никнеймом "${username}" не найден.`);
    }
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      avatar: user.avatar || '👤',
      avatarColor: user.avatarColor || '#ccc',
      bio: user.bio || ''
    };
  },

  toggleMemberRole: async (chatId, profileId, targetRole) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('chat_members')
        .update({ role: targetRole })
        .eq('chat_id', chatId)
        .eq('profile_id', profileId);
      if (error) throw error;
    }
  },

  updateChatAvatar: async (chatId, base64Avatar) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('chats')
        .update({ avatar: base64Avatar })
        .eq('id', chatId);
      if (error) throw error;
    }
  },

  updateChatSettings: async (chatId, newSettings) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('chats')
        .update({ settings: newSettings })
        .eq('id', chatId);
      if (error) throw error;
    }
  }
};
