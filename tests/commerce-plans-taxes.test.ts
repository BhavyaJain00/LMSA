import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, MembershipPlan, Payment, Settings, TaxRule } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import {
  applyTax,
  countryCode,
  countryFromAcceptLanguage,
  countryFromHeaders,
  countryName,
  findTaxRule,
  isTaxInclusive,
  resolveTax,
  roundAmount,
  roundForCurrency,
  taxLineLabel,
  validateTaxRuleInput,
} from "@/lib/commerce/tax";
import { currencyForCountry, normalizeCurrency, pickPrice, preferredCurrency, priceOptions, selectableCurrencies, validatePriceRows } from "@/lib/commerce/currency";
import { buyerTaxContext, viewerCurrency } from "@/lib/commerce/buyer";
import { orderTaxCountry, parseTaxReportFilter, pricedItems, saleCurrencies, taxReport, taxReportToCsv, taxRuleRows } from "@/lib/commerce/tax-views";
import { computeOrderSummary, getBillingItem, itemCurrencies, orderTaxFields, priceItemIn } from "@/lib/data/commerce";
import { placeOrderAction } from "@/lib/actions/payments";
import { deleteTaxRulesAction, saveCurrencyPricesAction, saveTaxRuleAction, saveTaxSettingsAction, setCurrencyAction } from "@/lib/actions/taxes";
import { COUNTRIES } from "@/components/commerce/countries";
import { buildSettings, makeCoupon, makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, requestCookie, resetRequest } from "./helpers/request";

/**
 * Taxes by country and multi-currency prices: country parsing and guessing,
 * which tax applies, inclusive/exclusive maths and rounding per currency,
 * the rule and price forms, currency selection, checkout orders carrying
 * the right tax and currency, the tax report, and the admin actions.
 */

const DE: TaxRule = { id: "tax_de", country: "DE", name: "VAT", rate: 19, inclusive: true };
const GB: TaxRule = { id: "tax_gb", country: "GB", name: "VAT", rate: 20, inclusive: false };
const IN: TaxRule = { id: "tax_in", country: "IN", name: "GST", rate: 18, inclusive: false };

const settingsWith = (patch: { applyTax?: boolean; taxPercentage?: number; taxLabel?: string; taxMode?: "none" | "by_country"; multiCurrency?: boolean } = {}): Settings =>
  buildSettings({
    commerce: { applyTax: patch.applyTax ?? false, taxPercentage: patch.taxPercentage ?? 0, taxLabel: patch.taxLabel ?? "Tax" },
    growth: { taxMode: patch.taxMode ?? "by_country", multiCurrency: patch.multiCurrency ?? false },
  });

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

/* ------------------------------------------------------------------ */
/* Countries                                                           */
/* ------------------------------------------------------------------ */

