import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { gatewayLabel, getBillingItem, getPaymentByOrderId, ITEM_TYPE_LABELS } from "@/lib/data/commerce";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/transactions-table";
import { CancelOrderButton, PrintReceiptButton } from "@/components/commerce/order-actions";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Order" };

export default async function OrderPage(props: PageProps<"/billing/success/[orderId]">) {
  const { orderId } = await props.params;
  const user = await requireUser(`/billing/success/${orderId}`);
  const payment = await getPaymentByOrderId(orderId);
  if (!payment || (payment.userId !== user.id && !isAdmin(user))) notFound();

  const db = await getDb();
  const item = await getBillingItem(payment.itemType, payment.itemId);
  const own = payment.userId === user.id;
  const settings = db.settings;
  const checkoutHref = `/billing/${payment.itemType}/${payment.itemId}`;

  // Next steps for a completed order.
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
    tone = "neutral";
    heading = "Order cancelled";
    message = <>This order was cancelled and no payment is expected. You can check out again whenever you&apos;re ready.</>;
    if (own && item) {
      actions.push(
        <ButtonLink key="again" href={checkoutHref}>
          Checkout again
        </ButtonLink>,
      );
    }
  } else {
    tone = "danger";
    heading = "Order refunded";
    message = <>This order was refunded and the access it granted has been removed.</>;
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
    danger: <Icon.Refresh className="size-7" />,
  }[tone];

  const address = payment.address
    ? [payment.address.line1, payment.address.line2, payment.address.city, payment.address.state, payment.address.pincode, payment.address.country].filter(Boolean).join(", ")
    : null;

  return (
    <>
      <PageHeader
        title="Order"
        breadcrumbs={
          <Breadcrumbs
            items={[
              ...(item ? [{ label: item.name, href: item.href }] : []),
              { label: payment.orderId },
            ]}
          />
        }
        actions={<PrintReceiptButton />}
      />
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>{toneIcon}</span>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-ink">{heading}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{message}</p>
                {!own && (
                  <p className="mt-2 text-xs text-ink-muted">
                    You are viewing another member&apos;s order as an administrator.{" "}
                    <Link href={`/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`} className="font-medium text-accent hover:underline">
                      Open in Transactions
                    </Link>
                  </p>
                )}
                {(actions.length > 0 || (own && payment.status === "pending")) && (
                  <div className="mt-5 flex flex-wrap items-center gap-2 print:hidden">
                    {actions}
                    {own && payment.status === "pending" && <CancelOrderButton orderId={payment.orderId} />}
                  </div>
                )}
              </div>
            </div>
            {payment.status === "pending" && (
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

          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Order details</h2>
              <PaymentStatusBadge status={payment.status} />
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailItem label="Order ID">
                <span className="font-mono">{payment.orderId}</span>
              </DetailItem>
              <DetailItem label="Placed on">{formatDateTime(payment.createdAt)}</DetailItem>
              <DetailItem label="Item">
                {ITEM_TYPE_LABELS[payment.itemType]} · {payment.itemTitle}
              </DetailItem>
              <DetailItem label="Payment method">{gatewayLabel(payment.gateway)}</DetailItem>
              <DetailItem label="Billing name">{payment.billingName}</DetailItem>
              <DetailItem label="Billing address">{address ?? "—"}</DetailItem>
              {payment.paidAt && <DetailItem label="Paid on">{formatDateTime(payment.paidAt)}</DetailItem>}
              {payment.gatewayPaymentId && (
                <DetailItem label="Payment ID">
                  <span className="font-mono text-xs">{payment.gatewayPaymentId}</span>
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
