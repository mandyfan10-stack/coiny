/**
 * Escape regular expression special characters in user input.
 * @param {string} string
 * @returns {string}
 */
export function escapeRegExp(string) {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split text into matching and non-matching segments for search highlighting.
 * @param {string} text
 * @param {string} query
 * @returns {Array<{ text: string, isMatch: boolean }>}
 */
export function splitTextBySearchQuery(text, query) {
  if (!text || typeof text !== 'string') return [];
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return [{ text, isMatch: false }];
  }

  const escaped = escapeRegExp(cleanQuery);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  const lowerQuery = cleanQuery.toLowerCase();
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      isMatch: part.toLowerCase() === lowerQuery
    }));
}
