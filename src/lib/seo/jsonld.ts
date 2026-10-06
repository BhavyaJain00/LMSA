import type { FaqItem, JobOpening, Settings } from "@/lib/types";
import { currencyExponent } from "@/lib/payments/amounts";
import { absoluteUrl, siteOrigin } from "./site";
import { clampText, isoDuration, plainText } from "./text";

/**
 * schema.org structured data builders (JSON-LD) and their safe serializer.
 *
 * Builders are pure: they take plain inputs plus a `SeoContext` and return
 * objects with absolute URLs, dropping empty values so the output never
 * carries `null`, `""` or `[]`. Render them with `<JsonLd data={…} />`
 * (src/components/seo/json-ld.tsx), which uses `serializeJsonLd`.
 */

export type JsonLdValue = string | number | boolean | JsonLdObject | JsonLdValue[] | undefined | null;
export interface JsonLdObject {
  [key: string]: JsonLdValue;
}

export interface SeoContext {
  origin: string;
  siteName: string;
  /** BCP 47 language of the content, e.g. "en". */
  language: string;
  organization: { name: string; url: string; logo?: string; sameAs: string[]; email?: string };
}

export function seoContext(settings: Settings, origin: string = siteOrigin()): SeoContext {
  const org = settings.seo;
  return {
    origin,
    siteName: settings.brand.name,
    language: "en",
    organization: {
      name: org.organizationName || settings.brand.name,
      url: origin,
      logo: absoluteUrl(org.organizationLogoUrl || settings.brand.logoUrl, origin),
      sameAs: org.sameAs.map((u) => absoluteUrl(u, origin)).filter((u): u is string => !!u),
      email: settings.contact.email || settings.legal.contactEmail || undefined,
    },
  };
}

export const organizationId = (ctx: SeoContext) => `${ctx.origin}/#organization`;
export const websiteId = (ctx: SeoContext) => `${ctx.origin}/#website`;

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

/** Recursively drop undefined/null values, empty strings, empty arrays and empty objects. */
export function compactJsonLd<T extends JsonLdValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compactJsonLd(v)).filter((v) => !isEmpty(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: JsonLdObject = {};
    for (const [key, v] of Object.entries(value)) {
      const next = compactJsonLd(v);
      if (!isEmpty(next)) out[key] = next;
    }
    return out as T;
  }
  return value;
}

function isEmpty(value: JsonLdValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * JSON for a `<script type="application/ld+json">` element. `<`, `>` and `&`
 * are written as unicode escapes so user content (a course title containing
 * `</script>`) can never close the element or open a comment, and U+2028 /
 * U+2029 are escaped for old JavaScript parsers.
 */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(compactJsonLd(data))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/**
 * App amount → decimal string for schema.org `Offer.price`. The app stores
 * every amount as the price × 100 whatever the currency (see `formatPrice`
 * and payments/amounts.ts), so the value is always `amount / 100`; only the
 * number of decimals follows the currency ("4900" USD → "49.00",
 * 500000 JPY → "5000", 500000 KWD → "5000.000").
 */
export function minorUnitsToDecimal(amount: number, currency: string): string {
  const value = Number.isFinite(amount) ? amount / 100 : 0;
  return value.toFixed(currencyExponent(currency));
}

export interface PersonRef {
  name: string;
  url?: string;
  image?: string;
}

function person(p: PersonRef, ctx: SeoContext): JsonLdObject {
  return { "@type": "Person", name: p.name, url: absoluteUrl(p.url, ctx.origin), image: absoluteUrl(p.image, ctx.origin) };
}

function organizationRef(ctx: SeoContext): JsonLdObject {
  return { "@type": "Organization", "@id": organizationId(ctx), name: ctx.organization.name, url: ctx.organization.url, logo: ctx.organization.logo };
}

/* ------------------------------------------------------------------ */
/* Site-wide                                                           */
/* ------------------------------------------------------------------ */

export function organizationJsonLd(ctx: SeoContext): JsonLdObject {
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "@id": organizationId(ctx),
    name: ctx.organization.name,
    url: ctx.organization.url,
    logo: ctx.organization.logo ? { "@type": "ImageObject", url: ctx.organization.logo } : undefined,
    sameAs: ctx.organization.sameAs,
    contactPoint: ctx.organization.email ? { "@type": "ContactPoint", contactType: "customer support", email: ctx.organization.email } : undefined,
  });
}