describe("countries", () => {
  it("resolves billing-form names and codes to ISO codes", () => {
    assert.equal(countryCode("India"), "IN");
    assert.equal(countryCode("Germany"), "DE");
    assert.equal(countryCode("germany "), "DE");
    assert.equal(countryCode("de"), "DE");
    assert.equal(countryCode("United States of America"), "US");
    assert.equal(countryCode("UK"), "GB");
    assert.equal(countryCode("Türkiye"), "TR");
    assert.equal(countryCode("Côte d’Ivoire"), "CI");
  });

  it("never resolves to withdrawn or pseudo codes", () => {
    // Some ICU builds name the withdrawn "DD" "Germany": the current code must win.
    assert.equal(countryCode("DD"), null);
    assert.equal(countryCode("EU"), null);
    assert.equal(countryCode("ZZ"), null);
    assert.equal(countryCode("Atlantis"), null);
    assert.equal(countryCode(""), null);
    assert.equal(countryCode(undefined), null);
  });

  it("maps every billing-form country to a distinct code", () => {
    const codes = new Map<string, string>();
    for (const name of COUNTRIES) {
      const code = countryCode(name);
      assert.ok(code, `${name} has a code`);
      assert.ok(!codes.has(code), `${name} and ${codes.get(code)} share ${code}`);
      codes.set(code, name);
    }
  });

  it("names codes in English", () => {
    assert.equal(countryName("IN"), "India");
    assert.equal(countryName("de"), "Germany");
    assert.equal(countryName("not a code"), "not a code");
  });

  it("guesses the country from the preferred language's region", () => {
    assert.equal(countryFromAcceptLanguage("en-IN,en;q=0.9"), "IN");
    assert.equal(countryFromAcceptLanguage("fr;q=0.9, de-DE;q=0.8"), "DE");
    assert.equal(countryFromAcceptLanguage("zh-Hant-TW,en;q=0.5"), "TW");
    assert.equal(countryFromAcceptLanguage("en-US;q=0.2, en-GB;q=0.8"), "GB");
    assert.equal(countryFromAcceptLanguage("en"), null);
    assert.equal(countryFromAcceptLanguage("en-GB;q=0"), null);
    assert.equal(countryFromAcceptLanguage(null), null);
  });

  it("prefers a CDN geo-IP header and ignores its unknown markers", () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    assert.equal(countryFromHeaders(h({ "cf-ipcountry": "in", "accept-language": "de-DE" })), "IN");
    assert.equal(countryFromHeaders(h({ "cf-ipcountry": "XX", "accept-language": "de-DE" })), "DE");
    assert.equal(countryFromHeaders(h({ "cf-ipcountry": "T1" })), null);
    assert.equal(countryFromHeaders(h({ "x-vercel-ip-country": "GB" })), "GB");
  });
});

/* ------------------------------------------------------------------ */
/* Which tax applies                                                    */
/* ------------------------------------------------------------------ */

