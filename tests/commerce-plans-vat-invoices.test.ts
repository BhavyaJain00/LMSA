import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Database, Payment, Settings, TaxRule } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import {
  EU_COUNTRIES,
  countryVatPrefix,
  exampleVatId,
  isEuCountry,
  isPlausibleTaxId,
  isValidEuVatId,
  normalizeVatId,
  parseEuVatId,
  vatPrefixCountry,
} from "@/lib/commerce/vat-id";
import { priceForTax, resolveTax, reverseChargeApplies, sellerTaxCountry } from "@/lib/commerce/tax";
import { addressLines, defaultTaxIdLabel, invoiceSeller, validateSellerDetails } from "@/lib/commerce/invoice-seller";
import { validateVatId } from "@/lib/payments/billing-input";
import { assignInvoiceNumber, buildInvoiceView } from "@/lib/payments/invoice";
import { computeOrderSummary, getBillingItem, orderTaxFields } from "@/lib/data/commerce";
import { placeOrderAction } from "@/lib/actions/payments";
import { saveSellerDetailsAction } from "@/lib/actions/taxes";
import { buildSettings, makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Tax-compliant invoices: EU VAT number format checks, the reverse-charge
 * rule (by-country tax, a valid VAT number of another EU country than the
 * seller's), the seller block printed on invoices (legal name, registered
 * address, registration numbers, Settings → Legal fallbacks), the buyer's
 * tax number on the invoice, and checkout orders that store all of it.
 */

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

const DE: TaxRule = { id: "tax_de", country: "DE", name: "VAT", rate: 19, inclusive: true };
const AT: TaxRule = { id: "tax_at", country: "AT", name: "USt", rate: 20, inclusive: false };
const GB: TaxRule = { id: "tax_gb", country: "GB", name: "VAT", rate: 20, inclusive: false, registrationNumber: "GB123456789", registrationLabel: "UK VAT No." };
const IN: TaxRule = { id: "tax_in", country: "IN", name: "GST", rate: 18, inclusive: false, registrationNumber: "27AAPFU0939F1ZV" };

/* ------------------------------------------------------------------ */
/* VAT number formats                                                  */
/* ------------------------------------------------------------------ */

describe("EU VAT number format", () => {
  it("normalizes the way people type tax numbers", () => {
    assert.equal(normalizeVatId(" de 123.456-789 "), "DE123456789");
    assert.equal(normalizeVatId("nl123456789b01"), "NL123456789B01");
    assert.equal(normalizeVatId("FR/XX_123,456,789"), "FRXX123456789");
    assert.equal(normalizeVatId(null), "");
    assert.equal(normalizeVatId(undefined), "");
    assert.equal(normalizeVatId("x".repeat(60)).length, 40);
  });

  it("accepts a well-formed number of every member state", () => {
    assert.equal(EU_COUNTRIES.size, 27);
    for (const country of EU_COUNTRIES) {
      const check = parseEuVatId(exampleVatId(country));
      assert.ok(check.ok, `example of ${country} should be valid`);
      assert.equal(check.country, country);
    }
  });

  it("checks the national part of the number", () => {
    assert.ok(isValidEuVatId("ATU12345678"));
    assert.ok(!isValidEuVatId("AT12345678"));
    assert.ok(isValidEuVatId("BE0123456789"));
    assert.ok(!isValidEuVatId("BE2123456789"));
    assert.ok(isValidEuVatId("NL123456789B01"));
    assert.ok(!isValidEuVatId("NL123456789"));
    assert.ok(isValidEuVatId("SE123456789001"));
    assert.ok(!isValidEuVatId("SE123456789012"));
    assert.ok(isValidEuVatId("ESX1234567R"));
    assert.ok(isValidEuVatId("ES12345678Z"));
    assert.ok(isValidEuVatId("IE1234567FA"));
    assert.ok(isValidEuVatId("IE1A23456B"));
    assert.ok(!isValidEuVatId("IE12345678"));
    // France: two key characters (letters other than I and O, or digits), then the 9-digit SIREN.
    assert.ok(isValidEuVatId("FR40303265045"));
    assert.ok(!isValidEuVatId("FRIO123456789"));
  });

  it("says why a number is refused", () => {
    assert.deepEqual(parseEuVatId(""), { ok: false, reason: "empty" });
    assert.deepEqual(parseEuVatId("   "), { ok: false, reason: "empty" });
    assert.deepEqual(parseEuVatId("US123456789"), { ok: false, reason: "prefix" });
    assert.deepEqual(parseEuVatId("123456789"), { ok: false, reason: "prefix" });
    assert.deepEqual(parseEuVatId("DE12345678"), { ok: false, reason: "format", country: "DE" });
    assert.deepEqual(parseEuVatId("de 123 456 789"), { ok: true, value: "DE123456789", country: "DE", prefix: "DE" });
  });

  it("writes Greek numbers with the EL prefix", () => {
    assert.deepEqual(parseEuVatId("EL123456789"), { ok: true, value: "EL123456789", country: "GR", prefix: "EL" });
    assert.equal(parseEuVatId("GR123456789").ok, false);
    assert.equal(vatPrefixCountry("EL"), "GR");
    assert.equal(vatPrefixCountry("GR"), null);
    assert.equal(vatPrefixCountry("de"), "DE");
    assert.equal(vatPrefixCountry("GB"), null);
    assert.equal(countryVatPrefix("GR"), "EL");
    assert.equal(countryVatPrefix("fr"), "FR");
    assert.equal(countryVatPrefix("US"), null);
  });

  it("knows the member states and plausible non-EU tax numbers", () => {
    assert.ok(isEuCountry("de"));
    assert.ok(isEuCountry("GR"));
    assert.ok(!isEuCountry("GB"));
    assert.ok(!isEuCountry("CH"));
    assert.ok(!isEuCountry(null));
    assert.ok(!isEuCountry(""));
    assert.ok(isPlausibleTaxId("GB123456789"));
    assert.ok(isPlausibleTaxId("CHE123456789MWST"));
    assert.ok(!isPlausibleTaxId("123"));
    assert.ok(!isPlausibleTaxId("AB-123456"));
    assert.equal(exampleVatId("NL"), "NL123456789B01");
    assert.equal(exampleVatId("US"), "DE123456789");
    assert.equal(exampleVatId(null), "DE123456789");
  });
});

describe("billing form VAT number", () => {
  it("is optional", () => {
    assert.equal(validateVatId("", "Germany"), null);
    assert.equal(validateVatId("   ", "United States"), null);
  });

  it("must be a well-formed number of an EU billing country", () => {
    assert.equal(validateVatId("DE123456789", "Germany"), null);
    assert.equal(validateVatId("el 123 456 789", "Greece"), null);
    assert.match(validateVatId("FR40303265045", "Germany")!, /registered in France.*Germany, your billing country/);
    assert.match(validateVatId("123456789", "Germany")!, /country prefix, e\.g\. DE123456789/);
    assert.match(validateVatId("DE1234", "Germany")!, /doesn't look like a valid Germany VAT number/);
    assert.match(validateVatId("ATU1234", "Germany")!, /valid Austria VAT number, e\.g\. ATU12345678/);
  });

  it("accepts other countries' tax numbers when they look plausible", () => {
    assert.equal(validateVatId("GB123456789", "United Kingdom"), null);
    assert.equal(validateVatId("CHE-123.456.789 MWST", "Switzerland"), null);
    // An EU-looking number elsewhere must still be well formed.
    assert.match(validateVatId("DE12", "United States")!, /valid Germany VAT number/);
    assert.match(validateVatId("#1", "United States")!, /4 to 20 letters and digits/);
  });
});

/* ------------------------------------------------------------------ */
/* Reverse charge                                                      */
/* ------------------------------------------------------------------ */

describe("EU reverse charge rule", () => {
  const base = { taxMode: "by_country" as const, sellerCountry: "FR", buyerCountry: "DE", vatId: "DE123456789" };

  it("applies to a valid VAT number of another EU country than the seller's", () => {
    assert.ok(reverseChargeApplies(base));
    assert.ok(reverseChargeApplies({ ...base, buyerCountry: "Germany", vatId: "de 123 456 789" }));
    assert.ok(reverseChargeApplies({ ...base, buyerCountry: "Greece", vatId: "EL123456789" }));
    assert.ok(reverseChargeApplies({ ...base, sellerCountry: "Ireland", buyerCountry: "Netherlands", vatId: "NL123456789B01" }));
  });

  it("needs tax by country", () => {
    assert.ok(!reverseChargeApplies({ ...base, taxMode: "none" }));
  });

  it("does not apply inside the seller's own country", () => {
    assert.ok(!reverseChargeApplies({ ...base, buyerCountry: "FR", vatId: "FR40303265045" }));
  });

  it("needs both parties in the EU", () => {
    assert.ok(!reverseChargeApplies({ ...base, sellerCountry: "US" }));
    assert.ok(!reverseChargeApplies({ ...base, sellerCountry: "GB" }));
    assert.ok(!reverseChargeApplies({ ...base, buyerCountry: "GB", vatId: "GB123456789" }));
    assert.ok(!reverseChargeApplies({ ...base, sellerCountry: null }));
    assert.ok(!reverseChargeApplies({ ...base, buyerCountry: undefined }));
  });

  it("needs a well-formed number of the buyer's billing country", () => {
    assert.ok(!reverseChargeApplies({ ...base, vatId: "" }));
    assert.ok(!reverseChargeApplies({ ...base, vatId: null }));
    assert.ok(!reverseChargeApplies({ ...base, vatId: "DE12345" }));
    assert.ok(!reverseChargeApplies({ ...base, vatId: "123456789" }));
    // A valid Austrian number does not make a German billing address a reverse-charge sale.
    assert.ok(!reverseChargeApplies({ ...base, vatId: "ATU12345678" }));
  });

  it("finds the seller's country from the settings or its VAT number", () => {
    assert.equal(sellerTaxCountry({ sellerCountry: "France" }), "FR");
    assert.equal(sellerTaxCountry({ sellerCountry: "IE", sellerTaxId: "DE123456789" }), "IE");
    assert.equal(sellerTaxCountry({ sellerTaxId: "EL123456789" }), "GR");
    assert.equal(sellerTaxCountry({ sellerTaxId: "GB123456789" }), null);
    assert.equal(sellerTaxCountry({}), null);
  });
});

describe("tax with reverse charge", () => {
  const settings = (growth: Partial<Settings["growth"]> = {}): Settings =>
    buildSettings({
      commerce: { applyTax: true, taxPercentage: 10, taxLabel: "Tax" },
      growth: { taxMode: "by_country", sellerCountry: "FR", ...growth },
    });
  const rules = [DE, AT, GB];

  it("charges 0% VAT on a valid business VAT number of another EU country", () => {
    assert.deepEqual(resolveTax(settings(), { rules, country: "Germany", vatId: "DE123456789" }), {
      name: "VAT",
      rate: 0,
      inclusive: false,
      country: "DE",
      ruleId: "tax_de",
      reverseCharge: true,
      includedRate: 19,
    });
    assert.deepEqual(resolveTax(settings(), { rules, country: "AT", vatId: "ATU12345678" }), {
      name: "USt",
      rate: 0,
      inclusive: false,
      country: "AT",
      ruleId: "tax_at",
      reverseCharge: true,
    });
  });

  it("reverse-charges an EU country without a rule as VAT", () => {
    const applied = resolveTax(settings(), { rules, country: "Italy", vatId: "IT12345678901" });
    assert.equal(applied.reverseCharge, true);
    assert.equal(applied.name, "VAT");
    assert.equal(applied.rate, 0);
    assert.equal(applied.ruleId, null);
  });

  it("charges the country's tax otherwise", () => {
    assert.deepEqual(resolveTax(settings(), { rules, country: "DE" }), { name: "VAT", rate: 19, inclusive: true, country: "DE", ruleId: "tax_de" });
    assert.equal(resolveTax(settings(), { rules, country: "DE", vatId: "DE123" }).rate, 19);
    assert.equal(resolveTax(settings(), { rules, country: "DE", vatId: "ATU12345678" }).rate, 19);
    // Without a seller country nothing tells us the sale crosses a border.
    assert.equal(resolveTax(settings({ sellerCountry: undefined }), { rules, country: "DE", vatId: "DE123456789" }).rate, 19);
    // A seller established in Germany charges German VAT to German businesses.
    assert.equal(resolveTax(settings({ sellerCountry: "DE" }), { rules, country: "DE", vatId: "DE123456789" }).rate, 19);
    // The UK left the EU: its VAT applies to UK businesses.
    assert.equal(resolveTax(settings(), { rules, country: "GB", vatId: "GB123456789" }).rate, 20);
  });

  it("never reverse-charges under a single tax rate", () => {
    const applied = resolveTax(settings({ taxMode: "none" }), { rules, country: "DE", vatId: "DE123456789" });
    assert.equal(applied.reverseCharge, undefined);
    assert.equal(applied.rate, 10);
  });

  it("removes the included VAT from tax-inclusive prices", () => {
    assert.equal(priceForTax(11900, { reverseCharge: true, includedRate: 19 }), 10000);
    assert.equal(priceForTax(10000, { reverseCharge: true, includedRate: 19 }), 8403);
    // Whole yen for zero-decimal currencies.
    assert.equal(priceForTax(1000000, { reverseCharge: true, includedRate: 19 }, "JPY"), 840300);
    assert.equal(priceForTax(11900, { reverseCharge: true }), 11900);
    assert.equal(priceForTax(11900, { includedRate: 19 }), 11900);
    assert.equal(priceForTax(0, { reverseCharge: true, includedRate: 19 }), 0);
  });

  it("records the 0% rate and the reverse charge on the order", () => {
    assert.deepEqual(orderTaxFields({ taxAmount: 0, taxPercentage: 0, taxCountry: "DE", reverseCharge: true }), { taxCountry: "DE", taxRate: 0, reverseCharge: true });
    assert.deepEqual(orderTaxFields({ taxAmount: 1900, taxPercentage: 19, taxCountry: "DE", reverseCharge: false }), { taxCountry: "DE", taxRate: 19 });
    assert.deepEqual(orderTaxFields({ taxAmount: 0, taxPercentage: 0, taxCountry: "FR" }), { taxCountry: "FR" });
  });
});

/* ------------------------------------------------------------------ */
/* Seller details                                                      */
/* ------------------------------------------------------------------ */

describe("invoice seller details", () => {
  const sellerSettings = (growth: Partial<Settings["growth"]> = {}, legal: Partial<Settings["legal"]> = {}) =>
    buildSettings({
      brand: { name: "LearnLoop" },
      legal: { companyName: "LearnLoop Ltd", companyAddress: "12 Harbour Road\nDublin 2\nIreland", ...legal },
      growth: { taxMode: "by_country", ...growth },
    });

  it("splits an address into tidy lines", () => {
    assert.deepEqual(addressLines("  1 Main   Street \r\n\n Springfield \n"), ["1 Main Street", "Springfield"]);
    assert.deepEqual(addressLines("a\nb\nc\nd\ne\nf\ng"), ["a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(addressLines(undefined), []);
  });

  it("labels a tax number from its shape and country", () => {
    assert.equal(defaultTaxIdLabel("DE123456789", null), "VAT No.");
    assert.equal(defaultTaxIdLabel("27AAPFU0939F1ZV", null), "GSTIN");
    assert.equal(defaultTaxIdLabel("12345678901", "AU"), "ABN");
    assert.equal(defaultTaxIdLabel("123456789", "GB"), "VAT No.");
    assert.equal(defaultTaxIdLabel("123456789", "CA"), "GST/HST No.");
    assert.equal(defaultTaxIdLabel("123456789", "NZ"), "GST No.");
    assert.equal(defaultTaxIdLabel("1234567", "DE"), "VAT No.");
    assert.equal(defaultTaxIdLabel("12-3456789", "US"), "Tax ID");
    assert.equal(defaultTaxIdLabel("12-3456789", null), "Tax ID");
  });

  it("falls back to the legal company name and address, then the brand", () => {
    const seller = invoiceSeller(sellerSettings(), [], "DE");
    assert.deepEqual(seller, { legalName: "LearnLoop Ltd", addressLines: ["12 Harbour Road", "Dublin 2", "Ireland"], countryName: undefined, taxIds: [] });
    const bare = invoiceSeller(sellerSettings({}, { companyName: "", companyAddress: undefined }), [], null);
    assert.equal(bare.legalName, "LearnLoop");
    assert.deepEqual(bare.addressLines, []);
  });

  it("prints the seller's legal entity, address, country and registration numbers", () => {
    const settings = sellerSettings({
      sellerLegalName: "LearnLoop Europe SAS",
      sellerAddress: "8 Rue de la Paix\n75002 Paris",
      sellerCountry: "FR",
      sellerTaxId: "FR40303265045",
    });
    const seller = invoiceSeller(settings, [DE, GB, IN], "DE");
    assert.deepEqual(seller, {
      legalName: "LearnLoop Europe SAS",
      addressLines: ["8 Rue de la Paix", "75002 Paris"],
      countryName: "France",
      taxIds: [{ label: "VAT No.", value: "FR40303265045" }],
    });
    // Sold to the UK: the UK registration is printed too, with its own label.
    assert.deepEqual(invoiceSeller(settings, [DE, GB, IN], "GB").taxIds, [
      { label: "VAT No.", value: "FR40303265045" },
      { label: "UK VAT No.", value: "GB123456789" },
    ]);
    // Without a label, one is made from the country and the tax name.
    assert.deepEqual(invoiceSeller(settings, [DE, GB, IN], "India").taxIds[1], { label: "India GST No.", value: "27AAPFU0939F1ZV" });
    // A custom label for the main number; the country is not repeated when the address names it.
    const custom = invoiceSeller(sellerSettings({ sellerAddress: "8 Rue de la Paix\nParis, France", sellerCountry: "FR", sellerTaxId: "FR40303265045", sellerTaxIdLabel: "N° TVA" }), [], null);
    assert.equal(custom.countryName, undefined);
    assert.deepEqual(custom.taxIds, [{ label: "N° TVA", value: "FR40303265045" }]);
  });

  it("validates the seller details form", () => {
    const empty = validateSellerDetails({ legalName: " ", address: "\n", country: "", taxId: "", taxIdLabel: "" });
    assert.deepEqual(empty, { ok: true, value: { sellerLegalName: undefined, sellerAddress: undefined, sellerCountry: undefined, sellerTaxId: undefined, sellerTaxIdLabel: undefined } });

    const ok = validateSellerDetails({ legalName: " LearnLoop   Europe SAS ", address: " 8 Rue de la Paix \n\n75002 Paris", country: "France", taxId: "fr 40 303 265 045", taxIdLabel: "" });
    assert.deepEqual(ok, {
      ok: true,
      value: { sellerLegalName: "LearnLoop Europe SAS", sellerAddress: "8 Rue de la Paix\n75002 Paris", sellerCountry: "FR", sellerTaxId: "FR40303265045", sellerTaxIdLabel: undefined },
    });

    const india = validateSellerDetails({ legalName: "", address: "", country: "IN", taxId: "27AAPFU0939F1ZV", taxIdLabel: "GSTIN" });
    assert.ok(india.ok && india.value.sellerTaxIdLabel === "GSTIN" && india.value.sellerCountry === "IN");

    const wrongCountry = validateSellerDetails({ legalName: "", address: "", country: "FR", taxId: "DE123456789", taxIdLabel: "" });
    assert.ok(!wrongCountry.ok && /belongs to Germany, not France/.test(wrongCountry.errors.taxId!));
    const noPrefix = validateSellerDetails({ legalName: "", address: "", country: "DE", taxId: "123456789", taxIdLabel: "" });
    assert.ok(!noPrefix.ok && /country prefix/.test(noPrefix.errors.taxId!));
    const malformed = validateSellerDetails({ legalName: "", address: "", country: "", taxId: "DE12", taxIdLabel: "" });
    assert.ok(!malformed.ok && /valid Germany VAT number/.test(malformed.errors.taxId!));

    const bad = validateSellerDetails({ legalName: "x".repeat(141), address: "1\n2\n3\n4\n5\n6\n7", country: "Narnia", taxId: "", taxIdLabel: "VAT No." });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ["address", "country", "legalName", "taxId"]);
  });
});

/* ------------------------------------------------------------------ */
/* Invoice view                                                        */
/* ------------------------------------------------------------------ */

describe("invoice view", () => {
  const settings = buildSettings({
    brand: { name: "LearnLoop" },
    legal: { companyName: "LearnLoop Ltd", companyAddress: "12 Harbour Road\nDublin 2" },
    commerce: { taxLabel: "Tax", taxPercentage: 0, applyTax: false },
    growth: { taxMode: "by_country", sellerLegalName: "LearnLoop Europe SAS", sellerAddress: "8 Rue de la Paix\n75002 Paris", sellerCountry: "FR", sellerTaxId: "FR40303265045" },
  });
  const paid = (overrides: Partial<Payment>): Payment =>
    makePayment({ userId: "usr_b", itemId: "crs_1", status: "paid", paidAt: "2026-03-04T10:00:00.000Z", invoiceNumber: "INV-2026-00001", billingName: "Bea GmbH", ...overrides });
  const view = (p: Payment, rules: TaxRule[] = [DE, AT, GB]) => buildInvoiceView(p, { settings, buyer: { email: "bea@example.com" }, gatewayLabel: "Stripe", taxRules: rules })!;

  it("shows the seller's legal name, address and tax number", () => {
    const v = view(paid({}));
    assert.equal(v.seller.name, "LearnLoop");
    assert.equal(v.seller.legalName, "LearnLoop Europe SAS");
    assert.deepEqual(v.seller.addressLines, ["8 Rue de la Paix", "75002 Paris"]);
    assert.equal(v.seller.countryName, "France");
    assert.deepEqual(v.seller.taxIds, [{ label: "VAT No.", value: "FR40303265045" }]);
  });

  it("shows the buyer's tax number", () => {
    const vat = view(paid({ buyerVatId: "de 123456789", address: { line1: "Hauptstr. 1", city: "Berlin", country: "Germany" } }));
    assert.equal(vat.buyer.taxId, "DE123456789");
    assert.equal(vat.buyer.taxIdKind, "vat");
    assert.deepEqual(vat.buyer.addressLines, ["Hauptstr. 1", "Berlin", "Germany"]);
    const other = view(paid({ buyerVatId: "CHE123456789MWST" }));
    assert.equal(other.buyer.taxIdKind, "other");
    const none = view(paid({}));
    assert.equal(none.buyer.taxId, undefined);
    assert.equal(none.buyer.taxIdKind, undefined);
  });

  it("shows the tax name, rate and amount of an exclusive tax", () => {
    const v = view(paid({ originalAmount: 10000, taxAmount: 2000, amount: 12000, taxCountry: "GB", taxRate: 20 }));
    assert.equal(v.taxLabel, "VAT");
    assert.equal(v.taxRate, 20);
    assert.equal(v.taxAmount, 2000);
    assert.equal(v.taxableAmount, 10000);
    assert.equal(v.taxInclusive, false);
    assert.equal(v.taxCountryName, "United Kingdom");
    assert.equal(v.total, 12000);
    assert.equal(v.reverseCharge, false);
  });

  it("shows the tax included in the price", () => {
    const v = view(paid({ originalAmount: 11900, taxAmount: 1900, amount: 11900, taxCountry: "DE", taxRate: 19 }));
    assert.equal(v.taxInclusive, true);
    assert.equal(v.taxableAmount, 10000);
    assert.equal(v.taxRate, 19);
    assert.equal(v.taxCountryName, "Germany");
  });

  it("marks reverse-charge sales with a 0% VAT line", () => {
    const v = view(paid({ originalAmount: 10000, taxAmount: 0, amount: 10000, taxCountry: "DE", taxRate: 0, reverseCharge: true, buyerVatId: "DE123456789" }));
    assert.equal(v.reverseCharge, true);
    assert.equal(v.taxLabel, "VAT");
    assert.equal(v.taxRate, 0);
    assert.equal(v.taxAmount, 0);
    assert.equal(v.taxableAmount, 10000);
    assert.equal(v.buyer.taxId, "DE123456789");
    // Without a rule for the country, an EU sale is still called VAT.
    const noRule = view(paid({ taxAmount: 0, taxCountry: "IT", taxRate: 0, reverseCharge: true, buyerVatId: "IT12345678901" }), []);
    assert.equal(noRule.taxLabel, "VAT");
    // A stored reverse charge with tax actually charged is not printed as one.
    assert.equal(view(paid({ originalAmount: 10000, taxAmount: 1900, amount: 11900, taxCountry: "DE", reverseCharge: true })).reverseCharge, false);
  });

  it("keeps the seller details the invoice was issued with", () => {
    const p = makePayment({ userId: "usr_b", itemId: "crs_1", status: "paid", paidAt: "2026-05-01T00:00:00.000Z", amount: 12000, originalAmount: 10000, taxAmount: 2000, taxCountry: "GB", taxRate: 20 });
    const db = { payments: [p], settings, taxRules: [GB] } as unknown as Database;
    assert.equal(assignInvoiceNumber(db, p), "INV-2026-00001");
    assert.deepEqual(p.invoiceSeller, {
      legalName: "LearnLoop Europe SAS",
      addressLines: ["8 Rue de la Paix", "75002 Paris"],
      countryName: "France",
      taxIds: [
        { label: "VAT No.", value: "FR40303265045" },
        { label: "UK VAT No.", value: "GB123456789" },
      ],
    });
    // The company moves later: the issued invoice does not change.
    const moved = buildSettings({ ...settings, growth: { ...settings.growth, sellerLegalName: "LearnLoop BV", sellerAddress: "Damrak 1\nAmsterdam", sellerCountry: "NL", sellerTaxId: "NL123456789B01" } });
    const v = buildInvoiceView(p, { settings: moved, buyer: null, gatewayLabel: "Stripe", taxRules: [GB] })!;
    assert.equal(v.seller.legalName, "LearnLoop Europe SAS");
    assert.equal(v.seller.taxIds[0]!.value, "FR40303265045");
    // A second assignment keeps the number and the details.
    assert.equal(assignInvoiceNumber({ ...db, settings: moved } as Database, p), "INV-2026-00001");
    assert.equal(p.invoiceSeller!.legalName, "LearnLoop Europe SAS");
  });
});

/* ------------------------------------------------------------------ */
/* Checkout orders and the admin action                                */
/* ------------------------------------------------------------------ */

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_vat", slug: "vat-course", title: "VAT course", paidCourse: true, price: 11900, currency: "EUR" });

async function setup(growth: Partial<Settings["growth"]> = { sellerCountry: "FR", sellerTaxId: "FR40303265045" }) {
  await resetDb({
    users: [buyer, admin],
    courses: [course],
    taxRules: [DE, AT, GB],
    settings: {
      email: { enabled: false },
      gamification: { enabled: false },
      commerce: { paymentGateway: "manual", applyTax: false, taxPercentage: 0, defaultCurrency: "EUR" },
      growth: { taxMode: "by_country", multiCurrency: false, ...growth },
    },
  });
  resetRequest();
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
};
const billing = (country: string, vatId = "") => ({ billingName: "Bea GmbH", line1: "Hauptstr. 1", city: "Capital", country, source: "Search engine", consent: "on", vatId });

describe("checkout with a VAT number", () => {
  it("prices a reverse-charge order without the VAT the price included", async () => {
    await setup();
    const item = (await getBillingItem("course", course.id))!;
    const db = await getDb();
    const summary = computeOrderSummary(item, null, db.settings, { rules: db.taxRules, country: "DE", vatId: "DE123456789" });
    assert.equal(summary.reverseCharge, true);
    assert.equal(summary.originalAmount, 10000);
    assert.equal(summary.taxAmount, 0);
    assert.equal(summary.total, 10000);
    assert.equal(summary.taxCountry, "DE");
    const consumer = computeOrderSummary(item, null, db.settings, { rules: db.taxRules, country: "DE" });
    assert.equal(consumer.reverseCharge, false);
    assert.equal(consumer.total, 11900);
    assert.equal(consumer.taxAmount, 1900);
  });

  it("stores the VAT number and the reverse charge on the order", async () => {
    await setup();
    await createSession(buyer.id);
    const target = await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "10000", ...billing("Germany", "de 123 456 789") })));
    assert.match(target, /^\/billing\/success\/ORD-/);
    const order = (await getDb()).payments[0]!;
    assert.equal(order.buyerVatId, "DE123456789");
    assert.equal(order.reverseCharge, true);
    assert.equal(order.taxRate, 0);
    assert.equal(order.taxCountry, "DE");
    assert.equal(order.taxAmount, 0);
    assert.equal(order.amount, 10000);
    assert.equal(order.originalAmount, 10000);
  });

  it("reverse-charges an exclusive tax by not adding it", async () => {
    await setup();
    await createSession(buyer.id);
    await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "11900", ...billing("Austria", "ATU12345678") })));
    const order = (await getDb()).payments[0]!;
    assert.equal(order.reverseCharge, true);
    assert.equal(order.amount, 11900);
    assert.equal(order.taxAmount, 0);
    assert.equal(order.taxCountry, "AT");
  });

  it("charges VAT to consumers and to businesses in the seller's country", async () => {
    await setup({ sellerCountry: "DE" });
    await createSession(buyer.id);
    await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "11900", ...billing("Germany", "DE123456789") })));
    const order = (await getDb()).payments[0]!;
    assert.equal(order.reverseCharge, undefined);
    assert.equal(order.taxAmount, 1900);
    assert.equal(order.taxRate, 19);
    // Still printed on the invoice.
    assert.equal(order.buyerVatId, "DE123456789");
  });

  it("refuses a VAT number that does not match the billing country", async () => {
    await setup();
    await createSession(buyer.id);
    const result = await placeOrderAction(null, form({ itemType: "course", itemId: course.id, expectedTotal: "10000", ...billing("Germany", "ATU12345678") }));
    assert.ok(!result.ok);
    assert.match(result.fieldErrors?.vatId ?? "", /registered in Austria/);
    assert.equal((await getDb()).payments.length, 0);
  });
});