/**
 * WebSite with a sitelinks search box pointing at the course catalog search.
 * Pass `searchPath: null` when guests cannot search (catalog off or members only).
 */
export function websiteJsonLd(ctx: SeoContext, opts: { description?: string; searchPath?: string | null } = {}): JsonLdObject {
  const searchPath = opts.searchPath === undefined ? "/courses?search=" : opts.searchPath;
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId(ctx),
    name: ctx.siteName,
    url: ctx.origin,
    description: opts.description,
    inLanguage: ctx.language,
    publisher: { "@id": organizationId(ctx) },
    potentialAction: searchPath
      ? {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${ctx.origin}${searchPath}{search_term_string}` },
          "query-input": "required name=search_term_string",
        }
      : undefined,
  });
}

export interface BreadcrumbItem {
  name: string;
  /** Site path; omit for the current page (last item). */
  path?: string;
}

/**
 * BreadcrumbList. Google needs an `item` URL on every entry but the last, so
 * middle entries without a page of their own (shown as plain text) are left
 * out of the markup.
 */
export function breadcrumbJsonLd(items: BreadcrumbItem[], ctx: Pick<SeoContext, "origin">): JsonLdObject {
  const listed = items.filter((item, i) => i === items.length - 1 || !!item.path);
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: listed.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.path ? absoluteUrl(item.path, ctx.origin) : undefined,
    })),
  });
}

export interface ItemListEntry {
  name: string;
  path: string;
  image?: string;
}

/** ItemList of pages (summary-page style: position + url + name). */
export function itemListJsonLd(name: string, items: ItemListEntry[], ctx: Pick<SeoContext, "origin">): JsonLdObject {
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(item.path, ctx.origin),
      name: item.name,
      image: absoluteUrl(item.image, ctx.origin),
    })),
  });
}

export function faqPageJsonLd(faq: FaqItem[]): JsonLdObject | null {
  const items = faq.filter((f) => f.question.trim() && f.answer.trim());
  if (!items.length) return null;
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.question.trim(),
      acceptedAnswer: { "@type": "Answer", text: plainText(f.answer) },
    })),
  });
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export interface CourseInstanceInput {
  name: string;
  path: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** HH:mm */
  startTime?: string;
  endTime?: string;
  medium: "online" | "offline";
  instructors: PersonRef[];
}

export interface ReviewInput {
  author: string;
  rating: number;
  body?: string;
  /** ISO date */
  date: string;
}

export interface CourseJsonLdInput {
  name: string;
  description: string;
  path: string;
  image?: string;
  instructors: PersonRef[];
  category?: string;
  keywords: string[];
  /** Learning outcomes. */
  teaches: string[];
  prerequisites: string[];
  /** Beginner / Intermediate / Advanced when known. */
  educationalLevel?: string;
  totalDurationSeconds: number;
  lessonCount: number;
  free: boolean;
  /** Smallest currency unit. */
  price: number;
  currency: string;
  upcoming: boolean;
  averageRating: number | null;
  reviewCount: number;
  reviews: ReviewInput[];
  instances: CourseInstanceInput[];
  datePublished?: string;
  dateModified?: string;
}

/** Whole weeks between two YYYY-MM-DD dates (at least 1). */
function weeksBetween(start: string, end: string): number {
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days > 0 ? Math.max(1, Math.round(days / 7)) : 1;
}

function sessionDuration(start?: string, end?: string): string | undefined {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = (eh! * 60 + em!) - (sh! * 60 + sm!);
  return minutes > 0 ? isoDuration(minutes * 60) : undefined;
}

/** Course (Google "Course info"): provider, offers, instances, rating, reviews. */
export function courseJsonLd(input: CourseJsonLdInput, ctx: SeoContext): JsonLdObject {
  const url = absoluteUrl(input.path, ctx.origin);
  const selfPaced: JsonLdObject[] =
    input.totalDurationSeconds > 0
      ? [
          {
            "@type": "CourseInstance",
            name: `${input.name} (self-paced)`,
            courseMode: "Online",
            courseWorkload: isoDuration(input.totalDurationSeconds),
            location: { "@type": "VirtualLocation", url },
            instructor: input.instructors.map((p) => person(p, ctx)),
          },
        ]
      : [];
  const cohorts: JsonLdObject[] = input.instances.map((b) => ({
    "@type": "CourseInstance",
    name: b.name,
    url: absoluteUrl(b.path, ctx.origin),
    courseMode: b.medium === "online" ? "Online" : "Onsite",
    startDate: b.startDate,
    endDate: b.endDate,
    courseSchedule: {
      "@type": "Schedule",
      startDate: b.startDate,
      endDate: b.endDate,
      repeatFrequency: "Weekly",
      repeatCount: weeksBetween(b.startDate, b.endDate),
      duration: sessionDuration(b.startTime, b.endTime),
    },
    location: b.medium === "online" ? { "@type": "VirtualLocation", url: absoluteUrl(b.path, ctx.origin) } : undefined,
    instructor: b.instructors.map((p) => person(p, ctx)),
  }));

  const rated = input.averageRating !== null && input.reviewCount > 0;
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "Course",
    "@id": `${url}#course`,
    name: input.name,
    description: clampText(input.description, 500),
    url,
    image: absoluteUrl(input.image, ctx.origin),
    inLanguage: ctx.language,
    provider: { "@type": "Organization", name: ctx.organization.name, sameAs: ctx.organization.url, url: ctx.organization.url },
    publisher: { "@id": organizationId(ctx) },
    creator: input.instructors.map((p) => person(p, ctx)),
    about: input.category,
    keywords: input.keywords.join(", "),
    teaches: input.teaches,
    coursePrerequisites: input.prerequisites,
    educationalLevel: input.educationalLevel,
    timeRequired: isoDuration(input.totalDurationSeconds),
    numberOfLessons: input.lessonCount || undefined,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    isAccessibleForFree: input.free,
    offers: {
      "@type": "Offer",
      category: input.free ? "Free" : "Paid",
      price: input.free ? "0" : minorUnitsToDecimal(input.price, input.currency),
      priceCurrency: input.currency,
      availability: input.upcoming ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
      url,
    },
    hasCourseInstance: [...cohorts, ...selfPaced],
    aggregateRating: rated
      ? { "@type": "AggregateRating", ratingValue: Number(input.averageRating!.toFixed(1)), ratingCount: input.reviewCount, reviewCount: input.reviewCount, bestRating: 5, worstRating: 1 }
      : undefined,
    review: input.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      datePublished: r.date.slice(0, 10),
      reviewBody: r.body ? clampText(r.body, 500) : undefined,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    })),
  });
}