describe("tax resolution", () => {
  const rules = [DE, GB, IN];

  it("finds the rule of a country by name or code", () => {
    assert.equal(findTaxRule(rules, "Germany")?.id, "tax_de");
    assert.equal(findTaxRule(rules, "gb")?.id, "tax_gb");
    assert.equal(findTaxRule(rules, "France"), null);
    assert.equal(findTaxRule(rules, null), null);
  });

  it("uses the single rate when tax is not charged by country", () => {
    const s = settingsWith({ taxMode: "none", applyTax: true, taxPercentage: 18, taxLabel: "GST" });
    assert.deepEqual(resolveTax(s, { rules, country: "DE" }), { name: "GST", rate: 18, inclusive: false, country: null, ruleId: null });
    assert.equal(resolveTax(settingsWith({ taxMode: "none" }), { rules, country: "DE" }).rate, 0);
  });

  it("applies the buyer's country rule by country", () => {
    const s = settingsWith({ taxMode: "by_country" });
    assert.deepEqual(resolveTax(s, { rules, country: "Germany" }), { name: "VAT", rate: 19, inclusive: true, country: "DE", ruleId: "tax_de" });
    assert.equal(resolveTax(s, { rules, country: "IN" }).name, "GST");
  });

  it("falls back to the single rate (or nothing) for countries without a rule", () => {
    assert.deepEqual(resolveTax(settingsWith({ applyTax: true, taxPercentage: 10, taxLabel: "Sales tax" }), { rules, country: "FR" }), {
      name: "Sales tax",
      rate: 10,
      inclusive: false,
      country: "FR",
      ruleId: null,
    });
    const none = resolveTax(settingsWith(), { rules, country: "FR" });
    assert.equal(none.rate, 0);
    assert.equal(none.country, "FR");
    assert.equal(resolveTax(settingsWith(), null).rate, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Tax maths                                                           */
/* ------------------------------------------------------------------ */

describe("tax computation", () => {
  it("adds exclusive tax on top", () => {
    assert.deepEqual(applyTax(10000, { rate: 18, inclusive: false }), { net: 10000, taxAmount: 1800, total: 11800 });
  });

  it("carves inclusive tax out of the price", () => {
    assert.deepEqual(applyTax(12000, { rate: 20, inclusive: true }), { net: 10000, taxAmount: 2000, total: 12000 });
    assert.deepEqual(applyTax(9000, { rate: 19, inclusive: true }), { net: 7563, taxAmount: 1437, total: 9000 });
  });

  it("rounds half up once, to a cent", () => {
    // 9.99 × 7.5% = 0.74925 → 0.75
    assert.deepEqual(applyTax(999, { rate: 7.5, inclusive: false }), { net: 999, taxAmount: 75, total: 1074 });
    // 10.00 ÷ 1.075 = 9.3023 → 9.30, tax 0.70
    assert.deepEqual(applyTax(1000, { rate: 7.5, inclusive: true }), { net: 930, taxAmount: 70, total: 1000 });
  });

  it("rounds to whole units for zero-decimal currencies", () => {
    // ¥1,234 × 8% = ¥98.72 → ¥99
    assert.deepEqual(applyTax(123400, { rate: 8, inclusive: false }, "JPY"), { net: 123400, taxAmount: 9900, total: 133300 });
    assert.deepEqual(applyTax(110000, { rate: 10, inclusive: true }, "JPY"), { net: 100000, taxAmount: 10000, total: 110000 });
    assert.equal(roundForCurrency(150, "JPY"), 200);
    assert.equal(roundForCurrency(149, "JPY"), 100);
    assert.equal(roundForCurrency(149.5, "USD"), 150);
  });

  it("charges nothing for a zero rate or amount", () => {
    assert.deepEqual(applyTax(5000, { rate: 0, inclusive: false }), { net: 5000, taxAmount: 0, total: 5000 });
    assert.deepEqual(applyTax(0, { rate: 20, inclusive: true }), { net: 0, taxAmount: 0, total: 0 });
    assert.deepEqual(applyTax(-50, { rate: 20, inclusive: false }), { net: 0, taxAmount: 0, total: 0 });
  });

  it("ignores float noise and rounds negatives away from zero", () => {
    // 2.4999999999 is 2.5 with float noise: it rounds up like 2.5.
    assert.equal(roundAmount(2.4999999999), 3);
    assert.equal(roundAmount(2.49), 2);
    assert.equal(roundAmount(2.5), 3);
    assert.equal(roundAmount(0.1 * 3 * 10), 3);
    assert.equal(roundAmount(-2.5), -3);
  });

  it("tells inclusive orders from exclusive ones by their stored amounts", () => {
    assert.equal(isTaxInclusive({ originalAmount: 9000, discountAmount: 0, taxAmount: 1437, amount: 9000 }), true);
    assert.equal(isTaxInclusive({ originalAmount: 10000, discountAmount: 1000, taxAmount: 1800, amount: 10800 }), false);
    assert.equal(isTaxInclusive({ originalAmount: 10000, discountAmount: 0, taxAmount: 0, amount: 10000 }), false);
  });

  it("labels invoice tax lines", () => {
    assert.equal(taxLineLabel({ name: "VAT", rate: 20, inclusive: true }), "VAT (20%, included)");
    assert.equal(taxLineLabel({ name: "GST", rate: 18, inclusive: false }), "GST (18%)");
    assert.equal(taxLineLabel({ name: "Tax", rate: null, inclusive: false }), "Tax");
  });

  it("prices an order: coupon first, then the buyer's tax", () => {
    const course = makeCourse({ id: "crs_t", paidCourse: true, price: 10000, currency: "USD" });
    const item = { type: "course" as const, id: course.id, name: "C", title: "C", description: "", href: "/courses/c", amount: 10000, currency: "USD", course, batch: null };
    const coupon = makeCoupon({ value: 10 });
    const s = settingsWith();
    const gb = computeOrderSummary(item, coupon, s, { rules: [GB, DE], country: "GB" });
    assert.equal(gb.discountAmount, 1000);
    assert.equal(gb.taxAmount, 1800);
    assert.equal(gb.total, 10800);
    assert.equal(gb.taxLabel, "VAT");
    assert.equal(gb.taxCountry, "GB");
    assert.equal(gb.taxInclusive, false);
    const de = computeOrderSummary(item, coupon, s, { rules: [GB, DE], country: "DE" });
    assert.equal(de.total, 9000);
    assert.equal(de.taxAmount, 1437);
    assert.equal(de.taxInclusive, true);
    assert.deepEqual(orderTaxFields(de), { taxCountry: "DE", taxRate: 19 });
    const fr = computeOrderSummary(item, null, s, { rules: [GB, DE], country: "FR" });
    assert.equal(fr.taxAmount, 0);
    assert.deepEqual(orderTaxFields(fr), { taxCountry: "FR" });
  });
});

/* ------------------------------------------------------------------ */
/* Rule form                                                           */
/* ------------------------------------------------------------------ */

describe("tax rule form", () => {
  const free = () => null;

  it("accepts a valid rule and normalises it", () => {
    const res = validateTaxRuleInput({ country: "Germany", name: "  Mehrwert   steuer ", rate: "7,5", inclusive: true }, free);
    assert.deepEqual(res, { ok: true, value: { country: "DE", name: "Mehrwert steuer", rate: 7.5, inclusive: true } });
  });

  it("reports every problem", () => {
    const res = validateTaxRuleInput({ country: "Atlantis", name: "", rate: "abc", inclusive: false }, free);
    assert.ok(!res.ok);
    assert.deepEqual(Object.keys(res.errors).sort(), ["country", "name", "rate"]);
    for (const rate of ["0", "101", "1.2345", "-5"]) {
      const r = validateTaxRuleInput({ country: "DE", name: "VAT", rate, inclusive: false }, free);
      assert.ok(!r.ok && r.errors.rate, `rate ${rate} is refused`);
    }
    const long = validateTaxRuleInput({ country: "DE", name: "x".repeat(41), rate: "19", inclusive: false }, free);
    assert.ok(!long.ok && long.errors.name);
  });

  it("refuses a second rule for the same country", () => {
    const res = validateTaxRuleInput({ country: "DE", name: "VAT", rate: "19", inclusive: true }, (c) => (c === "DE" ? "tax_de" : null));
    assert.ok(!res.ok);
    assert.match(res.errors.country!, /Germany already has a tax rule/);
  });
});

/* ------------------------------------------------------------------ */
/* Currencies                                                          */
/* ------------------------------------------------------------------ */

describe("currency selection", () => {
  const base = { amount: 10000, currency: "usd" };
  const prices = [
    { currency: "EUR", amount: 9000 },
    { currency: "inr", amount: 799900 },
    { currency: "EUR", amount: 1 },
    { currency: "USD", amount: 5 },
    { currency: "us", amount: 100 },
    { currency: "GBP", amount: 0 },
  ];

  it("lists the default price first and skips duplicate, invalid and empty prices", () => {
    assert.deepEqual(priceOptions(base, prices), [
      { currency: "USD", amount: 10000, isDefault: true },
      { currency: "EUR", amount: 9000, isDefault: false },
      { currency: "INR", amount: 799900, isDefault: false },
    ]);
  });

  it("picks the fixed price in the wanted currency, else the default", () => {
    assert.deepEqual(pickPrice(base, prices, "eur", true), { currency: "EUR", amount: 9000, isDefault: false });
    assert.equal(pickPrice(base, prices, "JPY", true).currency, "USD");
    assert.equal(pickPrice(base, prices, null, true).currency, "USD");
    // Multi-currency off: always the default.
    assert.equal(pickPrice(base, prices, "EUR", false).currency, "USD");
  });

  it("offers only the default currency when multi-currency is off", () => {
    assert.deepEqual(selectableCurrencies(base, prices, true), ["USD", "EUR", "INR"]);
    assert.deepEqual(selectableCurrencies(base, prices, false), ["USD"]);
  });

  it("remembers the chosen currency, else guesses one the platform sells in", () => {
    assert.equal(preferredCurrency("gbp", "IN", ["USD", "INR"]), "GBP");
    assert.equal(preferredCurrency(null, "IN", ["USD", "INR"]), "INR");
    assert.equal(preferredCurrency(null, "DE", ["USD", "EUR"]), "EUR");
    assert.equal(preferredCurrency(null, "JP", ["USD", "INR"]), null);
    assert.equal(preferredCurrency("nope", null, ["USD"]), null);
    assert.equal(currencyForCountry("fr"), "EUR");
    assert.equal(normalizeCurrency(" usd "), "USD");
    assert.equal(normalizeCurrency("US"), null);
  });

  it("validates the fixed prices typed by an admin", () => {
    const allowed = ["USD", "EUR", "INR", "JPY"];
    assert.deepEqual(
      validatePriceRows(
        [
          { currency: "EUR", amount: "89.50" },
          { currency: "INR", amount: "" },
          { currency: "JPY", amount: "1500" },
        ],
        "USD",
        allowed,
      ),
      { ok: true, prices: [{ currency: "EUR", amount: 8950 }, { currency: "JPY", amount: 150000 }] },
    );
    const bad = validatePriceRows(
      [
        { currency: "USD", amount: "10" },
        { currency: "EUR", amount: "1.234" },
        { currency: "XYZ", amount: "5" },
        { currency: "INR", amount: "0" },
      ],
      "USD",
      allowed,
    );
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ["price_EUR", "price_INR", "price_USD", "price_XYZ"]);
  });
});

/* ------------------------------------------------------------------ */
/* Checkout: tax and currency on real orders                           */
/* ------------------------------------------------------------------ */

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_py", slug: "python", title: "Python", paidCourse: true, price: 10000, currency: "USD", prices: [{ currency: "EUR", amount: 9000 }] });
const bundle: Bundle = {
  id: "bnd_1",
  slug: "starter",
  title: "Starter",
  description: "",
  courseIds: [course.id],
  price: 15000,
  currency: "USD",
  prices: [{ currency: "INR", amount: 1200000 }],
  published: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const monthly: MembershipPlan = {
  id: "pln_m",
  slug: "monthly",
  name: "Monthly",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 0,
  access: { type: "all" },
  active: true,
  features: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const lifetime: MembershipPlan = { ...monthly, id: "pln_l", slug: "lifetime", name: "Lifetime", interval: "one_time", price: 49900 };

async function setup(opts: { multiCurrency?: boolean; taxMode?: "none" | "by_country"; payments?: Payment[]; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  await resetDb({
    users: [buyer, admin],
    courses: [course],
    bundles: [bundle],
    plans: [monthly, lifetime],
    taxRules: [DE, GB, IN],
    payments: opts.payments ?? [],
    settings: {
      email: { enabled: false },
      gamification: { enabled: false },
      commerce: { paymentGateway: "manual", applyTax: false, taxPercentage: 0, defaultCurrency: "USD" },
      growth: { taxMode: opts.taxMode ?? "by_country", multiCurrency: opts.multiCurrency ?? true, bundlesEnabled: true, subscriptionsEnabled: true },
    },
  });
  resetRequest({ cookies: opts.cookies, headers: opts.headers });
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const billing = (country: string) => ({ billingName: "Bea Buyer", line1: "1 Main Street", city: "Capital", country, source: "Search engine", consent: "on" });

describe("checkout pricing", () => {
  it("prices an item in the viewer's currency when it has a fixed price in it", async () => {
    await setup();
    const listed = (await getBillingItem("course", course.id))!;
    const db = await getDb();
    assert.deepEqual(itemCurrencies(listed, db.settings), ["USD", "EUR"]);
    const eur = priceItemIn(listed, "EUR", db.settings);
    assert.equal(eur.currency, "EUR");
    assert.equal(eur.amount, 9000);
    assert.equal(priceItemIn(listed, "INR", db.settings).currency, "USD");
    const off = buildSettings({ growth: { multiCurrency: false } });
    assert.equal(priceItemIn(listed, "EUR", off).currency, "USD");
    assert.deepEqual(itemCurrencies(listed, off), ["USD"]);
  });

  it("reads the remembered currency and guesses the country from the request", async () => {
    await setup({ cookies: { ll_currency: "eur" }, headers: { "accept-language": "de-DE,de;q=0.9" } });
    assert.equal(await viewerCurrency(), "EUR");
    const db = await getDb();
    assert.equal((await buyerTaxContext(db, null)).country, "DE");
    // An entered billing country wins over the guess.
    assert.equal((await buyerTaxContext(db, "United Kingdom")).country, "GB");
    await setup({ taxMode: "none", headers: { "accept-language": "de-DE" } });
    assert.equal((await buyerTaxContext(await getDb(), null)).country, null);
  });

  it("charges inclusive VAT in the chosen currency and stores the tax facts", async () => {
    await setup();
    await createSession(buyer.id);
    const target = await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, currency: "EUR", expectedTotal: "9000", ...billing("Germany") })));
    assert.match(target, /^\/billing\/success\/ORD-/);
    const order = (await getDb()).payments[0]!;
    assert.equal(order.currency, "EUR");
    assert.equal(order.amount, 9000);
    assert.equal(order.originalAmount, 9000);
    assert.equal(order.taxAmount, 1437);
    assert.equal(order.taxCountry, "DE");
    assert.equal(order.taxRate, 19);
  });

  it("adds exclusive tax for the billing country, computed on the server", async () => {
    await setup();
    await createSession(buyer.id);
    // The browser saw a total without tax: refused, the server's price stands.
    const stale = await placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "10000", ...billing("United Kingdom") }));
    assert.ok(!stale.ok);
    await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "12000", ...billing("United Kingdom") })));
    const order = (await getDb()).payments[0]!;
    assert.equal(order.currency, "USD");
    assert.equal(order.amount, 12000);
    assert.equal(order.taxAmount, 2000);
    assert.equal(order.taxCountry, "GB");
  });

  it("charges no tax for a country without a rule", async () => {
    await setup();
    await createSession(buyer.id);
    await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "10000", ...billing("France") })));
    const order = (await getDb()).payments[0]!;
    assert.equal(order.taxAmount, 0);
    assert.equal(order.taxCountry, "FR");
    assert.equal(order.taxRate, undefined);
  });

  it("refuses a currency the item is no longer sold in", async () => {
    await setup({ multiCurrency: false });
    await createSession(buyer.id);
    const res = await placeOrderAction(null, form({ itemType: "course", itemId: course.id, currency: "EUR", expectedTotal: "9000", ...billing("Germany") }));
    assert.ok(!res.ok);
    assert.match(res.error, /no longer sold in the currency/);
    assert.equal((await getDb()).payments.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Admin read models                                                   */
/* ------------------------------------------------------------------ */

describe("tax report", () => {
  const paid = (over: Partial<Payment>) => makePayment({ userId: buyer.id, itemId: course.id, gateway: "manual", status: "paid", ...over });
  const payments = [
    paid({ id: "p_de", orderId: "ORD-DE", invoiceNumber: "INV-1", currency: "EUR", originalAmount: 9000, amount: 9000, taxAmount: 1437, taxCountry: "DE", taxRate: 19, paidAt: "2026-03-10T10:00:00.000Z", billingName: "Hans" }),
    paid({ id: "p_gb", orderId: "ORD-GB", currency: "USD", originalAmount: 10000, amount: 12000, taxAmount: 2000, taxCountry: "GB", taxRate: 20, paidAt: "2026-04-02T10:00:00.000Z", billingName: "Jo, \"Jr\"" }),
    // Billing address only (an order from before tax by country): still counted for its country.
    paid({ id: "p_gb2", orderId: "ORD-GB2", currency: "USD", originalAmount: 5000, amount: 6000, taxAmount: 1000, address: { line1: "x", city: "London", country: "United Kingdom" }, paidAt: "2026-04-05T10:00:00.000Z" }),
    paid({ id: "p_ref", orderId: "ORD-REF", currency: "USD", originalAmount: 10000, amount: 12000, taxAmount: 2000, taxCountry: "GB", status: "refunded", refundedAmount: 12000, paidAt: "2026-04-03T10:00:00.000Z" }),
    paid({ id: "p_none", orderId: "ORD-NONE", taxAmount: 0, paidAt: "2026-04-03T10:00:00.000Z" }),
    paid({ id: "p_pending", orderId: "ORD-PEND", taxAmount: 500, taxCountry: "GB", status: "pending" }),
  ];
  const db = { payments, taxRules: [DE, GB, IN], settings: buildSettings({ commerce: { taxLabel: "Tax" } }) };

  it("finds the tax country of an order", () => {
    assert.equal(orderTaxCountry({ taxCountry: "de", address: undefined }), "DE");
    assert.equal(orderTaxCountry({ taxCountry: undefined, address: { line1: "", city: "", country: "India" } }), "IN");
    assert.equal(orderTaxCountry({ taxCountry: undefined, address: undefined }), null);
  });

  it("sums what each rule collected per currency", () => {
    const rows = taxRuleRows(db);
    assert.deepEqual(
      rows.map((r) => r.country),
      ["DE", "IN", "GB"],
    );
    const gb = rows.find((r) => r.country === "GB")!;
    assert.equal(gb.orders, 2);
    assert.deepEqual(gb.collected, [{ currency: "USD", amount: 3000 }]);
    assert.equal(rows.find((r) => r.country === "IN")!.orders, 0);
  });

  it("lists taxed sales newest first, with totals per currency", () => {
    const { lines, totals } = taxReport(db, { from: null, to: null, country: null });
    assert.deepEqual(
      lines.map((l) => l.orderId),
      ["ORD-GB2", "ORD-GB", "ORD-DE"],
    );
    const de = lines.find((l) => l.orderId === "ORD-DE")!;
    assert.equal(de.inclusive, true);
    assert.equal(de.net, 7563);
    assert.equal(de.taxName, "VAT");
    assert.deepEqual(totals, [
      { currency: "USD", net: 15000, tax: 3000, total: 18000, orders: 2 },
      { currency: "EUR", net: 7563, tax: 1437, total: 9000, orders: 1 },
    ]);
  });

  it("filters by date range and country", () => {
    const filter = parseTaxReportFilter(new URLSearchParams({ from: "2026-04-01", to: "2026-04-02", country: "United Kingdom" }));
    assert.deepEqual(filter, { from: "2026-04-01", to: "2026-04-02", country: "GB" });
    assert.deepEqual(
      taxReport(db, filter).lines.map((l) => l.orderId),
      ["ORD-GB"],
    );
    assert.deepEqual(parseTaxReportFilter({ from: "2026-13-45", to: "yesterday", country: "Atlantis" }), { from: null, to: null, country: null });
  });

  it("exports the report as CSV", () => {
    const csv = taxReportToCsv(taxReport(db, { from: null, to: null, country: "GB" }).lines).split("\n");
    assert.equal(csv[0], "Paid at,Invoice,Order,Billing name,Country,Tax,Rate %,Included in price,Net,Tax amount,Total,Currency,Refunded,Buyer VAT No.,Reverse charge,VAT No. verified (VIES)");
    assert.equal(csv.length, 3);
    // No buyer VAT number and no reverse charge on these sales: the VAT cells are empty, "no" and empty.
    assert.ok(csv.some((l) => l.includes('"Jo, ""Jr"""') && l.endsWith(",VAT,20,no,100.00,20.00,120.00,USD,no,,no,")));
  });

  it("lists the items that can carry fixed prices", () => {
    const listing = pricedItems({ courses: [course, makeCourse({ id: "crs_free", paidCourse: false, price: 0 })], bundles: [bundle], plans: [monthly, lifetime] }, { type: "all", search: null, page: 1 });
    assert.deepEqual(
      listing.rows.map((r) => `${r.type}:${r.id}`),
      ["bundle:bnd_1", "course:crs_py", "plan:pln_l"],
    );
    assert.deepEqual(listing.rows.find((r) => r.id === "crs_py")!.prices, { EUR: 9000 });
    assert.equal(pricedItems({ courses: [course], bundles: [bundle], plans: [lifetime] }, { type: "course", search: null, page: 1 }).total, 1);
    assert.equal(pricedItems({ courses: [course], bundles: [bundle], plans: [lifetime] }, { type: "all", search: "start", page: 1 }).rows[0]!.id, "bnd_1");
  });

  it("sells in the default currency first, then the supported ones", () => {
    const list = saleCurrencies(buildSettings({ commerce: { defaultCurrency: "INR" } }));
    assert.equal(list[0], "INR");
    assert.equal(new Set(list).size, list.length);
    assert.ok(list.includes("USD"));
  });
});

/* ------------------------------------------------------------------ */
/* Admin actions                                                       */
/* ------------------------------------------------------------------ */

describe("tax and currency actions", () => {
  it("are for administrators only", async () => {
    await setup();
    await createSession(buyer.id);
    assert.ok(!(await saveTaxRuleAction(null, form({ country: "FR", name: "TVA", rate: "20" }))).ok);
    assert.ok(!(await deleteTaxRulesAction(["tax_de"])).ok);
    assert.ok(!(await saveTaxSettingsAction(null, form({ taxMode: "none" }))).ok);
    assert.ok(!(await saveCurrencyPricesAction(null, form({ itemType: "course", itemId: course.id, price_EUR: "1" }))).ok);
    assert.equal((await getDb()).taxRules.length, 3);
  });

  it("adds, edits and deletes tax rules, one per country", async () => {
    await setup();
    await createSession(admin.id);
    const added = await saveTaxRuleAction(null, form({ country: "FR", name: "TVA", rate: "20", inclusive: "on" }));
    assert.ok(added.ok);
    const id = added.data.id;
    assert.deepEqual(
      (await getDb()).taxRules.find((r) => r.id === id),
      { id, country: "FR", name: "TVA", rate: 20, inclusive: true },
    );
    const dup = await saveTaxRuleAction(null, form({ country: "France", name: "TVA", rate: "5.5" }));
    assert.ok(!dup.ok && dup.fieldErrors?.country);
    const edited = await saveTaxRuleAction(null, form({ id, country: "FR", name: "TVA", rate: "5.5" }));
    assert.ok(edited.ok);
    assert.equal((await getDb()).taxRules.find((r) => r.id === id)!.rate, 5.5);
    const gone = await deleteTaxRulesAction([id, "tax_de"]);
    assert.ok(gone.ok && gone.data.deleted === 2);
    assert.deepEqual(
      (await getDb()).taxRules.map((r) => r.country).sort(),
      ["GB", "IN"],
    );
    assert.ok(!(await deleteTaxRulesAction([])).ok);
  });

  it("switches the tax mode and multi-currency", async () => {
    await setup({ taxMode: "none", multiCurrency: false });
    await createSession(admin.id);
    assert.ok((await saveTaxSettingsAction(null, form({ taxMode: "by_country", multiCurrency: "on" }))).ok);
    const growth = (await getDb()).settings.growth;
    assert.equal(growth.taxMode, "by_country");
    assert.equal(growth.multiCurrency, true);
    await saveTaxSettingsAction(null, form({ taxMode: "anything" }));
    assert.equal((await getDb()).settings.growth.taxMode, "none");
  });

  it("saves and clears the fixed prices of an item", async () => {
    await setup();
    await createSession(admin.id);
    const saved = await saveCurrencyPricesAction(null, form({ itemType: "bundle", itemId: bundle.id, price_EUR: "129.99", price_INR: "" }));
    assert.ok(saved.ok);
    assert.deepEqual((await getDb()).bundles[0]!.prices, [{ currency: "EUR", amount: 12999 }]);
    const own = await saveCurrencyPricesAction(null, form({ itemType: "bundle", itemId: bundle.id, price_USD: "100" }));
    assert.ok(!own.ok && own.fieldErrors?.price_USD);
    assert.ok((await saveCurrencyPricesAction(null, form({ itemType: "bundle", itemId: bundle.id }))).ok);
    assert.equal((await getDb()).bundles[0]!.prices, undefined);
    assert.ok(!(await saveCurrencyPricesAction(null, form({ itemType: "batch", itemId: "x" }))).ok);
    assert.ok(!(await saveCurrencyPricesAction(null, form({ itemType: "course", itemId: "missing" }))).ok);
  });

  it("remembers the buyer's currency in a cookie", async () => {
    await setup();
    assert.ok((await setCurrencyAction("eur")).ok);
    assert.equal(requestCookie("ll_currency"), "EUR");
    assert.ok(!(await setCurrencyAction("XYZ")).ok);
    assert.ok(!(await setCurrencyAction(42 as unknown as string)).ok);
    assert.equal(requestCookie("ll_currency"), "EUR");
  });
});
