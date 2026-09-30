import { preconnect, prefetchDNS } from "react-dom";
import { getSettings } from "@/lib/db/store";
import { getResourceHints } from "@/lib/data/seo";
import { scheduleContentSync } from "@/lib/seo/content-sync";
import { organizationJsonLd, seoContext } from "@/lib/seo/jsonld";
import { JsonLd } from "./json-ld";

/**
 * Site-wide SEO plumbing, mounted once in the root layout:
 *
 *  - the Organization node, present on every page because Course,
 *    VideoObject, WebSite and Person nodes reference it by `@id` (the home
 *    page adds the WebSite node with its SearchAction);
 *  - `preconnect` / `dns-prefetch` hints for the hosts that serve covers and
 *    videos (the media CDN first), so the largest image or the first video
 *    segment does not wait for a connection to be set up;
 *  - the content sync (slug redirects and IndexNow pings), scheduled to run
 *    after the response.
 *
 * Verification tags, the RSS alternates and robots defaults come from
 * `rootMetadata()`.
 */
export async function RootSeo() {
  const [settings, hints] = await Promise.all([getSettings(), getResourceHints()]);
  scheduleContentSync();
  for (const origin of hints.preconnect) preconnect(origin);
  for (const origin of hints.dnsPrefetch) prefetchDNS(origin);
  return <JsonLd data={organizationJsonLd(seoContext(settings))} />;
}
