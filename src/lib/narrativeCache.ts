// src/lib/narrativeCache.ts
const NARRATIVE_CACHE_TTL_MS = 30_000;

const narrativeCache = new Map<string, { expiresAt: number; payload: any }>();
const narrativeInflight = new Map<string, Promise<any>>();

function narrativeCacheGet(key: string) {
  const hit = narrativeCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    narrativeCache.delete(key);
    return null;
  }
  return hit.payload;
}

function narrativeCacheSet(key: string, payload: any) {
  narrativeCache.set(key, { expiresAt: Date.now() + NARRATIVE_CACHE_TTL_MS, payload });
}

export { narrativeCacheGet, narrativeCacheSet, narrativeInflight };