import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFormatters, formatLocalizedDuration } from "@/i18n/formatters";
import { formatClock, formatDate, formatDateTime, formatNumber, formatPrice, relativeTime } from "@/lib/utils";

const NOW = new Date("2026-03-04T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("i18n: utils keep their English output without a locale", () => {
  it("dates, times and clock", () => {
    assert.equal(formatDate("2026-03-01"), "Mar 1, 2026");
    assert.equal(formatDate(""), "");
    assert.equal(formatDate("not a date"), "");
    assert.match(formatDateTime("2026-03-01T10:05:00"), /^Mar 1, 2026, 10:05\sAM$/u);
    assert.equal(formatClock("14:30"), "2:30 PM");
    assert.equal(formatClock("00:05"), "12:05 AM");
    assert.equal(formatClock("bad"), "bad");
  });

  it("numbers and prices", () => {
    assert.equal(formatNumber(1234), "1,234");
    assert.equal(formatNumber(12000), "12K");
    assert.equal(formatPrice(1999), "$19.99");
    assert.equal(formatPrice(0), "Free");
    assert.equal(formatPrice(0, "USD", "Gratis"), "Gratis");
    assert.equal(formatPrice(500, "INR"), "₹5.00");
  });

  it("relative time", () => {
    assert.equal(relativeTime(ago(3), NOW), "just now");
    assert.equal(relativeTime(ago(3 * 86400), NOW), "3 days ago");
    assert.equal(relativeTime(ago(86400), NOW), "yesterday");
    assert.equal(relativeTime("garbage", NOW), "");
  });
});

describe("i18n: utils with a locale", () => {
  it("formats dates in the interface language", () => {
    assert.equal(formatDate("2026-03-01", {}, "fr"), "1 mars 2026");
    assert.equal(formatDate("2026-03-01", {}, "es"), "1 mar 2026");
    assert.match(formatDate("2026-03-01", {}, "ar"), /^1 مارس 2026$/u);
    assert.match(formatDate("2026-03-01", {}, "hi"), /मार्च/u);
    assert.equal(formatDate("2026-03-01", {}, "en"), "Mar 1, 2026");
  });

  it("uses Western digits for Arabic and Hindi", () => {
    for (const locale of ["ar", "hi"]) {
      assert.match(formatDate("2026-03-01", {}, locale), /2026/);
      assert.doesNotMatch(formatNumber(1234, locale), /[٠-٩०-९]/u);
    }
  });

  it("formats prices and clocks per locale", () => {
    assert.equal(plain(formatPrice(1999, "EUR", "Gratuit", "fr")), "19,99 €");
    assert.equal(plain(formatPrice(1999, "EUR", "Gratis", "es")), "19,99 €");
    assert.equal(formatPrice(0, "EUR", "Gratuit", "fr"), "Gratuit");
    assert.equal(formatClock("14:30", "fr"), "14:30");
    assert.equal(formatClock("14:30", "en"), "2:30 PM");
  });

  it("accepts any BCP 47 tag too", () => {
    assert.equal(formatDate("2026-03-01", {}, "de-DE"), "1. März 2026");
  });

  it("formats relative time in the language", () => {
    assert.equal(relativeTime(ago(3 * 86400), NOW, "fr"), "il y a 3 jours");
    assert.equal(relativeTime(ago(3 * 86400), NOW, "es"), "hace 3 días");
    assert.equal(relativeTime(ago(2), NOW, "fr"), "maintenant");
    assert.match(relativeTime(ago(3 * 86400), NOW, "ar"), /3/);
  });
});

describe("i18n formatters bound to a locale", () => {
  it("exposes the same helpers for every language", () => {
    const fr = createFormatters("fr");
    assert.equal(fr.locale, "fr");
    assert.equal(fr.date("2026-03-01"), "1 mars 2026");
    assert.equal(plain(fr.number(12000)), "12 000");
    assert.equal(plain(fr.percent(42)), "42 %");
    assert.equal(plain(fr.percent(0.5, { fraction: true })), "50 %");
    assert.equal(fr.list(["HTML", "CSS", "JS"]), "HTML, CSS et JS");
    assert.equal(fr.list(["a", "b"], "disjunction"), "a ou b");
    assert.equal(fr.relative(ago(3600), NOW), "il y a 1 heure");
    assert.equal(fr.clock("09:00"), "9:00");
    assert.equal(plain(fr.price(1000, "USD")), "10,00 $US");

    const en = createFormatters("en");
    assert.equal(en.list(["a", "b", "c"]), "a, b, and c");
    assert.equal(en.count(25000), "25K");
    assert.equal(en.dateTime(""), "");

    const ar = createFormatters("ar");
    assert.match(ar.list(["أ", "ب"]), /و/);
  });

  it("formats durations with the locale's units", () => {
    assert.equal(formatLocalizedDuration(3725, "en"), "1h 2m");
    assert.equal(formatLocalizedDuration(125, "en"), "2m");
    assert.equal(formatLocalizedDuration(30, "en"), "30s");
    assert.equal(formatLocalizedDuration(3600, "en"), "1h");
    assert.equal(formatLocalizedDuration(-5, "en"), "0s");
    assert.equal(formatLocalizedDuration(Number.NaN, "en"), "0s");
    assert.match(plain(formatLocalizedDuration(3725, "fr")), /^1\s?h 2\s?min$/);
  });
});
