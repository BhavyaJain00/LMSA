import { type EmailBrand, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface EmailVerificationData {
  name: string;
  verifyUrl: string;
  expiresInHours?: number;
  footer?: EmailFooter;
}

/** Confirm-your-address email (transactional — always sent). */
export function emailVerificationEmail(brand: EmailBrand, data: EmailVerificationData): RenderedEmail {
  const hours = data.expiresInHours ?? 24;
  return renderEmail(brand, `Confirm your email address for ${brand.name}`, {
    preheader: "One click to confirm your email address.",
    heading: "Confirm your email address",
    greeting: `Hi ${firstName(data.name)},`,
    blocks: [
      {
        type: "paragraph",
        text: `Please confirm that this is the right email address for your ${brand.name} account. A confirmed address lets you enroll, receive certificates and recover your account.`,
      },
      { type: "button", label: "Confirm email address", url: data.verifyUrl, fallback: true },
      {
        type: "muted",
        text: `This link expires in ${hours} hour${hours === 1 ? "" : "s"}. If it has expired, request a new one from the security page of your account settings.`,
      },
      { type: "muted", text: `If you didn't create an account on ${brand.name}, you can ignore this email.` },
    ],
    footer: data.footer ?? { reason: `You received this email because this address was used to sign up on ${brand.name}.` },
  });
}
