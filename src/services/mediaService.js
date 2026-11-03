// @ts-check
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { getStorageObjectPath } from '../utils/urlSecurity';
import { requireClient } from './serviceUtils.ts';

export const mediaService = {
  fetchStories: async () => {
    if (isSupabaseConfigured) {
      const { data, error } = await requireClient(supabase)
        .from('stories')
        .select('*, profiles(display_name, username, avatar, avatar_color)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((story) => ({
        ...story,
        media: story.media_path ? `storage://stories/${story.media_path}` : story.media
      }));
    }

    /** @type {any[]} */
    let savedStories = [];
    try {
      const stored = localStorage.getItem('tg-stories-mock');
      if (stored) savedStories = JSON.parse(stored);
    } catch {
      /* ignore */
    }

    if (savedStories.length === 0) {
      savedStories = [
        {
          id: 'demo-story-1',
          user_id: 'system',
          profiles: { display_name: 'Команда Coiny', avatar: '📢', avatar_color: '#3b82f6' },
          media: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
          caption: `Обновление Coiny ${import.meta.env.APP_VERSION}! 🚀`,
          created_at: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: 'demo-story-2',
          user_id: 'system',
          profiles: { display_name: 'Демо Бот', avatar: '🤖', avatar_color: '#ef4444' },
          media: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop',
          caption: 'Привет из Демо-режима 🪙',
          created_at: new Date(Date.now() - 7200000).toISOString()
        }
      ];
      localStorage.setItem('tg-stories-mock', JSON.stringify(savedStories));
    }
    return savedStories;
  },

  /**
   * @param {string} userId
   * @param {string} media storage reference or URL
   * @param {string} caption
   */
  publishStory: async (userId, media, caption) => {
    if (isSupabaseConfigured) {
      const { data, error } = await requireClient(supabase)
        .from('stories')
        .insert({
          user_id: userId,
          media,
          media_path: getStorageObjectPath(media, 'stories'),
          caption
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const savedUser = JSON.parse(localStorage.getItem('tg-user-mock') || '{}');
    const newStory = {
      id: `story-mock-${Date.now()}`,
      user_id: userId,
      profiles: {
        display_name: savedUser.name || 'Вы',
        username: savedUser.username || '',
        avatar: savedUser.avatar || '🪙',
        avatar_color: savedUser.avatarColor || '#ccc'
      },
      media,
      caption,
      created_at: new Date().toISOString()
    };

    /** @type {any[]} */
    let savedStories = [];
    try {
      const stored = localStorage.getItem('tg-stories-mock');
      if (stored) savedStories = JSON.parse(stored);
    } catch {
      /* ignore */
    }

    savedStories.push(newStory);
    localStorage.setItem('tg-stories-mock', JSON.stringify(savedStories));
    return newStory;
  },

  /** @param {string} storyId */
  deleteStory: async (storyId) => {
    if (isSupabaseConfigured) {
      const { error } = await requireClient(supabase)
        .from('stories')
        .delete()
        .eq('id', storyId);
      if (error) throw error;
      return true;
    }

    /** @type {any[]} */
    let savedStories = [];
    try {
      const stored = localStorage.getItem('tg-stories-mock');
      if (stored) savedStories = JSON.parse(stored);
    } catch {
      /* ignore */
    }
    savedStories = savedStories.filter((s) => s.id !== storyId);
    localStorage.setItem('tg-stories-mock', JSON.stringify(savedStories));
    return true;
  },

  /** @param {string} userId */
  fetchStickers: async (userId) => {
    if (!isSupabaseConfigured) return null;

    const { data: userPacks, error: err1 } = await requireClient(supabase)
      .from('user_sticker_packs')
      .select('pack_id, sticker_packs(*)')
      .eq('user_id', userId);

    if (err1) throw err1;

    return await Promise.all((userPacks || []).map(async (up) => {
      // Many-to-one embed: PostgREST returns one object, but the untyped
      // client infers an array for embedded relations.
      const pack = /** @type {any} */ (up.sticker_packs);
      if (!pack) return null;
      const { data: stickerList, error: err2 } = await requireClient(supabase)
        .from('stickers')
        .select('*')
        .eq('pack_id', pack.id)
        .order('created_at', { ascending: true });

      if (err2) throw err2;

      return {
        id: pack.id,
        name: pack.name,
        title: pack.title,
        is_animated: pack.is_animated,
        is_video: pack.is_video,
        stickers: (stickerList || []).map(s => ({
          id: s.id,
          emoji: s.emoji,
          filePath: s.file_path,
          width: s.width,
          height: s.height
        }))
      };
    }));
  },

  /**
   * @param {string} _userId
   * @param {string} packName
   */
  importStickerPack: async (_userId, packName) => {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await requireClient(supabase).functions.invoke('import-sticker-pack', {
      body: { packName }
    });
    if (error) throw error;
    return data;
  }
};
