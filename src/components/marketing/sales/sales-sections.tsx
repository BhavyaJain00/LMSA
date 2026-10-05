import type { ReactNode } from "react";
import type { Course, CourseSalesPage, SalesSection, SalesTestimonial } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { SALES_SECTION_TYPES } from "@/lib/seo/sales-page";
import { PriceTag, isPaidCourse } from "@/components/catalog/price-tag";
import { RatingStars } from "@/components/catalog/rating-stars";
import { VideoPlayer } from "@/components/player";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { SalesCountdown } from "./sales-countdown";

/** The enroll card's anchor on the course page (pricing and call-to-action buttons jump to it). */
export const ENROLL_ANCHOR = "enroll";

export interface SalesPricing {
  course: Pick<Course, "paidCourse" | "price" | "currency">;
  /** "What's included" lines (lessons, length, certificate…), already worded. */
  includes: string[];
  /** Label of the jump button ("Enroll now", "Continue learning"…). */
  actionLabel: string;
}

export interface SalesSectionsProps {
  page: CourseSalesPage;
  courseTitle: string;
  /** Preview video: the uploaded file, plus its HLS stream once converted (adaptive streaming with the file as fallback). */
  video: { url: string; poster?: string; hlsUrl?: string } | null;
  pricing: SalesPricing;
  /** Sections whose content the course page already renders (outline, instructors). */
  slots: { curriculum: ReactNode; instructor: ReactNode };
  serverNow: number;
}

async function SectionShell({ section, children, className }: { section: SalesSection; children: ReactNode; className?: string }) {
  const headingId = `sales-${section.id}`;
  const t = await getT("public");
  const typeLabel = SALES_SECTION_TYPES.some((type) => type.type === section.type) ? t(`sales.sectionType.${section.type}`) : undefined;
  return (
    <section aria-labelledby={section.title ? headingId : undefined} aria-label={section.title ? undefined : typeLabel} id={section.id} className={cn("scroll-mt-20", className)}>
      {section.title && (
        <h2 id={headingId} className="mb-5 text-2xl font-semibold tracking-tight text-ink text-balance">
          {section.title}
        </h2>
      )}
      {children}
    </section>
  );
}

function EnrollJump({ label, size = "lg" }: { label: string; size?: "md" | "lg" }) {
  return (
    <a href={`#${ENROLL_ANCHOR}`} className={buttonClasses({ size })}>
      {label}
      <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
    </a>
  );
}

