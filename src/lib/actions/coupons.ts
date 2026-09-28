"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Coupon } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
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
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage coupons." };
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

  const applicableItems: Coupon["applicableItems"] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const [type, itemId] = raw.split(":");
    if ((type !== "course" && type !== "batch") || !itemId || seen.has(raw)) continue;
    const exists = type === "course" ? db.courses.some((c) => c.id === itemId) : db.batches.some((b) => b.id === itemId);
    if (!exists) {
      errors.items = "One of the selected courses or batches no longer exists.";
      continue;
    }
    seen.add(raw);
    applicableItems.push({ type, id: itemId });
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
  revalidateCoupons();
  return { ok: true, data: { id: couponId }, message: existing ? "Coupon updated successfully" : "Coupon created successfully" };
}

export async function setCouponEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage coupons." };
  const found = await mutate((d) => {
    const row = d.coupons.find((c) => c.id === id);
    if (!row) return false;
    row.enabled = enabled;
    return true;
  });
  if (!found) return { ok: false, error: "Error updating coupon" };
  revalidateCoupons();
  return { ok: true, data: undefined, message: enabled ? "Coupon enabled" : "Coupon disabled" };
}

export async function deleteCouponAction(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage coupons." };
  const removed = await mutate((d) => {
    const before = d.coupons.length;
    d.coupons = d.coupons.filter((c) => c.id !== id);
    return before !== d.coupons.length;
  });
  if (!removed) return { ok: false, error: "Error deleting coupon" };
  revalidateCoupons();
  return { ok: true, data: undefined, message: "Coupon deleted successfully" };
}