/** Level named in a course's tags or title ("beginner", "intermediate", "advanced"). */
export function inferEducationalLevel(tags: string[], title: string): string | undefined {
  const hay = `${tags.join(" ")} ${title}`.toLowerCase();
  if (/\bbeginners?\b|\bintro(duction|ductory)?\b|\bfundamentals\b/.test(hay)) return "Beginner";
  if (/\badvanced\b|\bexpert\b/.test(hay)) return "Advanced";
  if (/\bintermediate\b/.test(hay)) return "Intermediate";
  return undefined;
}

export interface VideoJsonLdInput {
  name: string;
  description: string;
  thumbnail: string;
  /** ISO date the video was published. */
  uploadDate: string;
  contentUrl?: string;
  embedPath?: string;
  durationSeconds?: number;
}

/** VideoObject for a public preview video. */
export function videoObjectJsonLd(input: VideoJsonLdInput, ctx: SeoContext): JsonLdObject {
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: input.name,
    description: clampText(input.description, 300) || input.name,
    thumbnailUrl: [absoluteUrl(input.thumbnail, ctx.origin)],
    uploadDate: input.uploadDate,
    contentUrl: absoluteUrl(input.contentUrl, ctx.origin),
    embedUrl: absoluteUrl(input.embedPath, ctx.origin),
    duration: input.durationSeconds ? isoDuration(input.durationSeconds) : undefined,
    publisher: { "@id": organizationId(ctx) },
  });
}

/* ------------------------------------------------------------------ */
/* Blog                                                                */
/* ------------------------------------------------------------------ */

export interface BlogPostingInput {
  headline: string;
  description: string;
  path: string;
  image?: string;
  author: PersonRef;
  datePublished: string;
  dateModified: string;
  section?: string;
  keywords: string[];
  wordCount: number;
}

