/**
 * Minimal fake of `next/cache` for tests: nothing is cached, and every
 * revalidation is recorded on `globalThis.__llTestCache` so tests can assert
 * which pages a mutation refreshes (see `tests/helpers/request.ts`).
 */

function log() {
  globalThis.__llTestCache ??= { paths: [], tags: [] };
  return globalThis.__llTestCache;
}

export function revalidatePath(path, type) {
  log().paths.push(type ? `${path} (${type})` : path);
}

export function revalidateTag(tag) {
  log().tags.push(tag);
}

export function updateTag(tag) {
  log().tags.push(tag);
}

export function refresh() {}

export function unstable_noStore() {}

export function unstable_cache(fn) {
  return (...args) => fn(...args);
}

export function cacheLife() {}

export function cacheTag() {}
