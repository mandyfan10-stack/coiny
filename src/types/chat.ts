import type { ChatMember, ChatMemberRole, ProfileId } from './profile';
import type { ChatMessage } from './message';

export type ChatId = string;
export type ChatType = 'personal' | 'group' | 'channel';

export interface ChatSettings {
  only_admins_can_post?: boolean;
  allow_media?: boolean;
  allow_add_members?: boolean;
  allow_pin_messages?: boolean;
  [key: string]: unknown;
}

export interface Chat {
  id: ChatId;
  name: string;
  type: ChatType;
  avatar?: string;
  avatarColor?: string;
  bio?: string;
  username?: string;
  createdBy?: ProfileId | null;
  savedMessagesOwnerId?: ProfileId | null;
  pinned?: boolean;
  notifications?: boolean;
  members: ChatMember[];
  settings?: ChatSettings;
  lastSeen?: string | null;
  messages: ChatMessage[];
}

export type { ChatMemberRole };
