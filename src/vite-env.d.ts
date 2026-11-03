/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_E2EE_V2_ENABLED?: string;
  readonly VITE_E2EE_V2_AUDIT_APPROVED?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_WEB_PUSH_PUBLIC_KEY?: string;
  /** Optional Tenor GIF API key. Without it the picker uses a local curated set. */
  readonly VITE_TENOR_API_KEY?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
