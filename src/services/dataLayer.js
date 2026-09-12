/**
 * Unified data access facade.
 * Domain logic lives in authService / chatService / messageService / mediaService.
 * Call sites keep using `dataService.*` for a stable API.
 *
 * @typedef {import('../types').Chat} Chat
 * @typedef {import('../types').ChatMessage} ChatMessage
 * @typedef {import('../types').Profile} Profile
 */
import { isSupabaseConfigured } from '../supabaseClient';
import { authService } from './authService';
import { chatService } from './chatService';
import { messageService } from './messageService';
import { mediaService } from './mediaService';
import { v1MessageCompatibilityAdapter } from './v1MessageCompatibilityAdapter.js';

/** @type {{ isLive: () => boolean } & Record<string, Function>} */
export const dataService = {
  isLive: () => isSupabaseConfigured,

  // Auth + profile + E2EE backup
  signUp: authService.signUp,
  signIn: authService.signIn,
  signOut: authService.signOut,
  resetPasswordForEmail: authService.resetPasswordForEmail,
  resetPassword: authService.resetPasswordForEmail,
  fetchProfile: authService.fetchProfile,
  updateProfile: authService.updateProfile,
  saveE2EEBackup: authService.saveE2EEBackup,
  getE2EEBackup: authService.getE2EEBackup,
  deleteE2EEBackup: authService.deleteE2EEBackup,

  // Chats + members
  fetchChats: chatService.fetchChats,
  searchProfiles: chatService.searchProfiles,
  createChat: chatService.createChat,
  deleteChat: chatService.deleteChat,
  addMemberToChat: chatService.addMemberToChat,
  toggleMemberRole: chatService.toggleMemberRole,
  updateChatAvatar: chatService.updateChatAvatar,
  updateChatSettings: chatService.updateChatSettings,
  joinChatByInvite: chatService.joinChatByInvite,

  // Messages
  loadChatMessages: messageService.loadChatMessages,
  clearChatMessages: messageService.clearChatMessages,
  sendMessage: (...args) => (
    args[0] && typeof args[0] === 'object'
      ? messageService.sendMessage(args[0])
      : v1MessageCompatibilityAdapter.sendMessage(...args)
  ),
  deleteMessage: messageService.deleteMessage,
  toggleReaction: messageService.toggleReaction,
  markMessagesAsRead: messageService.markMessagesAsRead,

  // Stories + stickers
  fetchStories: mediaService.fetchStories,
  publishStory: mediaService.publishStory,
  deleteStory: mediaService.deleteStory,
  fetchStickers: mediaService.fetchStickers,
  importStickerPack: mediaService.importStickerPack
};

export { authService, chatService, messageService, mediaService };