export function blogPostingJsonLd(input: BlogPostingInput, ctx: SeoContext): JsonLdObject {
  const url = absoluteUrl(input.path, ctx.origin);
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: clampText(input.headline, 110),
    description: input.description,
    image: input.image ? [absoluteUrl(input.image, ctx.origin)] : undefined,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: person(input.author, ctx),
    publisher: organizationRef(ctx),
    articleSection: input.section,
    keywords: input.keywords.join(", "),
    wordCount: input.wordCount || undefined,
    inLanguage: ctx.language,
    url,
  });
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export interface PersonJsonLdInput {
  name: string;
  path: string;
  image?: string;
  jobTitle?: string;
  description?: string;
  sameAs: string[];
  knowsAbout: string[];
  location?: string;
}

/** Person, wrapped in a ProfilePage (Google's profile-page rich result). */
export function personJsonLd(input: PersonJsonLdInput, ctx: SeoContext): JsonLdObject {
  const url = absoluteUrl(input.path, ctx.origin);
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#person`,
      name: input.name,
      url,
      image: absoluteUrl(input.image, ctx.origin),
      jobTitle: input.jobTitle,
      description: input.description ? clampText(plainText(input.description), 300) : undefined,
      sameAs: input.sameAs.map((u) => absoluteUrl(u, ctx.origin)).filter((u): u is string => !!u),
      knowsAbout: input.knowsAbout,
      homeLocation: input.location ? { "@type": "Place", name: input.location } : undefined,
      affiliation: { "@id": organizationId(ctx) },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export interface ParsedSalary {
  currency: string;
  min: number;
  max?: number;
  unit: "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY", "A$": "AUD", C$: "CAD", S$: "SGD" };

/** Parse a free-text salary like "$80k – $100k / year", "₹12,00,000 per annum" or "EUR 45/hour". */
export function parseSalaryRange(text: string | undefined, fallbackCurrency: string): ParsedSalary | null {
  if (!text?.trim()) return null;
  const raw = text.trim();
  const lower = raw.toLowerCase();

  let currency = fallbackCurrency.toUpperCase();
  const code = /\b(USD|EUR|GBP|INR|AUD|CAD|SGD|AED|JPY)\b/i.exec(raw);
  if (code) currency = code[1]!.toUpperCase();
  else {
    const symbol = Object.keys(CURRENCY_SYMBOLS)
      .sort((a, b) => b.length - a.length)
      .find((s) => raw.includes(s));
    if (symbol) currency = CURRENCY_SYMBOLS[symbol]!;
  }

  let unit: ParsedSalary["unit"] = "YEAR";
  if (/\b(hour|hr|hourly)\b|\/\s*h\b/.test(lower)) unit = "HOUR";
  else if (/\b(day|daily)\b/.test(lower)) unit = "DAY";
  else if (/\b(week|weekly|wk)\b/.test(lower)) unit = "WEEK";
  else if (/\b(month|monthly|mo|pm)\b/.test(lower)) unit = "MONTH";

  const lakh = /\b(lpa|lakh|lakhs|lac)\b/.test(lower);
  const numbers: number[] = [];
  for (const m of raw.matchAll(/(\d[\d,.\s]*\d|\d)\s*(k|m)?\b/gi)) {
    const digits = m[1]!.replace(/[,\s]/g, "");
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const suffix = m[2]?.toLowerCase();
    if (suffix === "k") value *= 1_000;
    else if (suffix === "m") value *= 1_000_000;
    else if (lakh) value *= 100_000;
    numbers.push(value);
  }
  if (lakh) currency = code ? currency : "INR";
  const valid = numbers.filter((n) => n > 0);
  if (!valid.length) return null;
  const min = Math.min(...valid.slice(0, 2));
  const max = valid.length > 1 ? Math.max(...valid.slice(0, 2)) : undefined;
  return { currency, min, max: max !== undefined && max !== min ? max : undefined, unit };
}

const EMPLOYMENT_TYPES: Record<JobOpening["type"], string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  freelance: "CONTRACTOR",
  internship: "INTERN",
};

export interface JobPostingInput {
  job: Pick<JobOpening, "title" | "company" | "companyLogoUrl" | "companyWebsite" | "location" | "country" | "remote" | "workMode" | "type" | "description" | "salaryRange" | "createdAt" | "updatedAt">;
  path: string;
  /** ISO date-time the posting closes (auto-close date). */
  validThrough: string;
  currency: string;
}

/**
 * When an open job stops being valid: `days` after its last update, the same
 * base `closeExpiredJobs` (data/jobs.ts) uses, so editing or reopening a job
 * moves `validThrough` forward exactly as it extends the job's life.
 */
