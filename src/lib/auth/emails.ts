import "server-only";
import type { User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import {
  enqueueEmail,
  getEmailBrand,
  sendEmailVerificationEmail as queueVerificationEmail,
  sendPasswordResetEmail as queueResetEmail,
} from "@/lib/email";
import { renderEmail, type EmailBlock } from "@/lib/email/templates";
import { AUTH_TOKEN_TTL_MS } from "./tokens";

/**
 * Transactional account emails. Links carry the raw one-time token and are
 * absolute (`APP_URL`). The branded templates and the outbox belong to the
 * email module (`@/lib/email`); it scrubs one-time tokens from stored bodies
 * once they are delivered.
 */

type Recipient = Pick<User, "id" | "email" | "name">;

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteConfig.appUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function passwordResetUrl(token: string): string {
  return absoluteUrl(`/reset-password?token=${encodeURIComponent(token)}`);
}

export function emailVerificationUrl(token: string): string {
  return absoluteUrl(`/verify-email?token=${encodeURIComponent(token)}`);
}

export async function sendPasswordResetEmail(user: Recipient, token: string, context: { ip?: string } = {}): Promise<void> {
  await queueResetEmail({
    user,
    resetUrl: passwordResetUrl(token),
    expiresInMinutes: Math.round(AUTH_TOKEN_TTL_MS.password_reset / 60_000),
    ipAddress: context.ip && context.ip !== "unknown" ? context.ip : undefined,
  });
}

export async function sendVerificationEmail(user: Recipient, token: string): Promise<void> {
  await queueVerificationEmail({
    user,
    verifyUrl: emailVerificationUrl(token),
    expiresInHours: Math.round(AUTH_TOKEN_TTL_MS.email_verification / 3_600_000),
  });
}

export type SecurityNotice = "password_changed" | "two_factor_enabled" | "two_factor_disabled" | "two_factor_reset" | "recovery_codes_regenerated";

const NOTICE_COPY: Record<SecurityNotice, { subject: string; heading: string; body: string }> = {
  password_changed: {
    subject: "Your password was changed",
    heading: "Your password was changed",
    body: "The password for your account was just changed, and your other devices were signed out.",
  },
  two_factor_enabled: {
    subject: "Two-step verification is on",
    heading: "Two-step verification turned on",
    body: "From now on, signing in to your account also asks for a code from your authenticator app. Keep your recovery codes somewhere safe.",
  },
  two_factor_disabled: {
    subject: "Two-step verification was turned off",
    heading: "Two-step verification turned off",
    body: "Two-step verification was turned off for your account. Signing in now only needs your password.",
  },
  two_factor_reset: {
    subject: "Two-step verification was reset by an administrator",
    heading: "Two-step verification was reset",
    body: "An administrator reset two-step verification on your account, for example because you lost access to your authenticator app. You were signed out everywhere; you can set it up again from your security settings.",
  },
  recovery_codes_regenerated: {
    subject: "New recovery codes were generated",
    heading: "New recovery codes generated",
    body: "A new set of two-step verification recovery codes was generated for your account. Your previous codes no longer work.",
  },
};

/** Informational email after a security-relevant change. Never throws. */
export async function sendSecurityNotice(user: Recipient, notice: SecurityNotice, context: { ip?: string; device?: string } = {}): Promise<void> {
  const copy = NOTICE_COPY[notice];
  try {
    const brand = await getEmailBrand();
    const rows = [{ label: "When", value: `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC` }];
    if (context.device) rows.push({ label: "Device", value: context.device });
    if (context.ip && context.ip !== "unknown") rows.push({ label: "IP address", value: context.ip });
    const blocks: EmailBlock[] = [
      { type: "paragraph", text: copy.body },
      { type: "details", rows },
      { type: "button", label: "Review security settings", url: absoluteUrl("/settings/security") },
      { type: "callout", tone: "warning", text: "If this wasn't you, reset your password right away and contact an administrator." },
    ];
    const first = user.name.trim().split(/\s+/)[0] || "there";
    const rendered = renderEmail(brand, copy.subject, {
      preheader: copy.body,
      heading: copy.heading,
      greeting: `Hi ${first},`,
      blocks,
      footer: { reason: `You received this security notice because of a change to your ${brand.name} account.` },
    });
    await enqueueEmail({ to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "other" });
  } catch (err) {
    console.error(`[auth] could not queue the ${notice} notice`, err instanceof Error ? err.message : err);
  }
}
