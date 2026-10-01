import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "./config";

/**
 * Locale negotiation, in priority order:
 *
 *  1. the signed-in member's saved preference (`User.locale`),
 *  2. the `ll_locale` cookie (set by the language switcher, also for guests),
 *  3. the browser's `Accept-Language` header (quality-weighted),
 *  4. English.
 *
 * Pure functions: the server helper (`src/i18n/server.ts`) feeds them the
 * request's values.
 */

export type LocaleSource = "user" | "cookie" | "header" | "default";

export interface LanguageRange {
  /** Lower-cased BCP 47 range, e.g. "es-419" or "*". */
  tag: string;
  q: number;
}

/** Longest header we parse; anything beyond is ignored (headers are attacker-controlled). */
const MAX_HEADER_LENGTH = 1024;
const MAX_RANGES = 32;
const RANGE_RE = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/;

/**
 * Parse an `Accept-Language` header into ranges sorted by quality (highest
 * first; equal qualities keep header order). Invalid entries and `q=0` are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): LanguageRange[] {
  if (!header) return [];
  const ranges: (LanguageRange & { index: number })[] = [];
  const parts = header.slice(0, MAX_HEADER_LENGTH).split(",").slice(0, MAX_RANGES);
  parts.forEach((part, index) => {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = (rawTag ?? "").trim().toLowerCase().replace(/_/g, "-");
    if (!tag || !RANGE_RE.test(tag)) return;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.split("=").map((s) => s.trim());
      if (name?.toLowerCase() !== "q") continue;
      const parsed = Number(value);
      q = value && /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) && Number.isFinite(parsed) ? parsed : 0;
    }
    if (q > 0) ranges.push({ tag, q, index });
  });
  return ranges.sort((a, b) => b.q - a.q || a.index - b.index).map(({ tag, q }) => ({ tag, q }));
}

/**
 * Map one language tag to a supported locale: exact match, then the primary
 * subtag ("es-MX" → es, "hi-Latn-IN" → hi, "ar-EG" → ar). Returns null when unsupported.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (isLocale(normalized)) return normalized;
  const primary = normalized.split("-")[0];
  return isLocale(primary) ? primary : null;
}

/** Best supported locale for an `Accept-Language` header, or null ("*" means the default). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const range of parseAcceptLanguage(header)) {
    if (range.tag === "*") return DEFAULT_LOCALE;
    const match = matchLocale(range.tag);
    if (match) return match;
  }
  return null;
}

export interface NegotiationInput {
  /** `User.locale` of the signed-in member, if any. */
  userLocale?: string | null;
  /** Value of the `ll_locale` cookie. */
  cookieLocale?: string | null;
  /** Raw `Accept-Language` header. */
  acceptLanguage?: string | null;
}

export function negotiateLocale(input: NegotiationInput): { locale: Locale; source: LocaleSource } {
  if (isLocale(input.userLocale)) return { locale: input.userLocale, source: "user" };
  if (isLocale(input.cookieLocale)) return { locale: input.cookieLocale, source: "cookie" };
  const fromHeader = localeFromAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return { locale: fromHeader, source: "header" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}

/** Every supported locale, the negotiated one first (for "other languages" lists). */
export function localesStartingWith(locale: Locale): Locale[] {
  return [locale, ...LOCALES.filter((l) => l !== locale)];
}
