import { useCallback, useEffect, useRef, useState } from 'react';

export default function useImageFallback(sources) {
  const candidates = [...new Set(sources.filter(Boolean))];
  const key = JSON.stringify(candidates);
  const [state, setState] = useState({ key, index: 0, loaded: false, failed: false });
  const current = state.key === key ? state : { key, index: 0, loaded: false, failed: false };
  const latest = useRef(current);
  const imageRef = useRef(null);
  latest.current = current;
  const src = candidates[current.index];
  const index = current.index;
  const candidateCount = candidates.length;
  const advance = useCallback(() => {
    if (latest.current.key !== key || latest.current.index !== index || latest.current.loaded || latest.current.failed) return;
    setState(index + 1 < candidateCount
      ? { key, index: index + 1, loaded: false, failed: false }
      : { key, index, loaded: false, failed: true });
  }, [key, index, candidateCount]);

  useEffect(() => {
    if (!src || current.loaded || current.failed || !imageRef.current) return undefined;
    // A filtered CDN request can stall without firing an image error.
    // Lazy images outside the visible list must not time out before being requested.
    let timeout;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timeout);
      if (entry.isIntersecting) timeout = setTimeout(advance, 10_000);
    });
    observer.observe(imageRef.current);
    return () => { clearTimeout(timeout); observer.disconnect(); };
  }, [src, current.loaded, current.failed, advance]);

  return {
    src,
    ref: imageRef,
    loaded: current.loaded,
    failed: current.failed,
    onLoad: () => {
      if (latest.current.key === key && latest.current.index === index && !latest.current.failed) setState({ ...current, loaded: true });
    },
    onError: advance,
    retry: () => setState({ key, index: 0, loaded: false, failed: false })
  };
}
