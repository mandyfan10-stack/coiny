// These are alternate delivery addresses for the same GIF, not proxy services.
export function getGifImageSources(source) {
  if (!source) return [];
  const sources = [source];
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return sources;
    const alternate = new URL(url);
    if (['media.tenor.com', 'c.tenor.com', 'media1.tenor.com'].includes(url.hostname)) {
      const path = url.pathname.replace(/^\/m\//, '/');
      if (!/^\/[\w-]+\/[^/]+\.gif$/i.test(path)) return sources;
      alternate.hostname = 'media.tenor.com';
      alternate.pathname = path;
      sources.push(alternate.href);
      alternate.hostname = 'media1.tenor.com';
      alternate.pathname = `/m${path}`;
      sources.push(alternate.href);
    } else if (/^media[0-4]?\.giphy\.com$/.test(url.hostname) && /^\/media\/.+\.gif$/i.test(url.pathname)) {
      alternate.hostname = 'media.giphy.com';
      sources.push(alternate.href);
      alternate.hostname = 'media1.giphy.com';
      sources.push(alternate.href);
    }
  } catch {
    // Local blobs, private storage references and other image URLs stay intact.
  }
  return [...new Set(sources)];
}
