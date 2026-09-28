"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* datetime-local <-> ISO                                               */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO string → value for <input type="datetime-local"> in the browser's timezone. */
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) → ISO string. */
export function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/* ------------------------------------------------------------------ */
/* sessionStorage-backed flag                                           */
/* ------------------------------------------------------------------ */

const FLAG_EVENT = "ll:session-flag";

function subscribeFlags(callback: () => void) {
  window.addEventListener(FLAG_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(FLAG_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** A boolean remembered for the browser session (false on the server). */
export function useSessionFlag(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeFlags,
    () => readFlag(key),
    () => false,
  );
  const set = (next: boolean) => {
    try {
      if (next) window.sessionStorage.setItem(key, "1");
      else window.sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable (private mode) — the flag simply isn't remembered.
    }
    window.dispatchEvent(new Event(FLAG_EVENT));
  };
  return [value, set];
}

/* ------------------------------------------------------------------ */
/* Unsaved-changes guard                                                */
/* ------------------------------------------------------------------ */

/**
 * While `active`, asks before leaving: the native prompt for reloads/closing
 * the tab, and a confirm dialog (driven by the returned state) for in-app
 * link clicks.
 */
export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const allowRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (allowRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);

  return {
    pendingHref,
    cancel: () => setPendingHref(null),
    confirm: () => {
      const href = pendingHref;
      setPendingHref(null);
      if (!href) return;
      allowRef.current = true;
      router.push(href);
    },
    /** Navigate programmatically without the prompt (e.g. after deleting). */
    bypass: (href: string) => {
      allowRef.current = true;
      router.push(href);
    },
  };
}
