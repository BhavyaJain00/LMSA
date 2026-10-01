"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult, CurrencyPrice, TaxRule, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/lib/config";
import { fd, fdBool, uid } from "@/lib/utils";
import { CURRENCY_COOKIE, CURRENCY_COOKIE_MAX_AGE, normalizeCurrency, validatePriceRows } from "@/lib/commerce/currency";
import { validateTaxRuleInput } from "@/lib/commerce/tax";
import { saleCurrencies } from "@/lib/commerce/tax-views";

/**
 * Taxes & currencies (Admin → Settings → Taxes & currencies) and the
 * buyer's currency choice at checkout.
 */

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

const DENIED = "Only administrators can change taxes and currencies.";

function revalidatePricing(): void {
  revalidatePath("/admin/settings/taxes");
  // Every checkout, order summary and price list reads these settings.
  revalidatePath("/", "layout");
}

/** Tax mode and multi-currency switches. */
export async function saveTaxSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: DENIED };
  const taxMode = fd(formData, "taxMode") === "by_country" ? "by_country" : "none";
  const multiCurrency = fdBool(formData, "multiCurrency");
  const before = await mutate((d) => {
    const prev = { taxMode: d.settings.growth.taxMode, multiCurrency: d.settings.growth.multiCurrency };
    d.settings.growth.taxMode = taxMode;
    d.settings.growth.multiCurrency = multiCurrency;
    d.settings.updatedAt = new Date().toISOString();
    return prev;
  });
  if (before.taxMode !== taxMode || before.multiCurrency !== multiCurrency) {
    await audit(actor, "settings.taxes", { type: "settings", id: "growth" }, { taxMode, multiCurrency });
  }
  revalidatePricing();
  return { ok: true, message: "Tax and currency settings saved." };
}

/** Create or edit the tax rule of one country. */
export async function saveTaxRuleAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: DENIED };
  const id = fd(formData, "id");
  const db = await getDb();
  if (id && !db.taxRules.some((r) => r.id === id)) return { ok: false, error: "This tax rule no longer exists." };
  const parsed = validateTaxRuleInput(
    { country: fd(formData, "country"), name: fd(formData, "name"), rate: fd(formData, "rate"), inclusive: fdBool(formData, "inclusive") },
    (country) => db.taxRules.find((r) => r.id !== id && r.country.toUpperCase() === country)?.id ?? null,
  );
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };

  const saved = await mutate((d): TaxRule | { conflict: true } | null => {
    // Checked again inside the serialized write: two admins can't add the same country twice.
    if (d.taxRules.some((r) => r.id !== id && r.country.toUpperCase() === parsed.value.country)) return { conflict: true };
    if (id) {
      const row = d.taxRules.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, parsed.value);
      return { ...row };
    }
    const row: TaxRule = { id: uid("tax"), ...parsed.value };
    d.taxRules.push(row);
    return { ...row };
  });
  if (!saved) return { ok: false, error: "This tax rule no longer exists." };
  if ("conflict" in saved) {
    const error = "This country already has a tax rule. Edit that one instead.";
    return { ok: false, error, fieldErrors: { country: error } };
  }
  await audit(actor, id ? "tax_rule.update" : "tax_rule.create", { type: "tax_rule", id: saved.id }, { country: saved.country, rate: saved.rate, inclusive: saved.inclusive });
  revalidatePricing();
  return { ok: true, data: { id: saved.id }, message: id ? "Tax rule saved." : "Tax rule added." };
}

/** Delete tax rules. Orders keep the tax they were charged. */
export async function deleteTaxRulesAction(ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: DENIED };
  const wanted = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && !!x && x.length <= 64).slice(0, 500) : []);
  if (!wanted.size) return { ok: false, error: "Select at least one tax rule." };
  const removed = await mutate((d) => {
    const gone = d.taxRules.filter((r) => wanted.has(r.id));
    d.taxRules = d.taxRules.filter((r) => !wanted.has(r.id));
    return gone.map((r) => r.country);
  });
  if (!removed.length) return { ok: false, error: "These tax rules no longer exist." };
  await audit(actor, "tax_rule.delete", { type: "tax_rule", id: [...wanted].join(",").slice(0, 200) }, { countries: removed.join(",") });
  revalidatePricing();
  return { ok: true, data: { deleted: removed.length }, message: removed.length === 1 ? "Tax rule deleted." : `${removed.length} tax rules deleted.` };
}

/**
 * Fixed prices of one course, bundle or lifetime plan in other currencies.
 * The form posts `price_<CUR>` for every sale currency (empty = none).
 */
export async function saveCurrencyPricesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: DENIED };
  const itemType = fd(formData, "itemType");
  const itemId = fd(formData, "itemId");
  if (itemType !== "course" && itemType !== "bundle" && itemType !== "plan") return { ok: false, error: "Unknown item." };
  const db = await getDb();
  const item =
    itemType === "course" ? db.courses.find((c) => c.id === itemId) : itemType === "bundle" ? db.bundles.find((b) => b.id === itemId) : db.plans.find((p) => p.id === itemId);
  if (!item) return { ok: false, error: "This item no longer exists." };
  const baseCurrency = item.currency || db.settings.commerce.defaultCurrency;
  const allowed = saleCurrencies(db.settings);
  const parsed = validatePriceRows(
    allowed.map((currency) => ({ currency, amount: fd(formData, `price_${currency}`) })),
    baseCurrency,
    allowed,
  );
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the prices below.", fieldErrors: parsed.errors };
  const prices: CurrencyPrice[] | undefined = parsed.prices.length ? parsed.prices : undefined;

  const ok = await mutate((d) => {
    const row = itemType === "course" ? d.courses.find((c) => c.id === itemId) : itemType === "bundle" ? d.bundles.find((b) => b.id === itemId) : d.plans.find((p) => p.id === itemId);
    if (!row) return false;
    row.prices = prices;
    return true;
  });
  if (!ok) return { ok: false, error: "This item no longer exists." };
  await audit(actor, "item.prices", { type: itemType, id: itemId }, { currencies: (prices ?? []).map((p) => p.currency).join(",") || "none" });
  revalidatePricing();
  return { ok: true, message: prices ? `Saved ${prices.length} fixed price${prices.length === 1 ? "" : "s"}.` : "Fixed prices removed." };
}

/** The buyer picks the currency they pay in at checkout (remembered for a year). */
export async function setCurrencyAction(code: string): Promise<ActionResult> {
  const currency = normalizeCurrency(typeof code === "string" ? code : "");
  const db = await getDb();
  if (!currency || !saleCurrencies(db.settings).includes(currency)) return { ok: false, error: "This currency isn't available." };
  const jar = await cookies();
  jar.set({ name: CURRENCY_COOKIE, value: currency, httpOnly: true, sameSite: "lax", secure: siteConfig.cookieSecure, path: "/", maxAge: CURRENCY_COOKIE_MAX_AGE });
  revalidatePath("/billing/[type]/[id]", "page");
  return { ok: true, message: `Prices are now shown in ${currency} where available.` };
}