export function jobValidThrough(job: Pick<JobOpening, "createdAt" | "updatedAt">, days: number): string {
  const base = [job.updatedAt, job.createdAt].map((d) => (d ? Date.parse(d) : NaN)).find((t) => Number.isFinite(t)) ?? Date.now();
  return new Date(base + days * 86_400_000).toISOString();
}

/** Google Jobs posting: title, description, dates, employment type, hiring organization, location, salary. */
export function jobPostingJsonLd(input: JobPostingInput, ctx: SeoContext): JsonLdObject {
  const { job } = input;
  const remote = job.workMode ? job.workMode === "remote" : job.remote;
  const salary = parseSalaryRange(job.salaryRange, input.currency);
  const locationName = job.location?.trim();
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description.trim() ? job.description : job.title,
    url: absoluteUrl(input.path, ctx.origin),
    datePosted: job.createdAt,
    validThrough: input.validThrough,
    employmentType: EMPLOYMENT_TYPES[job.type],
    hiringOrganization: {
      "@type": "Organization",
      name: job.company,
      sameAs: absoluteUrl(job.companyWebsite, ctx.origin),
      logo: absoluteUrl(job.companyLogoUrl, ctx.origin),
    },
    jobLocationType: remote ? "TELECOMMUTE" : undefined,
    applicantLocationRequirements: remote && job.country ? { "@type": "Country", name: job.country } : undefined,
    jobLocation:
      !remote || job.workMode === "hybrid"
        ? {
            "@type": "Place",
            address: { "@type": "PostalAddress", addressLocality: locationName, addressCountry: job.country },
          }
        : undefined,
    baseSalary: salary
      ? {
          "@type": "MonetaryAmount",
          currency: salary.currency,
          value: salary.max
            ? { "@type": "QuantitativeValue", minValue: salary.min, maxValue: salary.max, unitText: salary.unit }
            : { "@type": "QuantitativeValue", value: salary.min, unitText: salary.unit },
        }
      : undefined,
    directApply: true,
  });
}

/* ------------------------------------------------------------------ */
/* Certificates and events                                             */
/* ------------------------------------------------------------------ */

export interface CredentialInput {
  name: string;
  description: string;
  path: string;
  code: string;
  recipient: string;
  issueDate: string;
  expiryDate?: string;
  /** What the credential was earned for (course or batch). */
  aboutName?: string;
  aboutPath?: string;
}

export function credentialJsonLd(input: CredentialInput, ctx: SeoContext): JsonLdObject {
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "EducationalOccupationalCredential",
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path, ctx.origin),
    credentialCategory: "certificate",
    identifier: { "@type": "PropertyValue", name: "Certificate code", value: input.code },
    dateCreated: input.issueDate,
    expires: input.expiryDate,
    recognizedBy: organizationRef(ctx),
    about: input.aboutName ? { "@type": "Course", name: input.aboutName, url: absoluteUrl(input.aboutPath, ctx.origin) } : undefined,
    creditText: `Awarded to ${input.recipient}`,
  });
}

export interface EducationEventInput {
  name: string;
  description?: string;
  /** ISO date-time (UTC). */
  startDate: string;
  endDate: string;
  /** Public page for the event (never the private join link). */
  path: string;
  image?: string;
  performers: PersonRef[];
  online: boolean;
  offer?: { free: boolean; price: number; currency: string };
}

export function educationEventJsonLd(input: EducationEventInput, ctx: SeoContext): JsonLdObject {
  const url = absoluteUrl(input.path, ctx.origin);
  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": "EducationEvent",
    name: input.name,
    description: input.description ? clampText(plainText(input.description), 300) : undefined,
    startDate: input.startDate,
    endDate: input.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: input.online ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    location: input.online ? { "@type": "VirtualLocation", url } : { "@type": "Place", name: input.name, url },
    image: input.image ? [absoluteUrl(input.image, ctx.origin)] : undefined,
    organizer: organizationRef(ctx),
    performer: input.performers.map((p) => person(p, ctx)),
    url,
    offers: input.offer
      ? {
          "@type": "Offer",
          price: input.offer.free ? "0" : minorUnitsToDecimal(input.offer.price, input.offer.currency),
          priceCurrency: input.offer.currency,
          availability: "https://schema.org/InStock",
          url,
        }
      : undefined,
  });
}
