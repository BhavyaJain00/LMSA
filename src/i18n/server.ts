import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { LOCALE_COOKIE, localeDir, type Locale, type Namespace, type TextDirection } from "./config";
import { catalogMessages, englishMessages, pickMessages, type MessageKey } from "./catalog";
import { createFormatters, type Formatters } from "./formatters";
import { negotiateLocale, type LocaleSource } from "./negotiate";
import { createTranslator, type Translator } from "./translate";
import type { Messages } from "./types";

/**
 * Server-side i18n for Server Components, layouts, `generateMetadata`,
 * Server Actions and route handlers:
 *
 *   const t = await getT("auth");
 *   t("login.title");                              // "Welcome back"
 *   t("login.subtitle", { brand: "LearnLoop" });   // interpolation
 *   t.rich("login.signupPrompt", { link: (s) => <Link href="/register">{s}</Link> });
 *   const f = await getFormatter();  f.date(course.publishedAt)
 *
 * The locale is negotiated once per request (React `cache`).
 */

const resolveLocale = cache(async (): Promise<{ locale: Locale; source: LocaleSource }> => {
  const [store, head, user] = await Promise.all([cookies(), headers(), getCurrentUser()]);
  return negotiateLocale({
    userLocale: user?.locale,
    cookieLocale: store.get(LOCALE_COOKIE)?.value,
    acceptLanguage: head.get("accept-language"),
  });
});

/** The active interface language for this request. */
export async function getLocale(): Promise<Locale> {
  return (await resolveLocale()).locale;
}

/** Where the active language came from (account, cookie, browser, default). */
export async function getLocaleSource(): Promise<LocaleSource> {
  return (await resolveLocale()).source;
}

/** Text direction of the active language. */
export async function getDirection(): Promise<TextDirection> {
  return localeDir(await getLocale());
}

function reportMissing(namespace: Namespace, key: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing message "${namespace}:${key}"`);
}

/** A translator for one namespace in the active language (English fallback per key). */
export async function getT<N extends Namespace>(namespace: N, locale?: Locale): Promise<Translator<MessageKey<N>>> {
  const active = locale ?? (await getLocale());
  return createTranslator<MessageKey<N>>({
    locale: active,
    namespace,
    messages: catalogMessages(active, namespace),
    fallback: englishMessages(namespace),
    onMissing: reportMissing,
  });
}

/** `Intl` formatters bound to the active language. */
export async function getFormatter(locale?: Locale): Promise<Formatters> {
  return createFormatters(locale ?? (await getLocale()));
}

/** Messages to hand to the client provider (merged with English, optionally only some key prefixes). */
export function clientMessages(locale: Locale, namespaces: readonly Namespace[], pick?: Partial<Record<Namespace, readonly string[]>>): Partial<Record<Namespace, Messages>> {
  const out: Partial<Record<Namespace, Messages>> = {};
  for (const namespace of namespaces) out[namespace] = pickMessages(catalogMessages(locale, namespace), pick?.[namespace]);
  return out;
}
