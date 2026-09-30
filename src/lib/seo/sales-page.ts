import type { CourseSalesPage, SalesSection, SalesTestimonial } from "@/lib/types";
import { normalizeFaq } from "./blog";

/**
 * Course sales pages (pure, isomorphic): the section catalogue shown in the
 * builder, validation of the JSON the builder submits, a starter template and
 * the countdown maths used by the public page.
 */

export type SalesSectionType = SalesSection["type"];

export const SALES_SECTION_TYPES: { type: SalesSectionType; label: string; description: string; repeatable: boolean }[] = [
  { type: "text", label: "Text", description: "A heading and a few paragraphs of markdown.", repeatable: true },
  { type: "features", label: "What you get", description: "A grid of benefits with icons.", repeatable: true },
  { type: "curriculum", label: "Curriculum", description: "The course outline, chapter by chapter.", repeatable: false },
  { type: "instructor", label: "Instructor", description: "Who teaches the course, with their bio.", repeatable: false },
  { type: "testimonials", label: "Testimonials", description: "Quotes from learners (edited below).", repeatable: false },
  { type: "faq", label: "FAQ", description: "Questions and answers (edited below).", repeatable: false },
  { type: "pricing", label: "Pricing", description: "Price, what is included and the enroll button.", repeatable: false },
  { type: "video", label: "Preview video", description: "The course's promo video.", repeatable: false },
  { type: "cta", label: "Call to action", description: "A closing pitch with the enroll button.", repeatable: true },
];

/** Icons the builder offers for feature items (names from the app's icon set). */
export const FEATURE_ICONS = [
  "CheckCircle",
  "Zap",
  "Award",
  "Clock",
  "Users",
  "BookOpen",
  "Video",
  "Certificate",
  "Target",
  "Rocket",
  "ShieldCheck",
  "Sparkles",
  "Trophy",
  "MessageCircle",
  "Code",
  "Globe",
  "Smartphone",
  "Star",
  "Layers",
] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

export const SALES_LIMITS = {
  sections: 20,
  title: 120,
  body: 8000,
  items: 12,
  itemTitle: 100,
  itemBody: 400,
  headline: 120,
  subheadline: 300,
  testimonials: 12,
  quote: 800,
  guarantee: 1000,
} as const;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isSectionType(value: unknown): value is SalesSectionType {
  return SALES_SECTION_TYPES.some((t) => t.type === value);
}

function sectionId(value: unknown, index: number): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : `sec_${index + 1}`;
}

function normalizeTestimonials(raw: unknown): SalesTestimonial[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesTestimonial[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const name = str(r.name, 80);
    const quote = str(r.quote, SALES_LIMITS.quote);
    if (!name || !quote) continue;
    const rating = typeof r.rating === "number" && Number.isFinite(r.rating) ? Math.min(5, Math.max(1, Math.round(r.rating))) : undefined;
    const avatarUrl = str(r.avatarUrl, 500);
    out.push({
      name,
      quote,
      role: str(r.role, 100) || undefined,
      avatarUrl: avatarUrl && (avatarUrl.startsWith("/") ? !avatarUrl.startsWith("//") : /^https?:\/\//i.test(avatarUrl)) ? avatarUrl : undefined,
      rating,
    });
    if (out.length >= SALES_LIMITS.testimonials) break;
  }
  return out;
}

function normalizeSections(raw: unknown): SalesSection[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesSection[] = [];
  const singles = new Set<SalesSectionType>();
  const ids = new Set<string>();
  raw.forEach((s, index) => {
    if (!s || typeof s !== "object" || out.length >= SALES_LIMITS.sections) return;
    const r = s as Record<string, unknown>;
    if (!isSectionType(r.type)) return;
    const meta = SALES_SECTION_TYPES.find((t) => t.type === r.type)!;
    if (!meta.repeatable) {
      if (singles.has(r.type)) return;
      singles.add(r.type);
    }
    let id = sectionId(r.id, index);
    while (ids.has(id)) id = `${id}_${index}`;
    ids.add(id);
    const items = Array.isArray(r.items)
      ? r.items
          .map((it) => {
            if (!it || typeof it !== "object") return null;
            const item = it as Record<string, unknown>;
            const title = str(item.title, SALES_LIMITS.itemTitle);
            if (!title) return null;
            const icon = FEATURE_ICONS.includes(item.icon as FeatureIcon) ? (item.icon as string) : undefined;
            return { title, body: str(item.body, SALES_LIMITS.itemBody) || undefined, icon };
          })
          .filter((it): it is { title: string; body: string | undefined; icon: string | undefined } => !!it)
          .slice(0, SALES_LIMITS.items)
      : [];
    const section: SalesSection = { id, type: r.type };
    const title = str(r.title, SALES_LIMITS.title);
    const body = str(r.body, SALES_LIMITS.body);
    if (title) section.title = title;
    if (body) section.body = body;
    if (items.length) section.items = items.map((it) => ({ title: it.title, ...(it.body ? { body: it.body } : {}), ...(it.icon ? { icon: it.icon } : {}) }));
    out.push(section);
  });
  return out;
}

/** Validate a sales page submitted by the builder. Unknown fields are dropped. */
export function normalizeSalesPage(raw: unknown): { page: CourseSalesPage; errors: Record<string, string> } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  let countdownEndsAt: string | undefined;
  if (typeof r.countdownEndsAt === "string" && r.countdownEndsAt.trim()) {
    const at = Date.parse(r.countdownEndsAt);
    if (Number.isFinite(at)) countdownEndsAt = new Date(at).toISOString();
    else errors.countdownEndsAt = "Enter a valid end date for the countdown.";
  }
  const page: CourseSalesPage = {
    heroHeadline: str(r.heroHeadline, SALES_LIMITS.headline) || undefined,
    heroSubheadline: str(r.heroSubheadline, SALES_LIMITS.subheadline) || undefined,
    sections: normalizeSections(r.sections),
    faq: normalizeFaq(r.faq),
    testimonials: normalizeTestimonials(r.testimonials),
    guarantee: str(r.guarantee, SALES_LIMITS.guarantee) || undefined,
    countdownEndsAt,
    showStats: r.showStats !== false,
  };
  if (page.sections.some((s) => s.type === "testimonials") && !page.testimonials.length) errors.testimonials = "Add at least one testimonial, or remove the testimonials section.";
  if (page.sections.some((s) => s.type === "faq") && !page.faq.length) errors.faq = "Add at least one question, or remove the FAQ section.";
  return { page, errors };
}

