export const MAX_ANIMATION_BYTES = 1024 * 1024;
const MAX_NODES = 20_000;
const MAX_DEPTH = 32;

function reject() { throw new Error('Unsupported or excessively complex sticker animation.'); }

/** Validate data before handing it to the renderer, including numeric expansion. */
export function validateStickerAnimation(document) {
  if (!document || !Array.isArray(document.layers)
    || !Number.isFinite(document.w) || !Number.isFinite(document.h)
    || document.w < 1 || document.h < 1 || document.w > 1024 || document.h > 1024
    || !Number.isFinite(document.fr) || document.fr < 1 || document.fr > 60
    || !Number.isFinite(document.ip) || !Number.isFinite(document.op)
    || document.op <= document.ip || document.op - document.ip > 3600) reject();
  // Stickers use self-contained vectors. Fonts/glyphs and segmented loads have
  // separate expansion/fetch paths outside the layer graph inspected below.
  if (document.fonts || document.chars?.length || document.segments?.length) reject();

  const stack = [[document, 0]];
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) reject();
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1_000_000)) reject();
    if (typeof value === 'string' && value.length > 4096) reject();
    if (!value || typeof value !== 'object') continue;
    // The renderer uses .length to allocate typed arrays. Only actual JSON
    // arrays may supply it; array-like objects allow coercion of huge strings.
    if (!Array.isArray(value) && Object.hasOwn(value, 'length')) reject();
    if (value.g !== undefined && (!value.g || !Number.isInteger(value.g.p) || value.g.p < 1 || value.g.p > 32)) reject();
    if (value.ef?.length) reject();
    // These modifiers expand geometry, including numeric and chained copies.
    // Their output size cannot be bounded by the serialized input's size.
    if (['rp', 'zz', 'rd', 'op'].includes(value.ty)) reject();
    if (value.ty === 'sr') {
      // Polystars also use a numeric property to allocate their vertices.
      const points = value.pt;
      if (!points || points.a !== 0 || !Number.isFinite(points.k) || points.k < 1 || points.k > 64) reject();
    }
    for (const [key, child] of Object.entries(value)) {
      if (['x', 'expression', 'url', 'href', 'p', 'u'].includes(key) && typeof child === 'string' && child) reject();
      stack.push([child, depth + 1]);
    }
  }

  // Serialized references can recurse without increasing the JSON's depth.
  const assets = new Map();
  for (const asset of document.assets || []) {
    if (typeof asset.id !== 'string' || assets.has(asset.id) || !Array.isArray(asset.layers)) reject();
    assets.set(asset.id, asset);
  }
  let expandedLayers = 0;
  let expandedNodes = 0;
  const inspectLayers = (layers, ancestors = new Set()) => {
    if (!Array.isArray(layers) || ancestors.size > 16) reject();
    const indices = new Map();
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object' || ![0, 1, 3, 4].includes(layer.ty)) reject();
      if (layer.ind === undefined) continue;
      if (!Number.isInteger(layer.ind) || indices.has(layer.ind)) reject();
      indices.set(layer.ind, layer);
    }
    // Renderer parenting follows IDs recursively, independently of JSON depth.
    for (const layer of layers) {
      const seen = new Set();
      let parent = layer.parent;
      while (parent !== undefined) {
        if (!Number.isInteger(parent) || seen.has(parent) || !indices.has(parent) || seen.size >= 16) reject();
        seen.add(parent);
        parent = indices.get(parent).parent;
      }
    }
    for (const layer of layers) {
      if (++expandedLayers > 256) reject();
      const pending = [layer];
      while (pending.length) {
        const value = pending.pop();
        if (++expandedNodes > MAX_NODES) reject();
        if (value && typeof value === 'object') pending.push(...Object.values(value));
      }
      if (layer.refId === undefined) continue;
      const asset = assets.get(layer.refId);
      if (!asset || !Array.isArray(asset.layers) || ancestors.has(layer.refId)) reject();
      inspectLayers(asset.layers, new Set([...ancestors, layer.refId]));
    }
  };
  inspectLayers(document.layers);
  // The renderer can eagerly initialize assets marked as extra compositions.
  for (const [id, asset] of assets) inspectLayers(asset.layers, new Set([id]));
  return document;
}

export async function loadStickerAnimation(url, { signal, fetch: fetcher = globalThis.fetch } = {}) {
  const response = await fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_ANIMATION_BYTES) reject();
  const reader = response.body?.getReader();
  if (!reader) reject();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ANIMATION_BYTES) reject();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (signal?.aborted) throw new DOMException('Animation load cancelled.', 'AbortError');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return validateStickerAnimation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
