"use client";

import { useMemo, useState, useTransition } from "react";
import type { PlanInterval } from "@/lib/types";
import { deletePlanAction, savePlanAction, setMembershipsEnabledAction, setPlanActiveAction } from "@/lib/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, RadioCard, Select, Switch, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { MAX_TRIAL_DAYS, PLAN_INTERVALS, PLAN_INTERVAL_LABELS, intervalSuffix, yearlySavingsPercent } from "@/lib/commerce/plans";
import { cn, formatPrice, slugify } from "@/lib/utils";

export interface PlanRowData {
  id: string;
  slug: string;
  name: string;
  description: string;
  interval: PlanInterval;
  price: number;
  currency: string;
  trialDays: number;
  accessType: "all" | "courses";
  courseIds: string[];
  courseTitles: string[];
  active: boolean;
  features: string[];
  stripePriceId: string;
  razorpayPlanId: string;
  activeMembers: number;
  trialing: number;
  totalMembers: number;
  /** Percent saved against the matching monthly plan (yearly plans). */
  savingsPercent: number;
}

export interface PlanCourseOption {
  id: string;
  title: string;
  published: boolean;
}

/** "Sell memberships" switch: the pricing page, its menu link and new membership checkouts. */
export function MembershipSalesSwitch({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const res = await setMembershipsEnabledAction(next);
      if (res.ok) toast.success(res.message ?? "Saved");
      else {
        setOn(!next);
        toast.error("The setting could not be saved", res.error);
      }
    });
  };
  return (
    <Switch
      id="memberships-enabled"
      checked={on}
      disabled={pending}
      onChange={(e) => change(e.target.checked)}
      label="Sell memberships"
      description={on ? "The pricing page is live and appears in the main menu." : "The pricing page is hidden and new membership checkouts are closed. Current members keep their access."}
    />
  );
}

