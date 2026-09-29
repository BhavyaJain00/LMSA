import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface PaymentReceiptData {
  name: string;
  orderId: string;
  invoiceNumber?: string;
  itemTitle: string;
  /** "Course", "Batch" or "Certificate". */
  itemLabel: string;
  /** Pre-formatted money values. */
  originalAmount: string;
  discountAmount?: string;
  couponCode?: string;
  taxAmount?: string;
  taxLabel?: string;
  total: string;
  paidAt: string;
  gateway: string;
  gatewayPaymentId?: string;
  billingName?: string;
  /** Where the learner accesses what they bought. */
  accessUrl: string;
  /** Printable invoice / order page. */
  invoiceUrl?: string;
  footer?: EmailFooter;
}

/** Payment receipt (sent whenever email is enabled; receipts cannot be unsubscribed). */
export function paymentReceiptEmail(brand: EmailBrand, data: PaymentReceiptData): RenderedEmail {
  const subject = `Receipt for ${data.itemTitle} (${data.orderId})`;
  const rows = [
    { label: data.itemLabel, value: data.itemTitle },
    { label: "Price", value: data.originalAmount },
    { label: data.couponCode ? `Discount (${data.couponCode})` : "Discount", value: data.discountAmount ?? "" },
    { label: data.taxLabel ?? "Tax", value: data.taxAmount ?? "" },
    { label: "Total paid", value: data.total },
  ];
  const meta = [
    { label: "Order", value: data.orderId },
    { label: "Invoice", value: data.invoiceNumber ?? "" },
    { label: "Paid on", value: data.paidAt },
    { label: "Payment method", value: data.gateway },
    { label: "Payment ID", value: data.gatewayPaymentId ?? "" },
    { label: "Billed to", value: data.billingName ?? "" },
  ];
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: `Thank you for your purchase. Your payment for ${data.itemTitle} was received and your access is active.` },
    { type: "details", title: "Order summary", rows },
    { type: "details", title: "Payment details", rows: meta },
    { type: "button", label: data.itemLabel === "Certificate" ? "View your certificate" : `Go to your ${data.itemLabel.toLowerCase()}`, url: data.accessUrl },
  ];
  if (data.invoiceUrl) blocks.push({ type: "muted", text: `Need an invoice for your records? Open the order page: ${data.invoiceUrl}` });
  blocks.push({ type: "muted", text: "Keep this email as your receipt." });
  return renderEmail(brand, subject, {
    preheader: `${data.total} paid for ${data.itemTitle}.`,
    eyebrow: "Payment receipt",
    heading: "Thanks for your payment",
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    footer: data.footer,
  });
}

export interface PaymentReminderData {
  name: string;
  orderId: string;
  itemTitle: string;
  amount: string;
  createdAt: string;
  /** Where the learner completes the payment. */
  checkoutUrl: string;
  footer?: EmailFooter;
}

/** Reminder for an unpaid order. */
export function paymentReminderEmail(brand: EmailBrand, data: PaymentReminderData): RenderedEmail {
  const subject = `Complete your order for ${data.itemTitle}`;
  return renderEmail(brand, subject, {
    preheader: `Your order ${data.orderId} is still awaiting payment.`,
    eyebrow: "Payment reminder",
    heading: "Your order is waiting",
    greeting: `Hi ${firstName(data.name)},`,
    blocks: [
      { type: "paragraph", text: `You started an order for ${data.itemTitle} but the payment hasn't been completed yet. Finish checking out to secure your access.` },
      {
        type: "details",
        rows: [
          { label: "Order", value: data.orderId },
          { label: "Item", value: data.itemTitle },
          { label: "Amount", value: data.amount },
          { label: "Started", value: data.createdAt },
        ],
      },
      { type: "button", label: "Complete payment", url: data.checkoutUrl },
      { type: "muted", text: "Already paid or changed your mind? You can ignore this email." },
    ],
    footer: data.footer,
  });
}

export interface PaymentRefundData {
  name: string;
  orderId: string;
  itemTitle: string;
  refundedAmount: string;
  refundedAt: string;
  gateway: string;
  refundId?: string;
  orderUrl: string;
  footer?: EmailFooter;
}

/** Refund confirmation. */
export function paymentRefundEmail(brand: EmailBrand, data: PaymentRefundData): RenderedEmail {
  const subject = `Your refund for ${data.itemTitle}`;
  return renderEmail(brand, subject, {
    preheader: `${data.refundedAmount} refunded for order ${data.orderId}.`,
    eyebrow: "Refund",
    heading: "Your refund has been processed",
    greeting: `Hi ${firstName(data.name)},`,
    blocks: [
      { type: "paragraph", text: `We've refunded your payment for ${data.itemTitle}. Depending on your bank or card issuer, it can take 5–10 business days to appear on your statement.` },
      {
        type: "details",
        rows: [
          { label: "Order", value: data.orderId },
          { label: "Refunded", value: data.refundedAmount },
          { label: "Date", value: data.refundedAt },
          { label: "Payment method", value: data.gateway },
          { label: "Refund ID", value: data.refundId ?? "" },
        ],
      },
      { type: "button", label: "View order", url: data.orderUrl },
    ],
    footer: data.footer,
  });
}
