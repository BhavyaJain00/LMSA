"use client";

import { useState, type ReactNode } from "react";
import type { PlanInterval } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/tabs";
import { intervalSuffix, planMatchesCycle } from "@/lib/commerce/plans";
import { cn, formatPrice } from "@/lib/utils";

export interface PricingCardPlan {
  id: string;
  slug: string;
  name: string;
  /** Rendered plan description (Markdown rendered on the server). */
  description: ReactNode;
  interval: PlanInterval;
  price: number;
  currency: string;
  trialDays: number;
  features: string[];
  accessLabel: string;
  courseTitles: string[];
  /** Whole percent saved against the matching monthly plan (yearly plans). */
  savingsPercent: number;
}

export interface PricingViewer {
  loggedIn: boolean;
  /** Plan of the viewer's running membership. */
  currentPlanId: string | null;
  trialEligible: boolean;
}

type Cycle = "month" | "year";

const MAX_COURSES_SHOWN = 5;

function cta(plan: PricingCardPlan, viewer: PricingViewer): { label: string; href: string; current: boolean } {
  if (viewer.currentPlanId === plan.id) return { label: "Manage membership", href: "/settings/subscription", current: true };
  if (viewer.currentPlanId) {
    // Lifetime plans are bought once the running membership ends; monthly/yearly plans are switched in place.
    return plan.interval === "one_time"
      ? { label: "Manage membership", href: "/settings/subscription", current: false }
      : { label: "Switch to this plan", href: "/settings/subscription#change-plan", current: false };
  }
  const href = `/billing/plan/${plan.slug}`;
  if (plan.interval === "one_time") return { label: "Get lifetime access", href, current: false };
  if (plan.trialDays > 0 && viewer.trialEligible) return { label: `Start ${plan.trialDays}-day free trial`, href, current: false };
  return { label: plan.interval === "year" ? "Join yearly" : "Join monthly", href, current: false };
}

/**
 * Plan cards of the pricing page with the monthly/yearly toggle. The toggle
 * appears only when both billing cycles are on sale; lifetime plans show in
 * both views. Every price comes from the server; this component only picks
 * which cards are visible.
 */
export function PricingPlans({ plans, viewer, initialCycle }: { plans: PricingCardPlan[]; viewer: PricingViewer; initialCycle: Cycle }) {
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const hasMonthly = plans.some((p) => p.interval === "month");
  const hasYearly = plans.some((p) => p.interval === "year");
  const bestSaving = Math.max(0, ...plans.map((p) => p.savingsPercent));
  const visible = plans.filter((p) => planMatchesCycle(p, cycle));
  // The card to highlight: the viewer's plan, else the best yearly saving, else the first card.
  const featuredId = visible.find((p) => p.id === viewer.currentPlanId)?.id ?? visible.find((p) => p.savingsPercent > 0 && p.savingsPercent === bestSaving)?.id ?? (visible.length > 1 ? visible[0]?.id : undefined);

  return (
    <div>
      {hasMonthly && hasYearly && (
        <div className="mb-8 flex flex-col items-center gap-2">
          <SegmentedControl<Cycle>
            size="md"
            value={cycle}
            onChange={setCycle}
            options={[
              { value: "month", label: "Pay monthly" },
              {
                value: "year",
                label: (
                  <>
                    Pay yearly
                    {bestSaving > 0 && (
                      <Badge tone="success" size="xs">
                        Save {bestSaving}%
                      </Badge>
                    )}
                  </>
                ),
              },
            ]}
          />
          <p className="text-xs text-ink-muted" aria-live="polite">
            {cycle === "year" ? "One payment a year." : bestSaving > 0 ? `Switch to yearly billing and save up to ${bestSaving}%.` : "Billed every month. Cancel any time."}
          </p>
        </div>
      )}

      <ul className={cn("mx-auto grid gap-5", visible.length === 1 ? "max-w-md" : visible.length === 2 ? "max-w-3xl md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3")}>
        {visible.map((plan) => {
          const action = cta(plan, viewer);
          const featured = plan.id === featuredId;
          const trial = plan.trialDays > 0 && plan.interval !== "one_time" && viewer.trialEligible && !viewer.currentPlanId;
          const extraCourses = plan.courseTitles.length - MAX_COURSES_SHOWN;
          return (
            <li
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-card border bg-surface-1 p-6 shadow-card",
                featured ? "border-accent ring-1 ring-accent" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink">{plan.name}</h2>
                {action.current && (
                  <Badge tone="accent" dot>
                    Your plan
                  </Badge>
                )}
                {!action.current && plan.savingsPercent > 0 && <Badge tone="success">Save {plan.savingsPercent}%</Badge>}
                {!action.current && plan.interval === "one_time" && <Badge tone="info">Pay once</Badge>}
              </div>

              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight text-ink tabular-nums">{formatPrice(plan.price, plan.currency)}</span>
                <span className="text-sm text-ink-muted">{plan.interval === "one_time" ? "once" : intervalSuffix(plan.interval)}</span>
              </p>
              <p className="mt-1 min-h-5 text-xs text-ink-muted">
                {plan.interval === "year"
                  ? `That's ${formatPrice(Math.round(plan.price / 12), plan.currency)} a month, billed yearly.`
                  : plan.interval === "month"
                    ? "Billed every month. Cancel any time."
                    : "Lifetime access. No renewals."}
              </p>

              {trial && (
                <p className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
                  <Icon.Gift className="size-3.5" aria-hidden="true" />
                  {plan.trialDays}-day free trial
                </p>
              )}

              <div className="mt-4 text-sm text-ink-muted">{plan.description}</div>

              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink">
                <li className="flex items-start gap-2.5 font-medium">
                  <Icon.BookOpen className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  {plan.accessLabel}
                </li>
                {plan.courseTitles.slice(0, MAX_COURSES_SHOWN).map((title) => (
                  <li key={title} className="flex items-start gap-2.5 pl-6.5 text-ink-muted">
                    {title}
                  </li>
                ))}
                {extraCourses > 0 && <li className="pl-6.5 text-ink-muted">and {extraCourses} more</li>}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>

              <ButtonLink href={action.href} size="lg" variant={featured && !action.current ? "primary" : "outline"} className="mt-6 w-full">
                {action.label}
              </ButtonLink>
              {!viewer.currentPlanId && plan.trialDays > 0 && plan.interval !== "one_time" && !viewer.trialEligible && (
                <p className="mt-2 text-center text-xs text-ink-muted">The free trial is for first-time members.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
