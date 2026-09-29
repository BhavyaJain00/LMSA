/*
 * LearnLoop service worker.
 *
 * Registered from src/components/pwa/pwa-client.tsx in production builds when
 * Settings → Installable app is enabled. Bump VERSION whenever this file
 * changes: the page then shows "A new version is available — Reload" and the
 * new worker only takes over (skipWaiting) after the member confirms.
 *
 * Strategies
 *  - Navigations: network-first (navigation preload when available). After
 *    4 s, or when the network fails, fall back to a cached copy of the page,
 *    then to the precached /offline page.
 *  - /_next/static/*: cache-first (content-hashed, immutable).
 *  - Same-origin images: stale-while-revalidate, LRU-trimmed to ~60 entries.
 *  - Never cached: /api/*, non-GET requests (Server Actions), RSC payloads,
 *    range requests, /uploads/videos/* and other media, `no-store` images,
 *    and any HTML rendered for a signed-in member. Page HTML is only stored
 *    when the server marked it as rendered for a signed-out visitor
 *    (<meta name="ll-pwa" content="cacheable">), and never for account,
 *    admin or auth routes. The offline page is fetched without cookies.
 */

const VERSION = "1.0.1";
const PREFIX = "ll-";
const CACHES = {
  shell: `${PREFIX}shell-${VERSION}`,
  static: `${PREFIX}static-${VERSION}`,
  images: `${PREFIX}images-${VERSION}`,
  pages: `${PREFIX}pages-${VERSION}`,
  meta: `${PREFIX}meta`,
};

const OFFLINE_URL = "/offline";
const SHELL_ICONS = ["/icon.svg", "/images/icon-192.svg", "/images/icon-512.svg", "/images/icon-maskable.svg"];
const NAVIGATION_TIMEOUT_MS = 4000;
const MAX_PAGES = 25;
const MAX_IMAGES = 60;
const MAX_STATIC = 250;
const SHELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONFIG_KEY = "/__ll-sw/config";

const CACHEABLE_MARKER = /<meta\s+name="ll-pwa"\s+content="cacheable"/i;

