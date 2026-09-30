import Link from "next/link";
import type { ReactNode } from "react";
import type { InstallmentPartView, InstallmentPlanView } from "@/lib/commerce/installment-views";
import { INSTALLMENT_GRACE_DAYS, type InstallmentPlanStatus } from "@/lib/commerce/installments";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink, type ButtonSize } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatDate } from "@/lib/utils";
import { money } from "./order-summary";
import { ResumePaymentButton } from "./resume-payment-button";

/**
 * A learner's payment plan: where it stands, the schedule of its payments and
 * the "Pay installment" button for the part that is due next. Shown on the
 * order page of every part, in the order history and (as `InstallmentNotice`)
 * on the course page. Server-safe; only the pay button is a client component.
 */

const STATUS_TONE: Record<InstallmentPlanStatus, BadgeTone> = {
  awaiting_first: "warning",
  on_track: "success",
  overdue: "warning",
  paused: "danger",
  completed: "success",
  cancelled: "neutral",
};

export const orderPath = (orderId: string) => `/billing/success/${encodeURIComponent(orderId)}`;

/**
 * The action for the next payment of a plan: the gateway checkout ("Pay
 * installment"), or the payment instructions when payments are confirmed by
 * hand. Nothing while Stripe is about to charge the part by itself.
 */
export function InstallmentPayAction({ plan, size = "md", className, hereOrderId }: { plan: InstallmentPlanView; size?: ButtonSize; className?: string; hereOrderId?: string }) {
  const next = plan.next;
  if (!next || (plan.status !== "on_track" && plan.status !== "overdue" && plan.status !== "paused")) return null;
  if (plan.autoCharge && plan.status === "on_track") return null;
  const label = `Pay ${money(next.amount, plan.currency)}`;
  if (plan.payGateway === "stripe" || plan.payGateway === "razorpay") {
    return <ResumePaymentButton installment orderId={next.orderId} gateway={plan.payGateway} label={label} size={size} className={className} />;
  }
  // Already on the page that shows how to pay this part.
  if (hereOrderId === next.orderId) return null;
  return (
    <ButtonLink href={orderPath(next.orderId)} size={size} className={className} leftIcon={<Icon.Receipt className="size-4" />}>
      {label} · how to pay
    </ButtonLink>
  );
}

function headline(plan: InstallmentPlanView): { tone: "info" | "warning" | "danger" | "success" | "neutral"; icon: ReactNode; text: ReactNode } | null {
  const next = plan.next;
  const amount = next ? money(next.amount, plan.currency) : "";
  const due = next?.dueAt ? formatDate(next.dueAt) : "";
  const pauses = plan.pausesAt ? formatDate(plan.pausesAt) : "";
  switch (plan.status) {
    case "on_track":
      if (!next) return null;
      return {
        tone: "info",
        icon: <Icon.Calendar className="size-4" />,
        text: plan.autoCharge ? (
          <>
            Payment {next.number} of {plan.total} ({amount}) is charged to your card automatically on <strong className="text-ink">{due}</strong>. There is nothing you need to do.
          </>
        ) : (
          <>
            Payment {next.number} of {plan.total} ({amount}) is due on <strong className="text-ink">{due}</strong>. We&apos;ll remind you, and you can pay it early at any time.
          </>
        ),
      };
    case "overdue":
      if (!next) return null;
      return {
        tone: "warning",
        icon: <Icon.AlertTriangle className="size-4" />,
        text: (
          <>
            Payment {next.number} of {plan.total} ({amount}) was due on {due}. Pay by <strong className="text-ink">{pauses}</strong> to keep your access without interruption.
          </>
        ),
      };
    case "paused":
      if (!next) return null;
      return {
        tone: "danger",
        icon: <Icon.Lock className="size-4" />,
        text: (
          <>
            Payment {next.number} of {plan.total} ({amount}) is more than {INSTALLMENT_GRACE_DAYS} days overdue, so the lessons are locked. Your progress is saved and everything unlocks as soon
            as it is paid.
          </>
        ),
      };
    case "completed":
      return { tone: "success", icon: <Icon.CheckCircle className="size-4" />, text: <>Every payment is complete. The course is yours for good.</> };
    case "cancelled":
      return {
        tone: "neutral",
        icon: <Icon.XCircle className="size-4" />,
        text: <>This payment plan was cancelled, so nothing more is due. The lessons stay locked unless you buy the course; your progress is saved.</>,
      };
    default:
      return { tone: "warning", icon: <Icon.Clock className="size-4" />, text: <>The plan starts as soon as the first payment is confirmed.</> };
  }
}

const HEADLINE_BOX = {
  info: "border-info/30 bg-info/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-danger/30 bg-danger/10",
  success: "border-success/30 bg-success/10",
  neutral: "border-border bg-surface-2",
};

const HEADLINE_ICON = { info: "text-info", warning: "text-warning", danger: "text-danger", success: "text-success", neutral: "text-ink-muted" };

