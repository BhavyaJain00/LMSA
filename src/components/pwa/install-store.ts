/**
 * Browser-side stores for the install experience, readable with
 * `useSyncExternalStore`:
 *  - the deferred `beforeinstallprompt` event (captured at module load, so it
 *    is not lost when the browser fires it before React hydrates),
 *  - whether the app runs installed (standalone display mode),
 *  - whether the member dismissed the install card recently (14 days),
 *  - online / offline state.
 *
 * The capture only calls preventDefault() when the server rendered
 * <meta name="ll-pwa-install" content="prompt"> (install prompt enabled in
 * settings); otherwise the browser keeps its own install UI.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "ll-pwa-install-dismissed-until";
const INSTALLED_KEY = "ll-pwa-installed";
export const DISMISS_DAYS = 14;
const DISMISS_EVENT = "ll-pwa-install-dismiss";

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<Listener>();

function emitInstall() {
  for (const l of installListeners) l();
}

function promptEnabledByServer(): boolean {
  return typeof document !== "undefined" && document.querySelector('meta[name="ll-pwa-install"][content="prompt"]') !== null;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!promptEnabledByServer()) return;
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitInstall();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    safeStorage()?.setItem(INSTALLED_KEY, new Date().toISOString());
    emitInstall();
  });
}

/* ------------------------------- install event ------------------------------- */

export function subscribeInstallPrompt(listener: Listener): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function getServerInstallPrompt(): BeforeInstallPromptEvent | null {
  return null;
}

/** Show the native install dialog. The event can only be used once. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  emitInstall();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

/* ------------------------------- standalone mode ------------------------------ */

export function subscribeStandalone(listener: Listener): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

export function getStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (window.matchMedia?.("(display-mode: standalone)").matches ?? false) || nav.standalone === true;
}

/* ------------------------------- dismissal ------------------------------------ */

export function subscribeDismissed(listener: Listener): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISMISS_KEY || e.key === INSTALLED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DISMISS_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DISMISS_EVENT, listener);
  };
}

/** True while the card was dismissed less than 14 days ago (or the app was installed from here). */
export function getDismissed(): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  if (storage.getItem(INSTALLED_KEY)) return true;
  const until = Number(storage.getItem(DISMISS_KEY));
  return Number.isFinite(until) && until > Date.now();
}

export function dismissInstallCard(days = DISMISS_DAYS): void {
  safeStorage()?.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

/* ------------------------------- platform ------------------------------------- */

/** iPhone / iPad Safari, where installing means Share → Add to Home Screen. */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  const ios = /iPad|iPhone|iPod/.test(ua) || iPadOs;
  if (!ios || !/WebKit/i.test(ua)) return false;
  // In-app browsers and other iOS browsers can't (reliably) add to the home screen.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\/|Snapchat|DuckDuckGo|YaBrowser|Twitter/i.test(ua);
}

export function isIpad(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/* ------------------------------- online state --------------------------------- */

export function subscribeOnline(listener: Listener): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function getOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
