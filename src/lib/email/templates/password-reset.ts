import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface PasswordResetEmailData {
  name: string;
  resetUrl: string;
  /** Link lifetime shown to the user. */
  expiresInMinutes?: number;
  /** Optional request context shown to help spot unwanted requests. */
  requestedAt?: string;
  ipAddress?: string;
  footer?: EmailFooter;
}

export function formatLifetime(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Password reset link (transactional — always sent). */
export function passwordResetEmail(brand: EmailBrand, data: PasswordResetEmailData): RenderedEmail {
  const minutes = data.expiresInMinutes ?? 60;
  const rows: { label: string; value: string }[] = [];
  if (data.requestedAt) rows.push({ label: "Requested", value: data.requestedAt });
  if (data.ipAddress) rows.push({ label: "From IP address", value: data.ipAddress });
  const blocks: EmailBlock[] = [
    {
      type: "paragraph",
      text: `We received a request to reset the password for your ${brand.name} account. Click the button below to choose a new one.`,
    },
    { type: "button", label: "Choose a new password", url: data.resetUrl, fallback: true },
    {
      type: "muted",
      text: `This link expires in ${formatLifetime(minutes)} and can only be used once. Resetting your password signs you out on every device.`,
    },
  ];
  if (rows.length) blocks.push({ type: "details", rows });
  blocks.push({
    type: "callout",
    tone: "warning",
    text: "Didn't ask for this? You can safely ignore this email — your password won't change unless you open the link above.",
  });
  return renderEmail(brand, `Reset your ${brand.name} password`, {
    preheader: `Use this link to choose a new password. It expires in ${formatLifetime(minutes)}.`,
    heading: "Reset your password",
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    footer: data.footer ?? { reason: `You received this email because a password reset was requested for your ${brand.name} account.` },
  });
}
