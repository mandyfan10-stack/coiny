/** Safe ISO conversion for Date or already-string timestamps. */
export const toISO = (date: Date | string | null | undefined): string | null | undefined => (
  date instanceof Date ? date.toISOString() : date
);

/**
 * Narrow an optional Supabase client on live-only code paths. Throws a clear
 * error instead of a TypeError deep inside a query when used in mock mode.
 */
export function requireClient<T>(client: T | null | undefined): T {
  if (!client) throw new Error('Supabase is not configured.');
  return client;
}
