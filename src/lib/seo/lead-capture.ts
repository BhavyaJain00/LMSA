import "server-only";
import type { Course, Lead } from "@/lib/types";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { enqueueEmail, getEmailBrand } from "@/lib/email";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email/templates/layout";
import { recordLead } from "@/lib/services/leads";
import { legalLinks } from "@/lib/legal/links";
import { siteConfig } from "@/lib/config";
import { coursePath } from "./content-index";
import { leadConfirmUrl, leadUnsubscribeUrl, isLeadId } from "./lead-tokens";
import { type LeadQuery, type LeadStats, filterLeads, leadStats, normalizeLeadSource } from "./leads";
import { isCoursePublic } from "./visibility";
import { paginate } from "./landing";

/**
 * Lead capture (round 3): store the sign-up, send the double opt-in email,
 * confirm and unsubscribe through signed links, deliver what was promised
 * (the course syllabus, or the free resources), and the admin list.
 *
 * Leads go through `recordLead` (services/leads.ts) so email sequences,
 * webhooks and analytics hear about them; sequences and broadcasts only ever
 * reach leads that confirmed (see `leadBlock` in comms/segments.ts).
 */

export interface CaptureInput {
  email: string;
  name?: string;
  /** Short label of the form ("blog", "course", "footer", "free"). */
  source: string;
  courseId?: string;
  consent: boolean;
}

export type CaptureResult = { ok: true; status: "confirmation_sent" | "already_confirmed"; lead: Lead } | { ok: false; error: string };

/** A course the lead form may name: it exists and is publicly visible. */
async function publicCourse(courseId: string | undefined): Promise<Course | null> {
  if (!courseId) return null;
  const course = (await getDb()).courses.find((c) => c.id === courseId);
  return course && isCoursePublic(course) ? course : null;
}

function leadFooter(brandName: string, lead: Pick<Lead, "id" | "email">) {
  return {
    reason: `You're receiving this email because this address was entered on ${brandName}.`,
    unsubscribeUrl: leadUnsubscribeUrl(lead.id, lead.email),
    unsubscribeLabel: "Unsubscribe",
  };
}

/** "Please confirm your subscription" (double opt-in). */
export async function renderConfirmationEmail(lead: Pick<Lead, "id" | "email" | "name">, course: Pick<Course, "title"> | null): Promise<RenderedEmail> {
  const brand = await getEmailBrand();
  const what = course ? `the syllabus of ${course.title}` : `free resources and updates from ${brand.name}`;
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: `You asked for ${what}. Please confirm that this address is yours and that you want to hear from us.` },
    { type: "button", label: "Confirm my email", url: leadConfirmUrl(lead.id, lead.email), fallback: true },
    { type: "muted", text: "The link works for 7 days. If you didn't sign up, ignore this email: you won't receive anything else." },
  ];
  return renderEmail(brand, `Confirm your email for ${brand.name}`, {
    preheader: `One click to confirm and receive ${what}.`,
    heading: lead.name ? `Almost there, ${lead.name.split(/\s+/)[0]}!` : "Almost there!",
    blocks,
    signoff: ["Thanks,", `The ${brand.name} team`],
  });
}

/** The course outline, chapter by chapter (sent after confirmation). */
export async function renderSyllabusEmail(lead: Pick<Lead, "id" | "email" | "name">, course: Course): Promise<RenderedEmail> {
  const [brand, db] = await Promise.all([getEmailBrand(), getDb()]);
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const blocks: EmailBlock[] = [{ type: "paragraph", text: course.shortIntroduction || `Here is everything ${course.title} covers.` }];
  chapters.forEach((chapter, ci) => {
    const lessons = db.lessons.filter((l) => l.chapterId === chapter.id).sort((a, b) => a.order - b.order);
    if (!lessons.length) return;
    blocks.push({
      type: "details",
      title: `${ci + 1}. ${chapter.title}`,
      rows: lessons.map((l, li) => ({ label: `${ci + 1}.${li + 1}`, value: l.includeInPreview ? `${l.title} (free preview)` : l.title })),
    });
  });
  if (course.outcomes.length) blocks.push({ type: "paragraph", text: "By the end you will be able to:" }, { type: "list", items: course.outcomes.slice(0, 8) });
  blocks.push({ type: "button", label: "See the course", url: `${siteConfig.appUrl}${coursePath(course.slug)}` });
  return renderEmail(brand, `Syllabus: ${course.title}`, {
    preheader: `The full outline of ${course.title}.`,
    eyebrow: "Course syllabus",
    heading: course.title,
    blocks,
    signoff: ["Happy learning,", `The ${brand.name} team`],
    footer: leadFooter(brand.name, lead),
  });
}

