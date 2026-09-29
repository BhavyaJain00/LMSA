"use client";

export interface TrackingScriptsProps {
  /** `settings.seo.ga4Id` — loaded only after analytics consent. */
  ga4Id?: string;
  /** `settings.seo.metaPixelId` — loaded only after marketing consent. */
  metaPixelId?: string;
}

/**
 * Third-party measurement tags (GA4, Meta Pixel), mounted once in the root
 * layout. Foundation stub: loads nothing until the SEO area implements
 * consent-gated loading.
 */
export function TrackingScripts(props: TrackingScriptsProps) {
  void props;
  return null;
}