/** Whether a course has a sales page to render instead of the default layout. */
export function hasSalesPage(page: CourseSalesPage | undefined | null): page is CourseSalesPage {
  return !!page && (page.sections.length > 0 || !!page.heroHeadline);
}

/** An empty sales page (the builder's starting point when nothing is saved yet). */
export function emptySalesPage(): CourseSalesPage {
  return { sections: [], faq: [], testimonials: [], showStats: true };
}

export interface SalesTemplateInput {
  title: string;
  shortIntroduction: string;
  outcomes: string[];
  hasVideo: boolean;
  hasCertificate: boolean;
}

/** A complete starter page built from the course's own content. */
export function salesPageTemplate(course: SalesTemplateInput): CourseSalesPage {
  const outcomeItems = course.outcomes.slice(0, 6).map((o) => ({ title: o, icon: "CheckCircle" }));
  const sections: SalesSection[] = [];
  if (course.hasVideo) sections.push({ id: "sec_video", type: "video", title: "Watch the introduction" });
  sections.push({
    id: "sec_outcomes",
    type: "features",
    title: "What you will be able to do",
    items: outcomeItems.length
      ? outcomeItems
      : [
          { title: "Learn by doing", body: "Short lessons followed by hands-on practice.", icon: "Target" },
          { title: "Go at your own pace", body: "Lifetime access on any device.", icon: "Clock" },
          { title: "Get unstuck fast", body: "Ask questions in the course discussions.", icon: "MessageCircle" },
        ],
  });
  sections.push({
    id: "sec_why",
    type: "features",
    title: "Why learners choose this course",
    items: [
      { title: "Practical from day one", body: "Every lesson ends with something you can use right away.", icon: "Zap" },
      { title: "Learn on any device", body: "Pick up where you left off on your phone, tablet or laptop.", icon: "Smartphone" },
      ...(course.hasCertificate ? [{ title: "Earn a certificate", body: "Share a verifiable certificate when you finish.", icon: "Certificate" }] : []),
    ],
  });
  sections.push({ id: "sec_curriculum", type: "curriculum", title: "Course curriculum" });
  sections.push({ id: "sec_instructor", type: "instructor", title: "Meet your instructor" });
  sections.push({ id: "sec_pricing", type: "pricing", title: "Start learning today" });
  sections.push({ id: "sec_faq", type: "faq", title: "Frequently asked questions" });
  sections.push({ id: "sec_cta", type: "cta", title: `Ready to start ${course.title}?`, body: "Join now and take the first lesson in the next five minutes." });
  return {
    heroHeadline: course.title,
    heroSubheadline: course.shortIntroduction,
    sections,
    faq: [
      { question: "How long do I have access?", answer: "As long as the course is available — revisit the lessons whenever you need them." },
      { question: "Do I need any prior experience?", answer: "Check the requirements listed on this page; everything else is explained step by step." },
      { question: "Can I learn on my phone?", answer: "Yes. Lessons, quizzes and progress tracking work on any modern browser." },
    ],
    testimonials: [],
    showStats: true,
  };
}

export interface CountdownParts {
  done: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Time left until `endsAt` (all zeros and `done` once it has passed or when invalid). */
export function countdownParts(endsAt: string | undefined, now: number = Date.now()): CountdownParts {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const left = Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  return {
    done: left === 0,
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}
