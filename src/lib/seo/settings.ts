import type { Settings } from "@/lib/types";
import { isValidUrl } from "@/lib/utils";

/**
 * Parsing and validation of the SEO settings form (Admin → Settings → SEO).
 * Pure, so the rules are unit-tested and the Server Action stays thin.
 * Verification fields accept either the bare token or the whole
 * `<meta … content="…">` tag pasted from Search Console / Bing Webmaster Tools.
 */

export const SEO_SETTINGS_LIMITS = {
  titleTemplate: 70,
  description: 300,
  keywords: 500,
  organizationName: 120,
  sameAs: 20,
} as const;

/** Fields of the form this module owns (search appearance, organization, verification, indexing). */
export interface SeoSettingsInput {
  siteTitleTemplate: string;
  metaDescription: string;
  metaKeywords: string;
  metaImageUrl: string;
  twitterHandle: string;
  organizationName: string;
  organizationLogoUrl: string;
  sameAs: string;
  googleVerification: string;
  bingVerification: string;
  noindexSite: boolean;
}

export interface SeoSettingsPatch {
  brand: Pick<Settings["brand"], "metaDescription" | "metaKeywords" | "metaImageUrl">;
  seo: Pick<
    Settings["seo"],
    "siteTitleTemplate" | "defaultDescription" | "defaultOgImageUrl" | "twitterHandle" | "organizationName" | "organizationLogoUrl" | "sameAs" | "googleVerification" | "bingVerification" | "noindexSite"
  >;
}

/** Site-relative upload path or absolute http(s) URL. */
function isAssetUrl(value: string): boolean {
  return value.startsWith("/") ? !value.startsWith("//") : isValidUrl(value);
}

/**
 * "@handle", "handle", "https://x.com/handle" or "twitter.com/handle" → "@handle".
 * Returns null when the value is not a valid handle (1–15 letters, digits or underscores).
 */
export function normalizeTwitterHandle(raw: string): string | null {
  let value = raw.trim();
  if (!value) return "";
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([^/?#]+)/i.exec(value);
  if (fromUrl) value = fromUrl[1]!;
  value = value.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(value) ? `@${value}` : null;
}

/**
 * Extract a verification token from a bare value or a pasted meta tag
 * (`<meta name="google-site-verification" content="abc" />`). Returns null
 * when the result contains characters no provider uses.
 */
export function extractVerificationToken(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(value);
  const token = (content ? content[1]! : value).trim();
  return /^[A-Za-z0-9_\-.:=+/]{6,120}$/.test(token) ? token : null;
}

/** One URL per line (or comma separated) → unique absolute http(s) URLs; invalid lines are reported. */
export function parseSameAs(raw: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const value = line.trim();
    if (!value) continue;
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) invalid.push(value);
    else if (!urls.includes(url.href)) urls.push(url.href);
  }
  return { urls, invalid };
}

export function parseSeoSettings(input: SeoSettingsInput): { patch: SeoSettingsPatch; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const L = SEO_SETTINGS_LIMITS;

  const template = input.siteTitleTemplate.trim().replace(/\s+/g, " ");
  if (!template) errors.siteTitleTemplate = "Enter a title template, for example “%s · Your brand”.";
  else if (!template.includes("%s")) errors.siteTitleTemplate = "Include %s where the page title goes.";
  else if (template.length > L.titleTemplate) errors.siteTitleTemplate = `Keep the template under ${L.titleTemplate} characters.`;

  const description = input.metaDescription.trim().replace(/\s+/g, " ");
  if (description.length > L.description) errors.metaDescription = `Search engines cut descriptions short — keep it under ${L.description} characters.`;

  const keywords = [...new Set(input.metaKeywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean))];
  if (keywords.join(", ").length > L.keywords) errors.metaKeywords = `Keep keywords under ${L.keywords} characters.`;

  const image = input.metaImageUrl.trim();
  if (image && !isAssetUrl(image)) errors.metaImageUrl = "Upload an image or enter a valid URL.";

  const twitter = normalizeTwitterHandle(input.twitterHandle);
  if (twitter === null) errors.twitterHandle = "Enter an X (Twitter) handle such as @learnloop.";

  const organizationName = input.organizationName.trim();
  if (!organizationName) errors.organizationName = "Enter the name of the organization behind the site.";
  else if (organizationName.length > L.organizationName) errors.organizationName = `Keep the name under ${L.organizationName} characters.`;

  const logo = input.organizationLogoUrl.trim();
  if (logo && !isAssetUrl(logo)) errors.organizationLogoUrl = "Upload an image or enter a valid URL.";

  const sameAs = parseSameAs(input.sameAs);
  if (sameAs.invalid.length) errors.sameAs = `Not a valid web address: ${sameAs.invalid[0]}`;
  else if (sameAs.urls.length > L.sameAs) errors.sameAs = `Add at most ${L.sameAs} profile links.`;

  const google = extractVerificationToken(input.googleVerification);
  if (google === null) errors.googleVerification = "Paste the token (or the whole meta tag) from Google Search Console.";
  const bing = extractVerificationToken(input.bingVerification);
  if (bing === null) errors.bingVerification = "Paste the token (or the whole meta tag) from Bing Webmaster Tools.";

  return {
    errors,
    patch: {
      brand: {
        metaDescription: description || undefined,
        metaKeywords: keywords.length ? keywords.join(", ") : undefined,
        metaImageUrl: image || undefined,
      },
      seo: {
        siteTitleTemplate: template,
        defaultDescription: description,
        defaultOgImageUrl: image || undefined,
        twitterHandle: twitter || undefined,
        organizationName,
        organizationLogoUrl: logo || undefined,
        sameAs: sameAs.urls,
        googleVerification: google || undefined,
        bingVerification: bing || undefined,
        noindexSite: input.noindexSite,
      },
    },
  };
}
