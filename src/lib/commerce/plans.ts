import type { MembershipPlan, PlanAccess, PlanInterval } from "@/lib/types";

/**
 * Membership plan rules shared by the pricing page, checkout, the member's
 * subscription page and the admin editor. Pure and free of server imports,
 * so client components (the monthly/yearly toggle, the plan form) use the
 * same wording and math as the server.
 */

export const PLAN_INTERVALS: readonly PlanInterval[] = ["month", "year", "one_time"];

export const PLAN_INTERVAL_LABELS: Record<PlanInterval, string> = {
  month: "Monthly",
  year: "Yearly",
  one_time: "One-time (lifetime)",
};

/** "/month", "/year" or "" (lifetime) after a price. */
export function intervalSuffix(interval: PlanInterval): string {
  if (interval === "month") return "/month";
  if (interval === "year") return "/year";
  return "";
}

/** "month", "year" or "lifetime". */
export function intervalNoun(interval: PlanInterval): string {
  if (interval === "one_time") return "lifetime";
  return interval;
}

export function isRecurringInterval(interval: PlanInterval): interval is "month" | "year" {
  return interval === "month" || interval === "year";
}

/** A lifetime plan never renews: its access period is effectively unbounded. */
export const LIFETIME_YEARS = 100;

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add whole billing intervals to an instant. Months are calendar months in
 * UTC with the day clamped to the target month (Jan 31 + 1 month = Feb 28/29),
 * so a renewal never skips a short month.
 */
export function addInterval(fromIso: string, interval: PlanInterval, count = 1): string {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) throw new RangeError("Invalid start date");
  const months = interval === "month" ? count : interval === "year" ? 12 * count : 12 * LIFETIME_YEARS;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = Math.min(from.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(targetYear, targetMonth, day, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()),
  ).toISOString();
}

/** Add days to an instant (trials, grace periods). */
export function addDaysIso(fromIso: string, days: number): string {
  return new Date(new Date(fromIso).getTime() + days * 86_400_000).toISOString();
}

/** Price of a plan expressed per month, used for MRR and for comparing plans. */
export function monthlyEquivalent(plan: Pick<MembershipPlan, "interval" | "price">): number {
  if (plan.interval === "month") return plan.price;
  if (plan.interval === "year") return plan.price / 12;
  return 0;
}

/**
 * Percentage saved by paying yearly instead of twelve monthly payments
 * (0 when the yearly plan is not cheaper). Whole percent, rounded down so the
 * advertised saving is never overstated.
 */
export function yearlySavingsPercent(monthlyPrice: number, yearlyPrice: number): number {
  if (monthlyPrice <= 0 || yearlyPrice <= 0) return 0;
  const full = monthlyPrice * 12;
  if (yearlyPrice >= full) return 0;
  return Math.floor(((full - yearlyPrice) / full) * 100);
}

function sameAccess(a: PlanAccess, b: PlanAccess): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "all" || b.type === "all") return true;
  const left = [...a.courseIds].sort();
  const right = [...b.courseIds].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/**
 * The monthly plan a yearly plan should be compared with: same currency and
 * the same access (cheapest one when several match).
 */
export function monthlyCounterpart<P extends Pick<MembershipPlan, "id" | "interval" | "price" | "currency" | "access">>(yearly: P, plans: readonly P[]): P | null {
  if (yearly.interval !== "year") return null;
  const candidates = plans.filter((p) => p.interval === "month" && p.currency.toUpperCase() === yearly.currency.toUpperCase() && sameAccess(p.access, yearly.access));
  if (!candidates.length) return null;
  return candidates.reduce((best, p) => (p.price < best.price ? p : best));
}

/** Savings of a yearly plan against its monthly counterpart (0 when there is none). */
export function planSavingsPercent<P extends Pick<MembershipPlan, "id" | "interval" | "price" | "currency" | "access">>(plan: P, plans: readonly P[]): number {
  const monthly = monthlyCounterpart(plan, plans);
  return monthly ? yearlySavingsPercent(monthly.price, plan.price) : 0;
}

/** Whether a plan unlocks a course. */
export function planCoversCourse(plan: Pick<MembershipPlan, "access">, courseId: string): boolean {
  return plan.access.type === "all" || plan.access.courseIds.includes(courseId);
}

/** "All courses" or "3 courses". */
export function planAccessLabel(access: PlanAccess): string {
  if (access.type === "all") return "Every course in the catalog";
  const n = access.courseIds.length;
  return `${n} selected course${n === 1 ? "" : "s"}`;
}

/** Which billing view a plan appears in on the pricing page (lifetime plans show in both). */
export function planMatchesCycle(plan: Pick<MembershipPlan, "interval">, cycle: "month" | "year"): boolean {
  return plan.interval === "one_time" || plan.interval === cycle;
}

