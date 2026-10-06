import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMessage, placeholderNames, pluralCategory, pluralSelectors } from "@/i18n/format";

const LESSONS = "{count, plural, =0 {No lessons} one {# lesson} other {# lessons}}";

describe("i18n formatMessage: placeholders", () => {
  it("returns templates without placeholders unchanged", () => {
    assert.equal(formatMessage("Save changes"), "Save changes");
    assert.equal(formatMessage(""), "");
  });

  it("interpolates named values of every primitive type", () => {
    assert.equal(formatMessage("Hi {name}, welcome to {brand}.", { name: "Ada", brand: "LearnLoop" }), "Hi Ada, welcome to LearnLoop.");
    assert.equal(formatMessage("{a}{b}", { a: 1, b: true }), "1true");
    assert.equal(formatMessage("Year {year}", { year: 2026 }), "Year 2026");
  });

  it("allows whitespace and dotted names inside braces", () => {
    assert.equal(formatMessage("{ user.name } joined", { "user.name": "Ravi" }), "Ravi joined");
  });

  it("leaves a placeholder visible when its value is missing", () => {
    assert.equal(formatMessage("Hello {name}"), "Hello {name}");
    assert.equal(formatMessage("Hello {name}", { name: null }), "Hello {name}");
  });

  it("does not interpret placeholder values as templates", () => {
    assert.equal(formatMessage("Hi {name}", { name: "{brand}", brand: "X" }), "Hi {brand}");
  });

  it("prints malformed braces literally", () => {
    assert.equal(formatMessage("Use {} or {, or a lone } or {"), "Use {} or {, or a lone } or {");
    assert.equal(formatMessage("JSON: {\"a\": 1}"), "JSON: {\"a\": 1}");
    assert.equal(formatMessage("{count, plural, one {x}}", { count: 1 }), "{count, plural, one {x}}", "plural without other is not valid");
    assert.equal(formatMessage("{count, plural, one {x} other {y}", { count: 1 }), "{count, plural, one {x} other {y}", "unclosed");
    assert.equal(formatMessage("{count, unknown, a {b} other {c}}", { count: 1 }), "{count, unknown, a {b} other {c}}");
  });

  it("keeps apostrophes as ordinary characters (no ICU quoting)", () => {
    assert.equal(formatMessage("L'e-mail de {name} n'est pas confirmé", { name: "Zoé" }, "fr"), "L'e-mail de Zoé n'est pas confirmé");
    assert.equal(formatMessage("You're '{name}'", { name: "Sam" }), "You're 'Sam'");
  });

  it("formats {n, number} for the locale", () => {
    assert.equal(formatMessage("{n, number} learners", { n: 12000 }, "en"), "12,000 learners");
    assert.equal(formatMessage("{n, number}", { n: 12000 }, "es"), "12.000");
    assert.match(formatMessage("{n, number}", { n: 12000 }, "fr"), /^12\s000$/u);
    assert.equal(formatMessage("{n, number}", { n: 1234567 }, "hi"), "12,34,567", "Indian digit grouping");
    assert.equal(formatMessage("{n, number}", { n: 12000 }, "ar"), "12,000", "Arabic uses Western digits");
    assert.equal(formatMessage("{n, number}", { n: "1500" }, "en"), "1,500", "numeric strings are formatted");
    assert.equal(formatMessage("{n, number}", { n: "n/a" }, "en"), "n/a");
  });

  it("does not hang or recurse forever on deeply nested input", () => {
    const deep = "{a, select, other {".repeat(50) + "x" + "}}".repeat(50);
    assert.equal(typeof formatMessage(deep, { a: "z" }), "string");
  });
});

