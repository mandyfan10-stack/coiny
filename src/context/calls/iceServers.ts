import { supabase } from '../../supabaseClient.js';

export interface IceConfigProviderOptions {
  allowDirectConnection?: boolean;
  /** Authenticated account id. Clear the cache when the account changes. */
  cacheKey?: string;
  forceRefresh?: boolean;
  requestTimeoutMs?: number;
}

interface IceCredentialClient {
  functions: {
    invoke(
      name: string,
      options: { method: 'POST'; signal: AbortSignal }
    ): Promise<{ data?: unknown; error?: unknown }>;
  };
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

let cachedConfiguration: RTCConfiguration = { iceServers: STUN_SERVERS, iceTransportPolicy: 'all' };
const EXPIRY_MARGIN_MS = 30_000;
const REQUEST_TIMEOUT_MS = 3_000;
interface CredentialResult { servers: RTCIceServer[]; expiresAt: number }
interface CredentialEntry { value?: CredentialResult; pending?: Promise<CredentialResult> }
let credentialCaches = new WeakMap<IceCredentialClient, Map<string, CredentialEntry>>();
let generation = 0;
let activeRequest = 0;
const controllers = new Set<AbortController>();

/** Discard credentials and invalidate in-flight requests on sign-out/account change. */
export function resetIceConfiguration(): void {
  generation += 1;
  activeRequest += 1;
  credentialCaches = new WeakMap();
  cachedConfiguration = configurationFor({});
  for (const controller of controllers) controller.abort();
  controllers.clear();
}

function isTurnUrl(value: unknown): value is string {
  return typeof value === 'string' && /^turns?:[^\s]+$/i.test(value);
}

function normalizeFetchedIceServers(payload: unknown): RTCIceServer[] {
  if (!payload || typeof payload !== 'object') return [];
  const iceServers = (payload as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(iceServers)) return [];

  const servers: RTCIceServer[] = [];
  for (const entry of iceServers) {
    if (!entry || typeof entry !== 'object') continue;
    const urlsValue = (entry as { urls?: unknown }).urls;
    const urls = Array.isArray(urlsValue) ? urlsValue.filter(isTurnUrl) : (isTurnUrl(urlsValue) ? [urlsValue] : []);
    if (!urls.length) continue;
    const username = (entry as { username?: unknown }).username;
    const secret = (entry as { credential?: unknown }).credential;
    if (typeof username !== 'string' || typeof secret !== 'string' || !username || !secret) continue;
    servers.push({ urls, username, credential: secret });
  }
  return servers;
}

function configurationFor(
  options: IceConfigProviderOptions,
  extraServers: RTCIceServer[] = []
): RTCConfiguration {
  const hasRelay = extraServers.length > 0;
  return {
    iceServers: hasRelay ? [...STUN_SERVERS, ...extraServers] : STUN_SERVERS,
    iceTransportPolicy: hasRelay && !options.allowDirectConnection ? 'relay' : 'all'
  };
}

export async function refreshIceConfiguration(
  options: IceConfigProviderOptions = {},
  client: IceCredentialClient | null = supabase
): Promise<RTCConfiguration> {
  const request = ++activeRequest;
  const startedGeneration = generation;
  // Never expose credentials from the previously selected account while awaiting this one.
  cachedConfiguration = configurationFor(options);
  let result: CredentialResult = { servers: [], expiresAt: 0 };
  if (client) {
    let cache = credentialCaches.get(client);
    if (!cache) credentialCaches.set(client, cache = new Map());
    const key = options.cacheKey ?? '';
    let entry = cache.get(key);
    if (!entry) cache.set(key, entry = {});
    const valid = entry.value && entry.value.expiresAt > Date.now() + EXPIRY_MARGIN_MS;
    if (valid && !options.forceRefresh) {
      result = entry.value!;
    } else {
      if (!entry.pending) {
        const targetEntry = entry;
        const controller = new AbortController();
        controllers.add(controller);
        let timer: ReturnType<typeof setTimeout>;
        const timeout = Number.isFinite(options.requestTimeoutMs)
          ? Math.max(1, Math.min(10_000, options.requestTimeoutMs!)) : REQUEST_TIMEOUT_MS;
        const cancelled = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('ICE request cancelled')), { once: true });
          timer = setTimeout(() => controller.abort(), timeout);
        });
        targetEntry.pending = (async () => {
          try {
            // The race also bounds custom clients which do not implement abort correctly.
            const { data, error } = await Promise.race([
              client.functions.invoke('turn-credentials', { method: 'POST', signal: controller.signal }),
              cancelled
            ]);
            if (error) {
              return targetEntry.value && targetEntry.value.expiresAt > Date.now() + EXPIRY_MARGIN_MS
                ? targetEntry.value : { servers: [], expiresAt: 0 };
            }
            if (!data || typeof data !== 'object' || !('available' in data) || !data.available) {
              return { servers: [], expiresAt: 0 };
            }
            const hasExpiry = 'expiresAt' in data;
            const expiresAt = hasExpiry && typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) ? data.expiresAt : 0;
            const servers = hasExpiry && expiresAt <= Date.now() + EXPIRY_MARGIN_MS
              ? [] : normalizeFetchedIceServers(data);
            const value = { servers, expiresAt };
            if (generation === startedGeneration && expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
              targetEntry.value = value;
            }
            return value;
          } catch {
            // A failed proactive refresh may keep credentials that are still safely valid.
            return targetEntry.value && targetEntry.value.expiresAt > Date.now() + EXPIRY_MARGIN_MS
              ? targetEntry.value : { servers: [], expiresAt: 0 };
          }
        })().finally(() => {
          clearTimeout(timer!);
          controllers.delete(controller);
          targetEntry.pending = undefined;
        });
      }
      result = await entry.pending!;
    }
  }
  const configuration = configurationFor(options, generation === startedGeneration ? result.servers : []);
  if (generation === startedGeneration && request === activeRequest) cachedConfiguration = configuration;
  return configuration;
}

export function getIceConfiguration(): RTCConfiguration {
  return cachedConfiguration;
}

export const ICE_SERVERS = STUN_SERVERS;

export function createPeerConnection(configuration: RTCConfiguration = getIceConfiguration()): RTCPeerConnection {
  return new RTCPeerConnection(configuration);
}
