import type { ProfileId } from './profile';

export type MessageId = string;

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
  userId?: string;
}

export interface ChatMessage {
  id: MessageId;
  senderId: ProfileId;
  senderName?: string;
  text: string | null;
  media?: string | null;
  replyTo?: MessageId | null;
  read?: boolean;
  reads?: ProfileId[];
  reactions?: MessageReaction[];
  timestamp: Date | string;
  createdAt?: string;
  isOptimistic?: boolean;
  isPending?: boolean;
  isFailed?: boolean;
  isLocked?: boolean;
  cryptoVersion?: 1 | 2;
  senderDeviceId?: string | null;
  encryptedPayload?: string | null;
  requiresUpdate?: boolean;
}

export interface OfflineQueueItem {
  queueId: string;
  chatId: string;
  senderId: ProfileId;
  text: string;
  replyToId?: MessageId | null;
  media?: string | null;
  optimisticId: MessageId;
  hasOfflineMedia?: boolean;
  mediaType?: string | null;
  isPending?: boolean;
  isFailed?: boolean;
}
