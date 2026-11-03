import { useRef } from 'react';

const MOBILE_MAX_WIDTH_PX = 768;
const START_ZONE_RATIO = 0.25;
const COMMIT_RATIO = 0.25;
const DIRECTION_LOCK_PX = 15;
const SETTLE_MS = 240;
const SETTLE_TRANSITION = `transform ${SETTLE_MS / 1000}s cubic-bezier(0.1, 0.76, 0.55, 0.94)`;

const isMobileViewport = () => window.innerWidth < MOBILE_MAX_WIDTH_PX;

/**
 * Interactive swipe-right-to-go-back for the chat pane on mobile: the pane
 * follows the finger and either slides out (past 25% width) or snaps back.
 * Returns the ref for the pane and its touch handlers.
 */
export default function useChatSwipeBack(onBack) {
  const paneRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchMoveRef = useRef({ x: 0, y: 0 });
  const isSwipeGestureRef = useRef(false);

  const resetGesture = () => {
    isSwipeGestureRef.current = false;
    touchStartRef.current = { x: 0, y: 0 };
  };

  const onTouchStart = (event) => {
    if (!isMobileViewport() || event.touches.length !== 1) return;
    const { clientX: startX, clientY: startY } = event.touches[0];
    if (startX > window.innerWidth * START_ZONE_RATIO) {
      touchStartRef.current = { x: 0, y: 0 };
      return;
    }
    touchStartRef.current = { x: startX, y: startY };
    touchMoveRef.current = { x: startX, y: startY };
    isSwipeGestureRef.current = false;
    if (paneRef.current) paneRef.current.style.transition = 'none';
  };

  const onTouchMove = (event) => {
    if (!isMobileViewport() || event.touches.length !== 1 || touchStartRef.current.x === 0) return;
    const { clientX: currentX, clientY: currentY } = event.touches[0];
    const deltaX = currentX - touchStartRef.current.x;
    const deltaY = currentY - touchStartRef.current.y;
    touchMoveRef.current = { x: currentX, y: currentY };
    if (!isSwipeGestureRef.current) {
      if (deltaX > DIRECTION_LOCK_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        isSwipeGestureRef.current = true;
      } else if (Math.abs(deltaY) > DIRECTION_LOCK_PX || deltaX < -DIRECTION_LOCK_PX) {
        touchStartRef.current = { x: 0, y: 0 };
      }
    }
    if (isSwipeGestureRef.current && deltaX > 0) {
      event.preventDefault();
      if (paneRef.current) paneRef.current.style.transform = `translate3d(${deltaX}px, 0, 0)`;
    }
  };

  const onTouchEnd = () => {
    if (!isMobileViewport() || !isSwipeGestureRef.current || touchStartRef.current.x === 0) {
      resetGesture();
      return;
    }
    const deltaX = touchMoveRef.current.x - touchStartRef.current.x;
    if (paneRef.current) paneRef.current.style.transition = SETTLE_TRANSITION;
    if (deltaX > window.innerWidth * COMMIT_RATIO) {
      if (paneRef.current) paneRef.current.style.transform = 'translate3d(100%, 0, 0)';
      setTimeout(() => {
        onBack();
        if (paneRef.current) {
          paneRef.current.style.transform = '';
          paneRef.current.style.transition = '';
        }
      }, SETTLE_MS);
    } else {
      if (paneRef.current) paneRef.current.style.transform = '';
      setTimeout(() => {
        if (paneRef.current) paneRef.current.style.transition = '';
      }, SETTLE_MS);
    }
    resetGesture();
  };

  return { paneRef, swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
