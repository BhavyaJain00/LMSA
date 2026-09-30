/**
 * IndexNow protocol helpers (pure). The server-side client lives in
 * `indexnow-client.ts`; this module only validates keys and builds requests
 * so it can be unit tested and shared with the settings form.
 *
 * The key file is served at `/indexnow.txt` (see `src/app/indexnow.txt/route.ts`)
 * and every submission names it through `keyLocation`, which the protocol
 * allows for a key file hosted at the site root.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow.txt";
/** The protocol accepts at most 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;

/** 8–128 characters of a-z, A-Z, 0-9 and "-" (IndexNow key rules). */
export function isValidIndexNowKey(key: string | undefined | null): key is string {
  return typeof key === "string" && /^[A-Za-z0-9-]{8,128}$/.test(key);
}

/** A new random 32-character hexadecimal key. */
export function generateIndexNowKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hosts where pinging search engines makes no sense (local development, private networks). */
export function isPingableOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test") || host.endsWith(".internal")) return false;
  if (/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.0\.0\.0$/.test(host)) return false;
  if (host === "[::1]" || host === "::1") return false;
  return host.includes(".");
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * Request bodies for a set of URLs: only absolute URLs on the site's own host
 * are kept (the protocol rejects the whole batch otherwise), deduplicated and
 * split into chunks of `INDEXNOW_MAX_URLS`.
 */
export function buildIndexNowPayloads(origin: string, key: string, urls: readonly string[]): IndexNowPayload[] {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return [];
  }
  const unique = [
    ...new Set(
      urls.filter((u) => {
        try {
          return new URL(u).host === host;
        } catch {
          return false;
        }
      }),
    ),
  ];
  const payloads: IndexNowPayload[] = [];
  for (let i = 0; i < unique.length; i += INDEXNOW_MAX_URLS) {
    payloads.push({ host, key, keyLocation: `${origin}${INDEXNOW_KEY_PATH}`, urlList: unique.slice(i, i + INDEXNOW_MAX_URLS) });
  }
  return payloads;
}
