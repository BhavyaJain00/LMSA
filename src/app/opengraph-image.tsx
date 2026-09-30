import { OG_CONTENT_TYPE, renderSiteOgCard } from "@/components/seo/og-card";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";

/** Default share card for pages without their own image (brand, tagline and description from settings). */
export const alt = "Online courses and learning community";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Rendered per request so brand changes show up without a rebuild (crawlers cache it anyway).
export const dynamic = "force-dynamic";

export default function OpengraphImage() {
  return renderSiteOgCard();
}
