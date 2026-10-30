import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStickerAnimation, validateStickerAnimation, MAX_ANIMATION_BYTES } from '../src/utils/stickerAnimation.js';

const normal = () => ({ v: '5.5.2', w: 512, h: 512, fr: 30, ip: 0, op: 60, assets: [],
  layers: [{ ty: 4, shapes: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] } }] }] });

test('ordinary bounded vector stickers remain usable', async () => {
  const animation = normal();
  assert.equal(validateStickerAnimation(animation), animation);
  assert.deepEqual(await loadStickerAnimation('https://fixture.invalid/sticker.json', {
    fetch: async () => new Response(JSON.stringify(animation))
  }), animation);
});

test('repeaters and alternate numeric expansion are rejected before rendering', () => {
  for (const shape of [
    { ty: 'rp', c: { a: 0, k: 1e100 } },
    { ty: 'rp', c: { a: 1, k: [{ t: 0, s: [1], e: [1e9] }] } },
    { ty: 'zz', r: { a: 0, k: 1e6 } },
    { ty: 'rd', r: { a: 0, k: 10 } },
    { ty: 'op', a: { a: 0, k: 10 } },
    { ty: 'sr', pt: { a: 0, k: 1e6 } },
    { ty: 'sr', pt: { a: 1, k: [] } }
  ]) {
    const animation = normal(); animation.layers[0].shapes.push(shape);
    assert.throws(() => validateStickerAnimation(animation), /complex/);
  }
  const animation = normal(); animation.layers[0].shapes.push({ ty: 'sr', pt: { a: 0, k: 5 } });
  assert.equal(validateStickerAnimation(animation), animation);
});

test('precomposition cycles and repeated-reference expansion are rejected', () => {
  const animation = normal();
  animation.layers = [{ ty: 0, refId: 'a' }];
  animation.assets = [{ id: 'a', layers: [{ ty: 0, refId: 'a' }] }];
  assert.throws(() => validateStickerAnimation(animation), /complex/);
  animation.assets = [{ id: 'a', layers: Array.from({ length: 256 }, () => ({ ty: 4 })) }];
  animation.layers.push({ ty: 0, refId: 'a' });
  assert.throws(() => validateStickerAnimation(animation), /complex/);
});

test('non-finite values, expressions, external resources and excessive nesting fail closed', () => {
  for (const value of [Infinity, { x: 'alert(1)' }, { p: 'https://example.invalid/image.png' }]) {
    const animation = normal(); animation.extra = value;
    assert.throws(() => validateStickerAnimation(animation), /complex/);
  }
  const animation = normal(); let value = animation;
  for (let i = 0; i < 40; i++) value = value.extra = {};
  assert.throws(() => validateStickerAnimation(animation), /complex/);
});

test('layer parent cycles are rejected independently of composition references', () => {
  const animation = normal();
  animation.layers = [{ ty: 3, ind: 1, parent: 2 }, { ty: 3, ind: 2, parent: 1 }];
  assert.throws(() => validateStickerAnimation(animation), /complex/);
  animation.layers = [{ ty: 3, ind: 1 }, { ty: 3, ind: 2, parent: 1 }];
  assert.equal(validateStickerAnimation(animation), animation);
});

test('array-like objects and numeric gradient stop expansion fail closed', () => {
  for (const shape of [
    { ty: 'el', p: { a: 0, k: { 0: 0, length: '100000000' } } },
    { ty: 'gf', g: { p: 1000000, k: { a: 0, k: [0, 1, 1, 1] } } },
    { ty: 'gf', g: { p: '1000000', k: { a: 0, k: [0, 1, 1, 1] } } }
  ]) {
    const animation = normal(); animation.layers[0].shapes.push(shape);
    assert.throws(() => validateStickerAnimation(animation), /complex/);
  }
  const animation = normal();
  animation.layers[0].shapes.push({ ty: 'gf', g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0] } } });
  assert.equal(validateStickerAnimation(animation), animation);
});

test('unreferenced extra compositions and alternate renderer loading paths are checked', () => {
  const animation = normal();
  animation.assets = [{ id: 'unused', xt: true, layers: [{ ty: 0, refId: 'unused' }] }];
  assert.throws(() => validateStickerAnimation(animation), /complex/);
  for (const extra of [{ chars: [{ ch: 'a' }] }, { fonts: { list: [] } }, { segments: [{ time: 0 }] }]) {
    assert.throws(() => validateStickerAnimation({ ...normal(), ...extra }), /complex/);
  }
});

test('streaming byte cap works without trusting content-length and cancels the reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(MAX_ANIMATION_BYTES + 1)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(loadStickerAnimation('https://fixture.invalid/sticker.json', {
    fetch: async () => new Response(body)
  }), /complex/);
  assert.equal(cancelled, true);
});
