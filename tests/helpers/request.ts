/**
 * Controls for the fake request behind the `next/headers`, `next/navigation`
 * and `next/cache` stubs (see tests/stubs/*.mjs). The stubs and these helpers
 * share state through `globalThis`, so every module in the test process sees
 * the same simulated request.
 */

export interface TestRequestState {
  cookies: Map<string, string>;
  headers: Headers;
}

export interface TestCacheLog {
  paths: string[];
  tags: string[];
}

const g = globalThis as unknown as { __llTestRequest?: TestRequestState; __llTestCache?: TestCacheLog };

export function testRequest(): TestRequestState {
  g.__llTestRequest ??= { cookies: new Map(), headers: new Headers() };
  return g.__llTestRequest;
}

/** Start a new simulated request with the given cookies and headers. */
export function resetRequest(init: { cookies?: Record<string, string>; headers?: Record<string, string> } = {}): TestRequestState {
  g.__llTestRequest = { cookies: new Map(Object.entries(init.cookies ?? {})), headers: new Headers(init.headers ?? {}) };
  return g.__llTestRequest;
}

export function requestCookie(name: string): string | undefined {
  return testRequest().cookies.get(name);
}

export function setRequestCookie(name: string, value: string): void {
  testRequest().cookies.set(name, value);
}

/** Paths passed to `revalidatePath` since the last `resetCacheLog()`. */
export function revalidatedPaths(): string[] {
  g.__llTestCache ??= { paths: [], tags: [] };
  return [...g.__llTestCache.paths];
}

export function resetCacheLog(): void {
  g.__llTestCache = { paths: [], tags: [] };
}

/** The destination of a `redirect()` error thrown by the navigation stub, or null for any other value. */
export function redirectTarget(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  return digest.split(";")[2] ?? null;
}

/** Run `fn`, which must call `redirect()`, and return where it redirected to. */
export async function captureRedirect(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const target = redirectTarget(error);
    if (target !== null) return target;
    throw error;
  }
  throw new Error("Expected a redirect, but the function returned normally.");
}
