import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/db/store";

/** Web app manifest so the LMS can be installed as a PWA on phones and desktops. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  return {
    name: settings.brand.name,
    short_name: settings.brand.name,
    description: settings.brand.metaDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: settings.brand.accentColor,
    icons: [
      { src: settings.brand.faviconUrl ?? "/icon.svg", sizes: "any", type: settings.brand.faviconUrl ? undefined : "image/svg+xml", purpose: "any" },
      { src: "/images/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/images/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
