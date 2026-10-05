"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Coupon } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { normalizeCouponCode } from "@/lib/data/commerce";
import { fd, fdBool, toDateKey, uid } from "@/lib/utils";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateCoupons() {
  revalidatePath("/admin/settings/coupons");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Create or update a coupon (Frappe: LMS Coupon). */
export async function saveCouponAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage coupons." };
  const db = await getDb();

  const id = fd(formData, "id");
  const existing = id ? db.coupons.find((c) => c.id === id) : null;
  if (id && !existing) return { ok: false, error: "This coupon no longer exists." };

  const code = normalizeCouponCode(fd(formData, "code"));
  const discountType = fd(formData, "discountType");
  const rawValue = fd(formData, "value");
  const expiresOn = fd(formData, "expiresOn");
  const rawLimit = fd(formData, "usageLimit");
  const enabled = fdBool(formData, "enabled");
  const rawItems = formData.getAll("items").filter((v): v is string => typeof v === "string");

  const errors: Record<string, string> = {};
  if (!code) errors.code = "Coupon Code is required";
  else if (!/^[A-Z0-9_-]{3,32}$/.test(code)) errors.code = "Use 3–32 letters, numbers, dashes or underscores.";
  else if (db.coupons.some((c) => c.code.toUpperCase() === code && c.id !== id)) errors.code = "A coupon with this code already exists.";

  if (discountType !== "percentage" && discountType !== "fixed") errors.discountType = "Discount Type is required";

  let value = 0;
  if (discountType === "percentage") {
    const n = Number(rawValue);
    if (rawValue === "") errors.value = "Discount Percentage is required";
    else if (!Number.isFinite(n) || n <= 0 || n > 100) errors.value = "Enter a percentage between 1 and 100.";
    else value = Math.round(n * 100) / 100;
  } else if (discountType === "fixed") {
    const n = Number(rawValue);
    if (rawValue === "") errors.value = "Discount Amount is required";
    else if (!Number.isFinite(n) || n <= 0) errors.value = "Enter an amount greater than zero.";
    else value = Math.round(n * 100);
  }

  if (expiresOn && !DATE_RE.test(expiresOn)) errors.expiresOn = "Enter a valid date.";
  else if (expiresOn && enabled && expiresOn < toDateKey() && expiresOn !== existing?.expiresOn) errors.expiresOn = "Expiry date cannot be in the past";

  let usageLimit = 0;
  if (rawLimit !== "") {
    const n = Number(rawLimit);
    if (!Number.isInteger(n)) errors.usageLimit = "Usage limit must be a whole number.";
    else if (n < 0) errors.usageLimit = "Usage limit cannot be negative";
    else usageLimit = n;
  }

  /*
   * Deliberate deviation from Frappe (where "Applicable For" is required): an
   * empty list means the coupon applies to every course and batch, which the
   * form explains next to the picker. Fixed amounts are stored in the default
   * currency, so a fixed coupon may only target items priced in it (checkout
   * enforces the same rule for "all items" coupons).
   */
  const defaultCurrency = db.settings.commerce.defaultCurrency.toUpperCase();
  const applicableItems: Coupon["applicableItems"] = [];
  const seen = new Set<string>();
  const otherCurrency: string[] = [];
  for (const raw of rawItems) {
    const [type, itemId] = raw.split(":");
    if ((type !== "course" && type !== "batch") || !itemId || seen.has(raw)) continue;
    const target = type === "course" ? db.courses.find((c) => c.id === itemId) : db.batches.find((b) => b.id === itemId);
    if (!target) {
      errors.items = "One of the selected courses or batches no longer exists.";
      continue;
    }
    if (discountType === "fixed" && (target.currency || "USD").toUpperCase() !== defaultCurrency) otherCurrency.push(target.title);
    seen.add(raw);
    applicableItems.push({ type, id: itemId });
  }
  if (otherCurrency.length && !errors.items) {
    errors.items = `Fixed-amount coupons only work for items priced in ${defaultCurrency}. Remove ${otherCurrency.join(", ")} or use a percentage discount.`;
  }

  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };

  const couponId = existing?.id ?? uid("cpn");
  await mutate((d) => {
    if (existing) {
      const row = d.coupons.find((c) => c.id === existing.id);
      if (!row) return;
      row.code = code;
      row.discountType = discountType as Coupon["discountType"];
      row.value = value;
      row.expiresOn = expiresOn || undefined;
      row.usageLimit = usageLimit;
      row.enabled = enabled;
      row.applicableItems = applicableItems;
    } else {
      d.coupons.push({
        id: couponId,
        code,
        discountType: discountType as Coupon["discountType"],
        value,
        expiresOn: expiresOn || undefined,
        usageLimit,
        redemptionCount: 0,
        enabled,
        applicableItems,
        createdAt: new Date().toISOString(),
      });
    }
  });
  await audit(admin, existing ? "coupon.update" : "coupon.create", { type: "coupon", id: couponId }, {
    code,
    discountType,
    value,
    usageLimit,
    enabled,
    items: applicableItems.length,
  });
  revalidateCoupons();
  return { ok: true, data: { id: couponId }, message: existing ? "Coupon updated successfully" : "Coupon created successfully" };
}

export async function setCouponEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage coupons." };
  const found = await mutate((d) => {
    const row = d.coupons.find((c) => c.id === id);
    if (!row) return null;
    const changed = row.enabled !== enabled;
    row.enabled = enabled;
    return { code: row.code, changed };
  });
  if (!found) return { ok: false, error: "Error updating coupon" };
  if (found.changed) await audit(admin, enabled ? "coupon.enable" : "coupon.disable", { type: "coupon", id }, { code: found.code });
  revalidateCoupons();
  return { ok: true, data: undefined, message: enabled ? "Coupon enabled" : "Coupon disabled" };
}

export async function deleteCouponAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Only administrators can manage coupons." };
  const removed = await mutate((d) => {
    const row = d.coupons.find((c) => c.id === id);
    if (!row) return null;
    d.coupons = d.coupons.filter((c) => c.id !== id);
    return { code: row.code, redemptions: row.redemptionCount };
  });
  if (!removed) return { ok: false, error: "Error deleting coupon" };
  await audit(admin, "coupon.delete", { type: "coupon", id }, { code: removed.code, redemptions: removed.redemptions });
  revalidateCoupons();
  return { ok: true, data: undefined, message: "Coupon deleted successfully" };
}
