import "server-only";
import { getSettings, mutate } from "@/lib/db/store";
import { INDEXNOW_ENDPOINT, type IndexNowResult, buildIndexNowPayloads, generateIndexNowKey, isPingableOrigin, isValidIndexNowKey } from "./indexnow";
import { absoluteUrl, siteOrigin } from "./site";

/**
 * IndexNow client: tells Bing, Yandex, Seznam, Naver and the other
 * participating search engines (they share submissions through
 * api.indexnow.org) that pages were published, updated or removed.
 *
 * Never throws. Skipped when the site is set to noindex or runs on a local
 * address. A key is generated and saved the first time something is
 * submitted. The same URL is not resubmitted within 10 minutes.
 */

const RESUBMIT_AFTER_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

interface IndexNowState {
  recent: Map<string, number>;
  last: IndexNowResult | null;
}

const g = globalThis as unknown as { __llIndexNow?: IndexNowState };
const state: IndexNowState = (g.__llIndexNow ??= { recent: new Map(), last: null });

/** Result of the latest submission in this server process (shown in SEO settings). */
export function lastIndexNowResult(): IndexNowResult | null {
  return state.last;
}

/** The configured key, generating and saving one when missing or invalid. */
export async function ensureIndexNowKey(): Promise<string> {
  const settings = await getSettings();
  if (isValidIndexNowKey(settings.seo.indexNowKey)) return settings.seo.indexNowKey;
  return mutate((db) => {
    if (isValidIndexNowKey(db.settings.seo.indexNowKey)) return db.settings.seo.indexNowKey;
    const key = generateIndexNowKey();
    db.settings.seo.indexNowKey = key;
    db.settings.updatedAt = new Date().toISOString();
    return key;
  });
}

function finish(result: Omit<IndexNowResult, "at">): IndexNowResult {
  const full = { ...result, at: new Date().toISOString() };
  state.last = full;
  return full;
}

/**
 * Submit site paths or absolute URLs. `force` resubmits URLs sent in the last
 * few minutes (used by the "Submit all pages" button).
 */
export async function submitToIndexNow(pathsOrUrls: readonly string[], opts: { force?: boolean } = {}): Promise<IndexNowResult> {
  try {
    const settings = await getSettings();
    if (settings.seo.noindexSite) return finish({ ok: true, submitted: 0, skipped: "noindex" });
    const origin = siteOrigin();
    if (!isPingableOrigin(origin)) return finish({ ok: true, submitted: 0, skipped: "local" });

    const now = Date.now();
    for (const [url, at] of state.recent) if (now - at > RESUBMIT_AFTER_MS) state.recent.delete(url);
    const urls = pathsOrUrls
      .map((p) => absoluteUrl(p, origin))
      .filter((u): u is string => !!u)
      .filter((u) => opts.force || !state.recent.has(u));
    if (!urls.length) return finish({ ok: true, submitted: 0, skipped: "nothing-new" });

    const key = await ensureIndexNowKey();
    let submitted = 0;
    let lastStatus: number | undefined;
    for (const payload of buildIndexNowPayloads(origin, key, urls)) {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = res.status;
      if (res.status !== 200 && res.status !== 202) {
        return finish({ ok: false, submitted, status: res.status, error: `Search engines answered HTTP ${res.status}.` });
      }
      submitted += payload.urlList.length;
      for (const u of payload.urlList) state.recent.set(u, now);
    }
    return finish({ ok: true, submitted, status: lastStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[indexnow] submission failed:", message);
    return finish({ ok: false, submitted: 0, error: message });
  }
}
