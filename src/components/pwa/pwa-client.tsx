"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useToast } from "@/components/ui/toast";
import { PwaIcon } from "./icons";
import { InstallPrompt } from "./install-prompt";
import { getOnline, subscribeOnline } from "./install-store";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SW_URL = "/sw.js";
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const MIN_CHECK_GAP_MS = 10 * 60 * 1000;

/** Unregister our worker and delete its caches (feature turned off, or a development build). */
async function teardown(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    let removed = false;
    for (const reg of registrations) {
      const worker = reg.active ?? reg.waiting ?? reg.installing;
      if (worker && new URL(worker.scriptURL).pathname === SW_URL) {
        await reg.unregister();
        removed = true;
      }
    }
    if (removed && "caches" in window) {
      for (const key of await caches.keys()) if (key.startsWith("ll-")) await caches.delete(key);
    }
  } catch {
    /* private mode or blocked storage: nothing to clean up */
  }
}

export interface PwaClientProps {
  enabled: boolean;
  installPrompt: boolean;
  offlinePage: boolean;
  authenticated: boolean;
  appName: string;
  /** Changes when anything shown on the offline page changes (brand, settings). */
  shellKey: string;
}

/**
 * Registers the service worker (production builds, when enabled), offers
 * updates with a "Reload" toast (the waiting worker only takes over after
 * the member confirms), keeps the worker's config in sync, and renders the
 * install card and an offline indicator.
 */
export function PwaClient({ enabled, installPrompt, offlinePage, authenticated, appName, shellKey }: PwaClientProps) {
  const toast = useToast();
  const toastRef = useRef(toast);
  const reloadRequested = useRef(false);
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Registration, updates and teardown.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!enabled || !IS_PRODUCTION) {
      void teardown();
      return;
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();
    const offered = new WeakSet<ServiceWorker>();

    /**
     * The toast's "Reload". Decides from the registration's state at click
     * time, not from the worker the toast was offered for: another tab may
     * already have activated that worker (its `controllerchange` does not
     * reload this tab), or a newer build may have replaced it meanwhile.
     */
    const applyUpdate = (offeredWorker: ServiceWorker) => {
      const waiting = cancelled ? null : (registration?.waiting ?? (offeredWorker.state === "installed" ? offeredWorker : null));
      if (waiting) {
        // Reloads on `controllerchange`, once the new worker has taken over.
        reloadRequested.current = true;
        waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }
      // Nothing left to activate: the new worker already controls this tab
      // (or is taking over), but the page still runs the previous build.
      window.location.reload();
    };

    const offerUpdate = (worker: ServiceWorker) => {
      // No controller means this is the first install, not an update.
      if (cancelled || offered.has(worker) || !navigator.serviceWorker.controller) return;
      offered.add(worker);
      toastRef.current.toast({
        title: "A new version is available",
        description: "Reload to get the latest improvements.",
        tone: "info",
        duration: 0,
        action: { label: "Reload", onClick: () => applyUpdate(worker) },
      });
    };

    const track = (worker: ServiceWorker) => {
      if (worker.state === "installed") offerUpdate(worker);
      else worker.addEventListener("statechange", () => worker.state === "installed" && offerUpdate(worker));
    };

    const onUpdateFound = () => {
      if (registration?.installing) track(registration.installing);
    };

    const onControllerChange = () => {
      if (!reloadRequested.current) return;
      reloadRequested.current = false;
      window.location.reload();
    };

    const checkForUpdate = () => {
      if (!registration || document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => undefined);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", checkForUpdate);
    const interval = window.setInterval(() => {
      lastCheck = 0;
      checkForUpdate();
    }, UPDATE_CHECK_MS);

    navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        if (reg.waiting) offerUpdate(reg.waiting);
        if (reg.installing) track(reg.installing);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch((err: unknown) => {
        console.warn("[pwa] Service worker registration failed:", err instanceof Error ? err.message : err);
      });

    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.clearInterval(interval);
    };
  }, [enabled]);

  // Keep the worker's settings in sync (offline page on/off, signed-in hint, shell version).
  useEffect(() => {
    if (!enabled || !IS_PRODUCTION || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const send = () => {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (!cancelled) reg.active?.postMessage({ type: "CONFIG", offlinePage, authenticated, shellKey });
        })
        .catch(() => undefined);
    };
    send();
    navigator.serviceWorker.addEventListener("controllerchange", send);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", send);
    };
  }, [enabled, offlinePage, authenticated, shellKey]);

  if (!enabled) return null;

  return (
    <>
      {installPrompt && <InstallPrompt appName={appName} />}
      {!online && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-2 z-[90] flex justify-center px-3 print:hidden"
        >
          <p className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface-1/95 px-3.5 py-1.5 text-xs font-medium text-ink shadow-pop backdrop-blur animate-fade-in">
            <PwaIcon.WifiOff className="size-4 shrink-0 text-warning" />
            <span className="truncate">You&apos;re offline. Some pages and actions won&apos;t work until you reconnect.</span>
          </p>
        </div>
      )}
    </>
  );
}
