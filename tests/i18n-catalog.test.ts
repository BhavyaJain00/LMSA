import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCALES, NAMESPACES, type Locale } from "@/i18n/config";
import { ENGLISH, catalogMessages, englishMessages, pickMessages, translatedMessages } from "@/i18n/catalog";
import { formatMessage, pluralCategory, placeholderNames, pluralSelectors } from "@/i18n/format";
import { createTranslator } from "@/i18n/translate";
import { GLOBAL_PREFIX, globalSlices, mergeProvided } from "@/i18n/provided";

const TRANSLATED = LOCALES.filter((l) => l !== "en");
const html = (node: ReactNode) => renderToStaticMarkup(createElement("p", null, node));

/** Plural categories `Intl.PluralRules` can produce for a locale over a wide range of integers. */
function categoriesFor(locale: Locale): Set<string> {
  const out = new Set<string>();
  for (let n = 0; n <= 1000; n++) out.add(pluralCategory(locale, n));
  return out;
}

describe("i18n catalog: every namespace in every language", () => {
  for (const namespace of NAMESPACES) {
    const english = englishMessages(namespace);

    it(`${namespace}: English templates parse and every plural/select has other`, () => {
      for (const [key, template] of Object.entries(english)) {
        assert.equal(typeof template, "string", `${namespace}:${key}`);
        assert.ok(template.trim().length > 0, `${namespace}:${key} is empty`);
        for (const [name, selectors] of Object.entries(pluralSelectors(template))) {
          assert.ok(selectors.includes("other"), `${namespace}:${key} plural {${name}} needs other`);
        }
        assert.doesNotThrow(() => formatMessage(template, {}, "en"));
      }
    });

    for (const locale of TRANSLATED) {
      it(`${namespace}/${locale}: only English keys, same placeholders, complete plurals`, () => {
        const translated = translatedMessages(locale, namespace);
        const categories = categoriesFor(locale);
        for (const [key, template] of Object.entries(translated)) {
          assert.ok(Object.hasOwn(english, key), `${namespace}/${locale} has a key English lacks: ${key}`);
          assert.equal(typeof template, "string");
          assert.ok(template.trim().length > 0, `${namespace}/${locale}:${key} is empty`);
          assert.deepEqual(placeholderNames(template), placeholderNames(english[key]!), `${namespace}/${locale}:${key} placeholders differ from English`);
          for (const [name, selectors] of Object.entries(pluralSelectors(template))) {
            assert.ok(selectors.includes("other"), `${namespace}/${locale}:${key} plural {${name}} needs other`);
            if (locale !== "ar") continue;
            // Arabic needs every category (zero may be written as =0, one as =1, two as =2).
            for (const category of categories) {
              const exact = { zero: "=0", one: "=1", two: "=2" }[category];
              assert.ok(selectors.includes(category) || (exact && selectors.includes(exact)), `${namespace}/ar:${key} plural {${name}} lacks "${category}"`);
            }
          }
          assert.doesNotThrow(() => formatMessage(template, {}, locale));
        }
      });
    }
  }

  it("the framework namespaces are fully translated", () => {
    for (const namespace of ["common", "shell", "auth"] as const) {
      const keys = Object.keys(englishMessages(namespace));
      assert.ok(keys.length > 50, `${namespace} has messages`);
      for (const locale of TRANSLATED) {
        const missing = keys.filter((key) => !Object.hasOwn(translatedMessages(locale, namespace), key));
        assert.deepEqual(missing, [], `${namespace}/${locale} is missing keys`);
      }
    }
  });

  it("translations are not left in English by mistake", () => {
    for (const namespace of ["shell", "auth"] as const) {
      for (const locale of TRANSLATED) {
        const translated = translatedMessages(locale, namespace);
        // Single words spelled the same in both languages ("Notifications", "Messages", "Discussions" in
        // French) and placeholders such as "you@example.com" may stay identical; whole phrases may not.
        const identical = Object.keys(translated).filter(
          (key) => translated[key] === englishMessages(namespace)[key] && /[a-z]{4}/.test(translated[key]!) && /\s/.test(translated[key]!.trim()),
        );
        assert.ok(identical.length <= 3, `${namespace}/${locale} copies English for: ${identical.join(", ")}`);
      }
    }
  });

  it("Hindi is written in Devanagari and Arabic in Arabic script", () => {
    assert.match(translatedMessages("hi", "shell")["nav.courses"]!, /[ऀ-ॿ]/);
    assert.match(translatedMessages("ar", "shell")["nav.courses"]!, /[؀-ۿ]/);
    assert.match(translatedMessages("ar", "auth")["login.forgot"]!, /؟$/, "Arabic question mark");
  });
});

