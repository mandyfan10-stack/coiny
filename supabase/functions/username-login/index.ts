import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MISSING_PROFILE_ID = "00000000-0000-4000-8000-000000000000";
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_CAPTCHA_TOKEN_LENGTH = 4096;
const GENERIC_CREDENTIALS_ERROR = "Invalid username, email, or password.";
// These are application-owned origins used by the checked-in web deployment
// and the repository's local/live E2E commands. Additional staging origins can
// be appended with USERNAME_LOGIN_ALLOWED_ORIGINS without making a standard
// deployment depend on an out-of-band secret.
const BUILT_IN_ALLOWED_ORIGINS = [
  "https://mandyfan10-stack.github.io",
  "app://coiny",
  "https://localhost",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:3000",
] as const;

type UsernameLoginBody = {
  username?: unknown;
  password?: unknown;
  captchaToken?: unknown;
};

function readCsv(name: string): string[] {
  return String(Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function keysFromEnvironment(legacyNames: string[], mapName: string): string[] {
  const keys = legacyNames
    .map((name) => String(Deno.env.get(name) || "").trim())
    .filter(Boolean);
  const rawMap = Deno.env.get(mapName);
  if (!rawMap) return [...new Set(keys)];

  try {
    const parsed = JSON.parse(rawMap) as Record<string, unknown>;
    for (const key of Object.values(parsed)) {
      if (typeof key === "string" && key.trim()) keys.push(key.trim());
    }
  } catch {
    console.error("Username-login key configuration is invalid");
  }
  return [...new Set(keys)];
}

function allowedOrigins(): string[] {
  return [...new Set([
    ...BUILT_IN_ALLOWED_ORIGINS,
    ...readCsv("USERNAME_LOGIN_ALLOWED_ORIGINS"),
  ])];
}

function requestOrigin(request: Request): string {
  return String(request.headers.get("origin") || "").trim();
}

function isAllowedOrigin(request: Request): boolean {
  const origin = requestOrigin(request);
  return Boolean(origin) && allowedOrigins().includes(origin);
}

function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": requestOrigin(request),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function json(
  request: Request,
  body: unknown,
  status = 200,
  includeCors = false,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(includeCors ? corsHeaders(request) : {}),
    },
  });
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@+/, "").toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : null;
}

function safeClientNetworkValue(request: Request): string {
  const forwarded = String(request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim();
  const candidate = String(
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || forwarded
    || "unknown",
  ).trim();
  return candidate.slice(0, 200) || "unknown";
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validClientApiKey(request: Request, publicKeys: string[]): boolean {
  const apiKey = String(request.headers.get("apikey") || "").trim();
  return apiKey.length > 0 && publicKeys.includes(apiKey);
}

async function syntheticEmail(username: string): Promise<string> {
  const digest = await sha256Hex(`unknown:${username}`);
  return `missing-${digest.slice(0, 32)}@coiny.invalid`;
}

Deno.serve(async (request: Request) => {
  const originAllowed = isAllowedOrigin(request);
  if (request.method === "OPTIONS") {
    return originAllowed
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : json(request, { error: "Origin is not allowed" }, 403);
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405, originAllowed);
  }
  if (!originAllowed) {
    return json(request, { error: "Origin is not allowed" }, 403);
  }

  const publicKeys = keysFromEnvironment(
    ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
    "SUPABASE_PUBLISHABLE_KEYS",
  );
  const serviceRoleKey = keysFromEnvironment(
    ["SUPABASE_SERVICE_ROLE_KEY"],
    "SUPABASE_SECRET_KEYS",
  )[0];
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  if (!supabaseUrl || !serviceRoleKey || publicKeys.length === 0) {
    console.error("Username-login backend credentials are not configured");
    return json(request, { error: "Sign-in is temporarily unavailable" }, 503, true);
  }
  if (!validClientApiKey(request, publicKeys)) {
    return json(request, { error: "Unauthorized" }, 401, true);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json(request, { error: "Invalid login request" }, 400, true);
  }

  let body: UsernameLoginBody;
  try {
    body = await request.json() as UsernameLoginBody;
  } catch {
    return json(request, { error: "Invalid login request" }, 400, true);
  }

  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const captchaToken = typeof body.captchaToken === "string"
    && body.captchaToken.length <= MAX_CAPTCHA_TOKEN_LENGTH
    ? body.captchaToken
    : undefined;
  if (!username || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return json(request, { error: GENERIC_CREDENTIALS_ERROR }, 401, true);
  }

  try {
    const [networkBucket, usernameBucket] = await Promise.all([
      sha256Hex(`network:${safeClientNetworkValue(request)}`),
      sha256Hex(`username:${username}`),
    ]);
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: quotaAllowed, error: quotaError } = await adminClient.rpc(
      "consume_username_login_quota",
      { p_bucket_keys: [networkBucket, usernameBucket] },
    );
    if (quotaError) {
      console.error("Username-login quota check failed", quotaError.code || "unknown");
      return json(request, { error: "Sign-in is temporarily unavailable" }, 503, true);
    }
    if (!quotaAllowed) {
      return json(request, { error: "Too many sign-in attempts" }, 429, true);
    }

    const { data: resolvedProfileId, error: resolutionError } = await adminClient.rpc(
      "resolve_username_login_profile_id",
      { p_username: username },
    );
    if (resolutionError) {
      console.error("Username-login profile lookup failed", resolutionError.code || "unknown");
      return json(request, { error: "Sign-in is temporarily unavailable" }, 503, true);
    }

    const profileId = typeof resolvedProfileId === "string" && UUID_PATTERN.test(resolvedProfileId)
      ? resolvedProfileId
      : MISSING_PROFILE_ID;
    const { data: userResult } = await adminClient.auth.admin.getUserById(profileId);
    const loginEmail = typeof userResult.user?.email === "string"
      ? userResult.user.email.trim().toLowerCase()
      : await syntheticEmail(username);

    const authClient = createClient(supabaseUrl, String(request.headers.get("apikey")), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: loginData, error: loginError } = await authClient.auth.signInWithPassword({
      email: loginEmail,
      password,
      options: captchaToken ? { captchaToken } : {},
    });
    const session = loginData.session;
    if (loginError || !session?.access_token || !session.refresh_token) {
      const status = loginError?.status === 429 ? 429 : 401;
      return json(request, { error: GENERIC_CREDENTIALS_ERROR }, status, true);
    }

    return json(request, {
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    }, 200, true);
  } catch (error) {
    console.error(
      "Username-login execution failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(request, { error: "Sign-in is temporarily unavailable" }, 503, true);
  }
});
