import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAuthEmail, validateAuthUsername, mapSupabaseAuthError } from "../src/services/authEmail.ts";

const e2eeModal = await readFile(new URL("../src/components/E2EESetupModal.jsx", import.meta.url), "utf8");
const authScreen = await readFile(new URL("../src/components/AuthScreen.jsx", import.meta.url), "utf8");
const e2eeTab = await readFile(new URL("../src/components/settings/E2EETab.jsx", import.meta.url), "utf8");
const e2eeContext = await readFile(new URL("../src/context/E2EEContext.jsx", import.meta.url), "utf8");
const authContext = await readFile(new URL("../src/context/AuthContext.jsx", import.meta.url), "utf8");
const authService = await readFile(new URL("../src/services/authService.js", import.meta.url), "utf8");
const dataLayer = await readFile(new URL("../src/services/dataLayer.js", import.meta.url), "utf8");
const authEmail = await readFile(new URL("../src/services/authEmail.ts", import.meta.url), "utf8");

const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

test("E2EESetupModal contracts: 24-digit recovery code is completely removed", () => {
  assert.doesNotMatch(e2eeModal, /24-значный/);
  assert.doesNotMatch(e2eeModal, /Я сохранил код восстановления/);
  assert.doesNotMatch(e2eeModal, /Восстановить по коду/);
  assert.doesNotMatch(e2eeModal, /recovery_code/);
  assert.doesNotMatch(e2eeModal, /recoveryCodeInput/);
  assert.doesNotMatch(e2eeModal, /handleRecoverCodeSubmit/);
  assert.doesNotMatch(e2eeModal, /showingRecoveryStep/);
  assert.doesNotMatch(e2eeModal, /e2ee-setup-step-2/);
});

test("E2EETab contracts: 24-digit code and recovery code mentions are removed", () => {
  assert.doesNotMatch(e2eeTab, /кодом восстановления/);
  assert.doesNotMatch(e2eeTab, /24-значный/);
  assert.match(e2eeTab, /Приватный ключ защищён вашим паролем\./);
  assert.doesNotMatch(e2eeTab, emojiRegex, "E2EETab must contain strictly zero emojis");
});

test("E2EESetupModal contracts: email recovery is fully integrated with zero emojis", () => {
  assert.match(e2eeModal, /Восстановление через Email/);
  assert.match(e2eeModal, /Забыли пароль\? Восстановить через Email/);
  assert.match(e2eeModal, /id="recovery-email"/);
  assert.match(e2eeModal, /handleEmailRecoverySubmit/);
  assert.match(e2eeModal, /dataService\.resetPasswordForEmail/);
  assert.match(e2eeModal, /currentUser\?\.email/);
  assert.match(e2eeModal, /Вернуться к вводу пароля/);
  assert.match(e2eeModal, /Сбросить шифрование аккаунта/);
  assert.match(e2eeModal, /coiny\.users\.local/);
  assert.doesNotMatch(e2eeModal, emojiRegex, "E2EESetupModal must contain strictly zero emojis");
});

test("AuthScreen contracts: email recovery link and reset mode integrated with zero emojis", () => {
  assert.match(authScreen, /Забыли пароль\?/);
  assert.match(authScreen, /isResetPassword/);
  assert.match(authScreen, /Восстановление пароля/);
  assert.match(authScreen, /Отправить инструкции/);
  assert.match(authScreen, /Вернуться ко входу/);
  assert.match(authScreen, /resetPasswordForEmail/);
  assert.match(authScreen, /id="resetIdentifier"/);
  assert.doesNotMatch(authScreen, emojiRegex, "AuthScreen must contain strictly zero emojis");
});

test("E2EEContext: setupE2EE does not block interface waiting for code save", () => {
  assert.match(e2eeContext, /setIsE2EESetupRequired\(false\)/);
  assert.doesNotMatch(e2eeContext, /Keep isE2EESetupRequired=true/);
});

test("AuthContext, authService & dataService expose resetPasswordForEmail and resetPassword alias", () => {
  // resetPasswordForEmail
  assert.match(authContext, /resetPasswordForEmail/);
  assert.match(authContext, /resetPasswordForEmail = async/);
  assert.match(dataLayer, /resetPasswordForEmail:\s*authService\.resetPasswordForEmail/);
  assert.match(authService, /resetPasswordForEmail:\s*async/);
  assert.match(authService, /supabase\.auth\.resetPasswordForEmail/);
  assert.match(authService, /mapSupabaseAuthError\(error,\s*'reset'\)/);
  assert.match(authService, /validateAuthEmail/);
  assert.match(authService, /validateAuthUsername/);

  // resetPassword alias
  assert.match(authService, /resetPassword:\s*async/);
  assert.match(dataLayer, /resetPassword:\s*authService\.resetPasswordForEmail/);
  assert.match(authContext, /resetPassword:\s*resetPasswordForEmail/);
});

test("authEmail email and username validation logic for reset flows", () => {
  // Invalid email
  const badEmailRes = validateAuthEmail("bad-email@");
  assert.equal(badEmailRes.ok, false);
  assert.match(badEmailRes.error, /корректный email/);

  // Invalid username
  const badUserRes = validateAuthUsername("a");
  assert.equal(badUserRes.ok, false);
  assert.match(badUserRes.error, /не менее 3 символов/);

  // Valid email
  const goodEmailRes = validateAuthEmail("valid.user@example.com");
  assert.equal(goodEmailRes.ok, true);
  assert.equal(goodEmailRes.email, "valid.user@example.com");

  // Valid username
  const goodUserRes = validateAuthUsername("alex_dev");
  assert.equal(goodUserRes.ok, true);
  assert.equal(goodUserRes.username, "alex_dev");
});

test("mapSupabaseAuthError handles reset action messages and email_address_invalid", () => {
  const resetErr = mapSupabaseAuthError(null, "reset");
  assert.match(resetErr.message, /Ошибка при отправке ссылки для восстановления/);

  const rateLimitErr = mapSupabaseAuthError({ code: "over_request_rate_limit" }, "reset");
  assert.match(rateLimitErr.message, /Слишком много попыток/);

  const invalidEmailErr = mapSupabaseAuthError({ code: "email_address_invalid" }, "reset");
  assert.match(invalidEmailErr.message, /К этому аккаунту не привязан действующий адрес электронной почты/);

  const testDomainErr = mapSupabaseAuthError({ message: "test domains are currently not supported" }, "reset");
  assert.match(testDomainErr.message, /К этому аккаунту не привязан действующий адрес электронной почты/);
});

test("All touched files strictly adhere to zero emojis requirement", () => {
  assert.doesNotMatch(e2eeModal, emojiRegex, "E2EESetupModal must not contain emojis");
  assert.doesNotMatch(authScreen, emojiRegex, "AuthScreen must not contain emojis");
  assert.doesNotMatch(e2eeTab, emojiRegex, "E2EETab must not contain emojis");
  assert.doesNotMatch(authEmail, emojiRegex, "authEmail must not contain emojis");
});