describe("i18n catalog: English fallback", () => {
  it("catalogMessages fills untranslated keys with English", () => {
    for (const locale of LOCALES) {
      for (const namespace of NAMESPACES) {
        const merged = catalogMessages(locale, namespace);
        assert.deepEqual(Object.keys(merged).sort(), Object.keys(englishMessages(namespace)).sort());
      }
    }
    assert.equal(catalogMessages("fr", "shell")["nav.courses"], "Cours");
    assert.equal(catalogMessages("en", "shell"), ENGLISH.shell, "English is served as is");
  });

  it("caches the merged objects", () => {
    assert.equal(catalogMessages("es", "common"), catalogMessages("es", "common"));
  });
});

describe("i18n translator", () => {
  const english = { "a.hello": "Hello {name}", "a.only": "English only", "a.count": "{count, plural, one {# file} other {# files}}" };
  const french = { "a.hello": "Bonjour {name}", "a.count": "{count, plural, one {# fichier} other {# fichiers}}" };

  it("translates, interpolates and pluralises in its locale", () => {
    const t = createTranslator({ locale: "fr", namespace: "common", messages: french, fallback: english });
    assert.equal(t("a.hello", { name: "Zoé" }), "Bonjour Zoé");
    assert.equal(t("a.count", { count: 0 }), "0 fichier", "French: 0 is singular");
    assert.equal(t("a.count", { count: 3 }), "3 fichiers");
    assert.equal(t.locale, "fr");
    assert.equal(t.namespace, "common");
  });

  it("falls back to English, then to the key, reporting each missing key once", () => {
    const missing: string[] = [];
    const t = createTranslator({ locale: "ar", namespace: "admin", messages: {}, fallback: english, onMissing: (ns, key) => missing.push(`${ns}:${key}`) });
    assert.equal(t("a.only"), "English only");
    assert.equal(t("a.nope"), "a.nope");
    assert.equal(t("a.nope"), "a.nope");
    assert.deepEqual(missing, ["admin:a.nope"]);
  });

  it("ignores inherited object properties as keys", () => {
    const t = createTranslator({ locale: "en", namespace: "common", messages: english });
    assert.equal(t("toString"), "toString");
    assert.equal(t("__proto__"), "__proto__");
    assert.equal(t.has("constructor"), false);
  });

  it("exposes raw templates and key checks", () => {
    const t = createTranslator({ locale: "fr", namespace: "common", messages: french, fallback: english });
    assert.equal(t.raw("a.hello"), "Bonjour {name}");
    assert.equal(t.has("a.only"), true, "available through the fallback");
    assert.equal(t.has("a.missing"), false);
  });

  it("rich text renders tags through functions and keeps the sentence whole", () => {
    const t = createTranslator({
      locale: "en",
      namespace: "auth",
      messages: { prompt: "New here? <link>Create an account</link>", email: "For your {brand} account <b>{email}</b>.", self: "Line<br/>break" },
    });
    assert.equal(
      html(t.rich("prompt", { link: (text) => createElement("a", { href: "/register" }, text) })),
      '<p>New here? <a href="/register">Create an account</a></p>',
    );
    assert.equal(
      html(t.rich("email", { brand: "LearnLoop", email: "a***@x.com", b: (text) => createElement("strong", null, text) })),
      "<p>For your LearnLoop account <strong>a***@x.com</strong>.</p>",
    );
    assert.equal(html(t.rich("self", { br: createElement("br") })), "<p>Line<br/>break</p>");
  });

  it("rich text accepts elements as placeholder values and escapes plain text", () => {
    const t = createTranslator({ locale: "ar", namespace: "common", messages: { x: "{count, plural, one {# ملف} other {# ملفات}} من {who}" } });
    assert.equal(html(t.rich("x", { count: 3, who: createElement("b", null, "<Sam>") })), "<p>3 ملفات من <b>&lt;Sam&gt;</b></p>");
    const plain = createTranslator({ locale: "en", namespace: "common", messages: { y: "Hi {name}" } });
    assert.equal(html(plain.rich("y", { name: "<script>alert(1)</script>" })), "<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("rich text never treats interpolated values as markup", () => {
    const t = createTranslator({ locale: "en", namespace: "common", messages: { m: "{name} sent <link>a message</link>" } });
    const link = (text: ReactNode) => createElement("a", { href: "/messages" }, text);
    // A user name that mimics the message's own tag stays text and gets no link.
    assert.equal(html(t.rich("m", { name: "<link>Evil</link>", link })), '<p>&lt;link&gt;Evil&lt;/link&gt; sent <a href="/messages">a message</a></p>');
    // Marker characters smuggled into a value cannot pull in the developer's elements.
    const smuggled = `${String.fromCodePoint(0xe000)}0${String.fromCodePoint(0xe001)}`;
    const u = createTranslator({ locale: "en", namespace: "common", messages: { m: "{who}: {badge}" } });
    assert.equal(html(u.rich("m", { who: smuggled, badge: createElement("b", null, "VIP") })), "<p>0: <b>VIP</b></p>");
  });

  it("rich text keeps unknown or unbalanced tags harmless", () => {
    const t = createTranslator({ locale: "en", namespace: "common", messages: { a: "<x>kept</x> and </y> stray", b: "a < b > c" } });
    assert.equal(html(t.rich("a")), "<p>kept and &lt;/y&gt; stray</p>");
    assert.equal(html(t.rich("b")), "<p>a &lt; b &gt; c</p>");
  });
});

describe("i18n client payload", () => {
  it("pickMessages keeps only the requested prefixes", () => {
    const messages = { "global.a": "1", "globalx.b": "2", "courses.c": "3", courses: "4" };
    assert.deepEqual(pickMessages(messages, ["global."]), { "global.a": "1" });
    assert.deepEqual(pickMessages(messages, ["courses"]), { "courses.c": "3", courses: "4" });
    assert.equal(pickMessages(messages, undefined), messages);
    assert.equal(pickMessages(messages, []), messages);
  });

  it("the root layout gets every other namespace's global slice", () => {
    const pick = globalSlices(["common", "shell"]);
    assert.equal(pick.common, undefined);
    assert.equal(pick.shell, undefined);
    for (const ns of ["auth", "public", "learning", "account", "admin"] as const) assert.deepEqual(pick[ns], [GLOBAL_PREFIX]);
  });

  it("nested providers merge key by key", () => {
    const root = { common: { "actions.save": "Save" }, account: { "global.palette": "Search" } };
    const page = { account: { "dashboard.title": "Dashboard" }, learning: { "player.next": "Next" } };
    assert.deepEqual(mergeProvided(root, page), {
      common: { "actions.save": "Save" },
      account: { "global.palette": "Search", "dashboard.title": "Dashboard" },
      learning: { "player.next": "Next" },
    });
    assert.deepEqual(root.account, { "global.palette": "Search" }, "the parent is not mutated");
  });
});
