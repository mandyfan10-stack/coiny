import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSavedMessagesChat,
  requiresPersonalE2EE,
  savedMessagesDisplayName,
  SAVED_MESSAGES_DISPLAY_NAME,
} from '../src/utils/savedMessages.ts';

const ownerId = 'self';
const saved = {
  type: 'personal', name: 'Notes', createdBy: ownerId,
  savedMessagesOwnerId: ownerId, members: [{ id: ownerId }]
};

test('notes-to-self requires its trusted identity, current owner and sole self membership', () => {
  assert.equal(isSavedMessagesChat(saved, ownerId), true);
  assert.equal(requiresPersonalE2EE(saved, ownerId), false);
  for (const chat of [
    { ...saved, savedMessagesOwnerId: null },
    { ...saved, createdBy: 'peer' },
    { ...saved, savedMessagesOwnerId: 'peer' },
    { ...saved, members: [] },
    { ...saved, members: undefined },
    { ...saved, members: [null] },
    { ...saved, members: [{ id: 'peer' }] },
    { ...saved, members: [{ id: ownerId }, { id: 'peer' }] }
  ]) {
    assert.equal(isSavedMessagesChat(chat, ownerId), false);
    assert.equal(requiresPersonalE2EE(chat, ownerId), true);
  }
  assert.equal(isSavedMessagesChat(saved, 'peer'), false);
  assert.equal(requiresPersonalE2EE(saved, 'peer'), true);
  assert.equal(isSavedMessagesChat(saved), false);
  assert.equal(isSavedMessagesChat({ ...saved, type: 'group' }, ownerId), false);
  assert.equal(isSavedMessagesChat(null, ownerId), false);
});

test('a peer name or username never disables E2EE, even with an incomplete member list', () => {
  for (const alias of ['Избранное', 'Saved Messages', 'Saved Messages 🔖', 'saved_messages', '@saved-messages']) {
    for (const members of [undefined, [], [{ id: ownerId }], [{ id: ownerId }, { id: 'peer' }]]) {
      const chat = { type: 'personal', name: alias, username: alias, createdBy: ownerId, members };
      assert.equal(isSavedMessagesChat(chat, ownerId), false);
      assert.equal(requiresPersonalE2EE(chat, ownerId), true);
      assert.equal(savedMessagesDisplayName(chat, ownerId), alias);
    }
  }
  assert.equal(requiresPersonalE2EE({ type: 'group', name: 'Избранное' }, ownerId), false);
});

test('only verified notes-to-self receive the canonical display label', () => {
  assert.equal(SAVED_MESSAGES_DISPLAY_NAME, 'Избранное');
  assert.equal(savedMessagesDisplayName(saved, ownerId), 'Избранное');
  assert.equal(savedMessagesDisplayName(saved, 'peer'), 'Notes');
});
