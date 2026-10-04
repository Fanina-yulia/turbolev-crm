import "server-only";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  epoch: number;
};

type AccessContextCacheState = {
  epoch: number;
  values: Map<string, CacheEntry>;
  inflight: Map<string, { epoch: number; promise: Promise<unknown> }>;
};

const globalForAccessContextCache = globalThis as unknown as {
  turboLevAccessContextCache?: AccessContextCacheState;
};

function cacheState(): AccessContextCacheState {
  globalForAccessContextCache.turboLevAccessContextCache ??= {
    epoch: 0,
    values: new Map(),
    inflight: new Map(),
  };
  return globalForAccessContextCache.turboLevAccessContextCache;
}

export const ACCESS_CONTEXT_CACHE_TTL_MS = {
  securityMode: 15_000,
  rbac: 20_000,
} as const;

export async function getAccessContextCachedValue<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const state = cacheState();
  const now = Date.now();
  const hit = state.values.get(key);
  if (hit && hit.expiresAt > now && hit.epoch === state.epoch) return hit.value as T;
  if (hit) state.values.delete(key);

  const pending = state.inflight.get(key);
  if (pending && pending.epoch === state.epoch) return pending.promise as Promise<T>;

  const loadEpoch = state.epoch;
  let promise!: Promise<T>;
  promise = (async () => {
    try {
      const value = await loader();
      if (cacheState().epoch === loadEpoch) {
        state.values.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs), epoch: loadEpoch });
      }
      return value;
    } finally {
      const active = state.inflight.get(key);
      if (active?.promise === promise) state.inflight.delete(key);
    }
  })();

  state.inflight.set(key, { epoch: loadEpoch, promise });
  return promise;
}

export function invalidateAccessContextCache() {
  const state = cacheState();
  state.epoch += 1;
  state.values.clear();
  state.inflight.clear();
}