describe("i18n formatMessage: plurals per locale", () => {
  it("English: one / other, with exact =0", () => {
    assert.equal(formatMessage(LESSONS, { count: 0 }, "en"), "No lessons");
    assert.equal(formatMessage(LESSONS, { count: 1 }, "en"), "1 lesson");
    assert.equal(formatMessage(LESSONS, { count: 2 }, "en"), "2 lessons");
    assert.equal(formatMessage(LESSONS, { count: 1500 }, "en"), "1,500 lessons", "# is locale-formatted");
    assert.equal(formatMessage("{count, plural, one {# item} other {# items}}", { count: 0 }, "en"), "0 items");
  });

  it("French and Hindi treat 0 and 1 as one", () => {
    const fr = "{count, plural, one {# leçon} other {# leçons}}";
    assert.equal(formatMessage(fr, { count: 0 }, "fr"), "0 leçon");
    assert.equal(formatMessage(fr, { count: 1 }, "fr"), "1 leçon");
    assert.equal(formatMessage(fr, { count: 2 }, "fr"), "2 leçons");
    assert.equal(pluralCategory("hi", 0), "one");
    assert.equal(pluralCategory("hi", 1), "one");
    assert.equal(pluralCategory("hi", 2), "other");
    const hi = "{count, plural, one {# पाठ बाकी है} other {# पाठ बाकी हैं}}";
    assert.equal(formatMessage(hi, { count: 1 }, "hi"), "1 पाठ बाकी है");
    assert.equal(formatMessage(hi, { count: 5 }, "hi"), "5 पाठ बाकी हैं");
  });

  it("Spanish: one / other (and many for millions)", () => {
    const es = "{count, plural, one {# curso} many {# de cursos} other {# cursos}}";
    assert.equal(formatMessage(es, { count: 1 }, "es"), "1 curso");
    assert.equal(formatMessage(es, { count: 0 }, "es"), "0 cursos");
    assert.equal(formatMessage(es, { count: 3 }, "es"), "3 cursos");
    assert.equal(formatMessage(es, { count: 1000000 }, "es"), "1.000.000 de cursos");
  });

  it("Arabic: zero / one / two / few / many / other", () => {
    const ar = "{count, plural, zero {لا دروس} one {درس واحد} two {درسان} few {# دروس} many {# درسًا} other {# درس}}";
    assert.equal(formatMessage(ar, { count: 0 }, "ar"), "لا دروس");
    assert.equal(formatMessage(ar, { count: 1 }, "ar"), "درس واحد");
    assert.equal(formatMessage(ar, { count: 2 }, "ar"), "درسان");
    assert.equal(formatMessage(ar, { count: 3 }, "ar"), "3 دروس");
    assert.equal(formatMessage(ar, { count: 10 }, "ar"), "10 دروس");
    assert.equal(formatMessage(ar, { count: 11 }, "ar"), "11 درسًا");
    assert.equal(formatMessage(ar, { count: 99 }, "ar"), "99 درسًا");
    assert.equal(formatMessage(ar, { count: 100 }, "ar"), "100 درس");
    assert.equal(formatMessage(ar, { count: 103 }, "ar"), "103 دروس", "103 is few again");
  });

  it("falls back to other when a category branch is missing", () => {
    assert.equal(formatMessage("{count, plural, one {one} other {# many}}", { count: 2 }, "ar"), "2 many");
  });

  it("exact matches win over categories", () => {
    assert.equal(formatMessage("{count, plural, =1 {just one} one {# one} other {# other}}", { count: 1 }, "en"), "just one");
  });

  it("uses other (with # left as is) for non-numeric values", () => {
    assert.equal(formatMessage(LESSONS, { count: "lots" }, "en"), "# lessons");
    assert.equal(formatMessage(LESSONS, {}, "en"), "# lessons");
  });

  it("supports offset", () => {
    const msg = "{count, plural, offset:1 =0 {Nobody} =1 {{name}} one {{name} and # other} other {{name} and # others}}";
    assert.equal(formatMessage(msg, { count: 1, name: "Ana" }, "en"), "Ana");
    assert.equal(formatMessage(msg, { count: 2, name: "Ana" }, "en"), "Ana and 1 other");
    assert.equal(formatMessage(msg, { count: 4, name: "Ana" }, "en"), "Ana and 3 others");
  });

  it("nests placeholders and selects inside branches", () => {
    const msg = "{gender, select, female {{name} completed {count, plural, one {# course} other {# courses}}} other {{name} completed {count, plural, one {# course} other {# courses}}}}";
    assert.equal(formatMessage(msg, { gender: "female", name: "Mia", count: 3 }, "en"), "Mia completed 3 courses");
  });

  it("selectordinal uses ordinal rules", () => {
    const msg = "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    assert.deepEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((place) => formatMessage(msg, { place }, "en")),
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"],
    );
    assert.equal(formatMessage("{n, selectordinal, one {#er} other {#e}}", { n: 1 }, "fr"), "1er");
    assert.equal(formatMessage("{n, selectordinal, one {#er} other {#e}}", { n: 2 }, "fr"), "2e");
  });

  it("select picks the branch by value, falling back to other", () => {
    const msg = "{role, select, admin {Administrator} moderator {Moderator} other {Member}}";
    assert.equal(formatMessage(msg, { role: "admin" }), "Administrator");
    assert.equal(formatMessage(msg, { role: "student" }), "Member");
    assert.equal(formatMessage(msg, {}), "Member");
    assert.equal(formatMessage("{on, select, true {On} other {Off}}", { on: true }), "On");
  });

  it("# outside a plural is literal", () => {
    assert.equal(formatMessage("Order #{id}", { id: 42 }), "Order #42");
    assert.equal(formatMessage("{role, select, other {#1}}", { role: "x" }), "#1");
  });

  it("# inside a select nested in a plural is the plural's number", () => {
    assert.equal(formatMessage("{n, plural, other {{g, select, other {# items}}}}", { n: 3, g: "x" }), "3 items");
    const msg = "{count, plural, one {{role, select, admin {# admin} other {# member}}} other {{role, select, admin {# admins} other {# members}}}}";
    assert.equal(formatMessage(msg, { count: 1, role: "admin" }), "1 admin");
    assert.equal(formatMessage(msg, { count: 1200, role: "student" }), "1,200 members");
    assert.equal(formatMessage(msg, { count: 1200, role: "student" }, "fr"), "1 200 members");
    // Deeper nesting keeps the context; a select at the top level still prints # literally.
    assert.equal(formatMessage("{n, plural, other {{a, select, other {{b, select, other {#!}}}}}}", { n: 2, a: "x", b: "y" }), "2!");
    assert.equal(formatMessage("{a, select, other {{n, plural, other {#}} #}}", { a: "x", n: 5 }), "5 #");
  });
});

describe("i18n template analysis", () => {
  it("lists placeholder names, including ones inside branches", () => {
    assert.deepEqual(placeholderNames("Hi {name}, {count, plural, one {# from {brand}} other {#}}"), ["brand", "count", "name"]);
    assert.deepEqual(placeholderNames("No placeholders"), []);
  });

  it("lists plural selectors per placeholder", () => {
    assert.deepEqual(pluralSelectors(LESSONS), { count: ["=0", "one", "other"] });
    assert.deepEqual(pluralSelectors("{role, select, a {x} other {y}}"), {});
  });
});
