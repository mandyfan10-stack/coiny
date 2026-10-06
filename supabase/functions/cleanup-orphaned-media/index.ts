import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.112.2";

type StorageEntry = {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

const MAX_DELETE_PER_RUN = 200;
const CHAT_GRACE_MS = 24 * 60 * 60 * 1000;
const PUBLIC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function isOlderThan(entry: StorageEntry, ageMs: number): boolean {
  const value = entry.created_at || entry.updated_at;
  return Boolean(value && Date.now() - new Date(value).getTime() >= ageMs);
}

function referencedPath(value: unknown, bucket: string): string | null {
  if (typeof value !== "string" || !value) return null;
  const canonicalPrefix = `storage://${bucket}/`;
  if (value.startsWith(canonicalPrefix)) return safePath(value.slice(canonicalPrefix.length));
  for (const marker of [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`]) {
    const index = value.indexOf(marker);
    if (index >= 0) return safePath(value.slice(index + marker.length).split("?")[0]);
  }
  return null;
}

function safePath(value: string): string | null {
  try {
    let decoded = value;
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (!decoded || decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
    if (decoded.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const candidateSecret = request.headers.get("x-cleanup-secret") || "";
  if (!url || !serviceKey || !candidateSecret) return new Response("Forbidden", { status: 403 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: authError } = await supabase.rpc("verify_media_cleanup_secret", { p_secret: candidateSecret });
  if (authError || allowed !== true) return new Response("Forbidden", { status: 403 });

  const listFiles = async (bucket: string, prefix = "", depth = 0): Promise<Array<StorageEntry & { path: string }>> => {
    if (depth > 5) throw new Error(`Storage nesting is too deep in ${bucket}/${prefix}`);
    const files: Array<StorageEntry & { path: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      const entries = (data || []) as StorageEntry[];
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id && !entry.metadata) files.push(...await listFiles(bucket, path, depth + 1));
        else if (entry.name !== ".emptyFolderPlaceholder") files.push({ ...entry, path });
      }
      if (entries.length < 1000) break;
    }
    return files;
  };

  try {
    const chatFiles = await listFiles("chat-attachments");
    const chatCandidates = chatFiles.filter(file => /^.+\/.+\/(msg|record)_[0-9a-f-]{36}\.[a-z0-9]+$/i.test(file.path) && isOlderThan(file, CHAT_GRACE_MS));
    const { data: messageRows, error: messageError } = await supabase.from("messages").select("id,media,media_path");
    if (messageError) throw messageError;
    const referencedChatPaths = new Set<string>();
    for (const row of messageRows || []) {
      const mediaPath = referencedPath(row.media_path, "chat-attachments");
      const mediaUrlPath = referencedPath(row.media, "chat-attachments");
      if (mediaPath) referencedChatPaths.add(mediaPath);
      if (mediaUrlPath) referencedChatPaths.add(mediaUrlPath);
    }
    const orphanChatPaths = chatCandidates
      .filter(file => !referencedChatPaths.has(file.path))
      .map(file => file.path);

    const [profiles, chats, stories] = await Promise.all([
      supabase.from("profiles").select("avatar,avatar_path,wallpaper,wallpaper_path,banner,banner_path"),
      supabase.from("chats").select("avatar,avatar_path"),
      supabase.from("stories").select("media,media_path,expires_at")
    ]);
    if (profiles.error || chats.error || stories.error) {
      throw profiles.error || chats.error || stories.error;
    }

    const references = new Map<string, Set<string>>([
      ["public-media", new Set()], ["avatars", new Set()], ["wallpapers", new Set()],
      ["banners", new Set()], ["group-avatars", new Set()], ["stories", new Set()]
    ]);
    const remember = (bucket: string, value: unknown) => {
      const path = referencedPath(value, bucket);
      if (path) references.get(bucket)?.add(path);
    };
    for (const row of profiles.data || []) {
      remember("public-media", row.avatar); remember("public-media", row.wallpaper);
      remember("avatars", row.avatar_path); remember("wallpapers", row.wallpaper_path);
      remember("public-media", row.banner); remember("banners", row.banner_path);
    }
    for (const row of chats.data || []) {
      remember("public-media", row.avatar); remember("group-avatars", row.avatar_path);
    }
    for (const row of stories.data || []) {
      if (new Date(row.expires_at).getTime() > Date.now()) {
        remember("public-media", row.media); remember("stories", row.media_path);
      }
    }

    const orphanByBucket = new Map<string, string[]>();
    for (const [bucket, bucketReferences] of references) {
      const files = await listFiles(bucket);
      orphanByBucket.set(bucket, files
        .filter((file) => isOlderThan(file, PUBLIC_GRACE_MS) && !bucketReferences.has(file.path))
        .map((file) => file.path));
    }

    const chatDeletes = orphanChatPaths.slice(0, MAX_DELETE_PER_RUN);
    if (chatDeletes.length) { const { error } = await supabase.storage.from("chat-attachments").remove(chatDeletes); if (error) throw error; }
    let remaining = MAX_DELETE_PER_RUN - chatDeletes.length;
    const deletedByBucket: Record<string, number> = {};
    for (const [bucket, paths] of orphanByBucket) {
      const selected = paths.slice(0, Math.max(0, remaining));
      if (selected.length) {
        const { error } = await supabase.storage.from(bucket).remove(selected);
        if (error) throw error;
      }
      deletedByBucket[bucket] = selected.length;
      remaining -= selected.length;
    }

    return Response.json({
      deleted: { chatAttachments: chatDeletes.length, ...deletedByBucket },
      candidates: {
        chatAttachments: orphanChatPaths.length,
        ...Object.fromEntries(Array.from(orphanByBucket, ([bucket, paths]) => [bucket, paths.length]))
      }
    });
  } catch (error) {
    console.error("media cleanup failed", error);
    return Response.json({ error: "Cleanup failed safely; no further files were removed." }, { status: 500 });
  }
});
