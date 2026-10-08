import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  escapeRegExp,
  splitTextBySearchQuery
} from '../src/utils/searchHighlight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const renderMessageTextPath = path.join(rootDir, 'src/components/chat/renderMessageText.jsx');
const renderMessageTextSource = fs.readFileSync(renderMessageTextPath, 'utf8');

const chatSearchBarPath = path.join(rootDir, 'src/components/chat/ChatSearchBar.jsx');
const chatSearchBarSource = fs.readFileSync(chatSearchBarPath, 'utf8');

const chatHeaderPath = path.join(rootDir, 'src/components/chat/ChatHeader.jsx');
const chatHeaderSource = fs.readFileSync(chatHeaderPath, 'utf8');

const chatAreaPath = path.join(rootDir, 'src/components/ChatArea.jsx');
const chatAreaSource = fs.readFileSync(chatAreaPath, 'utf8');

const messageBubblePath = path.join(rootDir, 'src/components/chat/MessageBubble.jsx');
const messageBubbleSource = fs.readFileSync(messageBubblePath, 'utf8');

test('escapeRegExp correctly escapes all special regex characters', () => {
  const dangerous = '.*+?^${}()|[]\\hello';
  const escaped = escapeRegExp(dangerous);
  const regex = new RegExp(escaped);
  assert.ok(regex.test(dangerous));
  assert.ok(!regex.test('regular string'));
});

test('splitTextBySearchQuery handles empty queries and non-matches safely', () => {
  assert.deepEqual(splitTextBySearchQuery('Hello world', ''), [{ text: 'Hello world', isMatch: false }]);
  assert.deepEqual(splitTextBySearchQuery('Hello world', '   '), [{ text: 'Hello world', isMatch: false }]);
  assert.deepEqual(splitTextBySearchQuery('', 'test'), []);
  assert.deepEqual(splitTextBySearchQuery(null, 'test'), []);
  assert.deepEqual(splitTextBySearchQuery('Hello world', 'xyz'), [{ text: 'Hello world', isMatch: false }]);
});

test('splitTextBySearchQuery highlights case-insensitively and preserves original casing', () => {
  const text = 'Quick Brown Fox jumps over quick dog';
  const result = splitTextBySearchQuery(text, 'quick');

  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { text: 'Quick', isMatch: true });
  assert.deepEqual(result[1], { text: ' Brown Fox jumps over ', isMatch: false });
  assert.deepEqual(result[2], { text: 'quick', isMatch: true });
  assert.deepEqual(result[3], { text: ' dog', isMatch: false });
});

test('renderMessageTextWithLinks contains contract for search highlighting and mark elements', () => {
  assert.match(renderMessageTextSource, /import\s*\{\s*splitTextBySearchQuery,\s*escapeRegExp\s*\}\s*from/);
  assert.match(renderMessageTextSource, /className="search-match-highlight"/);
  assert.match(renderMessageTextSource, /function renderMessageTextWithLinks\(text,\s*searchQuery\s*=\s*''\)/);
  assert.match(renderMessageTextSource, /highlightSearchQuery\(display,\s*query\)/);
  assert.match(renderMessageTextSource, /highlightSearchQuery\(part,\s*query\)/);
});

test('In-chat search matching and cyclic navigation logic', () => {
  const messages = [
    { id: 'm1', text: 'Hello everyone in group' },
    { id: 'm2', text: 'How is the weather today?' },
    { id: 'm3', text: 'Hello there monetka!' },
    { id: 'm4', media: 'image.jpg', text: '' },
    { id: 'm5', text: 'HELLO again!' },
  ];

  function searchInMessages(query) {
    if (!query || !query.trim()) return [];
    const clean = query.trim().toLowerCase();
    return messages.filter((m) => m.text && m.text.toLowerCase().includes(clean));
  }

  // 1. Search for 'hello'
  const matches = searchInMessages('hello');
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map((m) => m.id), ['m1', 'm3', 'm5']);

  // 2. Navigation next cyclic
  let currentIndex = 0;
  const next = () => {
    currentIndex = (currentIndex + 1) % matches.length;
    return currentIndex;
  };
  const prev = () => {
    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
    return currentIndex;
  };

  assert.equal(next(), 1);
  assert.equal(next(), 2);
  assert.equal(next(), 0); // cycles back to start
  assert.equal(prev(), 2); // cycles back to end
  assert.equal(prev(), 1);

  // 3. Search non-existent
  const noMatches = searchInMessages('nonexistent');
  assert.equal(noMatches.length, 0);

  // 4. Empty query
  const emptyMatches = searchInMessages('   ');
  assert.equal(emptyMatches.length, 0);
});

test('ChatSearchBar component satisfies accessibility, testids and keydown contracts', () => {
  assert.match(chatSearchBarSource, /data-testid="chat-search-bar"/);
  assert.match(chatSearchBarSource, /data-testid="chat-search-input"/);
  assert.match(chatSearchBarSource, /data-testid="chat-search-prev-btn"/);
  assert.match(chatSearchBarSource, /data-testid="chat-search-next-btn"/);
  assert.match(chatSearchBarSource, /data-testid="chat-search-close-btn"/);
  assert.match(chatSearchBarSource, /role="search"/);
  assert.match(chatSearchBarSource, /e\.key === 'Escape'/);
  assert.match(chatSearchBarSource, /e\.key === 'Enter'/);
  assert.match(chatSearchBarSource, /e\.shiftKey/);
  assert.match(chatSearchBarSource, /inputRef\.current\?\.focus\(\)/);
});

test('ChatHeader component exposes search button and props', () => {
  assert.match(chatHeaderSource, /data-testid="chat-header-search-btn"/);
  assert.match(chatHeaderSource, /isSearchOpen/);
  assert.match(chatHeaderSource, /onToggleSearch/);
  assert.match(chatHeaderSource, /Search size=\{22\}/);
});

test('ChatArea component integrates in-chat search state, hotkeys and matching', () => {
  assert.match(chatAreaSource, /import ChatSearchBar from '\.\/chat\/ChatSearchBar'/);
  assert.match(chatAreaSource, /const \[isSearchOpen, setIsSearchOpen\] = useState\(false\)/);
  assert.match(chatAreaSource, /const \[searchQuery, setSearchQuery\] = useState\(''\)/);
  assert.match(chatAreaSource, /const \[currentMatchIndex, setCurrentMatchIndex\] = useState\(0\)/);
  assert.match(chatAreaSource, /scrollToMatchedMessage/);
  assert.match(chatAreaSource, /handleNextMatch/);
  assert.match(chatAreaSource, /handlePrevMatch/);
  assert.match(chatAreaSource, /handleToggleSearch/);
  assert.match(chatAreaSource, /isSearchOpen=\{isSearchOpen\}/);
  assert.match(chatAreaSource, /onToggleSearch=\{handleToggleSearch\}/);
  assert.match(chatAreaSource, /<ChatSearchBar/);
  assert.match(chatAreaSource, /isSearchMatchTarget=\{isSearchOpen && matchedMessages\[currentMatchIndex\]\?\.id === msg\.id\}/);
});

test('MessageBubble component receives search props and applies search-match-target', () => {
  assert.match(messageBubbleSource, /searchQuery = ''/);
  assert.match(messageBubbleSource, /isSearchMatchTarget = false/);
  assert.match(messageBubbleSource, /search-match-target/);
  assert.match(messageBubbleSource, /renderMessageTextWithLinks\(msg\.text, searchQuery\)/);
});
