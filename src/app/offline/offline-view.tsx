"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { PwaIcon } from "@/components/pwa/icons";
import { getOnline, subscribeOnline } from "@/components/pwa/install-store";
import { relativeTime } from "@/lib/utils";

interface RecentPage {
  path: string;
  title: string;
  savedLabel: string;
  savedAt: number;
}

type RecentState = { status: "loading" } | { status: "unsupported" } | { status: "ready"; pages: RecentPage[] };

const MAX_RECENT = 12;
const PROBE_MS = 20_000;

const noopSubscribe = () => () => {};
const currentPath = () => window.location.pathname + window.location.search;

/** Title stored by the service worker, minus the " · Brand" suffix. */
function cleanTitle(raw: string | null, path: string, brandName: string): string {
  let title = "";
  try {
    title = raw ? decodeURIComponent(raw) : "";
  } catch {
    title = "";
  }
  const suffix = ` · ${brandName}`;
  if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
  if (title) return title;
  return path === "/" ? "Home" : decodeURIComponent(path.split("?")[0]!.split("/").filter(Boolean).pop() ?? path).replace(/[-_]+/g, " ");
}

async function readRecentPages(brandName: string, exclude: string): Promise<RecentState> {
  if (typeof caches === "undefined") return { status: "unsupported" };
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith("ll-pages-"));
    const pages = new Map<string, RecentPage>();
    const now = new Date();
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin !== window.location.origin) continue;
        const path = url.pathname + url.search;
        if (path === exclude || url.pathname === "/offline") continue;
        const res = await cache.match(request, { ignoreVary: true });
        if (!res) continue;
        const savedIso = res.headers.get("x-ll-cached-at") ?? "";
        const savedAt = Date.parse(savedIso) || 0;
        const previous = pages.get(path);
        if (previous && previous.savedAt >= savedAt) continue;
        pages.set(path, {
          path,
          title: cleanTitle(res.headers.get("x-ll-title"), path, brandName),
          savedAt,
          savedLabel: savedAt ? relativeTime(savedIso, now) : "",
        });
      }
    }
    return {
      status: "ready",
      pages: Array.from(pages.values())
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, MAX_RECENT),
    };
  } catch {
    return { status: "unsupported" };
  }
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{children}</p>
      </div>
    </li>
  );
}

/**
 * Offline screen. When the service worker serves it in place of another page
 * the address bar still shows that page, so "Try again" simply reloads it,
 * and it reloads by itself once the connection (or the server) is back.
 */
