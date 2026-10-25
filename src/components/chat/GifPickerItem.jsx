import { Loader2, RotateCw } from 'lucide-react';
import useImageFallback from '../../hooks/useImageFallback';
import { getGifImageSources } from '../../utils/gifImageSources';
import { triggerHaptic } from '../../hooks/useMessageTouch';

export default function GifPickerItem({ gif, onSelect }) {
  const image = useImageFallback([
    ...getGifImageSources(gif.preview || gif.url),
    ...getGifImageSources(gif.url)
  ]);
  return <button
    type="button"
    className="gif-cell-btn"
    title={gif.title}
    aria-label={image.failed ? `${gif.title}: повторить загрузку` : gif.title}
    aria-busy={!image.loaded && !image.failed}
    disabled={!image.loaded && !image.failed}
    onClick={() => {
      if (image.failed) { image.retry(); return; }
      triggerHaptic(12);
      onSelect(gif.url);
    }}
  >
    {image.failed ? <span className="gif-image-status"><RotateCw size={20} />Повторить</span> : <>
      <img ref={image.ref} src={image.src} alt={gif.title} className="gif-preview-img" loading="lazy" onLoad={image.onLoad} onError={image.onError} />
      {!image.loaded && <span className="gif-image-status" aria-hidden="true"><Loader2 size={20} className="spinner" /></span>}
    </>}
  </button>;
}
