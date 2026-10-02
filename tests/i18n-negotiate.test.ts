import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, LOCALE_COOKIE, documentDir, intlLocale, isLocale, localeDir, ogLocaleFor, toLocale } from "@/i18n/config";
import { localeFromAcceptLanguage, localesStartingWith, matchLocale, negotiateLocale, parseAcceptLanguage } from "@/i18n/negotiate";
import { getDirection, getLocale, getLocaleSource, getT } from "@/i18n/server";
import { setLocaleAction, setLocaleFormAction } from "@/lib/actions/locale";
import { createSession } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";
import { requestCookie, resetRequest, revalidatedPaths, resetCacheLog } from "./helpers/request";

describe("i18n config", () => {
  it("knows the five interface languages and their direction", () => {
    assert.ok(["en", "hi", "es", "fr", "ar"].every(isLocale));
    assert.equal(isLocale("de"), false);
    assert.equal(isLocale("EN"), false);
    assert.equal(isLocale(undefined), false);
    assert.equal(localeDir("ar"), "rtl");
    assert.equal(localeDir("hi"), "ltr");
    assert.equal(toLocale("fr"), "fr");
    assert.equal(toLocale("xx"), DEFAULT_LOCALE);
    assert.equal(toLocale(null, "es"), "es");
  });

  it("maps locales to Intl tags and og:locale", () => {
    assert.equal(intlLocale("en"), "en-US");
    assert.match(intlLocale("ar"), /^ar/);
    assert.equal(intlLocale("nope"), "en-US");
    assert.equal(ogLocaleFor("fr"), "fr_FR");
    assert.equal(ogLocaleFor("ar"), "ar_AR");
    assert.equal(ogLocaleFor(undefined), "en_US");
  });

  it("lets the admin's text direction override the language", () => {
    assert.equal(documentDir("ar"), "rtl");
    assert.equal(documentDir("en", "auto"), "ltr");
    assert.equal(documentDir("en", "rtl"), "rtl");
    assert.equal(documentDir("ar", "ltr"), "ltr");
  });
});

describe("i18n Accept-Language parsing", () => {
  it("orders ranges by quality, keeping header order for ties", () => {
    assert.deepEqual(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5"), [
      { tag: "fr-ch", q: 1 },
      { tag: "fr", q: 0.9 },
      { tag: "en", q: 0.8 },
      { tag: "de", q: 0.7 },
      { tag: "*", q: 0.5 },
    ]);
    assert.deepEqual(
      parseAcceptLanguage("de;q=0.5, es;q=0.5, hi").map((r) => r.tag),
      ["hi", "de", "es"],
    );
  });

  it("drops q=0, invalid tags and invalid qualities", () => {
    assert.deepEqual(parseAcceptLanguage("es;q=0, fr"), [{ tag: "fr", q: 1 }]);
    assert.deepEqual(parseAcceptLanguage("<script>, en_GB, ;q=1, fr;q=2, ar;q=abc"), [{ tag: "en-gb", q: 1 }]);
    assert.deepEqual(parseAcceptLanguage(""), []);
    assert.deepEqual(parseAcceptLanguage(null), []);
  });

  it("bounds the work done on long headers", () => {
    const header = Array.from({ length: 500 }, (_, i) => `x${i % 10};q=0.1`).join(",") + ",ar";
    assert.ok(parseAcceptLanguage(header).length <= 32);
    assert.equal(localeFromAcceptLanguage(header), null, "ranges past the limit are ignored");
  });

  it("matches region and script variants to the base language", () => {
    assert.equal(matchLocale("es-MX"), "es");
    assert.equal(matchLocale("ar-EG"), "ar");
    assert.equal(matchLocale("hi-Latn-IN"), "hi");
    assert.equal(matchLocale("FR_ca"), "fr");
    assert.equal(matchLocale("pt-BR"), null);
    assert.equal(matchLocale(""), null);
  });

  it("picks the best supported language", () => {
    assert.equal(localeFromAcceptLanguage("de-DE, de;q=0.9, es;q=0.8, en;q=0.7"), "es");
    assert.equal(localeFromAcceptLanguage("ar-SA,ar;q=0.9,en-US;q=0.8"), "ar");
    assert.equal(localeFromAcceptLanguage("de, *;q=0.1"), "en", "the wildcard means the default");
    assert.equal(localeFromAcceptLanguage("de, ja"), null);
  });
});

