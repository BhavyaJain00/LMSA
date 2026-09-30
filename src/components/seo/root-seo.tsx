import { getSettings } from "@/lib/db/store";
import { organizationJsonLd, seoContext } from "@/lib/seo/jsonld";
import { JsonLd } from "./json-ld";

/**
 * Site-wide structured data, mounted once in the root layout. The
 * Organization node is on every page because Course, VideoObject, WebSite
 * and Person nodes reference it by `@id` (publisher, affiliation); the home
 * page adds the WebSite node with its SearchAction. Verification tags, the
 * RSS alternates and robots defaults come from `rootMetadata()`.
 */
export async function RootSeo() {
  const settings = await getSettings();
  return <JsonLd data={organizationJsonLd(seoContext(settings))} />;
}