/** Pages that are personal, transactional or useless offline. */
const NEVER_CACHE_PAGES = [
  /^\/api(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/settings(\/|$)/,
  /^\/dashboard(\/|$)/,
  /^\/billing(\/|$)/,
  /^\/notifications(\/|$)/,
  /^\/persona(\/|$)/,
  /^\/you(\/|$)/,
  /^\/messages(\/|$)/,
  /^\/quiz(\/|$)/,
  /^\/offline(\/|$)/,
  /^\/uploads(\/|$)/,
  /^\/(login|logout|signup|register|forgot-password|reset-password|verify-email|two-factor|2fa|unsubscribe)(\/|$)/,
];
const SENSITIVE_PARAMS = ["token", "code", "secret", "signature", "sig", "key", "exp", "session_id", "payment_id", "order_id"];

/* ------------------------------------------------------------------ */
/* Config (sent by the page, persisted in Cache Storage)               */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG = { offlinePage: true, authenticated: false, shellKey: "", shellAt: 0 };
let configPromise = null;

function loadConfig() {
  if (!configPromise) {
    configPromise = caches
      .open(CACHES.meta)
      .then((cache) => cache.match(CONFIG_KEY))
      .then((res) => (res ? res.json() : null))
      .then((stored) => ({ ...DEFAULT_CONFIG, ...(stored && typeof stored === "object" ? stored : {}) }))
      .catch(() => ({ ...DEFAULT_CONFIG }));
  }
  return configPromise;
}

async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  configPromise = Promise.resolve(next);
  try {
    const cache = await caches.open(CACHES.meta);
    await cache.put(CONFIG_KEY, new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } }));
  } catch {
    /* storage full or unavailable: the in-memory config still applies */
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Shell precache: /offline, the assets it needs, and the app icons    */
/* ------------------------------------------------------------------ */

function sameOriginPath(raw, base) {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"), base || self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** Static assets referenced by an HTML document (scripts, styles, fonts, images). */
function collectHtmlAssets(html) {
  const found = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\)<>]+/g)) {
    const path = sameOriginPath(m[0]);
    if (path) found.add(path);
  }
  // Chunk paths inside the inline RSC payload are written without the /_next prefix.
  for (const m of html.matchAll(/(^|[^\w/])(static\/(?:chunks|css|media)\/[^"'\s\\)<>]+)/g)) {
    const path = sameOriginPath(`/_next/${m[2]}`);
    if (path) found.add(path);
  }
  for (const m of html.matchAll(/(?:src|href)="(\/(?:images|uploads)\/[^"?#]+\.(?:png|jpe?g|gif|webp|svg|avif|ico))"/gi)) {
    if (m[1].startsWith("/uploads/videos/")) continue;
    found.add(m[1]);
  }
  return found;
}

/** Fonts and images referenced by a stylesheet. */
function collectCssAssets(css, cssPath) {
  const found = new Set();
  const base = new URL(cssPath, self.location.origin).toString();
  for (const m of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    if (m[1].startsWith("data:")) continue;
    const path = sameOriginPath(m[1], base);
    if (path && path.startsWith("/_next/static/")) found.add(path);
  }
  return found;
}

async function cacheFetch(cache, path, init) {
  const res = await fetch(new Request(path, { credentials: "same-origin", ...init }));
  if (!res.ok || res.type !== "basic") throw new Error(`${path} → ${res.status}`);
  await cache.put(path, res.clone());
  return res;
}

let shellRefresh = null;

/**
 * (Re)build the offline shell. The page is fetched WITHOUT cookies so it is
 * the anonymous render (no personal data, no flash messages). Entries that
 * the new page no longer references are pruned.
 */
function refreshShell(shellKey) {
  if (shellRefresh) return shellRefresh;
  shellRefresh = (async () => {
    const cache = await caches.open(CACHES.shell);
    const keep = new Set([OFFLINE_URL, ...SHELL_ICONS]);
    await Promise.all(SHELL_ICONS.map((icon) => cacheFetch(cache, icon).catch(() => undefined)));

    const res = await fetch(new Request(OFFLINE_URL, { credentials: "omit", cache: "no-store" }));
    if (!res.ok || res.type !== "basic") throw new Error(`offline page → ${res.status}`);
    const html = await res.clone().text();
    const assets = collectHtmlAssets(html);
    const stylesheets = [];
    await Promise.all(
      [...assets].map(async (path) => {
        keep.add(path);
        try {
          const assetRes = await cacheFetch(cache, path);
          if (path.split("?")[0].endsWith(".css")) stylesheets.push({ path, css: await assetRes.text() });
        } catch {
          /* optional asset: the page still renders without it */
        }
      }),
    );
    const cssAssets = new Set();
    for (const { path, css } of stylesheets) for (const a of collectCssAssets(css, path)) if (!keep.has(a)) cssAssets.add(a);
    await Promise.all(
      [...cssAssets].map((path) => {
        keep.add(path);
        return cacheFetch(cache, path).catch(() => undefined);
      }),
    );
    await cache.put(OFFLINE_URL, res);

    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (!keep.has(url.pathname + url.search)) await cache.delete(request);
    }
    await saveConfig({ shellAt: Date.now(), ...(typeof shellKey === "string" ? { shellKey } : {}) });
  })().finally(() => {
    shellRefresh = null;
  });
  return shellRefresh;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

self.addEventListener("install", (event) => {
  // A failed shell download must not block installation: it is retried when the page sends its config.
  event.waitUntil(refreshShell().catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = new Set(Object.values(CACHES));
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !current.has(name)) await caches.delete(name);
      }
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* not supported */
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const reply = (payload) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
  };

  switch (data.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    case "CONFIG": {
      const patch = {
        offlinePage: data.offlinePage !== false,
        authenticated: data.authenticated === true,
      };
      const shellKey = typeof data.shellKey === "string" ? data.shellKey.slice(0, 200) : undefined;
      event.waitUntil(
        (async () => {
          const config = await saveConfig(patch);
          const stale = shellKey !== undefined && shellKey !== config.shellKey;
          const old = Date.now() - (config.shellAt || 0) > SHELL_MAX_AGE_MS;
          if (stale || old) await refreshShell(shellKey).catch(() => undefined);
        })(),
      );
      break;
    }
    case "GET_STATUS":
      event.waitUntil(
        (async () => {
          const config = await loadConfig();
          const counts = {};
          for (const [key, name] of Object.entries(CACHES)) {
            if (key === "meta") continue;
            try {
              counts[key] = (await (await caches.open(name)).keys()).length;
            } catch {
              counts[key] = 0;
            }
          }
          reply({ version: VERSION, offlinePage: config.offlinePage, shellAt: config.shellAt || 0, counts });
        })(),
      );
      break;
    case "CLEAR_CACHES":
      event.waitUntil(
        (async () => {
          for (const name of [CACHES.pages, CACHES.images, CACHES.static]) await caches.delete(name);
          await refreshShell().catch(() => undefined);
          reply({ ok: true });
        })(),
      );
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ */
/* Fetch routing                                                       */
/* ------------------------------------------------------------------ */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // Server Actions, uploads, forms
  if (request.headers.has("range")) return; // media seeking
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/uploads/videos/") || url.pathname.startsWith("/videos/")) return;
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return; // React Server Component payloads

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, request));
    return;
  }
  if (request.destination === "image") {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

/* ------------------------------------------------------------------ */
/* Navigations                                                         */
/* ------------------------------------------------------------------ */

function isCacheablePage(url) {
  if (NEVER_CACHE_PAGES.some((re) => re.test(url.pathname))) return false;
  for (const key of url.searchParams.keys()) if (SENSITIVE_PARAMS.includes(key.toLowerCase())) return false;
  return true;
}

function pageKey(url) {
  return url.origin + url.pathname + url.search;
}

async function cachedPage(url) {
  if (!isCacheablePage(url)) return null;
  try {
    const cache = await caches.open(CACHES.pages);
    return (await cache.match(pageKey(url), { ignoreVary: true })) || null;
  } catch {
    return null;
  }
}

async function offlineFallback(url) {
  const page = await cachedPage(url);
  if (page) return page;
  const config = await loadConfig();
  if (!config.offlinePage) return null;
  try {
    const cache = await caches.open(CACHES.shell);
    return (await cache.match(OFFLINE_URL)) || null;
  } catch {
    return null;
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const HEAD_LIMIT = 256 * 1024;

/**
 * Read an HTML response up to the end of <head>, then either stop (member
 * pages are never stored, so there is no need to buffer them) or continue to
 * the end when the whole document is needed.
 */
async function readHtml(response, wantBody) {
  if (!response.body) return { head: "", html: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let headEnd = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (headEnd === -1) {
      headEnd = text.indexOf("</head>");
      if (headEnd === -1 && text.length > HEAD_LIMIT) headEnd = HEAD_LIMIT;
      if (headEnd !== -1 && !wantBody(text.slice(0, headEnd))) {
        // Not awaited: cancelling one branch of a cloned (tee'd) body only
        // settles once the page has finished reading its own branch.
        reader.cancel().catch(() => undefined);
        return { head: text.slice(0, headEnd), html: null };
      }
    }
  }
  text += decoder.decode();
  if (headEnd === -1) headEnd = Math.min(text.length, HEAD_LIMIT);
  const head = text.slice(0, headEnd);
  return { head, html: wantBody(head) ? text : null };
}

/**
 * Navigation responses that rememberPage reads: complete same-origin HTML
 * pages. Only these are cloned. A clone tees the body, so an unread copy of
 * anything else (a PDF, ZIP or CSV opened in a tab) would be buffered in the
 * worker for as long as the download runs.
 */
function isHtmlPage(res) {
  return (
    !!res &&
    res.status === 200 &&
    res.type === "basic" &&
    !res.redirected &&
    /text\/html/i.test(res.headers.get("content-type") || "")
  );
}

/**
 * Store a navigation response for offline use — only when the HTML carries
 * the signed-out marker and the route is safe to keep. Also keeps the
 * "is a member signed in" hint fresh for the slow-network path.
 */
async function rememberPage(url, copy) {
  if (!isHtmlPage(copy)) return;
  const cacheable = isCacheablePage(url);
  const { head, html } = await readHtml(copy, (h) => cacheable && CACHEABLE_MARKER.test(h));
  const anonymous = CACHEABLE_MARKER.test(head);
  const config = await loadConfig();
  if (config.authenticated === anonymous) await saveConfig({ authenticated: !anonymous });
  if (!anonymous || !cacheable || html === null) return;

  const title = decodeEntities(((head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim());
  const headers = new Headers(copy.headers);
  headers.delete("vary");
  headers.delete("set-cookie");
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("x-ll-cached-at", new Date().toISOString());
  if (title) headers.set("x-ll-title", encodeURIComponent(title.slice(0, 200)));
  const cache = await caches.open(CACHES.pages);
  await cache.delete(pageKey(url), { ignoreVary: true });
  await cache.put(pageKey(url), new Response(html, { status: 200, statusText: "OK", headers }));
  await trimCache(CACHES.pages, MAX_PAGES);
}

const TIMEOUT = Symbol("timeout");

async function handleNavigation(event, url) {
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(event.request));
    // Clone before the browser starts reading the body, and only what
    // rememberPage will read (see isHtmlPage).
    return { res, copy: isHtmlPage(res) ? res.clone() : null };
  })();
  event.waitUntil(
    network.then(({ copy }) => rememberPage(url, copy)).catch(() => undefined),
  );

  try {
    let timer;
    const first = await Promise.race([
      network,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), NAVIGATION_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    if (first === TIMEOUT) {
      const config = await loadConfig();
      // A slow server is not an outage: only serve a cached copy to signed-out
      // visitors (never an anonymous page to a member), or the offline page
      // when the device reports it has no connection at all.
      if (!self.navigator.onLine) {
        const fallback = await offlineFallback(url);
        if (fallback) return fallback;
      } else if (!config.authenticated) {
        const page = await cachedPage(url);
        if (page) return page;
      }
      return (await network).res;
    }

    const { res } = first;
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      const page = await cachedPage(url);
      if (page) return page;
    }
    return res;
  } catch {
    const fallback = await offlineFallback(url);
    return fallback || Response.error();
  }
}

/* ------------------------------------------------------------------ */
/* Static assets & images                                              */
/* ------------------------------------------------------------------ */

async function putAndTrim(name, request, response, max) {
  try {
    const cache = await caches.open(name);
    await cache.put(request, response);
    await trimCache(name, max);
  } catch {
    /* quota exceeded: serving from the network still works */
  }
}

async function cacheFirst(event, request) {
  const cached = (await caches.match(request, { cacheName: CACHES.static })) || (await caches.match(request, { cacheName: CACHES.shell }));
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") event.waitUntil(putAndTrim(CACHES.static, request, res.clone(), MAX_STATIC));
  return res;
}

function storable(res) {
  if (!res || !res.ok || res.type !== "basic") return false;
  return !/no-store/i.test(res.headers.get("cache-control") || "");
}

async function staleWhileRevalidate(event, request) {
  const cached = (await caches.match(request, { cacheName: CACHES.images })) || (await caches.match(request, { cacheName: CACHES.shell }));
  const refresh = fetch(request).then((res) => {
    if (storable(res)) {
      // Re-putting moves the entry to the end of the list, so trimming drops the least recently used.
      event.waitUntil(putAndTrim(CACHES.images, request, res.clone(), MAX_IMAGES));
    }
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}
