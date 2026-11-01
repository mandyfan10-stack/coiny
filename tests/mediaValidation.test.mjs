import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MEDIA_ACCEPT, MAX_CHAT_MEDIA_BYTES, extensionForMedia, validateChatMedia, getAttachmentMimeType } from '../src/utils/mediaValidation.ts';

test('every accepted media MIME survives storage naming and decryption type restoration', () => {
  for (const mime of CHAT_MEDIA_ACCEPT.split(',')) {
    const info = validateChatMedia(fakeFile(mime));
    const restored = getAttachmentMimeType(`storage://chat-attachments/chat/user/msg_id.${info.extension}?download=1#preview`, mime);
    assert.equal(restored, mime === 'audio/x-m4a' ? 'audio/mp4' : mime);
  }
  for (const [ext, mime] of [['avif','image/avif'],['aac','audio/aac'],['flac','audio/flac'],['ogv','video/ogg']]) {
    assert.equal(getAttachmentMimeType(`storage://chat-attachments/chat/user/msg_id.${ext}`, 'image/webp'), mime);
  }
});

const fakeFile = (type, size = 128, name = 'file') => ({ type, size, name });

test('accepts every supported messenger media family', () => {
  assert.equal(validateChatMedia(fakeFile('image/png')).kind, 'image');
  assert.equal(validateChatMedia(fakeFile('video/mp4')).kind, 'video');
  assert.equal(validateChatMedia(fakeFile('audio/webm')).kind, 'audio');
  assert.match(CHAT_MEDIA_ACCEPT, /video\/webm/);
});

test('rejects empty, oversized, and unknown media', () => {
  assert.throws(() => validateChatMedia(fakeFile('image/png', 0)), /пуст/i);
  assert.throws(() => validateChatMedia(fakeFile('image/png', MAX_CHAT_MEDIA_BYTES + 1)), /15 МБ/);
  assert.throws(() => validateChatMedia(fakeFile('application/pdf')), /не поддерживается/i);
});

test('normalizes safe storage extensions from MIME', () => {
  assert.equal(extensionForMedia('image/jpeg'), 'jpg');
  assert.equal(extensionForMedia('audio/mpeg'), 'mp3');
  assert.equal(extensionForMedia('video/webm'), 'webm');
});