describe("seller details action", () => {
  it("is for administrators only", async () => {
    await setup({});
    await createSession(buyer.id);
    const denied = await saveSellerDetailsAction(null, form({ legalName: "Hacker Inc", address: "", country: "", taxId: "", taxIdLabel: "" }));
    assert.ok(!denied.ok);
    assert.equal((await getDb()).settings.growth.sellerLegalName, undefined);
  });

  it("saves, validates and clears the seller details", async () => {
    await setup({});
    await createSession(admin.id);
    const saved = await saveSellerDetailsAction(null, form({ legalName: "LearnLoop Europe SAS", address: "8 Rue de la Paix\n75002 Paris", country: "France", taxId: "FR 40 303 265 045", taxIdLabel: "" }));
    assert.ok(saved.ok);
    let growth = (await getDb()).settings.growth;
    assert.equal(growth.sellerLegalName, "LearnLoop Europe SAS");
    assert.equal(growth.sellerAddress, "8 Rue de la Paix\n75002 Paris");
    assert.equal(growth.sellerCountry, "FR");
    assert.equal(growth.sellerTaxId, "FR40303265045");
    assert.equal("sellerTaxIdLabel" in growth, false);

    const bad = await saveSellerDetailsAction(null, form({ legalName: "", address: "", country: "France", taxId: "DE123456789", taxIdLabel: "" }));
    assert.ok(!bad.ok && bad.fieldErrors?.taxId);
    assert.equal((await getDb()).settings.growth.sellerTaxId, "FR40303265045");

    assert.ok((await saveSellerDetailsAction(null, form({ legalName: "", address: "", country: "", taxId: "", taxIdLabel: "" }))).ok);
    growth = (await getDb()).settings.growth;
    for (const key of ["sellerLegalName", "sellerAddress", "sellerCountry", "sellerTaxId", "sellerTaxIdLabel"] as const) assert.equal(key in growth, false, key);
  });
});
