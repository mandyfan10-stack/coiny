import type { ChatId } from './chat';
import type { ProfileId } from './profile';

export type CallStatus = 'idle' | 'incoming' | 'calling' | 'connected' | 'ended';
export type WebRtcState = 'disconnected' | 'connecting' | 'connected' | 'failed';

export interface CallerInfo {
  name?: string;
  avatar?: string;
  avatarColor?: string;
}

export interface CallState {
  status: CallStatus;
  callId?: string;
  ownerId?: ProfileId;
  expiresAt?: number;
  chatId: ChatId | null;
  /** Legacy field; live timer is local to CallOverlay (C9). */
  duration: number;
  muted: boolean;
  isOutgoing: boolean;
  callerInfo: CallerInfo | null;
  otherUserId: ProfileId | null;
  webrtcState: WebRtcState;
  isRemoteScreenSharing?: boolean;
  isLocalSpeaking?: boolean;
  isRemoteSpeaking?: boolean;
}

export interface GroupCallParticipant {
  id: ProfileId;
  name: string;
  avatar?: string;
  avatarColor?: string;
  muted?: boolean;
  videoStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  isCameraActive?: boolean;
  isScreenSharing?: boolean;
  speaking?: boolean;
  isReal?: boolean;
}
