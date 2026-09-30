import { legalLinks } from "@/lib/legal/links";
import type { ConsentState } from "@/lib/legal/consent-shared";
import { ConsentBanner } from "./consent-banner";

export interface ConsentManagerProps {
  /** `settings.legal.cookieBanner` */
  enabled: boolean;
  /** Decision read from the `ll_consent` cookie on the server (avoids a banner flash). */
  initialConsent: ConsentState;
}

/**
 * Cookie-consent banner and preferences dialog, mounted once in the root
 * layout. Resolves the published cookie policy (falling back to the privacy
 * policy) on the server so the banner links to a page that exists.
 */
export async function ConsentManager({ enabled, initialConsent }: ConsentManagerProps) {
  const links = await legalLinks();
  const policy = links.find((l) => l.slug === "cookies") ?? links.find((l) => l.slug === "privacy");
  return <ConsentBanner enabled={enabled} initialConsent={initialConsent} policy={policy ? { href: policy.href, title: policy.title } : undefined} />;
}
