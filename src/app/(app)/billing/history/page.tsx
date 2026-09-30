import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getOrderHistory, ITEM_TYPE_LABELS, gatewayLabel } from "@/lib/data/commerce";
import { backfillInvoiceNumbers, hasInvoice } from "@/lib/payments/invoice";
import { isRealGateway } from "@/lib/payments/gateway";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { ItemThumb, money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import { ResumePaymentButton } from "@/components/commerce/resume-payment-button";
import { InstallmentPlanCard } from "@/components/commerce/installment-plan-card";
import { isInstallmentOrder } from "@/lib/commerce/installments";
import { runInstallmentMaintenance } from "@/lib/commerce/installment-service";
import { getMyInstallmentPlans } from "@/lib/commerce/installment-views";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Orders & invoices" };

const PAGE_SIZE = 20;

export default async function OrderHistoryPage(props: PageProps<"/billing/history">) {
  const user = await requireUser("/billing/history");
  const sp = await props.searchParams;
  const limitRaw = Number(typeof sp.limit === "string" ? sp.limit : PAGE_SIZE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : PAGE_SIZE;

  await backfillInvoiceNumbers();
  // No scheduler needed: reminders of this learner's payment plans that are due go out when they open their orders.
  await runInstallmentMaintenance({ userId: user.id }).catch((error) => {
    console.error("[installments] maintenance failed:", error instanceof Error ? error.message : String(error));
  });
  const [history, plans] = await Promise.all([getOrderHistory(user.id), getMyInstallmentPlans(user.id)]);
  // Payments of a plan that are not made yet live in the plan's schedule above the list, not among the orders.
  const orders = history.filter((o) => !(isInstallmentOrder(o) && o.installmentNumber! > 1 && o.status !== "paid" && o.status !== "refunded"));
  const openPlans = plans.filter((p) => p.status === "on_track" || p.status === "overdue" || p.status === "paused");
  const shown = orders.slice(0, limit);

  const spent = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== "paid" && o.status !== "refunded") continue;
    const refunded = o.status === "refunded" ? (o.refundedAmount ?? o.amount) : (o.refundedAmount ?? 0);
    spent.set(o.currency, (spent.get(o.currency) ?? 0) + Math.max(0, o.amount - refunded));
  }
  const spentLabel = Array.from(spent, ([currency, amount]) => money(amount, currency)).join(" + ");
  const openCount = orders.filter((o) => o.status === "pending").length;

  return (
    <>
      <PageHeader
        title="Orders & invoices"
        description="Everything you bought, with receipts and printable invoices. Unpaid orders can be completed or cancelled here."
        actions={
          <ButtonLink href="/courses" variant="outline" size="sm" leftIcon={<Icon.BookOpen className="size-4" />}>
            Browse courses
          </ButtonLink>
        }
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={<Icon.Receipt />}
          title="No orders yet"
          description="Courses, bundles, memberships and certificates you buy appear here together with their invoices."
          action={<ButtonLink href="/courses">Explore courses</ButtonLink>}
        />
      ) : (
        <div className="space-y-4 pb-10">
          {openPlans.length > 0 && (
            <section aria-label="Your payment plans" className="space-y-4">
              {openPlans.map((plan) => (
                <InstallmentPlanCard key={plan.key} plan={plan} own showCourse />
              ))}
            </section>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
            <span>
              <strong className="font-semibold text-ink">{orders.length}</strong> {orders.length === 1 ? "order" : "orders"}
            </span>
            {spentLabel && (
              <span>
                <strong className="font-semibold text-ink">{spentLabel}</strong> paid
              </span>
            )}
            {openCount > 0 && (
              <span className="text-warning">
                {openCount} awaiting payment
              </span>
            )}
          </div>

          <ul className="space-y-3" aria-label="Your orders">
            {shown.map((o) => {
              const orderHref = `/billing/success/${encodeURIComponent(o.orderId)}`;
              const invoiced = hasInvoice(o) && !!o.invoiceNumber && o.amount > 0;
              const online = isRealGateway(o.gateway);
              return (
                <li key={o.id} className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
                  <div className="flex gap-4">
                    <div className="hidden w-28 shrink-0 sm:block">
                      <ItemThumb imageUrl={o.imageUrl} gradient={o.gradient} title={o.itemTitle} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{ITEM_TYPE_LABELS[o.itemType]}</p>
                          {o.itemHref ? (
                            <Link href={o.itemHref} className="font-semibold leading-snug text-ink hover:text-accent hover:underline">
                              {o.itemTitle}
                            </Link>
                          ) : (
                            <p className="font-semibold leading-snug text-ink">{o.itemTitle}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums text-ink">{money(o.amount, o.currency)}</p>
                          {o.discountAmount > 0 && (
                            <p className="text-xs text-ink-muted line-through tabular-nums" aria-label={`Original price ${money(o.originalAmount, o.currency)}`}>
                              {money(o.originalAmount, o.currency)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
                        <PaymentStatusBadge status={o.status} failureReason={o.failureReason} refundedAmount={o.refundedAmount} amount={o.amount} audience="learner" />
                        <span className="font-mono">{o.orderId}</span>
                        <span>{formatDate(o.createdAt)}</span>
                        <span>{gatewayLabel(o.gateway)}</span>
                        {o.couponCode && <span>Coupon {o.couponCode}</span>}
                      </div>

                      {o.status === "failed" && o.failureReason && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
                          <Icon.AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                          {o.failureReason}
                        </p>
                      )}
                      {o.refundedAt && (
                        <p className="mt-2 text-xs text-ink-muted">
                          {money(o.refundedAmount ?? o.amount, o.currency)} refunded on {formatDate(o.refundedAt)}.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {o.status === "pending" && online && <ResumePaymentButton orderId={o.orderId} gateway={o.gateway} size="sm" />}
                        {o.status === "pending" && !online && (
                          <ButtonLink href={orderHref} size="sm" leftIcon={<Icon.Receipt className="size-4" />}>
                            Payment instructions
                          </ButtonLink>
                        )}
                        {invoiced && (
                          <ButtonLink href={`/billing/invoice/${encodeURIComponent(o.orderId)}`} variant="outline" size="sm" leftIcon={<Icon.FileText className="size-4" />}>
                            Invoice {o.invoiceNumber}
                          </ButtonLink>
                        )}
                        <ButtonLink href={orderHref} variant="ghost" size="sm">
                          Order details
                        </ButtonLink>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {orders.length > shown.length && (
            <div className="flex items-center justify-between gap-2 text-sm text-ink-muted">
              <span>
                Showing {shown.length} of {orders.length}
              </span>
              <ButtonLink href={`/billing/history?limit=${limit + PAGE_SIZE}`} variant="outline" size="sm">
                Show more
              </ButtonLink>
            </div>
          )}
        </div>
      )}
    </>
  );
}
