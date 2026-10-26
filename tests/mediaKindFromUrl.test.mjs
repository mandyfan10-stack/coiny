import assert from 'node:assert/strict';
import test from 'node:test';
import { getMediaKindFromUrl } from '../src/utils/mediaKindFromUrl.js';

test('GIFs remain images regardless of names, directories, query strings and fragments', () => {
  for (const url of [
    'https://media.tenor.com/abc/funny-video.gif',
    'https://media.tenor.com/audio_/audio_reaction.GIF',
    'https://media.tenor.com/abc/movie.mp4.gif?format=video.mp4#clip.webm',
    'https://media1.tenor.com/m/abc/video%2Egif',
    '/media/audio_123.gif',
    'storage://chat-attachments/chat/user/video.gif'
  ]) assert.equal(getMediaKindFromUrl(url), 'image', url);
});

test('actual audio and video extensions retain their display type, including legacy audio WebM', () => {
  for (const url of ['https://files.test/video.mp4?preview=cat.gif', '/clip.WEBM', '/clip.mov', '/clip.ogv', '/clip.mkv']) {
    assert.equal(getMediaKindFromUrl(url), 'video', url);
  }
  for (const url of ['/voice.ogg', '/video.mp3', '/voice.wav', '/voice.m4a', '/voice.aac', '/voice.opus', '/audio_123.webm']) {
    assert.equal(getMediaKindFromUrl(url), 'audio', url);
  }
});

test('data URL MIME types take precedence over their content', () => {
  assert.equal(getMediaKindFromUrl('data:image/gif;base64,video_audio_'), 'image');
  assert.equal(getMediaKindFromUrl('data:video/webm;base64,photo.gif'), 'video');
  assert.equal(getMediaKindFromUrl('data:audio/ogg;base64,clip.mp4'), 'audio');
});

test('blobs and unknown references leave content inspection to the caller', () => {
  for (const url of [null, '', 'blob:https://video.test/audio_123', '/unknown-video', '/unknown.bin?type=video.mp4', 'https://[invalid/photo.gif']) {
    assert.equal(getMediaKindFromUrl(url), null, String(url));
  }
});
