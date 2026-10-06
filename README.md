# Coiny Chat 🚀

Coiny — это высокозащищенный, быстрый кроссплатформенный клиент для обмена сообщениями (на базе веб, Electron и Capacitor для мобильных платформ), созданный с использованием React, Vite и Supabase.

Приложение спроектировано с акцентом на приватность (сквозное шифрование E2EE) и оптимизированную архитектуру для работы в условиях нестабильного интернет-соединения (Offline-first).

---

## 🔒 Безопасность и Сквозное Шифрование (E2EE)

В Coiny реализовано полноценное сквозное шифрование для личных переписок и отправляемых медиа-файлов на базе Web Crypto API (алгоритмы ECDH P-256 и AES-GCM 256 бит):

1. **Ключевой обмен (ECDH)**: Каждое устройство генерирует ключевую пару ECDH. Публичный ключ публикуется в профиле, а приватный ключ шифруется на основе пароля пользователя (PBKDF2 с **600 000 итерациями** и SHA-256) и сохраняется в защищенной таблице `user_private_keys` (защищена RLS `auth.uid() = id`).
2. **Локальное хранение**: Расшифрованный приватный ключ хранится в памяти приложения и в локальной базе данных **IndexedDB** в виде неэкстрагируемого (`extractable: false`) объекта `CryptoKey`. plaintext-ключи никогда не попадают в `localStorage`.
3. **E2EE для медиафайлов**: Все вложения (изображения, аудиозаписи, видеосообщения) шифруются симметричным AES-GCM ключом на клиенте *перед загрузкой* в облачное хранилище. В бакет Supabase `chat-attachments` (который настроен как приватный) попадает только зашифрованный бинарный blob. При получении файл скачивается через сессию Supabase и расшифровывается на устройстве получателя.
4. **Защита от MITM**: Интегрировано отображение хэша публичных ключей ("Safety Numbers") для ручной сверки подлинности сессии собеседников вне сети.

---

## 📁 Структура проекта

```
src/
  components/          # UI (chat/, settings/, CallOverlay, …)
  context/
    AuthContext.jsx    # сессия Supabase / mock
    E2EEContext.jsx    # ключи, backup/restore
    chat/              # ChatProvider + hooks (loader, actions, realtime, offline)
    calls/             # CallProvider, signaling, media, ICE
  services/            # dataLayer facade + auth/chat/message/media/offline
  types/               # shared TypeScript types
  utils/               # e2eeHelper, mediaValidation, IndexedDB, …
  mocks/               # demo stickers
```

Публичные entry points (стабильные импорты):

- `context/ChatContext.jsx` → `useChat` / `ChatProvider`
- `context/CallContext.jsx` → `useCalls` / `CallProvider`
- `services/dataLayer.js` → `dataService.*`

Подробнее: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · ops: **[docs/OPS.md](docs/OPS.md)** · DoD: **[docs/DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md)**.

---

## 🛠️ Требования к окружению и `.env`

Для запуска приложения в Supabase-режиме создайте файл `.env` в корневом каталоге проекта:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_GITHUB_REPO=mandyfan10-stack/coingram-chat
# Optional — Tenor GIF search. Restrict the key by HTTP referrer.
VITE_TENOR_API_KEY=your-tenor-api-key
```

*Примечание: Если переменные окружения отсутствуют, приложение автоматически переключается в интерактивный демонстрационный оффлайн-режим (Mock Mode).*

Без `VITE_TENOR_API_KEY` панель GIF использует локальный кураторский набор.

---

## 📘 TypeScript (постепенно)

В проекте включён **gradual TypeScript**:

- `tsconfig.json` — `allowJs: true`, `strict: true`, `noEmit`
- общие типы: `src/types/` (`profile`, `chat`, `message`, `call`)
- уже на TS: `authEmail`, `mediaValidation`, `reactionUtils`, `iceServers`, `themesData`, …
- проверка: `npm run typecheck` (также в CI)

Новые pure-модули предпочтительно писать на `.ts` / `.tsx`. Крупные JSX context/UI пока остаются на JS.

---

## 🔐 Модель входа (username-first)

UI принимает только **username + password**. Supabase Auth по-прежнему требует email, поэтому клиент строит *внутренний* идентификатор:

| Схема | Email (не показывается пользователю) | Когда |
|-------|--------------------------------------|--------|
| **Modern** (новые аккаунты) | `{username}@coiny.users.local` | Регистрация |
| **Legacy** (существующие) | `{username}@tg-clone.com` | Вход dual-path |

**Вход:** клиент пробует modern email, при `invalid_credentials` — legacy.  
**Регистрация:** только modern.  
Username: `a-z`, `0-9`, `_`, длина 3–32.

Синтетические адреса не принимают почту. На hosted-проекте выключите **Confirm email** (или примените миграцию `20260827120000_auto_confirm_synthetic_auth_emails.sql`). Иначе логин даёт 400 на `/auth/v1/token?grant_type=password`.

В Mock Mode пароли в `localStorage` хранятся как **SHA-256 hash** (`passwordHash`), не в открытом виде.

---

## 🚀 Запуск и Разработка

### Установка зависимостей:
```bash
npm install
```

### Запуск веб-версии в режиме разработки:
```bash
npm run dev
```

### Сборка веб-версии для продакшена:
```bash
npm run build
```

### Качество:
```bash
npm run lint
npm run typecheck
npm test              # E2EE + unit/contracts (offline, auth, …)
npm run test:e2e      # live two-user (нужны E2E_* secrets, см. docs/live-e2e.md)
npm run test:scroll   # прокрутка длинной истории и гонки пагинации, desktop + mobile, без Supabase
npm run test:ui       # настройки, шапка, панель медиа, истории и гонки загрузки; Chromium + WebKit
```

---

## 💻 Сборка Electron приложения

Приложение подготовлено для упаковки в нативный десктоп-клиент.

### Запуск Electron в режиме разработки:
```bash
npm run electron:dev
```

### Сборка десктопного дистрибутива (Windows):
```bash
npm run electron:build
```
*Собранные инсталляторы будут сохранены в каталоге `dist-electron/`.*

---

## 📱 Сборка под Android (Capacitor)

1. Синхронизируйте веб-ресурсы с нативным проектом:
   ```bash
   npm run build
   npx cap sync
   ```
2. Откройте Android Studio для компиляции APK/AAB:
   ```bash
   npx cap open android
   ```

---

## 🧹 Локальная очистка артефактов

Сборки и кэши **не** хранятся в Git (см. `.gitignore`), но локально могут занимать гигабайты (`dist-electron/`, `android/**/build`, `node_modules`).

Безопасно удалить и пересобрать:

```bash
# dist, dist-electron, android build, Playwright reports
npm run clean:artifacts

# то же + node_modules (после этого нужен npm install)
npm run clean:all
```

Установочные файлы релизов скачивайте с GitHub Releases — их не обязательно держать в `dist-electron/` между сборками.

Версия приложения всегда берётся из `package.json` через Vite (`import.meta.env.APP_VERSION`). Перед тегом:

```bash
npm run release:verify -- v1.20.44
```
