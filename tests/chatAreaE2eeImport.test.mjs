import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatArea = await readFile(new URL("../src/components/ChatArea.jsx", import.meta.url), "utf8");

test("ChatArea imports requiresPersonalE2EE from savedMessages", () => {
  assert.match(chatArea, /import\s*\{\s*requiresPersonalE2EE\s*\}\s*from\s*['"]\.\.\/utils\/savedMessages['"]/);
  assert.match(chatArea, /requiresPersonalE2EE\(activeChat, currentUser\?\.id\)/);
});
