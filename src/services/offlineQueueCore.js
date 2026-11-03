// @ts-check
/** @param {unknown} err */
export function isNetworkError(err) {
  const message = String(/** @type {{ message?: unknown } | null | undefined} */ (err)?.message || '');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return offline
    || /FetchError/i.test(message)
    || /failed to fetch/i.test(message)
    || /networkerror/i.test(message)
    || /NetworkError/i.test(message);
}

/**
 * Build a queue entry for an optimistic offline send.
 * @param {object} input
 * @param {string} input.chatId
 * @param {string} input.senderId
 * @param {string} input.text
 * @param {string | null} [input.replyToId]
 * @param {string | null} [input.media]
 * @param {string} input.optimisticId
 * @param {boolean} [input.hasOfflineMedia]
 * @param {string | null} [input.mediaType]
 * @param {{ name: string } | null} [input.forwardedFrom]
 * @returns {import('../types').OfflineQueueItem}
 */
export function createOfflineQueueItem({
  chatId,
  senderId,
  text,
  replyToId = null,
  media = null,
  optimisticId,
  hasOfflineMedia = false,
  mediaType = null,
  forwardedFrom = null
}) {
  return {
    queueId: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatId,
    senderId,
    text,
    replyToId,
    media,
    optimisticId,
    hasOfflineMedia,
    mediaType,
    ...(forwardedFrom ? { forwardedFrom } : {}),    isPending: true,
    isFailed: false
  };
}