function FeatureGrid({ items }: { items: NonNullable<SalesSection["items"]> }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((item, i) => {
        const ItemIcon = item.icon && item.icon in Icon ? Icon[item.icon as keyof typeof Icon] : Icon.CheckCircle;
        return (
          <li key={i} className="flex gap-3 rounded-card border border-border bg-surface-1 p-4 shadow-card">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <ItemIcon className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-ink">{item.title}</p>
              {item.body && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Testimonials({ items }: { items: SalesTestimonial[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((t, i) => (
        <li key={i}>
          <figure className="flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card">
            {t.rating && <RatingStars value={t.rating} size="sm" className="mb-3" />}
            <blockquote className="flex-1 text-[15px] leading-relaxed text-ink">
              <p>“{t.quote}”</p>
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              <Avatar name={t.name} src={t.avatarUrl} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                {t.role && <span className="block truncate text-xs text-ink-muted">{t.role}</span>}
              </span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

function Faq({ items }: { items: CourseSalesPage["faq"] }) {
  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface-1">
      {items.map((item, i) => (
        <details key={i} className="group px-4 py-1 sm:px-5" open={i === 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.question}
            <Icon.ChevronDown className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="pb-4 text-sm text-ink-muted">
            <Markdown content={item.answer} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Guarantee({ text }: { text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-success/30 bg-success/8 p-4">
      <Icon.ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      <div className="min-w-0 text-sm text-ink">
        <Markdown content={text} />
      </div>
    </div>
  );
}

/**
 * The ordered sections of a course sales page. Sections that would be empty
 * (no testimonials, no questions, no preview video, a features list without
 * items) are skipped, so a half-finished page never shows blank blocks.
 */
export async function SalesSections({ page, courseTitle, video, pricing, slots, serverNow }: SalesSectionsProps) {
  const t = await getT("public");
  const rendered = page.sections.map((section) => {
    switch (section.type) {
      case "text":
        return section.body ? (
          <SectionShell key={section.id} section={section}>
            <Markdown content={section.body} />
          </SectionShell>
        ) : null;
      case "features":
        return section.items?.length ? (
          <SectionShell key={section.id} section={section}>
            <FeatureGrid items={section.items} />
          </SectionShell>
        ) : null;
      case "curriculum":
        return (
          <SectionShell key={section.id} section={section}>
            {slots.curriculum}
          </SectionShell>
        );
      case "instructor":
        return (
          <SectionShell key={section.id} section={section}>
            {slots.instructor}
          </SectionShell>
        );
      case "testimonials":
        return page.testimonials.length ? (
          <SectionShell key={section.id} section={section}>
            <Testimonials items={page.testimonials} />
          </SectionShell>
        ) : null;
      case "faq":
        return page.faq.length ? (
          <SectionShell key={section.id} section={section}>
            <Faq items={page.faq} />
          </SectionShell>
        ) : null;
      case "video":
        return video ? (
          <SectionShell key={section.id} section={section}>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-3 shadow-card">
              <VideoPlayer src={video.url} hlsUrl={video.hlsUrl} poster={video.poster} title={t("course.hero.previewTitle", { title: courseTitle })} className="rounded-none" />
            </div>
          </SectionShell>
        ) : null;
      case "pricing":
        return (
          <SectionShell key={section.id} section={section}>
            <div className="overflow-hidden rounded-card border border-accent/30 bg-surface-1 shadow-card">
              <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-sm font-medium text-ink-muted">{isPaidCourse(pricing.course) ? t("sales.pricing.paid") : t("sales.pricing.free")}</p>
                  <PriceTag course={pricing.course} size="xl" className="mt-1 block" />
                  {page.countdownEndsAt && <SalesCountdown endsAt={page.countdownEndsAt} serverNow={serverNow} label={t("sales.countdown.thisOffer")} className="mt-4" />}
                  <div className="mt-5">
                    <EnrollJump label={pricing.actionLabel} />
                  </div>
                </div>
                {pricing.includes.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-ink">{t("sales.pricing.included")}</p>
                    <ul className="mt-3 space-y-2 text-sm text-ink">
                      {pricing.includes.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {page.guarantee && (
                <div className="border-t border-border p-4 sm:px-6">
                  <Guarantee text={page.guarantee} />
                </div>
              )}
            </div>
          </SectionShell>
        );
      case "cta":
        return (
          <section key={section.id} id={section.id} aria-labelledby={`sales-${section.id}`} className="scroll-mt-20">
            <div className="relative isolate overflow-hidden rounded-3xl border border-accent/25 bg-accent/8 px-5 py-10 text-center sm:px-10">
              <div aria-hidden="true" className="pointer-events-none absolute -end-20 -top-20 -z-10 size-72 rounded-full bg-accent/15 blur-3xl" />
              <h2 id={`sales-${section.id}`} className="text-2xl font-semibold tracking-tight text-ink text-balance sm:text-3xl">
                {section.title || t("sales.cta.defaultTitle", { title: courseTitle })}
              </h2>
              {section.body && (
                <div className="mx-auto mt-3 max-w-xl text-ink-muted">
                  <Markdown content={section.body} />
                </div>
              )}
              <div className="mt-6 flex justify-center">
                <EnrollJump label={pricing.actionLabel} />
              </div>
              {page.guarantee && !page.sections.some((s) => s.type === "pricing") && (
                <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink-muted">
                  <Icon.ShieldCheck className="size-4 text-success" aria-hidden="true" />
                  {t("sales.cta.guarantee")}
                </p>
              )}
            </div>
          </section>
        );
      default:
        return null;
    }
  });

  return (
    <>
      {rendered}
      {page.guarantee && !page.sections.some((s) => s.type === "pricing") && (
        <section aria-label={t("sales.guarantee")}>
          <Guarantee text={page.guarantee} />
        </section>
      )}
    </>
  );
}
