import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { gatewayLabel, getBillingItem, getPaymentByOrderId, ITEM_TYPE_LABELS } from "@/lib/data/commerce";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import { backfillInvoiceNumbers, formatAddressLines, hasInvoice, needsInvoiceNumber } from "@/lib/payments/invoice";
import { isRealGateway, syncPaymentStatus } from "@/lib/payments/gateway";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import { CancelOrderButton } from "@/components/commerce/order-actions";
import { ResumePaymentButton } from "@/components/commerce/resume-payment-button";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Order" };

const GATEWAY_NAME: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

export default async function OrderPage(props: PageProps<"/billing/success/[orderId]">) {
  const { orderId } = await props.params;
  const user = await requireUser(`/billing/success/${encodeURIComponent(orderId)}`);
  const found = await getPaymentByOrderId(orderId);
  if (!found || (found.userId !== user.id && !isAdmin(user))) notFound();

  // A learner coming back from Stripe/Razorpay before the webhook arrived: ask the gateway directly.
  let processing = false;
  if (found.status === "pending" && isRealGateway(found.gateway) && found.gatewayOrderId) {
    const state = await syncPaymentStatus({ ...found }, { timeoutMs: 6_000 });
    processing = state.state === "processing";
  }
  if (needsInvoiceNumber(found)) await backfillInvoiceNumbers();
  const payment = (await getPaymentByOrderId(orderId)) ?? found;

  const db = await getDb();
  const item = await getBillingItem(payment.itemType, payment.itemId);
  const own = payment.userId === user.id;
  const settings = db.settings;
  const checkoutHref = `/billing/${payment.itemType}/${payment.itemId}`;
  const invoiceHref = `/billing/invoice/${encodeURIComponent(payment.orderId)}`;
  const invoiced = hasInvoice(payment);
  const online = isRealGateway(payment.gateway);
  const gatewayName = GATEWAY_NAME[payment.gateway] ?? gatewayLabel(payment.gateway);

  // Next steps for the order.
  const actions: ReactNode[] = [];
  let heading = "";
  let message: ReactNode = null;
  let tone: "success" | "warning" | "neutral" | "danger" = "success";

  if (payment.status === "paid") {
    heading = payment.amount > 0 ? "Payment successful" : "You're enrolled";
    if (payment.itemType === "course" && item?.course) {
      const course = item.course;
      const next = own ? await getNextLesson(course, user) : null;
      message = <>You now have full access to <strong className="text-ink">{course.title}</strong>. Happy learning!</>;
      actions.push(
        <ButtonLink key="go" href={next ? lessonHref(course.slug, next) : `/courses/${course.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
          Start learning
        </ButtonLink>,
        <ButtonLink key="course" href={`/courses/${course.slug}`} variant="outline">
          Go to course
        </ButtonLink>,
      );
    } else if (payment.itemType === "batch" && item?.batch) {
      const batch = item.batch;
      const seated = db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === payment.userId);
      message = seated ? (
        <>Your seat in <strong className="text-ink">{batch.title}</strong> is confirmed. It starts on {batch.startDate} at {batch.startTime} ({batch.timezone}).</>
      ) : (
        <>Your payment was recorded, but a seat in <strong className="text-ink">{batch.title}</strong> could not be allocated. Our team will contact you.</>
      );
      if (!seated) tone = "warning";
      actions.push(
        <ButtonLink key="go" href={`/batches/${batch.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
          Go to batch
        </ButtonLink>,
      );
    } else if (payment.itemType === "certificate" && item?.course) {
      const course = item.course;
      const cert = db.certificates.find((c) => c.userId === payment.userId && c.courseId === course.id && c.published);
      if (cert) {
        message = <>Your certificate for <strong className="text-ink">{course.title}</strong> is ready.</>;
        actions.push(
          <ButtonLink key="cert" href={`/certificates/${cert.code}`} leftIcon={<Icon.Certificate className="size-4" />}>
            View certificate
          </ButtonLink>,
        );
      } else {
        message = <>Your certificate is unlocked. Finish every lesson of <strong className="text-ink">{course.title}</strong> to receive it.</>;
        actions.push(
          <ButtonLink key="cert" href={`/courses/${course.slug}/certification`} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Go to certification
          </ButtonLink>,
          <ButtonLink key="course" href={`/courses/${course.slug}`} variant="outline">
            Continue the course
          </ButtonLink>,
        );
      }
    } else {
      message = <>Thanks for your purchase of {payment.itemTitle}.</>;
    }
    if (invoiced && payment.amount > 0) {
      actions.push(
        <ButtonLink key="invoice" href={invoiceHref} variant="outline" leftIcon={<Icon.Receipt className="size-4" />}>
          View invoice
        </ButtonLink>,
      );
    }
  } else if (payment.status === "pending" && online) {
    tone = "warning";
    if (processing) {
      heading = "Payment processing";
      message = (
        <>
          {gatewayName} is still confirming your payment of <strong className="text-ink">{money(payment.amount, payment.currency)}</strong>. Some payment methods take a few
          minutes (bank debits can take a few days). You&apos;ll be enrolled and notified automatically.
        </>
      );
    } else {
      heading = "Complete your payment";
      message = (
        <>
          Your order is saved, but the payment of <strong className="text-ink">{money(payment.amount, payment.currency)}</strong> hasn&apos;t been completed yet. Nothing has
          been charged. Continue with {gatewayName} to get access.
        </>
      );
    }
  } else if (payment.status === "pending") {
    tone = "warning";
    heading = "Order placed — awaiting confirmation";
    message = (
      <>
        Complete your payment of <strong className="text-ink">{money(payment.amount, payment.currency)}</strong> and include your order ID{" "}
        <span className="font-mono font-semibold text-ink">{payment.orderId}</span> as the reference. You&apos;ll be enrolled automatically and notified as soon as an administrator
        confirms the payment.
      </>
    );
  } else if (payment.status === "failed") {
    tone = payment.failureReason ? "danger" : "neutral";
    heading = payment.failureReason ? "Payment failed" : "Order cancelled";
    message = payment.failureReason ? (
      <>
        The payment didn&apos;t go through: <span className="text-ink">{payment.failureReason}</span> Nothing was charged for this order. You can try again with the same or
        another payment method.
      </>
    ) : (
      <>This order was cancelled and no payment is expected. You can check out again whenever you&apos;re ready.</>
    );
    if (own && item) {
      actions.push(
        <ButtonLink key="again" href={checkoutHref}>
          {payment.failureReason ? "Try again" : "Checkout again"}
        </ButtonLink>,
      );
    }
  } else {
    tone = "danger";
    const partial = payment.refundedAmount !== undefined && payment.refundedAmount > 0 && payment.refundedAmount < payment.amount;
    heading = partial ? "Order partially refunded" : "Order refunded";
    message = (
      <>
        {money(payment.refundedAmount ?? payment.amount, payment.currency)} was refunded
        {payment.refundedAt ? ` on ${formatDateTime(payment.refundedAt)}` : ""} and the access this order granted has been removed.
        {isRealGateway(payment.gateway) && payment.refundId ? " Refunds usually reach your account within 5–10 business days." : ""}
      </>
    );
    if (invoiced) {
      actions.push(
        <ButtonLink key="invoice" href={invoiceHref} variant="outline" leftIcon={<Icon.Receipt className="size-4" />}>
          View invoice
        </ButtonLink>,
      );
    }
    if (own && item) {
      actions.push(
        <ButtonLink key="again" href={checkoutHref} variant="outline">
          Buy again
        </ButtonLink>,
      );
    }
  }

  const toneClasses = {
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    neutral: "bg-surface-2 text-ink-muted",
    danger: "bg-danger/12 text-danger",
  }[tone];
  const toneIcon = {
    success: <Icon.CheckCircle className="size-7" />,
    warning: <Icon.Clock className="size-7" />,
    neutral: <Icon.XCircle className="size-7" />,
    danger: payment.status === "refunded" ? <Icon.Refresh className="size-7" /> : <Icon.AlertCircle className="size-7" />,
  }[tone];

  const address = formatAddressLines(payment.address).join(", ");
  const showPendingActions = own && payment.status === "pending";

  return (
    <>
      <PageHeader
        title="Order"
        breadcrumbs={<Breadcrumbs items={[own ? { label: "Orders", href: "/billing/history" } : { label: "Transactions", href: "/admin/settings/transactions" }, { label: payment.orderId }]} />}
        actions={
          invoiced && payment.amount > 0 ? (
            <ButtonLink href={invoiceHref} variant="outline" size="sm" leftIcon={<Icon.Receipt className="size-4" />}>
              Invoice {payment.invoiceNumber}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-status-heading">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>{toneIcon}</span>
              <div className="min-w-0">
                <h2 id="order-status-heading" className="text-xl font-semibold tracking-tight text-ink">
                  {heading}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{message}</p>
                {!own && (
                  <p className="mt-2 text-xs text-ink-muted">
                    You are viewing another member&apos;s order as an administrator.{" "}
                    <Link href={`/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`} className="font-medium text-accent hover:underline">
                      Open in Transactions
                    </Link>
                  </p>
                )}
                {(actions.length > 0 || showPendingActions) && (
                  <div className="mt-5 flex flex-wrap items-start gap-2">
                    {showPendingActions && online && !processing && <ResumePaymentButton orderId={payment.orderId} gateway={payment.gateway} />}
                    {actions}
                    {showPendingActions && !processing && <CancelOrderButton orderId={payment.orderId} online={online} />}
                  </div>
                )}
              </div>
            </div>
            {payment.status === "pending" && !online && (
              <div className="mt-6 rounded-xl border border-border bg-surface-2 p-4 text-sm">
                <p className="font-medium text-ink">How to pay</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-muted">
                  <li>
                    Transfer <strong className="text-ink">{money(payment.amount, payment.currency)}</strong> using the payment details shared by our team.
                  </li>
                  <li>
                    Use <span className="font-mono text-ink">{payment.orderId}</span> as the payment reference.
                  </li>
                  <li>We confirm the payment and enroll you — you&apos;ll get a notification.</li>
                </ol>
                {(settings.contact.email || settings.contact.url) && (
                  <p className="mt-3 text-ink-muted">
                    Need the payment details or have a question?{" "}
                    {settings.contact.email ? (
                      <a href={`mailto:${settings.contact.email}?subject=${encodeURIComponent(`Payment for order ${payment.orderId}`)}`} className="font-medium text-accent hover:underline">
                        {settings.contact.email}
                      </a>
                    ) : (
                      <a href={settings.contact.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                        Contact us
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-details-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="order-details-heading" className="text-base font-semibold text-ink">
                Order details
              </h2>
              <PaymentStatusBadge status={payment.status} failureReason={payment.failureReason} refundedAmount={payment.refundedAmount} amount={payment.amount} audience="learner" />
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailItem label="Order ID">
                <span className="font-mono">{payment.orderId}</span>
              </DetailItem>
              <DetailItem label="Placed on">{formatDateTime(payment.createdAt)}</DetailItem>
              <DetailItem label="Item">
                {item ? (
                  <Link href={item.href} className="text-accent hover:underline">
                    {ITEM_TYPE_LABELS[payment.itemType]} · {payment.itemTitle}
                  </Link>
                ) : (
                  <>
                    {ITEM_TYPE_LABELS[payment.itemType]} · {payment.itemTitle}
                  </>
                )}
              </DetailItem>
              <DetailItem label="Payment method">{gatewayLabel(payment.gateway)}</DetailItem>
              <DetailItem label="Billing name">{payment.billingName}</DetailItem>
              <DetailItem label="Billing address">{address || "—"}</DetailItem>
              {payment.paidAt && <DetailItem label="Paid on">{formatDateTime(payment.paidAt)}</DetailItem>}
              {payment.invoiceNumber && (
                <DetailItem label="Invoice">
                  <Link href={invoiceHref} className="font-mono text-accent hover:underline">
                    {payment.invoiceNumber}
                  </Link>
                </DetailItem>
              )}
              {payment.gatewayPaymentId && (
                <DetailItem label="Payment ID">
                  <span className="font-mono text-xs">{payment.gatewayPaymentId}</span>
                </DetailItem>
              )}
              {payment.status === "failed" && payment.failureReason && <DetailItem label="Reason">{payment.failureReason}</DetailItem>}
              {payment.refundedAt && (
                <DetailItem label="Refunded">
                  {money(payment.refundedAmount ?? payment.amount, payment.currency)} · {formatDateTime(payment.refundedAt)}
                </DetailItem>
              )}
              {(payment.gstin || payment.pan) && (
                <DetailItem label="GSTIN / PAN">
                  {payment.gstin ?? "—"} / {payment.pan ?? "—"}
                </DetailItem>
              )}
            </dl>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20">
          <OrderSummary
            itemType={payment.itemType}
            title={item ? (payment.itemType === "certificate" ? item.name : item.title) : payment.itemTitle}
            subtitle={payment.itemType === "certificate" ? "Certificate of completion" : item?.description}
            imageUrl={item?.imageUrl}
            gradient={item?.gradient}
            lines={{
              currency: payment.currency,
              originalAmount: payment.originalAmount,
              discountAmount: payment.discountAmount,
              taxAmount: payment.taxAmount,
              taxLabel: settings.commerce.taxLabel,
              total: payment.amount,
              couponCode: payment.couponCode,
            }}
          />
        </aside>
      </div>
    </>
  );
}