describe("i18n locale negotiation order", () => {
  it("account preference beats the cookie, which beats the header", () => {
    assert.deepEqual(negotiateLocale({ userLocale: "hi", cookieLocale: "fr", acceptLanguage: "es" }), { locale: "hi", source: "user" });
    assert.deepEqual(negotiateLocale({ userLocale: undefined, cookieLocale: "fr", acceptLanguage: "es" }), { locale: "fr", source: "cookie" });
    assert.deepEqual(negotiateLocale({ cookieLocale: null, acceptLanguage: "es-AR,es;q=0.9" }), { locale: "es", source: "header" });
    assert.deepEqual(negotiateLocale({}), { locale: "en", source: "default" });
  });

  it("ignores unsupported or tampered stored values", () => {
    assert.deepEqual(negotiateLocale({ userLocale: "klingon", cookieLocale: "../../etc", acceptLanguage: "ar" }), { locale: "ar", source: "header" });
    assert.deepEqual(negotiateLocale({ userLocale: "", cookieLocale: "de", acceptLanguage: "ja" }), { locale: "en", source: "default" });
  });

  it("lists every locale with the active one first", () => {
    assert.deepEqual(localesStartingWith("fr"), ["fr", "en", "hi", "es", "ar"]);
  });
});

describe("i18n server helpers and the language action", () => {
  beforeEach(async () => {
    await resetDb({ users: [makeUser({ id: "u_ada", email: "ada@example.com", username: "ada" })] });
    resetRequest();
    resetCacheLog();
  });

  it("negotiates from the request: header, then cookie, then the member's preference", async () => {
    resetRequest({ headers: { "accept-language": "fr-FR,fr;q=0.9" } });
    assert.equal(await getLocale(), "fr");
    assert.equal(await getLocaleSource(), "header");

    resetRequest({ headers: { "accept-language": "fr" }, cookies: { [LOCALE_COOKIE]: "ar" } });
    assert.equal(await getLocale(), "ar");
    assert.equal(await getDirection(), "rtl");

    resetRequest({ headers: { "accept-language": "fr" }, cookies: { [LOCALE_COOKIE]: "ar" } });
    await resetDb({ users: [makeUser({ id: "u_ada", email: "ada@example.com", username: "ada", locale: "hi" })] });
    await createSession("u_ada");
    assert.equal(await getLocale(), "hi");
    assert.equal(await getLocaleSource(), "user");
  });

  it("getT translates in the negotiated language, or an explicit one", async () => {
    resetRequest({ cookies: { [LOCALE_COOKIE]: "es" } });
    const t = await getT("shell");
    assert.equal(t.locale, "es");
    assert.equal(t("nav.courses"), "Cursos");
    const en = await getT("shell", "en");
    assert.equal(en("nav.courses"), "Courses");
  });

  it("sets the cookie for guests and revalidates every layout", async () => {
    const result = await setLocaleAction("fr");
    assert.ok(result.ok);
    assert.deepEqual(result.data, { locale: "fr" });
    assert.match(result.message ?? "", /Français/);
    assert.equal(requestCookie(LOCALE_COOKIE), "fr");
    assert.ok(revalidatedPaths().includes("/ (layout)"));
    assert.equal(await getLocale(), "fr");
  });

  it("saves the preference on the member's account too", async () => {
    await createSession("u_ada");
    const result = await setLocaleAction("ar");
    assert.ok(result.ok);
    assert.equal((await findById("users", "u_ada"))?.locale, "ar");
    assert.equal(requestCookie(LOCALE_COOKIE), "ar");
  });

  it("rejects unsupported languages without touching the cookie or account", async () => {
    await createSession("u_ada");
    const result = await setLocaleAction("de");
    assert.equal(result.ok, false);
    assert.equal(requestCookie(LOCALE_COOKIE), undefined);
    assert.equal((await findById("users", "u_ada"))?.locale, undefined);
    const injected = await setLocaleAction("en; Path=/; Domain=evil.test");
    assert.equal(injected.ok, false);
  });

  it("works as a plain form action (no JavaScript)", async () => {
    const form = new FormData();
    form.set("locale", "hi");
    await setLocaleFormAction(form);
    assert.equal(requestCookie(LOCALE_COOKIE), "hi");
  });
});
