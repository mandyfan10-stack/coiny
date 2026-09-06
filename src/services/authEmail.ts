/**
 * Supabase Auth requires an email; Coiny is username-first in the UI.
 *
 * Dual-path model:
 * - Legacy accounts:  {username}@tg-clone.com
 * - New accounts:     {username}@coiny.users.local
 *
 * The email is an internal identifier only — never shown as a real mailbox.
 */

export const LEGACY_AUTH_EMAIL_DOMAIN = 'tg-clone.com';
export const MODERN_AUTH_EMAIL_DOMAIN = 'coiny.users.local';

export type UsernameValidationResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

export interface MockUserRecord {
  username?: string;
  password?: string;
  passwordHash?: string;
  [key: string]: unknown;
}

/** Normalize a username for auth (lowercase, strip @). */
export function normalizeAuthUsername(username: string | null | undefined): string {
  return String(username || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/** Usernames reserved for mock-only demo bots / system (not real accounts). */
export const RESERVED_AUTH_USERNAMES = new Set([
  'echo_bot',
  'quiz_bot',
  'weather_bot',
  'saved_messages',
  'coiny_news'
]);

/**
 * Validate username for auth (must form a safe local-part of an email).
 */
export function validateAuthUsername(username: string | null | undefined): UsernameValidationResult {
  const normalized = normalizeAuthUsername(username);
  if (normalized.length < 3) {
    return { ok: false, error: 'Имя пользователя должно быть не менее 3 символов.' };
  }
  if (normalized.length > 32) {
    return { ok: false, error: 'Имя пользователя должно быть не более 32 символов.' };
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return { ok: false, error: 'Имя пользователя: только латиница, цифры и _.' };
  }
  if (RESERVED_AUTH_USERNAMES.has(normalized)) {
    return { ok: false, error: 'Это имя пользователя зарезервировано.' };
  }
  return { ok: true, username: normalized };
}

export type AuthEmailValidationResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/** Validate and normalize a real email used for direct Supabase sign-in. */
export function validateAuthEmail(email: string | null | undefined): AuthEmailValidationResult {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: 'Укажите корректный email.' };
  }
  return { ok: true, email: normalized };
}

export function buildLegacyAuthEmail(username: string): string {
  return `${normalizeAuthUsername(username)}@${LEGACY_AUTH_EMAIL_DOMAIN}`;
}

export function buildModernAuthEmail(username: string): string {
  return `${normalizeAuthUsername(username)}@${MODERN_AUTH_EMAIL_DOMAIN}`;
}

/** Email used for new registrations (modern domain). */
export function buildSignupAuthEmail(username: string): string {
  return buildModernAuthEmail(username);
}

/**
 * Ordered candidate emails for sign-in (modern first, then legacy).
 */
export function buildSignInEmailCandidates(username: string): string[] {
  const modern = buildModernAuthEmail(username);
  const legacy = buildLegacyAuthEmail(username);
  return modern === legacy ? [modern] : [modern, legacy];
}

type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  statusCode?: number | null;
  message?: string | null;
} | null | undefined;

function authErrorCode(error: AuthErrorLike): string {
  return String(error?.code || '').trim().toLowerCase();
}

function authErrorMessage(error: AuthErrorLike): string {
  return String(error?.message || '').trim().toLowerCase();
}

/** Wrong-account-for-this-synthetic-email — safe to try the next dual-path candidate. */
export function isRetryableSignInSchemeError(error: AuthErrorLike): boolean {
  if (!error) return false;
  const code = authErrorCode(error);
  const message = authErrorMessage(error);
  return code === 'invalid_credentials'
    || message.includes('invalid login credentials')
    || message.includes('invalid_credentials');
}

/**
 * Dual-path should continue when this address is not a usable account, not when
 * the password is confirmed-wrong against an existing user (email_not_confirmed,
 * banned, rate-limit, etc.).
 */
export function shouldTryNextAuthEmail(error: AuthErrorLike, candidateEmail: string): boolean {
  if (isRetryableSignInSchemeError(error)) return true;
  const code = authErrorCode(error);
  const message = authErrorMessage(error);
  const invalidAddress = code === 'email_address_invalid'
    || message.includes('email_address_invalid')
    || message.includes('invalid email')
    || message.includes('test domains are currently not supported');
  return invalidAddress && candidateEmail.toLowerCase().endsWith(`@${MODERN_AUTH_EMAIL_DOMAIN}`);
}

export function mapSupabaseAuthError(
  error: AuthErrorLike,
  action: 'signin' | 'signup' | 'reset' = 'signin'
): Error {
  const code = authErrorCode(error);
  const message = authErrorMessage(error);
  const fallback = String(error?.message || '').trim();

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return new Error(
      'Аккаунт не подтверждён. Внутренние адреса Coiny не принимают письма — выключите Confirm email в Supabase Auth.'
    );
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return new Error(
      action === 'signup'
        ? 'Не удалось завершить регистрацию. Попробуйте войти с тем же логином и паролем.'
        : 'Неверный логин или пароль.'
    );
  }
  if (code === 'email_address_invalid' || message.includes('test domains are currently not supported')) {
    if (action === 'reset') {
      return new Error('К этому аккаунту не привязан действующий адрес электронной почты.');
    }
    return new Error('Сервер авторизации отклонил внутренний email. Проверьте настройки Auth в Supabase.');
  }
  if (code === 'user_already_exists' || message.includes('user already registered') || message.includes('already been registered')) {
    return new Error('Это имя пользователя уже занято.');
  }
  if (code === 'over_request_rate_limit' || message.includes('rate limit') || message.includes('too many requests')) {
    return new Error('Слишком много попыток. Подождите минуту и попробуйте снова.');
  }
  if (code === 'weak_password' || message.includes('password should be') || message.includes('weak password')) {
    return new Error('Пароль слишком простой. Нужно не менее 10 символов, буквы разного регистра, цифра и спецсимвол.');
  }
  return new Error(fallback || (action === 'signup'
    ? 'Ошибка при регистрации. Возможно, имя пользователя уже занято.'
    : action === 'reset'
      ? 'Ошибка при отправке ссылки для восстановления.'
      : 'Ошибка при входе. Проверьте логин и пароль.'));
}

/**
 * SHA-256 hex digest for mock-mode password storage (never plaintext in localStorage).
 */
export async function hashMockPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(String(password));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compare a mock user record against a password (hash or legacy plaintext). */
export async function mockPasswordMatches(
  user: MockUserRecord | null | undefined,
  password: string
): Promise<boolean> {
  if (!user) return false;
  const incoming = await hashMockPassword(password);
  if (user.passwordHash && user.passwordHash === incoming) return true;
  if (user.password && user.password === password) return true;
  return false;
}
