import assert from 'node:assert/strict';
import test from 'node:test';
import { getGifImageSources } from '../src/utils/gifImageSources.js';

test('Tenor delivery addresses preserve the GIF identity and query', () => {
  const primary = 'https://media.tenor.com/Ab-c_123AAAAM/cat.gif?item=1';
  const alternate = 'https://media1.tenor.com/m/Ab-c_123AAAAM/cat.gif?item=1';
  assert.deepEqual(getGifImageSources(primary), [primary, alternate]);
  assert.deepEqual(getGifImageSources(alternate), [alternate, primary]);
  assert.deepEqual(getGifImageSources('https://c.tenor.com/Ab-c_123AAAAM/cat.gif'), [
    'https://c.tenor.com/Ab-c_123AAAAM/cat.gif',
    'https://media.tenor.com/Ab-c_123AAAAM/cat.gif',
    'https://media1.tenor.com/m/Ab-c_123AAAAM/cat.gif'
  ]);
});

test('Giphy uses equivalent delivery hosts without changing the content path', () => {
  assert.deepEqual(getGifImageSources('https://media.giphy.com/media/abc/giphy.gif'), [
    'https://media.giphy.com/media/abc/giphy.gif',
    'https://media1.giphy.com/media/abc/giphy.gif'
  ]);
});

test('local, private and unrecognized URLs never get rewritten or sent to a CDN', () => {
  assert.deepEqual(getGifImageSources(null), []);
  for (const source of [
    'blob:https://coiny.test/id', 'data:image/gif;base64,abc',
    'storage://chat-attachments/chat/user/photo.gif',
    'https://private.supabase.co/storage/v1/object/sign/chat-attachments/photo.gif?token=secret',
    'https://media.tenor.com.evil.test/abc/cat.gif',
    'https://user:password@media.tenor.com/abc/cat.gif',
    'https://media.tenor.com:8443/abc/cat.gif',
    'http://media.tenor.com/abc/cat.gif',
    'https://media.tenor.com/abc/cat.mp4',
    'https://media1.tenor.com/unexpected/path/abc/cat.gif'
  ]) assert.deepEqual(getGifImageSources(source), [source]);
});
