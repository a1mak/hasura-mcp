import type { HasuraResult } from './hasura/errors.js';

/**
 * Engine state is read fresh rather than cached for correctness: a stale copy
 * makes the server answer confidently about a schema that has moved. The window
 * is short enough that nothing observable can change inside it, and long enough
 * to de-duplicate the reads of one turn — several steps of a call, or two tools
 * that need the same document.
 */
export const DEFAULT_READ_TTL_MS = 2_000;

export type CachedReader<T> = {
  readonly read: () => Promise<HasuraResult<T>>;
  readonly invalidate: () => void;
};

export type CacheOptions = { readonly ttlMs?: number; readonly now?: () => number };

export const createCachedReader = <T>(
  load: () => Promise<HasuraResult<T>>,
  options: CacheOptions = {},
): CachedReader<T> => {
  const ttlMs = options.ttlMs ?? DEFAULT_READ_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { readonly at: number; readonly result: HasuraResult<T> } | null = null;
  let inFlight: Promise<HasuraResult<T>> | null = null;

  const read = async (): Promise<HasuraResult<T>> => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.result;
    // Concurrent callers share one request rather than stampeding the engine.
    if (inFlight !== null) return inFlight;

    inFlight = load()
      .then((result) => {
        // Failures are not cached: the next call should retry, not inherit an outage.
        if (result.ok) cached = { at: now(), result };
        return result;
      })
      // A throw would otherwise leave the rejected promise parked here forever,
      // and every later read would inherit it.
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  return {
    read,
    invalidate: () => {
      cached = null;
    },
  };
};
