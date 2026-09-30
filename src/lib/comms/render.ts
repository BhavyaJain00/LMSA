import "server-only";
import type { Settings } from "@/lib/types";
import { brandFromSettings } from "@/lib/email/context";
import { fillPlaceholders, personalize, prepareMarkdown, type PreparedMarkdown } from "@/lib/email/personalize";
import { preferencesUrl, unsubscribeUrl } from "@/lib/email/signing";
import { renderEmail, type EmailBrand, type EmailFooter, type RenderedEmail } from "@/lib/email/templates";
import { leadUnsubscribeUrl } from "@/lib/seo/lead-tokens";
import { PERSONAL_KEYS, URL_KEYS, personalValues, type CampaignContent } from "./campaign-core";
import type { SegmentRecipient } from "./segments";

/**
 * Rendering of marketing emails (broadcasts and sequence steps).
 *
 * The markdown body is parsed once per send (`prepareCampaign`) and then
 * personalised per recipient (`renderCampaignEmail`): recipient values are
 * inserted after parsing and HTML-escaped, so a name can never add markup or
 * links. Every copy carries the recipient's own unsubscribe link — members
 * unsubscribe from the "Announcements" category, leads from the list.
 */

export interface PreparedCampaign {
  brand: EmailBrand;
  subject: string;
  preheader: string;
  body: PreparedMarkdown;
  /** Placeholder values that are the same for everyone. */
  shared: Record<string, string>;
}

/** Audience-wide values for sequence emails about a course. */
export function courseValues(course: { title: string; slug: string } | null | undefined, appUrl: string): Record<string, string> {
  const base = appUrl.replace(/\/+$/, "");
  return course
    ? { course_title: course.title, course_url: `${base}/courses/${encodeURIComponent(course.slug)}` }
    : { course_title: "your course", course_url: `${base}/courses` };
}

export function prepareCampaign(settings: Settings, content: CampaignContent, extraValues: Record<string, string> = {}): PreparedCampaign {
  const brand = brandFromSettings(settings);
  const shared = { site_name: brand.name, site_url: brand.appUrl, ...extraValues };
  return {
    brand,
    subject: content.subject,
    preheader: content.preheader ?? "",
    shared,
    body: prepareMarkdown(content.body, { values: shared, personalKeys: PERSONAL_KEYS, urlKeys: URL_KEYS, baseUrl: brand.appUrl, accentColor: brand.accentColor }),
  };
}

/** Who a copy is rendered for: a real recipient, or a staff member trying the email out. */
export type CampaignRecipient = SegmentRecipient | { kind: "test"; email: string; name: string; firstName: string; sentBy: string };

function footerFor(brand: EmailBrand, recipient: CampaignRecipient): EmailFooter {
  if (recipient.kind === "test") {
    return { reason: `Test email sent by ${recipient.sentBy}. Real recipients get their own unsubscribe link here.` };
  }
  if (recipient.kind === "member") {
    return {
      reason: `You're receiving this email because you have an account at ${brand.name}.`,
      preferencesUrl: preferencesUrl(),
      unsubscribeUrl: unsubscribeUrl(recipient.id, "announcements"),
      unsubscribeLabel: "Unsubscribe from announcements",
    };
  }
  return {
    reason: `You're receiving this email because you subscribed to updates from ${brand.name}.`,
    unsubscribeUrl: leadUnsubscribeUrl(recipient.id, recipient.email),
    unsubscribeLabel: "Unsubscribe",
  };
}

export function renderCampaignEmail(prepared: PreparedCampaign, recipient: CampaignRecipient, opts: { subjectPrefix?: string } = {}): RenderedEmail {
  const values = { ...prepared.shared, ...personalValues(recipient) };
  const body = personalize(prepared.body, values);
  const subject = `${opts.subjectPrefix ?? ""}${fillPlaceholders(prepared.subject, values)}`;
  return renderEmail(prepared.brand, subject, {
    preheader: prepared.preheader ? fillPlaceholders(prepared.preheader, values) : body.text.slice(0, 140),
    blocks: [{ type: "html", html: body.html, text: body.text }],
    footer: footerFor(prepared.brand, recipient),
  });
}