function PlanForm({ plan, courses, currencies, defaultCurrency, monthlyPrices, onDone }: { plan: PlanRowData | null; courses: PlanCourseOption[]; currencies: string[]; defaultCurrency: string; monthlyPrices: { price: number; currency: string }[]; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(savePlanAction, { onSuccess: onDone });
  const [name, setName] = useState(plan?.name ?? "");
  const [slug, setSlug] = useState(plan?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!plan);
  const [interval, setBilling] = useState<PlanInterval>(plan?.interval ?? "month");
  const [price, setPrice] = useState(plan ? (plan.price / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(plan?.currency ?? defaultCurrency);
  const [accessType, setAccessType] = useState<"all" | "courses">(plan?.accessType ?? "all");
  const [selected, setSelected] = useState<Set<string>>(new Set(plan?.courseIds ?? []));
  const [courseSearch, setCourseSearch] = useState("");
  const [advanced, setAdvanced] = useState(!!plan && (!!plan.stripePriceId || !!plan.razorpayPlanId));

  const visibleCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    return q ? courses.filter((c) => c.title.toLowerCase().includes(q)) : courses;
  }, [courses, courseSearch]);

  const cents = /^\d{1,7}(\.\d{1,2})?$/.test(price.trim()) ? Math.round(Number(price) * 100) : 0;
  const monthly = interval === "year" ? monthlyPrices.find((m) => m.currency === currency) : undefined;
  const saving = monthly && cents > 0 ? yearlySavingsPercent(monthly.price, cents) : 0;
  const billingChanged = !!plan && (plan.price !== cents || plan.currency !== currency || plan.interval !== interval);

  const toggleCourse = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      {formError && !Object.keys(errors).length && <FormError message={formError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan name" htmlFor="plan-name" error={errors.name} required>
          <Input
            id="plan-name"
            name="name"
            value={name}
            maxLength={80}
            invalid={!!errors.name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="URL name" htmlFor="plan-slug" error={errors.slug} hint={errors.slug ? undefined : `Checkout link: /billing/plan/${slug || "…"}`} required>
          <Input
            id="plan-slug"
            name="slug"
            value={slug}
            maxLength={80}
            className="font-mono"
            invalid={!!errors.slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="plan-description" error={errors.description} hint="Shown on the plan card. Markdown is supported.">
        <Textarea id="plan-description" name="description" rows={3} defaultValue={plan?.description ?? ""} maxLength={4000} invalid={!!errors.description} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Billing" htmlFor="plan-interval" error={errors.interval} className="sm:col-span-2" required>
          <Select
            id="plan-interval"
            name="interval"
            value={interval}
            onChange={(e) => setBilling(e.target.value as PlanInterval)}
            options={PLAN_INTERVALS.map((i) => ({ value: i, label: PLAN_INTERVAL_LABELS[i] }))}
            invalid={!!errors.interval}
          />
        </Field>
        <Field label="Price" htmlFor="plan-price" error={errors.price} required>
          <Input id="plan-price" name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="19.00" invalid={!!errors.price} />
        </Field>
        <Field label="Currency" htmlFor="plan-currency" error={errors.currency} required>
          <Select id="plan-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} invalid={!!errors.currency} />
        </Field>
      </div>
      {(cents > 0 || billingChanged) && (
        <p className="-mt-2 text-xs text-ink-muted" aria-live="polite">
          {cents > 0 && (
            <>
              Members pay{" "}
              <strong className="text-ink">
                {formatPrice(cents, currency)}
                {interval === "one_time" ? " once" : intervalSuffix(interval)}
              </strong>
              {interval === "year" && ` (${formatPrice(Math.round(cents / 12), currency)} a month)`}
              {saving > 0 && `, ${saving}% less than paying monthly`}.{" "}
            </>
          )}
          {billingChanged && plan.totalMembers > 0 && "New members pay the new price; current members keep their billing until they change plan."}
        </p>
      )}

      <Field
        label="Free trial (days)"
        htmlFor="plan-trial"
        error={errors.trialDays}
        hint={errors.trialDays ? undefined : interval === "one_time" ? "Lifetime plans are paid once and have no trial." : "0 for no trial. Each member gets the trial once, on their first membership."}
        className="sm:max-w-xs"
      >
        <Input id="plan-trial" name="trialDays" type="number" min={0} max={MAX_TRIAL_DAYS} step={1} defaultValue={plan?.trialDays ?? 0} disabled={interval === "one_time"} invalid={!!errors.trialDays} />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">What the plan unlocks</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <RadioCard name="accessType" value="all" checked={accessType === "all"} onChange={() => setAccessType("all")} title="Every course" description="The whole catalog, including courses added later." icon={<Icon.Globe className="size-4" />} />
          <RadioCard name="accessType" value="courses" checked={accessType === "courses"} onChange={() => setAccessType("courses")} title="Selected courses" description="Only the courses you pick below." icon={<Icon.ListChecks className="size-4" />} />
        </div>
        {accessType === "courses" && (
          <div className="mt-3 rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border p-2">
              <Input type="search" aria-label="Search courses" placeholder="Search courses" value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} leftAddon={<Icon.Search className="size-4" />} />
              <span className="shrink-0 px-1 text-xs text-ink-muted" aria-live="polite">
                {selected.size} selected
              </span>
            </div>
            {/* Selected courses are submitted even while a search hides them. */}
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="courseIds" value={id} />
            ))}
            <ul className="max-h-56 space-y-1 overflow-y-auto p-2">
              {visibleCourses.length === 0 ? (
                <li className="px-2 py-3 text-sm text-ink-muted">{courses.length ? "No courses match your search." : "There are no courses yet."}</li>
              ) : (
                visibleCourses.map((course) => (
                  <li key={course.id} className="rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <Checkbox
                      id={`plan-course-${course.id}`}
                      checked={selected.has(course.id)}
                      onChange={(e) => toggleCourse(course.id, e.target.checked)}
                      label={
                        <span className="font-normal">
                          {course.title}
                          {!course.published && <span className="ml-1.5 text-xs text-ink-muted">(unpublished)</span>}
                        </span>
                      }
                    />
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        {errors.courseIds && <p className="mt-1.5 text-xs text-danger">{errors.courseIds}</p>}
      </fieldset>

      <Field label="Features" htmlFor="plan-features" error={errors.features} hint={errors.features ? undefined : "One per line. Shown as a checklist on the plan card."}>
        <Textarea id="plan-features" name="features" rows={4} defaultValue={plan?.features.join("\n") ?? ""} invalid={!!errors.features} />
      </Field>

      <div className="rounded-lg border border-border px-4 py-3">
        <Switch id="plan-active" name="active" defaultChecked={plan?.active ?? true} label="On sale" description="Show this plan on the pricing page and accept new members. Turning it off never affects current members." />
      </div>

      {interval !== "one_time" && (
        <div>
          <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} aria-controls="plan-gateway-prices" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            <Icon.ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} aria-hidden="true" />
            Payment gateway prices (optional)
          </button>
          <div id="plan-gateway-prices" className={cn("mt-3 gap-4 sm:grid-cols-2", advanced ? "grid" : "hidden")}>
            <Field label="Stripe price ID" htmlFor="plan-stripe-price" error={errors.stripePriceId} hint={errors.stripePriceId ? undefined : "Leave empty and a recurring price is created on the first checkout."}>
              <Input id="plan-stripe-price" name="stripePriceId" defaultValue={plan?.stripePriceId ?? ""} placeholder="price_…" className="font-mono" invalid={!!errors.stripePriceId} />
            </Field>
            <Field label="Razorpay plan ID" htmlFor="plan-razorpay-plan" error={errors.razorpayPlanId} hint={errors.razorpayPlanId ? undefined : "Leave empty and a plan is created on the first checkout."}>
              <Input id="plan-razorpay-plan" name="razorpayPlanId" defaultValue={plan?.razorpayPlanId ?? ""} placeholder="plan_…" className="font-mono" invalid={!!errors.razorpayPlanId} />
            </Field>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {plan ? "Save plan" : "Create plan"}
        </Button>
      </div>
    </form>
  );
}

/** Plan list with create, edit, retire and delete (administrators). */
export function PlansManager({ plans, courses, currencies, defaultCurrency, salesEnabled }: { plans: PlanRowData[]; courses: PlanCourseOption[]; currencies: string[]; defaultCurrency: string; salesEnabled: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<PlanRowData | "new" | null>(null);
  const [toDelete, setToDelete] = useState<PlanRowData | null>(null);
  const [busy, startTransition] = useTransition();
  const monthlyPrices = plans.filter((p) => p.interval === "month" && p.active).map((p) => ({ price: p.price, currency: p.currency }));

  const setActive = (plan: PlanRowData, active: boolean) =>
    startTransition(async () => {
      const res = await setPlanActiveAction(plan.id, active);
      if (res.ok) toast.success(res.message ?? "Saved");
      else toast.error("The plan could not be updated", res.error);
    });

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startTransition(async () => {
      const res = await deletePlanAction(target.id);
      if (res.ok) toast.success(res.message ?? "Plan deleted");
      else toast.error("The plan could not be deleted", res.error);
      setToDelete(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {plans.length === 0 ? "No plans yet." : `${plans.length} plan${plans.length === 1 ? "" : "s"}, ${plans.filter((p) => p.active).length} on sale.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {salesEnabled && plans.some((p) => p.active) && (
            <ButtonLink href="/pricing" variant="outline" size="sm" leftIcon={<Icon.Eye className="size-4" />}>
              View pricing page
            </ButtonLink>
          )}
          <Button size="sm" onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
            New plan
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<Icon.Layers />}
          title="Create your first membership plan"
          description="A plan gives members access to every course, or to the courses you pick, for a monthly, yearly or one-time price."
          action={
            <Button onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
              New plan
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {plans.map((plan) => (
            <li key={plan.id} className={cn("flex flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card", !plan.active && "opacity-80")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                    <span className="truncate">{plan.name}</span>
                    <Badge tone={plan.active ? "success" : "neutral"} dot>
                      {plan.active ? "On sale" : "Retired"}
                    </Badge>
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted tabular-nums">
                    <strong className="text-ink">{formatPrice(plan.price, plan.currency)}</strong>
                    {plan.interval === "one_time" ? " once · lifetime" : intervalSuffix(plan.interval)}
                    {plan.savingsPercent > 0 && ` · saves ${plan.savingsPercent}%`}
                    {plan.trialDays > 0 && ` · ${plan.trialDays}-day trial`}
                  </p>
                </div>
                <Dropdown
                  trigger={
                    <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                      <Icon.MoreHorizontal className="size-4" />
                      <span className="sr-only">Actions for {plan.name}</span>
                    </span>
                  }
                  items={[
                    { label: "Edit", icon: <Icon.Edit />, onClick: () => setEditing(plan) },
                    { label: "View members", icon: <Icon.Users />, href: `/admin/settings/plans?tab=members&status=all&plan=${encodeURIComponent(plan.id)}` },
                    plan.active
                      ? { label: "Retire plan", icon: <Icon.Archive />, description: "Stop selling it; members keep it", onClick: () => setActive(plan, false), disabled: busy }
                      : { label: "Put on sale", icon: <Icon.CheckCircle />, onClick: () => setActive(plan, true), disabled: busy },
                    { label: "Delete", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setToDelete(plan) },
                  ]}
                />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-center">
                <div>
                  <dt className="text-xs text-ink-muted">Paying</dt>
                  <dd className="text-base font-semibold text-ink tabular-nums">{plan.activeMembers}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">On trial</dt>
                  <dd className="text-base font-semibold text-ink tabular-nums">{plan.trialing}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">All time</dt>
                  <dd className="text-base font-semibold text-ink tabular-nums">{plan.totalMembers}</dd>
                </div>
              </dl>

              <p className="mt-4 flex items-start gap-2 text-sm text-ink">
                <Icon.BookOpen className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                <span className="min-w-0">
                  {plan.accessType === "all" ? (
                    "Every course in the catalog"
                  ) : (
                    <>
                      {plan.courseTitles.length} selected course{plan.courseTitles.length === 1 ? "" : "s"}
                      <span className="block truncate text-xs text-ink-muted" title={plan.courseTitles.join(", ")}>
                        {plan.courseTitles.join(", ")}
                      </span>
                    </>
                  )}
                </span>
              </p>
              {(plan.stripePriceId || plan.razorpayPlanId) && (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-ink-muted">
                  {plan.stripePriceId && <span>Stripe {plan.stripePriceId}</span>}
                  {plan.razorpayPlanId && <span>Razorpay {plan.razorpayPlanId}</span>}
                </p>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                {plan.features.length} feature{plan.features.length === 1 ? "" : "s"} listed · checkout link <span className="font-mono">/billing/plan/{plan.slug}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New membership plan" : "Edit plan"} size="lg">
        {editing && (
          <PlanForm
            key={editing === "new" ? "new" : editing.id}
            plan={editing === "new" ? null : editing}
            courses={courses}
            currencies={currencies}
            defaultCurrency={defaultCurrency}
            monthlyPrices={monthlyPrices}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (busy ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={busy}
        destructive
        title={toDelete ? `Delete ${toDelete.name}?` : "Delete plan?"}
        description="Only plans that never had a member or an order can be deleted. Retire a plan to stop selling it and keep its history."
        confirmLabel="Delete plan"
      />
    </div>
  );
}
