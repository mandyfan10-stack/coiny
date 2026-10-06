import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  Smile,
  Sparkles,
  Film,
  Search,
  X,
  Plus,
  Clock,
  Settings,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  EMOJI_CATEGORIES,
  searchEmojis
} from './emojiData';
import {
  fetchTrendingTenorGifs,
  searchTenorGifs,
  TENOR_CATEGORIES
} from '../../services/tenorService';
import { triggerHaptic } from '../../hooks/useMessageTouch';
import './MediaPickerPanel.css';

const RECENT_EMOJIS_KEY = 'coiny_recent_emojis';
const DEFAULT_RECENTS = ['😀', '😂', '😍', '👍', '🔥', '🎉', '👏', '❤️', '🤔', '👀', '✨', '🚀', '💯', '😎'];

export default function MediaPickerPanel({
  isOpen,
  onClose,
  onSelectEmoji,
  onSelectSticker,
  onSelectGif,
  installedStickers = [],
  onOpenStickerSettings
}) {
  const [activeTab, setActiveTab] = useState('emoji'); // 'emoji' | 'sticker' | 'gif'
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [activeStickerPackId, setActiveStickerPackId] = useState(null);

  // Hover/Long-press Sticker Preview State
  const [previewSticker, setPreviewSticker] = useState(null);
  const hoverTimerRef = useRef(null);

  // Tenor GIF state
  const [gifs, setGifs] = useState([]);
  const [nextGifPos, setNextGifPos] = useState(null);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const [isLoadingMoreGifs, setIsLoadingMoreGifs] = useState(false);
  const [activeGifCategory, setActiveGifCategory] = useState('trending');

  const [recentEmojis, setRecentEmojis] = useState(() => {
    try {
      const saved = localStorage.getItem(RECENT_EMOJIS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_RECENTS;
    } catch {
      return DEFAULT_RECENTS;
    }
  });

  const panelRef = useRef(null);
  const searchInputRef = useRef(null);
  const contentBodyRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const [viewportStyle, setViewportStyle] = useState({});

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const viewport = window.visualViewport;
    const media = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => {
      const top = viewport?.offsetTop || 0;
      const height = viewport?.height || window.innerHeight;
      const visibleBottom = top + height;
      const anchor = panelRef.current?.parentElement?.getBoundingClientRect();
      const anchorBottom = anchor?.bottom || visibleBottom;
      const desktopBottom = Math.min(anchorBottom - 58, visibleBottom - 8);
      setViewportStyle({
        '--picker-available-height': `${Math.max(0, media.matches ? height - 8 : desktopBottom - top - 8)}px`,
        '--picker-viewport-bottom': `${Math.max(0, window.innerHeight - visibleBottom)}px`,
        '--picker-desktop-bottom': `${Math.max(58, anchorBottom - desktopBottom)}px`
      });
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    media.addEventListener('change', updateViewport);
    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      media.removeEventListener('change', updateViewport);
    };
  }, [isOpen]);

  // GIF Categories Slider State
  const gifPillsRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isDraggingPills, setIsDraggingPills] = useState(false);
  const dragInfoRef = useRef({ isDown: false, startX: 0, scrollLeft: 0, hasMoved: false });

  const updatePillsScrollState = useCallback(() => {
    const el = gifPillsRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  const handlePillsSlide = useCallback((direction) => {
    const el = gifPillsRef.current;
    if (!el) return;
    const distance = 140;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth'
    });
  }, []);

  // Update slider arrows and attach wheel/resize handlers
  useEffect(() => {
    if (!isOpen || activeTab !== 'gif' || searchQuery) return undefined;

    const el = gifPillsRef.current;
    if (!el) return undefined;

    const checkScroll = () => {
      updatePillsScrollState();
    };

    // Initial check after layout
    const timer = setTimeout(checkScroll, 50);

    const onWheel = (e) => {
      if (e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
        checkScroll();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', checkScroll);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => checkScroll());
      resizeObserver.observe(el);
    }

    return () => {
      clearTimeout(timer);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', checkScroll);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [isOpen, activeTab, searchQuery, updatePillsScrollState]);

  // Center / scroll active category into view
  useEffect(() => {
    if (!isOpen || activeTab !== 'gif' || searchQuery) return undefined;
    const el = gifPillsRef.current;
    if (!el) return undefined;

    const activeBtn = el.querySelector(`.gif-cat-pill[data-cat-id="${activeGifCategory}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      const timer = setTimeout(updatePillsScrollState, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeTab, activeGifCategory, searchQuery, updatePillsScrollState]);

  // Drag-to-scroll handlers for category pills
  const handlePillsMouseDown = (e) => {
    if (e.button !== 0) return;
    const el = gifPillsRef.current;
    if (!el) return;

    dragInfoRef.current = {
      isDown: true,
      startX: e.pageX - el.offsetLeft,
      scrollLeft: el.scrollLeft,
      hasMoved: false
    };
  };

  const handlePillsMouseMove = (e) => {
    if (!dragInfoRef.current.isDown) return;
    const el = gifPillsRef.current;
    if (!el) return;

    const x = e.pageX - el.offsetLeft;
    const walk = x - dragInfoRef.current.startX;
    if (Math.abs(walk) > 4) {
      if (!dragInfoRef.current.hasMoved) {
        dragInfoRef.current.hasMoved = true;
        setIsDraggingPills(true);
      }
      el.scrollLeft = dragInfoRef.current.scrollLeft - walk;
      updatePillsScrollState();
    }
  };

  const handlePillsMouseUpOrLeave = () => {
    if (dragInfoRef.current.isDown) {
      dragInfoRef.current.isDown = false;
      setTimeout(() => {
        setIsDraggingPills(false);
        dragInfoRef.current.hasMoved = false;
      }, 50);
    }
  };

  // Set default active sticker pack
  useEffect(() => {
    if (installedStickers.length > 0 && !activeStickerPackId) {
      setActiveStickerPackId(installedStickers[0].id);
    }
  }, [installedStickers, activeStickerPackId]);

  // Load Tenor GIFs
  const loadGifs = useCallback(async (query, categoryQuery, append = false, currentPos = null) => {
    if (append) {
      setIsLoadingMoreGifs(true);
    } else {
      setIsLoadingGifs(true);
    }

    try {
      const targetQuery = query?.trim() || '';
      const data = targetQuery || categoryQuery
        ? await searchTenorGifs(targetQuery, append ? currentPos : null, 20, categoryQuery)
        : await fetchTrendingTenorGifs(append ? currentPos : null, 20);

      if (append) {
        setGifs((prev) => [...prev, ...(data.results || [])]);
      } else {
        setGifs(data.results || []);
      }
      setNextGifPos(data.nextPos || null);
    } catch (e) {
      console.warn('Error loading GIFs:', e);
    } finally {
      setIsLoadingGifs(false);
      setIsLoadingMoreGifs(false);
    }
  }, []);

  // Fetch GIFs on tab switch or query change
  useEffect(() => {
    if (!isOpen || activeTab !== 'gif') return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const cat = TENOR_CATEGORIES.find((c) => c.id === activeGifCategory);
      loadGifs(searchQuery, cat?.query, false);
    }, searchQuery ? 300 : 0);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isOpen, activeTab, searchQuery, activeGifCategory, loadGifs]);

  // Click outside handling
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        !e.target.closest('.emoji-trigger')
      ) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      panelRef.current?.parentElement?.querySelector('.emoji-trigger')?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Handle Emoji Selection
  const handleEmojiClick = (emoji) => {
    triggerHaptic(6);
    onSelectEmoji(emoji);
    setRecentEmojis((prev) => {
      const updated = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 24);
      try {
        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  // Sticker Preview Handlers
  const handleStickerPointerEnter = (stickerData) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setPreviewSticker(stickerData);
    }, 250);
  };

  const handleStickerPointerLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setPreviewSticker(null);
  };

  // Search filtering for emojis
  const filteredEmojis = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchEmojis(searchQuery);
  }, [searchQuery]);

  // Scroll to category in emoji list
  const scrollToCategory = (categoryId) => {
    triggerHaptic(6);
    setActiveCategory(categoryId);
    setSearchQuery('');
    const el = document.getElementById(`emoji-cat-${categoryId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="media-picker-panel" ref={panelRef} style={viewportStyle}>
      {/* Top Segmented Switcher */}
      <div className="picker-top-tabs">
        <button
          type="button"
          className={`picker-top-tab ${activeTab === 'emoji' ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(8);
            setActiveTab('emoji');
            setSearchQuery('');
          }}
        >
          <Smile size={16} />
          <span>Смайлы</span>
        </button>
        <button
          type="button"
          className={`picker-top-tab ${activeTab === 'sticker' ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(8);
            setActiveTab('sticker');
            setSearchQuery('');
          }}
        >
          <Sparkles size={16} />
          <span>Стикеры</span>
        </button>
        <button
          type="button"
          className={`picker-top-tab ${activeTab === 'gif' ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(8);
            setActiveTab('gif');
            setSearchQuery('');
          }}
        >
          <Film size={16} />
          <span>GIF</span>
        </button>
      </div>

      {/* Unified Search Bar */}
      <div className="picker-search-bar">
        <Search size={14} style={{ color: 'var(--text-secondary)' }} />
        <input
          ref={searchInputRef}
          type="text"
          className="picker-search-input"
          placeholder={
            activeTab === 'emoji'
              ? 'Поиск эмодзи (огонь, кот, сердце...)'
              : activeTab === 'sticker'
              ? 'Поиск стикеров...'
              : 'Поиск Tenor GIF (котики, танцы, смех...)'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="picker-search-clear"
            onClick={() => setSearchQuery('')}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Emoji Mode */}
      {activeTab === 'emoji' && (
        <>
          {!searchQuery && (
            <div className="picker-cat-nav">
              <button
                type="button"
                className={`picker-cat-btn ${activeCategory === 'recent' ? 'active' : ''}`}
                onClick={() => scrollToCategory('recent')}
                title="Недавние"
              >
                <Clock size={16} />
              </button>
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`picker-cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => scrollToCategory(cat.id)}
                  title={cat.name}
                >
                  {cat.icon}
                </button>
              ))}
            </div>
          )}

          <div className="picker-content-body" ref={contentBodyRef}>
            {searchQuery ? (
              filteredEmojis && filteredEmojis.length > 0 ? (
                <div>
                  <div className="emoji-section-header">Результаты поиска ({filteredEmojis.length})</div>
                  <div className="emoji-grid-section">
                    {filteredEmojis.map((emo, idx) => (
                      <button
                        key={`${emo}-${idx}`}
                        type="button"
                        className="emoji-cell-btn"
                        onClick={() => handleEmojiClick(emo)}
                      >
                        {emo}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="picker-empty-placeholder">
                  <p>Ничего не найдено</p>
                  <span>Попробуйте другой запрос для поиска</span>
                </div>
              )
            ) : (
              <>
                {/* Recent Emojis */}
                {recentEmojis.length > 0 && (
                  <div id="emoji-cat-recent">
                    <div className="emoji-section-header">
                      <Clock size={12} />
                      <span>Недавние</span>
                    </div>
                    <div className="emoji-grid-section">
                      {recentEmojis.map((emo, idx) => (
                        <button
                          key={`recent-${emo}-${idx}`}
                          type="button"
                          className="emoji-cell-btn"
                          onClick={() => handleEmojiClick(emo)}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Categorized Emojis */}
                {EMOJI_CATEGORIES.map((cat) => (
                  <div key={cat.id} id={`emoji-cat-${cat.id}`}>
                    <div className="emoji-section-header">
                      <span>{cat.name}</span>
                    </div>
                    <div className="emoji-grid-section">
                      {cat.emojis.map((emo, idx) => (
                        <button
                          key={`${cat.id}-${emo}-${idx}`}
                          type="button"
                          className="emoji-cell-btn"
                          onClick={() => handleEmojiClick(emo)}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* Stickers Mode */}
      {activeTab === 'sticker' && (
        <div className="sticker-picker-view">
          {installedStickers.length === 0 ? (
            <div className="picker-empty-placeholder">
              <Sparkles size={32} style={{ opacity: 0.5, color: 'var(--accent-color)' }} />
              <p>Нет установленных стикеров</p>
              <span>Вы можете добавить стикеры в настройках</span>
              {onOpenStickerSettings && (
                <button
                  type="button"
                  className="settings-action-btn primary"
                  style={{ marginTop: '10px', padding: '6px 14px', fontSize: '13px', borderRadius: '8px' }}
                  onClick={() => {
                    onClose();
                    onOpenStickerSettings();
                  }}
                >
                  <Settings size={14} style={{ marginRight: '6px' }} />
                  Открыть настройки
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Floating Enlarged Preview Card */}
              {previewSticker && (
                <div className="sticker-hover-preview-card">
                  {previewSticker.isVideo ? (
                    <video
                      src={previewSticker.url}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="sticker-hover-preview-img"
                    />
                  ) : (
                    <img
                      src={previewSticker.url}
                      alt="preview"
                      className="sticker-hover-preview-img"
                    />
                  )}
                  {previewSticker.emoji && (
                    <div className="sticker-hover-emoji-badge">{previewSticker.emoji}</div>
                  )}
                </div>
              )}

              {/* Sticker Grid for Active Pack */}
              <div className="sticker-grid-scroll">
                {(() => {
                  const activePack =
                    installedStickers.find((p) => p.id === activeStickerPackId) || installedStickers[0];
                  if (!activePack) return null;

                  const filtered = searchQuery
                    ? activePack.stickers.filter((s) => (s.emoji || '').includes(searchQuery.trim()))
                    : activePack.stickers;

                  if (filtered.length === 0) {
                    return (
                      <div className="picker-empty-placeholder" style={{ gridColumn: 'span 4' }}>
                        <p>Стикеры не найдены</p>
                      </div>
                    );
                  }

                  return filtered.map((st) => {
                    const isPublicUrl = st.filePath.startsWith('http');
                    const fileUrl = isPublicUrl
                      ? st.filePath
                      : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/stickers/${st.filePath}`;

                    const stickerData = {
                      url: fileUrl,
                      emoji: st.emoji,
                      isVideo: Boolean(activePack.is_video)
                    };

                    return (
                      <button
                        key={st.id}
                        type="button"
                        className="sticker-cell-btn"
                        onClick={() => {
                          handleStickerPointerLeave();
                          triggerHaptic(12);
                          onSelectSticker(`sticker:${activePack.name}`, fileUrl);
                          onClose();
                        }}
                        onMouseEnter={() => handleStickerPointerEnter(stickerData)}
                        onMouseLeave={handleStickerPointerLeave}
                        onTouchStart={() => handleStickerPointerEnter(stickerData)}
                        onTouchEnd={handleStickerPointerLeave}
                        title={st.emoji || activePack.title}
                      >
                        {activePack.is_animated ? (
                          st.emoji ? (
                            <span style={{ fontSize: '28px' }}>{st.emoji}</span>
                          ) : (
                            <Sparkles size={28} style={{ color: 'var(--accent-color)' }} />
                          )
                        ) : activePack.is_video ? (
                          <video src={fileUrl} autoPlay loop muted playsInline className="sticker-preview-media" />
                        ) : (
                          <img src={fileUrl} alt="sticker" className="sticker-preview-media" />
                        )}
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Bottom Sticker Pack Switcher Bar */}
              <div className="sticker-bottom-bar">
                {installedStickers.map((pack) => {
                  const firstSticker = pack.stickers?.[0];
                  if (!firstSticker) return null;
                  const isPublicUrl = firstSticker.filePath.startsWith('http');
                  const coverUrl = isPublicUrl
                    ? firstSticker.filePath
                    : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/stickers/${firstSticker.filePath}`;

                  return (
                    <button
                      key={pack.id}
                      type="button"
                      className={`sticker-pack-btn ${activeStickerPackId === pack.id ? 'active' : ''}`}
                      onClick={() => {
                        setActiveStickerPackId(pack.id);
                        setSearchQuery('');
                      }}
                      title={pack.title}
                    >
                      {pack.is_animated ? (
                        <Sparkles size={16} style={{ color: 'var(--accent-color)' }} />
                      ) : pack.is_video ? (
                        <Film size={16} style={{ color: 'var(--accent-color)' }} />
                      ) : (
                        <img src={coverUrl} alt="cover" className="sticker-pack-cover" />
                      )}
                    </button>
                  );
                })}

                {onOpenStickerSettings && (
                  <button
                    type="button"
                    className="sticker-add-btn"
                    onClick={() => {
                      onClose();
                      onOpenStickerSettings();
                    }}
                    title="Управление стикерами"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tenor GIFs Mode */}
      {activeTab === 'gif' && (
        <div className="gif-picker-view">
          {/* Quick Category Pills Slider */}
          {!searchQuery && (
            <div
              className={`gif-cat-slider-container ${canScrollLeft ? 'has-left-overflow' : ''} ${canScrollRight ? 'has-right-overflow' : ''}`}
            >
              {canScrollLeft && (
                <button
                  type="button"
                  className="gif-cat-slider-btn left"
                  onClick={() => handlePillsSlide('left')}
                  title="Предыдущие категории"
                  aria-label="Предыдущие категории"
                >
                  <ChevronLeft size={16} />
                </button>
              )}

              <div
                ref={gifPillsRef}
                className={`gif-cat-pills ${isDraggingPills ? 'is-dragging' : ''}`}
                onScroll={updatePillsScrollState}
                onMouseDown={handlePillsMouseDown}
                onMouseMove={handlePillsMouseMove}
                onMouseUp={handlePillsMouseUpOrLeave}
                onMouseLeave={handlePillsMouseUpOrLeave}
              >
                {TENOR_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    data-cat-id={cat.id}
                    type="button"
                    className={`gif-cat-pill ${activeGifCategory === cat.id ? 'active' : ''}`}
                    onClick={() => {
                      if (dragInfoRef.current.hasMoved) return;
                      triggerHaptic(6);
                      setActiveGifCategory(cat.id);
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {canScrollRight && (
                <button
                  type="button"
                  className="gif-cat-slider-btn right"
                  onClick={() => handlePillsSlide('right')}
                  title="Следующие категории"
                  aria-label="Следующие категории"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}

          <div className="gif-grid-scroll">
            {isLoadingGifs ? (
              <div className="picker-loading-box">
                <Loader2 size={24} className="spinner" style={{ color: 'var(--accent-color)' }} />
                <span style={{ fontSize: '13px' }}>Загрузка Tenor GIF...</span>
              </div>
            ) : gifs.length > 0 ? (
              <>
                {gifs.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    className="gif-cell-btn"
                    onClick={() => {
                      triggerHaptic(12);
                      if (onSelectGif) {
                        onSelectGif(gif.url);
                      }
                      onClose();
                    }}
                    title={gif.title}
                  >
                    <img
                      src={gif.preview || gif.url}
                      alt={gif.title}
                      className="gif-preview-img"
                      loading="lazy"
                    />
                  </button>
                ))}

                {nextGifPos && (
                  <div className="gif-load-more-wrapper">
                    <button
                      type="button"
                      className="gif-load-more-btn"
                      onClick={() => {
                        const cat = TENOR_CATEGORIES.find((c) => c.id === activeGifCategory);
                        loadGifs(searchQuery, cat?.query, true, nextGifPos);
                      }}
                      disabled={isLoadingMoreGifs}
                    >
                      {isLoadingMoreGifs ? 'Загрузка...' : 'Загрузить ещё'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="picker-empty-placeholder" style={{ gridColumn: 'span 2' }}>
                <p>GIF не найдены</p>
                <span>Попробуйте другой поисковый запрос</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
