/**
 * Interface languages. Client-safe (no server imports): the language
 * switcher, the client provider, the server helpers and the SEO metadata all
 * read the locale list from here.
 *
 * The UI language is chosen per visitor (account preference → `ll_locale`
 * cookie → `Accept-Language` → English) and URLs stay the same in every
 * language. Course, lesson and blog content keeps the language it was written
 * in. Per-language URLs (`/es/courses/...`) would be a later step: see
 * `src/i18n/README.md` and `CONTENT_LANGUAGES` in `src/lib/seo/metadata.ts`.
 */

export const LOCALES = ["en", "hi", "es", "fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** Source language: every key exists in English, other languages fall back to it. */
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie holding the visitor's chosen interface language. */
export const LOCALE_COOKIE = "ll_locale";
/** The language choice is remembered for a year. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type TextDirection = "ltr" | "rtl";

export interface LocaleInfo {
  code: Locale;
  /** Name in English (admin lists, logs). */
  englishName: string;
  /** Name in the language itself (what the switcher shows). */
  nativeName: string;
  dir: TextDirection;
  /**
   * Tag handed to `Intl` formatters. Arabic and Hindi use Western digits
   * (`nu-latn`) so prices, codes, lesson numbers and dates read consistently
   * next to the Latin-script content of the catalog.
   */
  intl: string;
  /** Open Graph locale (`og:locale`), language_TERRITORY. */
  ogLocale: string;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { code: "en", englishName: "English", nativeName: "English", dir: "ltr", intl: "en-US", ogLocale: "en_US" },
  hi: { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", dir: "ltr", intl: "hi-IN-u-nu-latn", ogLocale: "hi_IN" },
  es: { code: "es", englishName: "Spanish", nativeName: "Español", dir: "ltr", intl: "es-ES", ogLocale: "es_ES" },
  fr: { code: "fr", englishName: "French", nativeName: "Français", dir: "ltr", intl: "fr-FR", ogLocale: "fr_FR" },
  ar: { code: "ar", englishName: "Arabic", nativeName: "العربية", dir: "rtl", intl: "ar-u-nu-latn", ogLocale: "ar_AR" },
};

/** Message namespaces. `common`, `shell` and `auth` belong to the framework; the other four to the translator groups. */
export const NAMESPACES = ["common", "shell", "auth", "public", "learning", "account", "admin"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isNamespace(value: unknown): value is Namespace {
  return typeof value === "string" && (NAMESPACES as readonly string[]).includes(value);
}

/** Coerce anything (a stored preference, a cookie) to a supported locale. */
export function toLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}

export function localeDir(locale: Locale): TextDirection {
  return LOCALE_INFO[locale].dir;
}

export function intlLocale(locale: Locale | string | undefined): string {
  return isLocale(locale) ? LOCALE_INFO[locale].intl : LOCALE_INFO[DEFAULT_LOCALE].intl;
}

export function ogLocaleFor(locale: Locale | string | undefined): string {
  return isLocale(locale) ? LOCALE_INFO[locale].ogLocale : LOCALE_INFO[DEFAULT_LOCALE].ogLocale;
}

/**
 * The document direction: the admin's override (Settings → General → Text
 * direction) wins, otherwise the active language decides.
 */
export function documentDir(locale: Locale, override: "auto" | TextDirection = "auto"): TextDirection {
  return override === "auto" ? localeDir(locale) : override;
}
