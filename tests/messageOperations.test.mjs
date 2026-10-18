import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditMessage, decodeMessageContent, preferMessageBody } from '../src/utils/messageContent.ts';
import { decryptMessageFields } from '../src/context/chat/decryptHelpers.js';
import { encryptMessage } from '../src/utils/e2eeHelper.js';
import { normalizeCachedMessage, denormalizeCachedMessage } from '../src/utils/indexedDbHelper.js';

test('edit availability rejects other authors, locked, unconfirmed and unsupported messages', () => {
 const own = { id: 'm', senderId: 'self', text: 'Текст', timestamp: new Date() };
 assert.equal(canEditMessage(own, 'self'), true);
 for (const fields of [{senderId:'peer'},{isPending:true},{isOptimistic:true},{isLocked:true},{isFailed:true},{cryptoVersion:2},{requiresUpdate:true},{text:'sticker:1',media:'file'}]) {
  assert.equal(canEditMessage({...own,...fields}, 'self'),false);
 }
});
test('forward origin is separate from text, ignores malformed metadata and truncates names', () => {
 const text = 'Обычный текст';
 assert.deepEqual(decodeMessageContent({text,forwardedFromRaw:'{bad'}),{text,forwardedFromRaw:'{bad'});
 const message=decodeMessageContent({text,forwardedFromRaw:JSON.stringify({name:'A'.repeat(200)})});
 assert.equal(message.text,text);assert.equal(message.forwardedFrom.name.length,128);
 assert.equal(decodeMessageContent({text,forwardedFromRaw:'{"name":12}'}).forwardedFrom,undefined);
});
test('forward text and attribution are encrypted with the destination key and decoded together', async () => {
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const encrypt=async text=>{const e=await encryptMessage(text,key);return `e2ee:aes-gcm:${e.ciphertext}:${e.iv}`;};
 const wire={text:await encrypt('Секретный текст'),media:null,forwardedFromRaw:await encrypt(JSON.stringify({name:'Автор'}))};
 assert.ok(!wire.text.includes('Секретный'));assert.ok(!wire.forwardedFromRaw.includes('Автор'));
 const decoded=await decryptMessageFields(wire,key,true);
 assert.equal(decoded.text,'Секретный текст');assert.deepEqual(decoded.forwardedFrom,{name:'Автор'});
 const locked=await decryptMessageFields(wire,null,true);
 assert.equal(locked.isLocked,true);assert.equal(locked.forwardedFrom,undefined);
});
test('stale history preserves the newer edited body while merging delivery state', () => {
 const current={id:'m',senderId:'self',text:'Новая правка',editedAt:'2026-10-18T12:00:00Z',timestamp:'2026-10-18T10:00:00Z',forwardedFrom:{name:'Автор'}};
 const stale={...current,text:'Старый текст',editedAt:null,read:true,reactions:[{emoji:'👍'}]};
 const result=preferMessageBody(current,stale);
 assert.equal(result.text,current.text);assert.equal(result.editedAt,current.editedAt);
 assert.equal(result.read,true);assert.deepEqual(result.reactions,stale.reactions);
 assert.equal(preferMessageBody(current,{...stale,editedAt:'2026-10-18T13:00:00Z'}).text,'Старый текст');
 const microsecond = {...current, editedAt:'2026-10-18T12:00:00.123456Z'};
 assert.equal(preferMessageBody(microsecond,{...stale,editedAt:'2026-10-18T12:00:00.123455+00:00'}).text,current.text);
});
test('cache round trip preserves edit, origin and unsupported-crypto guards', () => {
 const message={id:'m',senderId:'self',text:'Текст',timestamp:new Date(),editedAt:'2026-10-18T12:00:00Z',forwardedFrom:{name:'Автор'},cryptoVersion:2,requiresUpdate:true};
 const cached=denormalizeCachedMessage(normalizeCachedMessage(message,'chat','self'));
 assert.equal(cached.editedAt,message.editedAt);assert.deepEqual(cached.forwardedFrom,message.forwardedFrom);
 assert.equal(cached.cryptoVersion,2);assert.equal(cached.requiresUpdate,true);assert.equal(canEditMessage(cached,'self'),false);
});