function partState(part: InstallmentPartView): { label: string; tone: BadgeTone } {
  switch (part.status) {
    case "paid":
      return { label: part.paidAt ? `Paid ${formatDate(part.paidAt)}` : "Paid", tone: "success" };
    case "waived":
      return { label: "Waived", tone: "success" };
    case "refunded":
      return { label: "Refunded", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "overdue":
      return { label: part.dueAt ? `Overdue since ${formatDate(part.dueAt)}` : "Overdue", tone: "warning" };
    default:
      return { label: part.dueAt ? `Due ${formatDate(part.dueAt)}` : "Scheduled", tone: "outline" };
  }
}

export function InstallmentPlanCard({
  plan,
  own,
  currentOrderId,
  showCourse = false,
  className,
}: {
  plan: InstallmentPlanView;
  /** The viewer is the learner paying the plan (administrators see it read-only). */
  own: boolean;
  /** Order id of the part whose page this is (highlighted in the schedule). */
  currentOrderId?: string;
  /** Show the course title (lists of plans); the order page already names it. */
  showCourse?: boolean;
  className?: string;
}) {
  const top = headline(plan);
  const percentPaid = plan.total > 0 ? Math.round((plan.paidCount / plan.total) * 100) : 0;
  const headingId = `plan-${plan.key}`;
  return (
    <section className={cn("rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6", className)} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-ink">
            Payment plan
            {showCourse && (
              <>
                {" · "}
                {plan.courseSlug ? (
                  <Link href={`/courses/${plan.courseSlug}`} className="hover:text-accent hover:underline">
                    {plan.courseTitle}
                  </Link>
                ) : (
                  plan.courseTitle
                )}
              </>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {plan.paidCount} of {plan.total} payments made · {money(plan.paidAmount, plan.currency)} paid
            {plan.outstandingAmount > 0 && ` · ${money(plan.outstandingAmount, plan.currency)} to go`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[plan.status]} dot>
          {plan.statusLabel}
        </Badge>
      </div>

      <ProgressBar value={percentPaid} size="sm" tone={plan.status === "completed" ? "success" : "accent"} className="mt-4" />

      {top && (
        <div role={top.tone === "danger" || top.tone === "warning" ? "alert" : "status"} className={cn("mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm text-ink-muted", HEADLINE_BOX[top.tone])}>
          <span className={cn("mt-0.5 shrink-0", HEADLINE_ICON[top.tone])} aria-hidden="true">
            {top.icon}
          </span>
          <p className="min-w-0 flex-1">{top.text}</p>
        </div>
      )}
      {own && (
        <div className="mt-3 empty:hidden">
          <InstallmentPayAction plan={plan} hereOrderId={currentOrderId} />
        </div>
      )}

      <ol className="mt-5 divide-y divide-border rounded-lg border border-border" aria-label="Payment schedule">
        {plan.parts.map((part) => {
          const state = partState(part);
          const current = part.orderId === currentOrderId;
          return (
            <li key={part.number} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm", current && "bg-accent/5")} aria-current={current ? "true" : undefined}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    part.status === "paid" || part.status === "waived" ? "bg-success/15 text-success" : part.isNext ? "bg-accent/15 text-accent" : "bg-surface-2 text-ink-muted",
                  )}
                  aria-hidden="true"
                >
                  {part.status === "paid" || part.status === "waived" ? <Icon.Check className="size-3.5" /> : part.number}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    Payment {part.number} of {plan.total}
                    {current && <span className="ml-1.5 text-xs font-normal text-ink-muted">(this order)</span>}
                  </p>
                  {current ? (
                    <p className="font-mono text-xs text-ink-muted">{part.orderId}</p>
                  ) : (
                    <Link href={orderPath(part.orderId)} className="font-mono text-xs text-accent hover:underline">
                      {part.orderId}
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={state.tone} size="xs">
                  {state.label}
                </Badge>
                <span className="w-20 text-right font-medium tabular-nums text-ink">{part.status === "waived" ? "—" : money(part.amount, plan.currency)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {(plan.status === "on_track" || plan.status === "overdue") && (
        <p className="mt-3 text-xs text-ink-muted">
          If a payment is more than {INSTALLMENT_GRACE_DAYS} days late, the lessons lock until it is paid. Your progress is always kept.
        </p>
      )}
    </section>
  );
}

/**
 * Banner for a plan that needs the learner's attention (a payment is overdue,
 * access is paused, or the plan was cancelled) with the pay action. Renders
 * nothing for plans that are on track or complete.
 */
export function InstallmentNotice({ plan, compact = false, className }: { plan: InstallmentPlanView; compact?: boolean; className?: string }) {
  if (plan.status !== "overdue" && plan.status !== "paused" && plan.status !== "cancelled") return null;
  const top = headline(plan);
  if (!top) return null;
  return (
    <div role={plan.status === "cancelled" ? "status" : "alert"} className={cn("rounded-lg border px-3 py-2.5 text-sm text-ink-muted", HEADLINE_BOX[top.tone], className)}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 shrink-0", HEADLINE_ICON[top.tone])} aria-hidden="true">
          {top.icon}
        </span>
        <p className="min-w-0 flex-1">
          {!compact && <strong className="text-ink">{plan.courseTitle}: </strong>}
          {top.text}
        </p>
      </div>
      <div className={cn("mt-2.5 flex flex-wrap items-center gap-2 empty:hidden", !compact && "pl-6")}>
        <InstallmentPayAction plan={plan} size={compact ? "md" : "sm"} />
        {!compact && plan.status !== "cancelled" && (
          <ButtonLink href={orderPath(plan.key)} variant="ghost" size="sm">
            View payment plan
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
