import "server-only";
import { createHash } from "node:crypto";
import type { Settings } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { PwaClient } from "./pwa-client";

const RASTER_ICON_RE = /\.(png|jpe?g|webp)(\?.*)?$/i;

/** Short name for home-screen labels (iOS truncates around 12 characters). */
export function shortAppName(name: string): string {
  const trimmed = name.trim() || "LearnLoop";
  if (trimmed.length <= 12) return trimmed;
  const firstWord = trimmed.split(/\s+/)[0] ?? trimmed;
  return firstWord.length <= 12 ? firstWord : trimmed.slice(0, 12);
}

/**
 * Installable-app integration, mounted once in the root layout.
 *
 * Server part: emits the PWA head tags (hoisted into <head> by React) and,
 * for signed-out visitors only, the `ll-pwa` cacheable marker that tells the
 * service worker a page may be kept for offline reading. Member pages never
 * carry it, so their HTML is never cached.
 *
 * Client part (`PwaClient`): service worker registration and updates, the
 * install card and the offline indicator. When the feature is turned off it
 * still renders, to unregister a previously installed worker.
 */
export async function PwaProvider({ pwa }: { pwa: Settings["pwa"] }) {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const brand = settings.brand;
  const appName = brand.name.trim() || "LearnLoop";
  const touchIcon = [brand.logoUrl, brand.faviconUrl].find((u): u is string => !!u && RASTER_ICON_RE.test(u)) ?? "/images/icon-192.svg";
  const shellKey = createHash("sha256")
    .update(JSON.stringify([appName, brand.tagline, brand.logoUrl ?? "", brand.accentColor, pwa.offlinePage, settings.updatedAt]))
    .digest("base64url")
    .slice(0, 16);

  return (
    <>
      {pwa.enabled && (
        <>
          <meta name="theme-color" content={brand.accentColor} />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content={shortAppName(appName)} />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <link rel="apple-touch-icon" href={touchIcon} />
          {!user && <meta name="ll-pwa" content="cacheable" />}
          {pwa.installPrompt && <meta name="ll-pwa-install" content="prompt" />}
        </>
      )}
      <PwaClient
        enabled={pwa.enabled}
        installPrompt={pwa.installPrompt}
        offlinePage={pwa.offlinePage}
        authenticated={!!user}
        appName={appName}
        shellKey={shellKey}
      />
    </>
  );
}
