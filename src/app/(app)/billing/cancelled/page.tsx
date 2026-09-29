import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getBillingItem, getPaymentByOrderId, ITEM_TYPE_LABELS } from "@/lib/data/commerce";
import { isRealGateway, syncPaymentStatus } from "@/lib/payments/gateway";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { ItemThumb, money } from "@/components/commerce/order-summary";
import { CancelOrderButton } from "@/components/commerce/order-actions";
import { ResumePaymentButton } from "@/components/commerce/resume-payment-button";

export const metadata = { title: "Payment cancelled" };

/**
 * Where Stripe's "back" link and a dismissed Razorpay window land. Nothing
 * was charged; the order stays open so the learner can try again, or cancel it.
 */
export default async function PaymentCancelledPage(props: PageProps<"/billing/cancelled">) {
  const sp = await props.searchParams;
  const orderId = typeof sp.order === "string" ? sp.order.trim().slice(0, 64) : "";
  const user = await requireUser(`/billing/cancelled${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`);

  const found = orderId ? await getPaymentByOrderId(orderId) : null;
  const mine = found && found.userId === user.id ? found : null;
  if (mine && mine.status === "pending" && isRealGateway(mine.gateway) && mine.gatewayOrderId) {
    // The learner may have paid in another tab (or the gateway redirected here after a late success).
    await syncPaymentStatus({ ...mine }, { timeoutMs: 6_000 });
  }
  const payment = mine ? ((await getPaymentByOrderId(mine.orderId)) ?? mine) : null;
  if (payment?.status === "paid") redirect(`/billing/success/${encodeURIComponent(payment.orderId)}`);

  const item = payment ? await getBillingItem(payment.itemType, payment.itemId) : null;
  const checkoutHref = payment ? `/billing/${payment.itemType}/${payment.itemId}` : "/courses";
  const orderHref = payment ? `/billing/success/${encodeURIComponent(payment.orderId)}` : "/billing/history";
  const online = payment ? isRealGateway(payment.gateway) : false;

  let heading = "Payment cancelled";
  let body = "Nothing was charged. You can pick up where you left off whenever you're ready.";
  if (payment?.status === "pending") {
    body = "Nothing was charged. Your order is saved, so you can finish paying now or later from your orders.";
  } else if (payment?.status === "failed") {
    heading = payment.failureReason ? "Payment not completed" : "Order cancelled";
    body = payment.failureReason
      ? `${payment.failureReason} Nothing was charged. Start a new checkout to try again.`
      : "This order was cancelled and nothing was charged. Start a new checkout whenever you're ready.";
  } else if (payment?.status === "refunded") {
    heading = "Order refunded";
    body = "This order was refunded. You can buy it again at any time.";
  }

  return (
    <>
      <PageHeader
        title="Payment cancelled"
        breadcrumbs={<Breadcrumbs items={[{ label: "Orders", href: "/billing/history" }, ...(payment ? [{ label: payment.orderId, href: orderHref }] : []), { label: "Cancelled" }]} />}
      />
      <div className="mx-auto w-full max-w-xl pb-10">
        <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="cancelled-heading">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
              <Icon.XCircle className="size-7" />
            </span>
            <h2 id="cancelled-heading" className="mt-4 text-xl font-semibold tracking-tight text-ink">
              {heading}
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>
          </div>

          {payment && (
            <div className="mt-6 flex items-center gap-4 rounded-xl border border-border bg-surface-2 p-3">
              <div className="w-24 shrink-0">
                <ItemThumb imageUrl={item?.imageUrl} gradient={item?.gradient} title={payment.itemTitle} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{ITEM_TYPE_LABELS[payment.itemType]}</p>
                <p className="truncate font-medium text-ink">{payment.itemTitle}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  <span className="font-mono">{payment.orderId}</span> · {money(payment.amount, payment.currency)}
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-start justify-center gap-2">
            {payment?.status === "pending" && online && <ResumePaymentButton orderId={payment.orderId} gateway={payment.gateway} label="Try again" />}
            {payment?.status === "pending" && !online && <ButtonLink href={orderHref}>Payment instructions</ButtonLink>}
            {payment && payment.status !== "pending" && item && <ButtonLink href={checkoutHref}>Start a new checkout</ButtonLink>}
            {item && (
              <ButtonLink href={item.href} variant="outline">
                Back to {payment?.itemType === "batch" ? "batch" : "course"}
              </ButtonLink>
            )}
            {!payment && (
              <>
                <ButtonLink href="/billing/history">Your orders</ButtonLink>
                <ButtonLink href="/courses" variant="outline">
                  Browse courses
                </ButtonLink>
              </>
            )}
            {payment?.status === "pending" && <CancelOrderButton orderId={payment.orderId} online={online} gateway={payment.gateway} />}
          </div>
        </section>
        <p className="mt-4 text-center text-xs text-ink-muted">
          Having trouble paying? Check your card details or try another payment method. All your orders are in{" "}
          <Link href="/billing/history" className="font-medium text-accent hover:underline">
            Orders &amp; invoices
          </Link>
          .
        </p>
      </div>
    </>
  );
}
