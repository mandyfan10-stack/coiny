import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupportedRecordingMimeTypes, normalizeRecordingMimeType } from '../../utils/mediaRecording';
import {
  RECORD_HOLD_DELAY_MS,
  getRecordGesture,
  getRecordingConstraints,
  toggleRecordMode,
} from './chatAreaModel.ts';

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

/**
 * Hold-to-record voice and round-video messages.
 *
 * A short tap on the record button toggles voice/video; holding starts
 * recording. While held, swiping left cancels and swiping up locks hands-free
 * recording. `onRecorded(blob, mode)` receives the finished, non-empty blob.
 */
export default function useMediaRecorder({ uploading, onRecorded }) {
  const [recordMode, setRecordMode] = useState('voice');
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingStarting, setIsRecordingStarting] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [isLockActive, setIsLockActive] = useState(false);

  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const holdTimeoutRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordStartX = useRef(0);
  const recordStartY = useRef(0);
  const isCancelledRef = useRef(false);
  const isLockedRef = useRef(false);
  const isPausedRef = useRef(false);
  const isRecordingStartingRef = useRef(false);
  const pointerReleasedRef = useRef(true);
  const activeRecordPointerIdRef = useRef(null);
  const recordPointerMoveHandlerRef = useRef(null);
  const recordPointerUpHandlerRef = useRef(null);
  const recordPointerCancelHandlerRef = useRef(null);
  const isLockActiveRef = useRef(false);
  const videoPreviewRef = useRef(null);
  const stopRecordingAndSendRef = useRef(null);

  // The record button captures the pointer, but listen on window too so a
  // release outside the button still ends the gesture. Unmount stops devices.
  useEffect(() => {
    const handleGlobalPointerMove = (event) => recordPointerMoveHandlerRef.current?.(event);
    const handleGlobalPointerUp = (event) => recordPointerUpHandlerRef.current?.(event);
    const handleGlobalPointerCancel = (event) => recordPointerCancelHandlerRef.current?.(event);

    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerCancel);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch (error) {
          console.error('Failed to stop recorder during cleanup:', error);
        }
      }
      stopTracks(streamRef.current);
    };
  }, []);

  const startDurationTimer = () => {
    recordingTimerRef.current = setInterval(() => {
      setRecordDuration(previous => previous + 1);
    }, 1000);
  };

  const stopDurationTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const clearHoldTimeout = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  const setLockHint = (active) => {
    isLockActiveRef.current = active;
    setIsLockActive(active);
  };

  const cleanupRecordingState = () => {
    isRecordingRef.current = false;
    isRecordingStartingRef.current = false;
    setIsRecording(false);
    setIsRecordingStarting(false);
    setIsRecordingLocked(false);
    setIsRecordingPaused(false);
    isLockedRef.current = false;
    isPausedRef.current = false;
    pointerReleasedRef.current = true;
    activeRecordPointerIdRef.current = null;
    setLockHint(false);
    setRecordDuration(0);
    if (videoPreviewRef.current) {
      try {
        videoPreviewRef.current.srcObject = null;
      } catch (error) {
        console.error('Failed to clean up video preview:', error);
      }
    }
  };

  const createRecorder = (stream, mode) => {
    let lastRecorderError = null;
    for (const mimeType of [...getSupportedRecordingMimeTypes(mode, MediaRecorder), null]) {
      try {
        return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        lastRecorderError = error;
      }
    }
    throw lastRecorderError || new Error('MediaRecorder is unavailable');
  };

  const startRecording = async (mode) => {
    if (isRecordingStartingRef.current || isRecordingRef.current) return;

    isRecordingStartingRef.current = true;
    setIsRecordingStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(getRecordingConstraints(mode));

      // Permission prompts on mobile can outlive the original press. Never begin a
      // recording after the user has already released or cancelled that gesture.
      if (pointerReleasedRef.current || isCancelledRef.current) {
        stopTracks(stream);
        return;
      }

      streamRef.current = stream;

      if (mode === 'video') {
        setTimeout(() => {
          if (!videoPreviewRef.current) return;
          try {
            videoPreviewRef.current.srcObject = stream;
            videoPreviewRef.current.play().catch(error => console.error('Preview play failed', error));
          } catch (error) {
            console.error('Preview setup failed', error);
          }
        }, 50);
      }

      const chunks = [];
      mediaChunksRef.current = chunks;
      const recorder = createRecorder(stream, mode);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        stopTracks(stream);
        streamRef.current = null;
        mediaRecorderRef.current = null;
        isRecordingRef.current = false;
        const recordedMimeType = normalizeRecordingMimeType(recorder.mimeType || chunks[0]?.type, mode);
        cleanupRecordingState();

        if (isCancelledRef.current) return;

        const blob = new Blob(chunks, { type: recordedMimeType });
        if (blob.size === 0) {
          alert('Запись получилась пустой. Проверьте доступ к микрофону или камере и попробуйте ещё раз.');
          return;
        }

        await onRecordedRef.current(blob, mode);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);

      isRecordingRef.current = true;
      setIsRecording(true);
      isRecordingStartingRef.current = false;
      setIsRecordingStarting(false);
      setRecordDuration(0);
      startDurationTimer();
    } catch (err) {
      console.error('Failed to start recording:', err);
      stopTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      alert('Не удалось получить доступ к микрофону/камере: ' + err.message);
      cleanupRecordingState();
    } finally {
      if (!isRecordingRef.current) {
        isRecordingStartingRef.current = false;
        setIsRecordingStarting(false);
      }
    }
  };

  /** Finish the recording; with `isCancel` the captured media is discarded. */
  const stopRecordingAndSend = (isCancel = false) => {
    if (isCancel) isCancelledRef.current = true;
    stopDurationTimer();

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        isRecordingRef.current = false;
        mediaRecorderRef.current.stop();
      } else {
        stopTracks(streamRef.current);
        cleanupRecordingState();
      }
    } catch (error) {
      console.error('Error stopping media recorder:', error);
      try {
        stopTracks(streamRef.current);
      } catch (trackError) {
        console.error('Error stopping tracks in fallback:', trackError);
      }
      cleanupRecordingState();
    }
  };
  stopRecordingAndSendRef.current = stopRecordingAndSend;

  /** Discard an in-progress recording (chat switch, starting an edit). */
  const cancelRecording = useCallback(() => {
    if (isRecordingRef.current) stopRecordingAndSendRef.current?.(true);
  }, []);

  const pauseRecording = () => {
    try {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.pause();
    } catch (error) {
      console.error('Failed to pause media recorder:', error);
    }

    setIsRecordingPaused(true);
    isPausedRef.current = true;
    stopDurationTimer();

    if (recordMode === 'video' && videoPreviewRef.current) {
      try {
        videoPreviewRef.current.pause();
      } catch (error) {
        console.error('Preview pause failed', error);
      }
    }
  };

  const resumeRecording = () => {
    try {
      if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
    } catch (error) {
      console.error('Failed to resume media recorder:', error);
    }

    setIsRecordingPaused(false);
    isPausedRef.current = false;
    if (!recordingTimerRef.current) startDurationTimer();

    if (recordMode === 'video' && videoPreviewRef.current) {
      videoPreviewRef.current.play().catch(error => console.error('Preview resume play failed', error));
    }
  };

  const releaseRecordPointerCapture = (event) => {
    try {
      if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      console.error('Failed to release recording pointer capture:', error);
    }
  };

  const handlePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (
      activeRecordPointerIdRef.current !== null ||
      isRecordingRef.current ||
      isRecordingStartingRef.current ||
      uploading
    ) return;

    event.preventDefault();
    activeRecordPointerIdRef.current = event.pointerId;
    pointerReleasedRef.current = false;
    recordStartX.current = event.clientX;
    recordStartY.current = event.clientY;
    isCancelledRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    setIsRecordingLocked(false);
    setIsRecordingPaused(false);
    setLockHint(false);

    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.error('Failed to capture recording pointer:', error);
    }

    holdTimeoutRef.current = setTimeout(() => {
      holdTimeoutRef.current = null;
      void startRecording(recordMode);
    }, RECORD_HOLD_DELAY_MS);
  };

  const handlePointerMove = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    if (isLockedRef.current || isCancelledRef.current) return;

    event.preventDefault();
    const gesture = getRecordGesture({
      diffX: recordStartX.current - event.clientX,
      diffY: recordStartY.current - event.clientY,
      isLockActive: isLockActiveRef.current,
    });

    if (gesture.type === 'cancel') {
      isCancelledRef.current = true;
      pointerReleasedRef.current = true;
      setLockHint(false);
      clearHoldTimeout();
      if (isRecordingRef.current) stopRecordingAndSend(true);
    } else if (gesture.type === 'lock-hint' && gesture.active !== isLockActiveRef.current) {
      setLockHint(gesture.active);
    }
  };

  const handlePointerUp = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    event.preventDefault();
    releaseRecordPointerCapture(event);
    activeRecordPointerIdRef.current = null;
    pointerReleasedRef.current = true;

    if (isCancelledRef.current) return;

    if (holdTimeoutRef.current) {
      // Released before the hold delay: a tap toggles voice/video.
      clearHoldTimeout();
      setRecordMode(toggleRecordMode);
    } else if (isRecordingStartingRef.current && !isRecordingRef.current) {
      // startRecording will stop the late stream as soon as permission resolves.
      return;
    } else if (isRecordingRef.current) {
      if (isLockActiveRef.current) {
        isLockedRef.current = true;
        setIsRecordingLocked(true);
        return;
      }
      if (isLockedRef.current) return;
      stopRecordingAndSend(false);
    }
  };

  const handlePointerCancel = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    event.preventDefault();
    releaseRecordPointerCapture(event);
    activeRecordPointerIdRef.current = null;
    pointerReleasedRef.current = true;
    isCancelledRef.current = true;
    clearHoldTimeout();
    if (isRecordingRef.current) stopRecordingAndSend(true);
  };

  recordPointerMoveHandlerRef.current = handlePointerMove;
  recordPointerUpHandlerRef.current = handlePointerUp;
  recordPointerCancelHandlerRef.current = handlePointerCancel;

  return {
    recordMode,
    isRecording,
    isRecordingStarting,
    isRecordingLocked,
    isRecordingPaused,
    isLockActive,
    recordDuration,
    videoPreviewRef,
    isRecordingRef,
    cancelRecording,
    stopRecordingAndSend,
    pauseRecording,
    resumeRecording,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
