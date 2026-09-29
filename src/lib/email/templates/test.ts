import { type EmailBrand, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface TestEmailData {
  /** Admin who triggered the test. */
  requestedBy: string;
  /** e.g. "SMTP · smtp.example.com:587 · STARTTLS" */
  transportLabel: string;
  sentAt: string;
  outboxUrl: string;
}

/** Test message from Admin → Settings → Email or the outbox. */
export function testEmail(brand: EmailBrand, data: TestEmailData): RenderedEmail {
  return renderEmail(brand, `Test email from ${brand.name}`, {
    preheader: "If you can read this, email delivery works.",
    eyebrow: "Test email",
    heading: "Email delivery works",
    greeting: `Hi ${firstName(data.requestedBy)},`,
    blocks: [
      { type: "paragraph", text: `This is a test message from ${brand.name}. If it reached your inbox, your email settings are working.` },
      {
        type: "details",
        rows: [
          { label: "Sent", value: data.sentAt },
          { label: "Transport", value: data.transportLabel },
          { label: "Requested by", value: data.requestedBy },
        ],
      },
      { type: "callout", tone: "info", text: "Check that the sender name, reply-to address, logo and footer look right, and that the message didn't land in spam." },
      { type: "button", label: "Open the outbox", url: data.outboxUrl },
    ],
    footer: { reason: "You received this email because an administrator sent a test message to this address." },
  });
}
