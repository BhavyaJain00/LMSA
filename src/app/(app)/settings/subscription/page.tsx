import Link from "next/link";
import type { ReactNode } from "react";
import type { SubscriptionStatus } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getMemberMembership, type MemberMembershipView } from "@/lib/commerce/membership-views";
import { runMembershipMaintenance } from "@/lib/commerce/membership-service";
import { intervalSuffix } from "@/lib/commerce/plans";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import { CancelMembershipButton, ChangePlanList, RenewMembershipButton, ResumeMembershipButton } from "@/components/commerce/membership-actions";
import { formatDate, formatPrice } from "@/lib/utils";

export const metadata = privatePageMetadata("Membership");

const INVOICE_PAGE = 12;
const COURSES_SHOWN = 8;

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

function Notice({ tone, icon, children, actions }: { tone: "warning" | "info" | "neutral"; icon: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const classes = { warning: "border-warning/30 bg-warning/10", info: "border-info/30 bg-info/10", neutral: "border-border bg-surface-2" }[tone];
  return (
    <div role="status" className={`flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between ${classes}`}>
      <p className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 [&>svg]:size-4" aria-hidden="true">
          {icon}
        </span>
        <span>{children}</span>
      </p>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 ps-6 sm:ps-0">{actions}</div>}
    </div>
  );
}

/** The notice that matters most for the membership's state, with its action. */
function MembershipNotice({ view }: { view: MemberMembershipView }) {
  const sub = view.subscription;
  const planPrice = view.plan ? `${formatPrice(view.plan.price, view.plan.currency)}${intervalSuffix(view.plan.interval)}` : "";
  const payRenewal = view.renewalOrder ? (
    <ButtonLink href={`/billing/success/${encodeURIComponent(view.renewalOrder.orderId)}`} size="sm" leftIcon={<Icon.CreditCard className="size-4" />}>
      Pay {money(view.renewalOrder.amount, view.renewalOrder.currency)}
    </ButtonLink>
  ) : null;

  if (sub.status === "past_due") {
    return (
      <Notice
        tone="warning"
        icon={<Icon.AlertTriangle className="text-warning" />}
        actions={
          view.paymentUpdateUrl ? (
            <ButtonLink href={view.paymentUpdateUrl} size="sm" target="_blank" rel="noopener noreferrer" rightIcon={<Icon.ExternalLink className="size-4" />}>
              Pay or update card
            </ButtonLink>
          ) : (
            (payRenewal ?? (view.canRenew ? <RenewMembershipButton label="Pay renewal" /> : null))
          )
        }
      >
        <strong>Your last payment didn&apos;t go through.</strong> Your courses stay open until {formatDate(view.accessUntil ?? sub.currentPeriodEnd)}.{" "}
        {view.gatewayManaged
          ? view.paymentUpdateUrl
            ? "Pay the open invoice or update your card to keep your membership."
            : `${view.gatewayLabel} retries the payment automatically; make sure your payment method has funds.`
          : "Pay the renewal to keep your membership."}
      </Notice>
    );
  }
  if (sub.cancelAtPeriodEnd && (sub.status === "active" || sub.status === "trialing")) {
    return (
      <Notice tone="info" icon={<Icon.Info className="text-info" />} actions={view.canResume ? <ResumeMembershipButton /> : undefined}>
        <strong>Your membership ends on {formatDate(sub.currentPeriodEnd)}.</strong> You keep full access until then and won&apos;t be charged again.
        {view.resumeNote ? ` ${view.resumeNote}` : ""}
      </Notice>
    );
  }
  if (view.pendingPlan) {
    const next = view.pendingPlan;
    return (
      <Notice tone="info" icon={<Icon.Refresh className="text-info" />} actions={payRenewal ?? undefined}>
        <strong>
          You&apos;re moving to {next.name} ({formatPrice(next.price, next.currency)}
          {intervalSuffix(next.interval)}).
        </strong>{" "}
        {sub.status === "trialing" && !view.gatewayManaged
          ? "The new plan starts with the first renewal after your trial."
          : `The new plan starts when your membership renews on ${formatDate(sub.currentPeriodEnd)}.`}{" "}
        Until then you keep {view.plan?.name ?? "your current plan"} and its courses.
      </Notice>
    );
  }
  if (sub.status === "trialing") {
    return (
      <Notice tone="info" icon={<Icon.Gift className="text-info" />} actions={payRenewal ?? undefined}>
        <strong>Your free trial ends on {formatDate(sub.currentPeriodEnd)}.</strong>{" "}
        {view.gatewayManaged
          ? `After that you're charged ${planPrice} unless you cancel first.`
          : view.renewalOrder
            ? "Pay your order before then to keep your membership running."
            : `After that the membership continues at ${planPrice}.`}
      </Notice>
    );
  }
  if (sub.status === "cancelled") {
    return (
      <Notice
        tone="neutral"
        icon={<Icon.Clock className="text-ink-muted" />}
        actions={
          <ButtonLink href="/pricing" size="sm">
            Join again
          </ButtonLink>
        }
      >
        <strong>This membership was cancelled.</strong> Your access runs until {formatDate(sub.currentPeriodEnd)}.
      </Notice>
    );
  }
  if (view.renewalOrder) {
    return (
      <Notice tone="info" icon={<Icon.Receipt className="text-info" />} actions={payRenewal ?? undefined}>
        <strong>Your renewal is ready.</strong> Pay order <span className="font-mono">{view.renewalOrder.orderId}</span> before {formatDate(sub.currentPeriodEnd)} to continue without a
        break.
      </Notice>
    );
  }
  return null;
}

export default async function SubscriptionSettingsPage(props: PageProps<"/settings/subscription">) {
  const user = await requireUser("/settings/subscription");
  const sp = await props.searchParams;
  // Memberships paid by hand move to "payment due" / "ended" here when their period runs out (no scheduler needed).
  await runMembershipMaintenance({ userId: user.id }).catch((error) => {
    console.error("[memberships] maintenance failed:", error instanceof Error ? error.message : String(error));
  });
  const [page, settings] = await Promise.all([getMemberMembership(user.id), getSettings()]);
  const view = page.current;
  const plansOnSale = settings.growth.subscriptionsEnabled && page.plansAvailable > 0;

  const limitRaw = Number(typeof sp.invoices === "string" ? sp.invoices : INVOICE_PAGE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 600) : INVOICE_PAGE;
  const invoices = page.invoices.slice(0, limit);
  const allCourses = sp.courses === "all";
  // A scheduled cancellation on a membership that is still running.
  const endsSoon = !!view && view.subscription.cancelAtPeriodEnd && view.subscription.status !== "cancelled" && view.subscription.status !== "expired";

  const header = (
    <PageHeader
      title="Membership"
      description="Your plan, billing dates and membership invoices."
      breadcrumbs={<Breadcrumbs items={[{ label: "Account settings", href: "/settings" }, { label: "Membership" }]} />}
      actions={
        plansOnSale ? (
          <ButtonLink href="/pricing" variant="outline" size="sm" leftIcon={<Icon.Star className="size-4" />}>
            See all plans
          </ButtonLink>
        ) : undefined
      }
    />
  );

  return (
    <div className="mx-auto max-w-3xl pb-10">
      {header}
      <div className="space-y-6">
        {!view ? (
          <EmptyState
            icon={<Icon.Star />}
            title={page.history.length ? "You don't have a membership right now" : "You're not a member yet"}
            description={
              plansOnSale
                ? "A membership unlocks every course its plan includes for one price. Your progress in courses you opened before is kept."
                : "Membership plans aren't on sale at the moment. Courses you bought or joined stay available."
            }
            action={
              plansOnSale ? (
                <ButtonLink href="/pricing" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                  See membership plans
                </ButtonLink>
              ) : (
                <ButtonLink href="/courses" variant="outline">
                  Browse courses
                </ButtonLink>
              )
            }
          />
        ) : (
          <>
            <Card>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {view.plan?.name ?? "Retired plan"}
                    <Badge tone={endsSoon ? "warning" : STATUS_TONE[view.subscription.status]} dot>
                      {view.statusLabel}
                    </Badge>
                  </span>
                }
                description={
                  view.plan
                    ? view.lifetime
                      ? `${formatPrice(view.plan.price, view.plan.currency)} paid once · lifetime access`
                      : `${formatPrice(view.plan.price, view.plan.currency)}${intervalSuffix(view.plan.interval)}`
                    : "This plan is no longer sold. Your membership keeps running on its terms."
                }
              />
              <CardBody className="space-y-5">
                <MembershipNotice view={view} />
                <dl className="grid gap-4 sm:grid-cols-2">
                  <DetailItem label="Next payment">
                    {view.nextChargeAt && view.plan ? (
                      <>
                        {formatDate(view.nextChargeAt)} · {formatPrice(view.plan.price, view.plan.currency)}
                      </>
                    ) : view.lifetime ? (
                      "None — paid once"
                    ) : (
                      "None — the membership doesn't renew"
                    )}
                  </DetailItem>
                  <DetailItem label={view.subscription.status === "trialing" ? "Trial ends" : "Access until"}>
                    {view.lifetime ? "Lifetime" : view.accessUntil ? formatDate(view.accessUntil) : "Ended"}
                  </DetailItem>
                  <DetailItem label="Billed through">
                    {view.gatewayLabel}
                    {view.gatewayManaged ? " · charged automatically" : view.lifetime ? "" : " · renewal orders"}
                  </DetailItem>
                  <DetailItem label="Member since">{formatDate(view.subscription.createdAt)}</DetailItem>
                </dl>
                {(view.canCancel || (view.canRenew && !view.renewalOrder && view.subscription.status === "active")) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <div>{view.canRenew && view.subscription.status === "active" && <RenewMembershipButton label="Renew early" />}</div>
                    {view.canCancel && (
                      <CancelMembershipButton accessUntilLabel={formatDate(view.subscription.currentPeriodEnd)} trial={view.subscription.status === "trialing"} />
                    )}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Included courses" description={view.courses === "all" ? "Your plan unlocks the whole catalog." : "Open any of these without a checkout."} />
              <CardBody>
                {view.courses === "all" ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-start gap-2 text-sm text-ink-muted">
                      <Icon.BookOpen className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      Every published course, including the ones added while you&apos;re a member.
                    </p>
                    <ButtonLink href="/courses" size="sm" variant="outline" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                      Browse courses
                    </ButtonLink>
                  </div>
                ) : view.courses.length === 0 ? (
                  <p className="text-sm text-ink-muted">The courses of this plan are not published at the moment.</p>
                ) : (
                  <>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {(allCourses ? view.courses : view.courses.slice(0, COURSES_SHOWN)).map((course) => (
                        <li key={course.slug}>
                          <Link href={`/courses/${course.slug}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-ink hover:bg-surface-2">
                            <Icon.BookOpen className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                            <span className="truncate">{course.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {!allCourses && view.courses.length > COURSES_SHOWN && (
                      <Link href="/settings/subscription?courses=all" scroll={false} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
                        Show all {view.courses.length} courses
                      </Link>
                    )}
                  </>
                )}
              </CardBody>
            </Card>

            {view.changeTargets.length > 0 && view.plan && (
              <Card id="change-plan" className="scroll-mt-24">
                <CardHeader
                  title="Change plan"
                  description={
                    view.changeBilling === "stripe"
                      ? "Switch between the plans on sale. The new plan's courses unlock right away."
                      : "Switch between the plans on sale. The new plan starts when your membership renews."
                  }
                />
                <ChangePlanList
                  options={view.changeTargets}
                  currentId={view.plan.id}
                  currentName={view.plan.name}
                  billing={view.changeBilling}
                  renewalLabel={view.subscription.status === "trialing" && !view.gatewayManaged ? "after your trial" : `on ${formatDate(view.subscription.currentPeriodEnd)}`}
                />
              </Card>
            )}
          </>
        )}

        <section aria-labelledby="membership-invoices-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="membership-invoices-heading" className="text-base font-semibold text-ink">
                Invoices
              </h2>
              <p className="text-sm text-ink-muted">Every membership payment, newest first.</p>
            </div>
            <Link href="/billing/history" className="shrink-0 text-sm font-medium text-accent hover:underline">
              All orders
            </Link>
          </div>
          {invoices.length === 0 ? (
            <p className="rounded-card border border-dashed border-border-strong px-5 py-6 text-center text-sm text-ink-muted">
              Membership payments and their invoices appear here after your first charge.
            </p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH className="text-end">Amount</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Documents</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {invoices.map((row) => (
                    <TR key={row.id}>
                      <TD className="whitespace-nowrap">{formatDate(row.paidAt ?? row.createdAt)}</TD>
                      <TD>
                        <p className="text-ink">{row.title}</p>
                        <p className="font-mono text-xs text-ink-muted">{row.invoiceNumber ?? row.orderId}</p>
                      </TD>
                      <TD className="whitespace-nowrap text-end tabular-nums">{money(row.amount, row.currency)}</TD>
                      <TD>
                        <PaymentStatusBadge status={row.status} amount={row.amount} audience="learner" />
                      </TD>
                      <TD className="whitespace-nowrap text-end">
                        {row.invoiceHref ? (
                          <Link href={row.invoiceHref} className="text-sm font-medium text-accent hover:underline">
                            Invoice
                          </Link>
                        ) : (
                          <Link href={row.orderHref} className="text-sm font-medium text-accent hover:underline">
                            {row.status === "pending" ? "Pay" : "Order"}
                          </Link>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {page.invoices.length > limit && (
                <p className="mt-3 text-center">
                  <Link href={`/settings/subscription?invoices=${limit + INVOICE_PAGE}`} scroll={false} className="text-sm font-medium text-accent hover:underline">
                    Show more ({page.invoices.length - limit} older)
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        {page.history.length > 0 && (
          <Card>
            <CardHeader title="Earlier memberships" />
            <ul className="divide-y divide-border">
              {page.history.map((past) => (
                <li key={past.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{past.planName}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(past.startedAt)} – {formatDate(past.endedAt)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[past.status]}>{past.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
