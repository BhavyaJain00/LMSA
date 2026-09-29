import type { Metadata } from "next";
import { getSettings } from "@/lib/db/store";
import { OfflineView } from "./offline-view";

export const metadata: Metadata = {
  title: "Offline",
  description: "You're offline. Reconnect to keep learning.",
  robots: { index: false, follow: false },
};

/**
 * Offline fallback. The service worker precaches this page (fetched without
 * cookies, so it never contains personal data) and serves it when a page
 * can't be loaded. It must not depend on the signed-in member.
 */
export default async function OfflinePage() {
  const { brand } = await getSettings();
  return <OfflineView brandName={brand.name.trim() || "LearnLoop"} tagline={brand.tagline} logoUrl={brand.logoUrl} />;
}
