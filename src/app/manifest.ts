import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/db/store";
import { shortAppName } from "@/components/pwa/pwa-provider";

/**
 * Web app manifest (served at /manifest.webmanifest). With Settings →
 * Installable app turned off the manifest stays valid but uses
 * `display: "browser"`, so browsers no longer offer installation.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  const { brand, features, pwa } = settings;
  const name = brand.name.trim() || "LearnLoop";
  const dir = settings.textDirection === "auto" ? "auto" : settings.textDirection;

  const shortcuts: NonNullable<MetadataRoute.Manifest["shortcuts"]> = [
    { name: "Dashboard", short_name: "Dashboard", url: "/dashboard", description: "Your courses, classes and progress" },
  ];
  if (features.courses) shortcuts.push({ name: "Courses", short_name: "Courses", url: "/courses", description: "Browse the course catalog" });
  if (features.batches) shortcuts.push({ name: "Batches", short_name: "Batches", url: "/batches", description: "Your cohorts and live classes" });
  if (features.notifications) shortcuts.push({ name: "Notifications", short_name: "Inbox", url: "/notifications" });

  return {
    id: "/",
    name,
    short_name: shortAppName(name),
    description: brand.metaDescription || brand.tagline,
    lang: "en",
    dir,
    start_url: "/",
    scope: "/",
    display: pwa.enabled ? "standalone" : "browser",
    display_override: pwa.enabled ? ["standalone", "minimal-ui"] : undefined,
    orientation: "any",
    background_color: "#f7f7f8",
    theme_color: brand.accentColor,
    categories: ["education", "productivity"],
    prefer_related_applications: false,
    icons: [
      ...(brand.faviconUrl ? [{ src: brand.faviconUrl, sizes: "any", purpose: "any" as const }] : []),
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/images/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/images/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/images/icon-maskable.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: pwa.enabled ? shortcuts.slice(0, 4) : undefined,
  };
}
