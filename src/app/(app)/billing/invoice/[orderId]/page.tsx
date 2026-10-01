import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { gatewayLabel, getPaymentByOrderId } from "@/lib/data/commerce";
import { backfillInvoiceNumbers, buildInvoiceView, needsInvoiceNumber } from "@/lib/payments/invoice";
import { paymentDashboardUrl } from "@/lib/payments/gateway";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { InvoiceSheet } from "@/components/commerce/invoice-sheet";
import { PrintButton } from "@/components/commerce/order-actions";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import "./invoice-print.css";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

export default async function InvoicePage(props: PageProps<"/billing/invoice/[orderId]">) {
  const { orderId } = await props.params;
  const user = await requireUser(`/billing/invoice/${encodeURIComponent(orderId)}`);
  const found = await getPaymentByOrderId(orderId);
  if (!found || (found.userId !== user.id && !isAdmin(user))) notFound();

  // Orders paid before invoices existed get their number the first time they are needed.
  if (needsInvoiceNumber(found)) await backfillInvoiceNumbers();
  const payment = (await getPaymentByOrderId(orderId)) ?? found;

  const db = await getDb();
  const own = payment.userId === user.id;
  const buyer = db.users.find((u) => u.id === payment.userId) ?? null;
  const invoice = buildInvoiceView(payment, { settings: db.settings, buyer, gatewayLabel: gatewayLabel(payment.gateway), taxRules: db.taxRules });
  const orderHref = `/billing/success/${encodeURIComponent(payment.orderId)}`;
  const dashboardUrl = !own && isAdmin(user) ? paymentDashboardUrl(payment) : null;

  const breadcrumbs = (
    <Breadcrumbs
      items={[
        own ? { label: "Orders", href: "/billing/history" } : { label: "Transactions", href: `/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}` },
        { label: payment.orderId, href: orderHref },
        { label: "Invoice" },
      ]}
    />
  );

  if (!invoice) {
    return (
      <>
        <PageHeader title="Invoice" breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={<Icon.Receipt />}
          title={payment.status === "pending" ? "No invoice for this order yet" : "No invoice for this order"}
          description={
            payment.status === "pending"
              ? "Invoices are issued as soon as the payment is received. Complete the payment to get yours."
              : payment.status === "paid" || payment.status === "refunded"
                ? "Nothing was charged for this order, so it has no invoice."
                : "This order was not paid, so there is no invoice for it."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={orderHref}>View order</ButtonLink>
              {own && (
                <ButtonLink href="/billing/history" variant="outline">
                  All orders
                </ButtonLink>
              )}
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="invoice-screen-only print:hidden">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Invoice <span className="font-mono text-lg text-ink-muted">{invoice.invoiceNumber}</span>
            </span>
          }
          description={
            own
              ? "Print it or choose “Save as PDF” in the print dialog to keep a copy."
              : `Invoice of ${payment.billingName}. You are viewing it as an administrator.`
          }
          breadcrumbs={breadcrumbs}
          actions={
            <>
              <PrintButton variant="primary" />
              <ButtonLink href={orderHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
                Order details
              </ButtonLink>
              {dashboardUrl && (
                <ButtonLink href={dashboardUrl} variant="ghost" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
                  {payment.gateway === "stripe" ? "Stripe" : "Razorpay"} dashboard
                </ButtonLink>
              )}
            </>
          }
        />
        {payment.status === "refunded" && (
          <p className="mx-auto mb-4 flex max-w-3xl items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink">
            <Icon.Refresh className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>
              This order was refunded. The invoice stays available for your records.{" "}
              <PaymentStatusBadge status={payment.status} refundedAmount={payment.refundedAmount} amount={payment.amount} />
            </span>
          </p>
        )}
        {!own && (
          <p className="mx-auto mb-4 max-w-3xl text-xs text-ink-muted">
            Need to correct the billing name or tax IDs?{" "}
            <Link href={`/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`} className="font-medium text-accent hover:underline">
              Edit the order in Transactions
            </Link>
            .
          </p>
        )}
      </div>
      <div className="pb-10">
        <InvoiceSheet invoice={invoice} />
      </div>
    </>
  );
}