/** Default billing view: yearly when only yearly (or lifetime) plans exist. */
export function defaultCycle(plans: readonly Pick<MembershipPlan, "interval">[]): "month" | "year" {
  return plans.some((p) => p.interval === "month") ? "month" : "year";
}

/* ------------------------------------------------------------------ */
/* Admin form validation                                               */
/* ------------------------------------------------------------------ */

export interface PlanFormInput {
  name: string;
  slug: string;
  description: string;
  interval: string;
  /** Decimal price as typed, e.g. "19.00". */
  price: string;
  currency: string;
  trialDays: string;
  accessType: string;
  courseIds: string[];
  features: string;
  active: boolean;
  stripePriceId: string;
  razorpayPlanId: string;
}

export interface PlanDraft {
  name: string;
  slug: string;
  description: string;
  interval: PlanInterval;
  price: number;
  currency: string;
  trialDays: number;
  access: PlanAccess;
  features: string[];
  active: boolean;
  gatewayPriceIds: { stripe?: string; razorpay?: string };
}

export const MAX_TRIAL_DAYS = 365;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parse "19", "19.5" or "19.00" into app units (1900). */
function parsePrice(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * Validate the admin plan form. Returns the plan fields or per-field errors.
 * `knownCourseIds` guards the course picker; `currencies` the currency list.
 */
export function validatePlanInput(
  input: PlanFormInput,
  ctx: { knownCourseIds: ReadonlySet<string>; currencies: readonly string[] },
): { ok: true; draft: PlanDraft } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) errors.name = "Enter a plan name of 2 to 80 characters.";
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 80) errors.slug = "Use lowercase letters, numbers and hyphens only.";
  const description = input.description.trim();
  if (description.length > 4000) errors.description = "Keep the description under 4,000 characters.";

  const interval = (PLAN_INTERVALS as readonly string[]).includes(input.interval) ? (input.interval as PlanInterval) : null;
  if (!interval) errors.interval = "Choose how often members pay.";

  const price = parsePrice(input.price);
  if (price === null) errors.price = "Enter a price such as 19 or 19.99.";
  else if (price <= 0) errors.price = "Memberships need a price above zero.";

  const currency = input.currency.trim().toUpperCase();
  if (!ctx.currencies.includes(currency)) errors.currency = "Choose a supported currency.";

  const trialRaw = input.trialDays.trim() || "0";
  const trialDays = /^\d{1,3}$/.test(trialRaw) ? Number(trialRaw) : NaN;
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > MAX_TRIAL_DAYS) errors.trialDays = `Enter 0 to ${MAX_TRIAL_DAYS} days.`;
  else if (trialDays > 0 && interval === "one_time") errors.trialDays = "Lifetime plans are paid once, so they can't have a trial.";

  let access: PlanAccess = { type: "all" };
  if (input.accessType === "courses") {
    const ids = [...new Set(input.courseIds.map((id) => id.trim()).filter(Boolean))];
    const unknown = ids.filter((id) => !ctx.knownCourseIds.has(id));
    if (!ids.length) errors.courseIds = "Pick at least one course, or give access to every course.";
    else if (unknown.length) errors.courseIds = "Some selected courses no longer exist.";
    access = { type: "courses", courseIds: ids };
  } else if (input.accessType !== "all") {
    errors.courseIds = "Choose what the plan unlocks.";
  }

  const features = input.features
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);
  if (features.length > 15) errors.features = "List at most 15 features.";
  else if (features.some((f) => f.length > 140)) errors.features = "Keep each feature under 140 characters.";

  const stripePriceId = input.stripePriceId.trim();
  if (stripePriceId && !/^price_[A-Za-z0-9]{6,120}$/.test(stripePriceId)) errors.stripePriceId = "Stripe price ids look like price_1Nx…";
  const razorpayPlanId = input.razorpayPlanId.trim();
  if (razorpayPlanId && !/^plan_[A-Za-z0-9]{6,40}$/.test(razorpayPlanId)) errors.razorpayPlanId = "Razorpay plan ids look like plan_Ab12…";
  if ((stripePriceId || razorpayPlanId) && interval === "one_time") {
    errors[stripePriceId ? "stripePriceId" : "razorpayPlanId"] = "Lifetime plans are charged once, so they don't use recurring gateway prices.";
  }

  if (Object.keys(errors).length || !interval || price === null) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      name,
      slug,
      description,
      interval,
      price,
      currency,
      trialDays,
      access,
      features,
      active: input.active,
      gatewayPriceIds: { ...(stripePriceId ? { stripe: stripePriceId } : {}), ...(razorpayPlanId ? { razorpay: razorpayPlanId } : {}) },
    },
  };
}
