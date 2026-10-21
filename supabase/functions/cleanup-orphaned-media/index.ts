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
const PAGE_SIZE = 500;
const MAX_SCAN_ROWS = 100_000;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MESSAGE_FILE_PATTERN = new RegExp(`^(${UUID_PATTERN})/${UUID_PATTERN}/(?:msg|forward)_(${UUID_PATTERN})\\.[a-z0-9]+$`, 'i');

function isOlderThan(entry: StorageEntry, ageMs: number): boolean {
  const value = entry.created_at || entry.updated_at;
  return Boolean(value && Date.now() - new Date(value).getTime() >= ageMs);
}

function referencedPath(value: unknown, bucket: string, allowBarePath = false): string | null {
  if (typeof value !== "string" || !value) return null;
  const canonicalPrefix = `storage://${bucket}/`;
  if (value.startsWith(canonicalPrefix)) return safePath(value.slice(canonicalPrefix.length));
  for (const marker of [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/authenticated/${bucket}/`]) {
    const index = value.indexOf(marker);
    if (index >= 0) return safePath(value.slice(index + marker.length).split("?")[0]);
  }
  // *_path columns contain object keys, not URLs. Do not interpret an opaque
  // encrypted media envelope or an arbitrary display value as a bare key.
  return allowBarePath && !value.includes(':') ? safePath(value) : null;
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

  let dryRun = false;
  try {
    const body = (await request.text()).trim();
    if (body) {
      const options = JSON.parse(body);
      if (!options || typeof options !== 'object' || Array.isArray(options)
        || ('dryRun' in options && typeof options.dryRun !== 'boolean')) {
        return Response.json({ error: 'dryRun must be a boolean.' }, { status: 400 });
      }
      dryRun = options.dryRun === true;
    }
  } catch {
    return Response.json({ error: 'Invalid cleanup options.' }, { status: 400 });
  }

  // Every scan finishes before the first remove call. Any error, repeated page
  // or safety limit aborts the whole run; an incomplete reference set must
  // never be used to authorize deletion. Continue past short pages because a
  // project's Data API row cap can be lower than the requested page size.
  let scannedRows = 0;
  const accountForRows = (count: number) => {
    scannedRows += count;
    if (scannedRows > MAX_SCAN_ROWS) throw new Error('Cleanup scan limit exceeded');
  };
  const readAll = async (table: string, columns: string) => {
    const rows: Array<Record<string, unknown> & { id: string }> = [];
    let cursor = '';
    for (;;) {
      let query = supabase.from(table).select(`id,${columns}`).order('id', { ascending: true }).limit(PAGE_SIZE);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error(`Incomplete ${table} reference scan`);
      if (!data.length) return rows;
      accountForRows(data.length);
      for (const row of data) {
        if (typeof row.id !== 'string' || row.id <= cursor) throw new Error(`Non-advancing ${table} reference scan`);
        cursor = row.id;
        rows.push(row);
      }
    }
  };

  const listFiles = async (bucket: string, prefix = "", depth = 0): Promise<Array<StorageEntry & { path: string }>> => {
    if (depth > 5) throw new Error(`Storage nesting is too deep in ${bucket}/${prefix}`);
    const files: Array<StorageEntry & { path: string }> = [];
    const seen = new Set<string>();
    for (let offset = 0; ;) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error(`Incomplete ${bucket} file scan`);
      const entries = data as StorageEntry[];
      if (!entries.length) break;
      accountForRows(entries.length);
      for (const entry of entries) {
        if (typeof entry.name !== 'string' || !entry.name || entry.name.includes('/')
          || entry.name === '.' || entry.name === '..' || seen.has(entry.name)) {
          throw new Error(`Invalid or repeated ${bucket} file scan`);
        }
        seen.add(entry.name);
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id && !entry.metadata) files.push(...await listFiles(bucket, path, depth + 1));
        else if (entry.name !== ".emptyFolderPlaceholder") files.push({ ...entry, path });
      }
      offset += entries.length;
    }
    return files;
  };

  try {
    const [messageRows, profiles, chats, stories] = await Promise.all([
      readAll('messages', 'chat_id,crypto_version,media,media_path'),
      readAll('profiles', 'avatar,avatar_path,wallpaper,wallpaper_path,banner,banner_path'),
      readAll('chats', 'avatar,avatar_path'),
      readAll('stories', 'media,media_path,expires_at')
    ]);
    const references = new Map<string, Set<string>>([
      ['chat-attachments', new Set()], ["public-media", new Set()], ["avatars", new Set()], ["wallpapers", new Set()],
      ["banners", new Set()], ["group-avatars", new Set()], ["stories", new Set()]
    ]);
    const referencedChatPaths = references.get('chat-attachments')!;
    const existingIds = new Set(messageRows.map(row => row.id.toLowerCase()));
    const opaqueChatIds = new Set<string>();
    for (const row of messageRows) {
      const mediaPath = referencedPath(row.media_path, "chat-attachments", true);
      const mediaUrlPath = referencedPath(row.media, "chat-attachments");
      if (mediaPath) referencedChatPaths.add(mediaPath);
      if (mediaUrlPath) referencedChatPaths.add(mediaUrlPath);
      // Legacy encrypted media has no server-readable object key. Keep all
      // files of such a chat instead of guessing which are unreferenced.
      if (typeof row.chat_id === 'string' && (row.crypto_version === 2
        || (typeof row.media === 'string' && row.media.startsWith('e2ee:') && !mediaPath))) {
        opaqueChatIds.add(row.chat_id.toLowerCase());
      }
    }
    const remember = (bucket: string, value: unknown, allowBarePath = false) => {
      const path = referencedPath(value, bucket, allowBarePath);
      if (path) references.get(bucket)?.add(path);
    };
    for (const row of profiles) {
      for (const [field, bucket] of [['avatar', 'avatars'], ['wallpaper', 'wallpapers'], ['banner', 'banners']]) {
        remember('public-media', row[field]);
        remember('chat-attachments', row[field]);
        remember(bucket, row[field]);
        remember(bucket, row[`${field}_path`], true);
      }
    }
    for (const row of chats) {
      remember("public-media", row.avatar); remember('chat-attachments', row.avatar);
      remember('group-avatars', row.avatar); remember("group-avatars", row.avatar_path, true);
    }
    for (const row of stories) {
      if (typeof row.expires_at === 'string' && new Date(row.expires_at).getTime() > Date.now()) {
        remember("public-media", row.media); remember('chat-attachments', row.media);
        remember('stories', row.media); remember("stories", row.media_path, true);
      }
    }

    const orphanByBucket = new Map<string, string[]>();
    let skippedUnverifiableChatAttachments = 0;
    for (const [bucket, bucketReferences] of references) {
      const files = await listFiles(bucket);
      if (bucket === 'chat-attachments') {
        orphanByBucket.set(bucket, files.filter(file => {
          if (!isOlderThan(file, CHAT_GRACE_MS) || bucketReferences.has(file.path)) return false;
          const identity = file.path.match(MESSAGE_FILE_PATTERN);
          // record_<random id> and unknown legacy names do not bind to a
          // message id. Preserve them until an explicit reference is available.
          if (!identity || opaqueChatIds.has(identity[1].toLowerCase())) {
            skippedUnverifiableChatAttachments += 1;
            return false;
          }
          return !existingIds.has(identity[2].toLowerCase());
        }).map(file => file.path));
      } else {
        orphanByBucket.set(bucket, files
          .filter((file) => isOlderThan(file, PUBLIC_GRACE_MS) && !bucketReferences.has(file.path))
          .map((file) => file.path));
      }
    }

    const orphanChatPaths = orphanByBucket.get('chat-attachments') || [];
    orphanByBucket.delete('chat-attachments');
    const chatDeletes = orphanChatPaths.slice(0, MAX_DELETE_PER_RUN);
    if (!dryRun && chatDeletes.length) { const { error } = await supabase.storage.from("chat-attachments").remove(chatDeletes); if (error) throw error; }
    let remaining = MAX_DELETE_PER_RUN - chatDeletes.length;
    const deletedByBucket: Record<string, number> = {};
    for (const [bucket, paths] of orphanByBucket) {
      const selected = paths.slice(0, Math.max(0, remaining));
      if (!dryRun && selected.length) {
        const { error } = await supabase.storage.from(bucket).remove(selected);
        if (error) throw error;
      }
      deletedByBucket[bucket] = dryRun ? 0 : selected.length;
      remaining -= selected.length;
    }

    return Response.json({
      dryRun,
      completeScan: true,
      skippedUnverifiableChatAttachments,
      deleted: { chatAttachments: dryRun ? 0 : chatDeletes.length, ...deletedByBucket },
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