export function OfflineView({ brandName, tagline, logoUrl }: { brandName: string; tagline?: string; logoUrl?: string }) {
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => false);
  const path = useSyncExternalStore(noopSubscribe, currentPath, () => "/offline");
  const [recent, setRecent] = useState<RecentState>({ status: "loading" });
  const [retrying, setRetrying] = useState(false);
  const isFallback = !path.startsWith("/offline");

  useEffect(() => {
    let cancelled = false;
    void readRecentPages(brandName, path).then((state) => {
      if (!cancelled) setRecent(state);
    });
    return () => {
      cancelled = true;
    };
  }, [brandName, path]);

  // Reload the page the member wanted as soon as the connection is back.
  useEffect(() => {
    if (!isFallback) return;
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    // The device may be online while the server is unreachable: probe quietly.
    const probe = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      fetch(window.location.href, { method: "HEAD", cache: "no-store", credentials: "same-origin" })
        .then((res) => {
          if (res.ok || res.status < 500) window.location.reload();
        })
        .catch(() => undefined);
    }, PROBE_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(probe);
    };
  }, [isFallback]);

  // Full document loads on purpose: they go through the service worker, which can
  // answer from the device, while client-side navigation needs the server.
  const retry = () => {
    setRetrying(true);
    if (isFallback) window.location.reload();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
    else window.location.assign("/");
  };

  const heading = online ? (isFallback ? "This page couldn't load" : "You're back online") : "You're offline";
  const message = online
    ? isFallback
      ? `${brandName} isn't reachable right now. We'll keep trying and reload this page when it's back.`
      : "Your connection is working. Pick up where you left off."
    : "Check your Wi-Fi or mobile data. This page reloads by itself as soon as you're connected again.";

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-1/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full load via the service worker (works offline) */}
          <a href="/" className="flex min-w-0 items-center gap-2.5 font-semibold text-ink">
            {logoUrl ? (
              // A plain <img>: the optimizer route isn't available offline.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg">
                <Icon.GraduationCap className="size-4.5" />
              </span>
            )}
            <span className="truncate">{brandName}</span>
          </a>
          <Badge tone={online ? "success" : "warning"} dot>
            {online ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
        <section className="text-center" aria-live="polite">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
            {online ? <Icon.Wifi className="size-8 text-success" /> : <PwaIcon.WifiOff className="size-8 text-warning" />}
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">{heading}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{message}</p>
          {isFallback && (
            <p className="mx-auto mt-2 max-w-md truncate font-mono text-xs text-ink-faint" title={path}>
              {path}
            </p>
          )}
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button onClick={retry} loading={retrying} leftIcon={<Icon.Refresh className="size-4" />} className="w-full sm:w-auto">
              {isFallback || !online ? "Try again" : "Continue"}
            </Button>
            {isFallback && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages -- full load via the service worker (works offline)
              <a href="/" className={buttonClasses({ variant: "outline", className: "w-full sm:w-auto" })}>
                <Icon.Home className="size-4" />
                Go to home
              </a>
            )}
          </div>
        </section>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="offline-works" className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 id="offline-works" className="text-base font-semibold text-ink">
              What works offline
            </h2>
            <ul className="mt-4 space-y-4">
              <Feature icon={<Icon.Clock />} title="Pages you opened recently">
                Public pages you visited on this device, like the course catalog, open without a connection.
              </Feature>
              <Feature icon={<Icon.ShieldCheck />} title="Your progress is safe">
                Completed lessons, quiz results and submissions are stored on our servers. New actions need a connection to go through.
              </Feature>
              <Feature icon={<Icon.Download />} title="Your downloads">
                Certificates, calendar files and resources you downloaded stay in your device&apos;s files.
              </Feature>
              <Feature icon={<Icon.Refresh />} title="Automatic retry">
                Keep this tab open: it reloads by itself when you&apos;re back online.
              </Feature>
            </ul>
          </section>

          <section aria-labelledby="offline-recent" className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 id="offline-recent" className="text-base font-semibold text-ink">
              Available on this device
            </h2>
            {recent.status === "loading" && (
              <ul className="mt-4 space-y-3" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="space-y-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </li>
                ))}
              </ul>
            )}
            {recent.status === "unsupported" && (
              <p className="mt-3 text-sm text-ink-muted">This browser doesn&apos;t keep pages for offline reading.</p>
            )}
            {recent.status === "ready" &&
              (recent.pages.length ? (
                <ul className="mt-3 divide-y divide-border">
                  {recent.pages.map((page) => (
                    <li key={page.path}>
                      <a href={page.path} className="group flex items-center gap-3 py-2.5">
                        <Icon.FileText className="size-4 shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink group-hover:text-accent">{page.title}</span>
                          <span className="block truncate text-xs text-ink-muted">
                            {page.path}
                            {page.savedLabel && ` · saved ${page.savedLabel}`}
                          </span>
                        </span>
                        <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center">
                  <Icon.Inbox className="mx-auto size-6 text-ink-faint" />
                  <p className="mt-2 text-sm font-medium text-ink">No saved pages yet</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Public pages you browse while signed out are saved here automatically. Pages from your account are never stored on the device.
                  </p>
                </div>
              ))}
          </section>
        </div>
      </div>

      <footer className="border-t border-border py-4 text-center text-xs text-ink-faint">
        {brandName}
        {tagline ? ` · ${tagline}` : ""}
      </footer>
    </main>
  );
}
