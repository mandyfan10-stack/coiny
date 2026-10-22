import { useCallback, useEffect, useRef } from 'react';
import { removeVideoSender, replaceOrAddVideoTrack, stopStreamTracks } from './mediaTrackHelpers';

/** Camera/display requests belong to a call generation, including pending permissions. */
export function useCallMedia({
  callState, currentUser, chats, setLocalVideoStream, setIsScreenSharing,
  localVideoStreamRef, screenStreamRef, wasCameraActiveRef, pcRef, pcsRef,
  activeCallChannelRef, setMediaError, renegotiateMedia, mediaGenerationRef, callStateRef,
  videoRevisionRef
}) {
  const mounted = useRef(true);
  const operation = useRef(0);
  const latest = useRef({ callState, currentUser });
  latest.current = { callState, currentUser };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);
  const begin = () => ({
    generation: mediaGenerationRef?.current,
    callId: callState.callId,
    userId: currentUser?.id,
    operation: ++operation.current
  });
  const current = (token, checkOperation = true) => {
    const live = callStateRef?.current ?? latest.current.callState;
    return mounted.current && live.status === 'connected' && live.callId === token.callId
      && latest.current.currentUser?.id === token.userId
      && mediaGenerationRef?.current === token.generation
      && (!checkOperation || operation.current === token.operation);
  };
  const peers = () => chats.find(chat => chat.id === callState.chatId)?.type === 'group'
    ? Object.values(pcsRef.current) : [pcRef.current].filter(Boolean);
  const report = (token, message) => { if (current(token)) setMediaError?.(message); };
  const triggerRenegotiation = useCallback(async () => { await renegotiateMedia?.(); }, [renegotiateMedia]);

  const clearVideo = async (token) => {
    if (!current(token)) return;
    const video = localVideoStreamRef.current;
    const screen = screenStreamRef.current;
    screen?.getTracks().forEach(track => { track.onended = null; });
    localVideoStreamRef.current = null;
    screenStreamRef.current = null;
    if (videoRevisionRef) videoRevisionRef.current += 1;
    stopStreamTracks(video);
    if (screen !== video) stopStreamTracks(screen);
    setLocalVideoStream(null);
    setIsScreenSharing(false);
    for (const pc of peers()) removeVideoSender(pc);
    if (activeCallChannelRef.current) {
      try {
        const channel = activeCallChannelRef.current;
        const payload = { type: 'video-stopped', callId: token.callId, sessionId: token.callId, senderId: token.userId,
          ...(videoRevisionRef ? { videoRevision: videoRevisionRef.current } : {}) };
        const group = chats.find(chat => chat.id === callState.chatId)?.type === 'group';
        if (group) {
          for (const targetId of Object.keys(pcsRef.current)) {
            if (!current(token)) return;
            await channel.send({ type: 'broadcast', event: 'signal', payload: { ...payload, targetId } });
          }
        } else await channel.send({ type: 'broadcast', event: 'signal', payload });
      } catch { report(token, 'Не удалось сообщить об отключении видео.'); }
      if (current(token)) await triggerRenegotiation();
    }
  };
  const activate = async (stream, token, screen) => {
    if (!current(token)) { stopStreamTracks(stream); return false; }
    const previous = localVideoStreamRef.current;
    const videoTrack = stream.getVideoTracks()[0];
    const targets = new Set();
    try {
      // A group member can join while a native replaceTrack is pending. Bring
      // every current peer up to date before stopping the previous capture.
      let pending = peers();
      while (pending.length) {
        for (const pc of pending) {
          if (!current(token)) { stopStreamTracks(stream); return false; }
          targets.add(pc);
          await replaceOrAddVideoTrack(pc, videoTrack, stream);
          if (!current(token)) { stopStreamTracks(stream); return false; }
        }
        pending = peers().filter(pc => !targets.has(pc));
      }
      if (videoTrack?.readyState === 'ended') throw new Error('Capture ended before activation');
    } catch (error) {
      // A failed replacement must not leave an otherwise working camera sender
      // pointing at the newly rejected/stopped display stream.
      if (current(token)) {
        for (const pc of targets) {
          try {
            const track = previous?.getVideoTracks()[0];
            if (track && track.readyState !== 'ended') await replaceOrAddVideoTrack(pc, track, previous);
            else removeVideoSender(pc);
          } catch { /* Closed/replaced peers are cleaned up by their call owner. */ }
          if (!current(token)) break;
        }
      }
      stopStreamTracks(stream);
      throw error;
    }
    if (!current(token)) { stopStreamTracks(stream); return false; }
    screenStreamRef.current?.getTracks().forEach(track => { track.onended = null; });
    localVideoStreamRef.current = stream;
    screenStreamRef.current = screen ? stream : null;
    if (videoRevisionRef) videoRevisionRef.current += 1;
    setLocalVideoStream(stream);
    setIsScreenSharing(screen);
    if (previous !== stream) stopStreamTracks(previous);
    report(token, null);
    await triggerRenegotiation();
    return current(token);
  };
  const cleanupVideoTracks = async () => {
    const token = begin();
    if (current(token)) { wasCameraActiveRef.current = false; await clearVideo(token); }
  };
  const stopScreenSharing = async (revertToCamera = false) => {
    const token = begin();
    if (!current(token)) return;
    const restoreCamera = revertToCamera && wasCameraActiveRef.current;
    wasCameraActiveRef.current = false;
    await clearVideo(token);
    if (!restoreCamera || !current(token)) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (!current(token)) { stopStreamTracks(stream); return; }
      await activate(stream, token, false);
    } catch { report(token, 'Не удалось восстановить камеру. Проверьте разрешения.'); }
  };
  const toggleCallVideo = async () => {
    const token = begin();
    if (!current(token)) return;
    if (localVideoStreamRef.current && !screenStreamRef.current) {
      wasCameraActiveRef.current = false;
      await clearVideo(token);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (!current(token)) { stopStreamTracks(stream); return; }
      if (await activate(stream, token, false)) wasCameraActiveRef.current = false;
    } catch { report(token, 'Не удалось получить доступ к камере. Проверьте разрешения.'); }
  };
  const toggleCallScreenShare = async () => {
    if (screenStreamRef.current) { await stopScreenSharing(true); return; }
    const token = begin();
    if (!current(token)) return;
    const hadCamera = Boolean(localVideoStreamRef.current);
    try {
      // Retain the camera until display permission succeeds. Canceling the
      // browser picker must not stop a working camera or reopen its permission.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (!current(token)) { stopStreamTracks(stream); return; }
      wasCameraActiveRef.current = hadCamera;
      const screenTrack = stream.getVideoTracks()[0];
      screenTrack.onended = () => {
        if (current(token, false) && screenStreamRef.current === stream) void stopScreenSharing(true);
      };
      if (!await activate(stream, token, true)) return;
    } catch {
      if (current(token) && !screenStreamRef.current) wasCameraActiveRef.current = false;
      report(token, 'Не удалось начать демонстрацию экрана.');
    }
  };
  return { triggerRenegotiation, cleanupVideoTracks, stopScreenSharing, toggleCallVideo, toggleCallScreenShare };
}