/** Welcome email after confirming from a page without a course (blog, footer, /free). */
export async function renderWelcomeLeadEmail(lead: Pick<Lead, "id" | "email" | "name">): Promise<RenderedEmail> {
  const brand = await getEmailBrand();
  const settings = await getSettings();
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: `You're subscribed. We'll send you new free lessons, practical guides and course announcements — no more than a few emails a month.` },
    { type: "button", label: "Browse the free resources", url: `${siteConfig.appUrl}/free` },
  ];
  if (settings.seo.blogEnabled) blocks.push({ type: "paragraph", text: "Until then, the blog has step-by-step articles on every topic we teach." }, { type: "button", label: "Read the blog", url: `${siteConfig.appUrl}/blog` });
  return renderEmail(brand, `Welcome to ${brand.name}`, {
    preheader: "Your subscription is confirmed.",
    heading: "You're in!",
    blocks,
    signoff: ["See you soon,", `The ${brand.name} team`],
    footer: leadFooter(brand.name, lead),
  });
}

async function send(lead: Lead, email: RenderedEmail): Promise<void> {
  await enqueueEmail({ to: lead.email, toName: lead.name, subject: email.subject, html: email.html, text: email.text, category: "other" });
}

/**
 * Store a sign-up and send the confirmation email. An address that already
 * confirmed (and did not unsubscribe) is not asked again: it receives the
 * syllabus it asked for straight away.
 */
export async function captureLead(input: CaptureInput): Promise<CaptureResult> {
  if (!input.consent) return { ok: false, error: "Please tick the box to agree to receive emails from us." };
  const course = await publicCourse(input.courseId);
  const kind = normalizeLeadSource(input.source);
  const source = course ? `${kind}:${course.id}`.toLowerCase().slice(0, 80) : kind;
  const recorded = await recordLead({ email: input.email, name: input.name, source, courseId: course?.id, consent: true });
  if (!recorded.ok) return recorded;
  const { lead } = recorded;
  if (lead.confirmedAt && !lead.unsubscribedAt) {
    if (course) await send(lead, await renderSyllabusEmail(lead, course));
    return { ok: true, status: "already_confirmed", lead };
  }
  await send(lead, await renderConfirmationEmail(lead, course));
  return { ok: true, status: "confirmation_sent", lead };
}

export async function getLead(leadId: string | undefined | null): Promise<Lead | null> {
  if (!isLeadId(leadId)) return null;
  return (await getDb()).leads.find((l) => l.id === leadId) ?? null;
}

export type ConfirmResult = { lead: Lead; course: Course | null; firstTime: boolean };

/**
 * Mark a lead as confirmed (the link was checked by the caller) and deliver
 * what it signed up for. Confirming again changes nothing and sends nothing.
 */
export async function confirmLead(leadId: string): Promise<ConfirmResult | null> {
  const now = new Date().toISOString();
  const result = await mutate((db) => {
    const lead = db.leads.find((l) => l.id === leadId);
    if (!lead) return null;
    const firstTime = !lead.confirmedAt || !!lead.unsubscribedAt;
    if (firstTime) {
      lead.confirmedAt = now;
      lead.unsubscribedAt = undefined;
      lead.consent = true;
    }
    return { lead: { ...lead }, firstTime };
  });
  if (!result) return null;
  const course = await publicCourse(result.lead.courseId);
  if (result.firstTime) await send(result.lead, course ? await renderSyllabusEmail(result.lead, course) : await renderWelcomeLeadEmail(result.lead));
  return { ...result, course };
}

/** Stop all marketing email to a lead (sequences and broadcasts check `unsubscribedAt`). */
export async function unsubscribeLead(leadId: string): Promise<Lead | null> {
  const now = new Date().toISOString();
  return mutate((db) => {
    const lead = db.leads.find((l) => l.id === leadId);
    if (!lead) return null;
    lead.unsubscribedAt ??= now;
    return { ...lead };
  });
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const LEADS_PAGE_SIZE = 25;

export interface AdminLeadRow extends Lead {
  courseTitle?: string;
}

export interface AdminLeadList {
  rows: AdminLeadRow[];
  total: number;
  page: number;
  pages: number;
  stats: LeadStats;
  /** Source kinds present in the data (for the filter). */
  sources: string[];
  /** Courses that leads asked about (for the filter). */
  courses: { id: string; title: string }[];
}

export async function getAdminLeads(query: LeadQuery & { page?: number; pageSize?: number }): Promise<AdminLeadList> {
  const db = await getDb();
  const titles = new Map(db.courses.map((c) => [c.id, c.title] as const));
  const matching = filterLeads(db.leads, query);
  const { items, page, pages } = paginate(matching, query.page ?? 1, query.pageSize ?? LEADS_PAGE_SIZE);
  const courseIds = [...new Set(db.leads.map((l) => l.courseId).filter((id): id is string => !!id))];
  return {
    rows: items.map((l) => ({ ...l, courseTitle: l.courseId ? titles.get(l.courseId) : undefined })),
    total: matching.length,
    page,
    pages,
    stats: leadStats(db.leads),
    sources: [...new Set(db.leads.map((l) => l.source.split(":", 1)[0] || "website"))].sort(),
    courses: courseIds.map((id) => ({ id, title: titles.get(id) ?? id })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Course titles by id (for the CSV export). */
export async function courseTitleMap(): Promise<Map<string, string>> {
  return new Map((await getDb()).courses.map((c) => [c.id, c.title] as const));
}

/** The published privacy policy, linked next to the consent checkbox of lead forms. */
export async function privacyPolicyHref(): Promise<string | undefined> {
  return (await legalLinks()).find((l) => l.slug === "privacy")?.href;
}
