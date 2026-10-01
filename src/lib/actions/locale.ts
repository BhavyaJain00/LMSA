"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/auth/session";
import { update } from "@/lib/db/store";
import { fd } from "@/lib/utils";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_INFO, isLocale, type Locale } from "@/i18n/config";
import { getT } from "@/i18n/server";

/**
 * Change the interface language. Stored in the `ll_locale` cookie (guests and
 * members alike) and, for a signed-in member, on their account (`User.locale`)
 * so it follows them to other devices. Every layout re-renders in the new
 * language (`<html lang dir>` included).
 */
export async function setLocaleAction(locale: string): Promise<ActionResult<{ locale: Locale }>> {
  if (!isLocale(locale)) {
    const t = await getT("common");
    return { ok: false, error: t("language.unsupported") };
  }
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: siteConfig.cookieSecure,
  });
  const user = await getCurrentUser();
  if (user && user.locale !== locale) await update("users", user.id, { locale });
  revalidatePath("/", "layout");
  const t = await getT("common", locale);
  return { ok: true, data: { locale }, message: t("language.changed", { name: LOCALE_INFO[locale].nativeName }) };
}

/** Form variant (`<form action={setLocaleFormAction}>` with a `locale` field): works without JavaScript. */
export async function setLocaleFormAction(formData: FormData): Promise<void> {
  await setLocaleAction(fd(formData, "locale"));
}
