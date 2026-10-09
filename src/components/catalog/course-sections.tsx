import Link from "next/link";
import type { Announcement, CourseSummary, PublicUser } from "@/lib/types";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { CourseGrid } from "./course-grid";
import { SectionCard } from "./course-page/section-card";

/** Section heading used across the course page. */
export function SectionHeading({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-heading font-bold text-ink">
        {children}
      </h2>
      {aside && <div className="text-sm text-ink-muted">{aside}</div>}
    </div>
  );
}

/** "What you'll learn" checklist (course outcomes). */
export async function CourseOutcomes({ outcomes }: { outcomes: string[] }) {
  if (!outcomes.length) return null;
  const t = await getT("public");
  return (
    <section aria-labelledby="outcomes-heading" className="rounded-card border border-border bg-surface-1 p-5 sm:p-6">
      <h2 id="outcomes-heading" className="text-xl font-semibold tracking-tight text-ink">
        {t("course.sections.outcomes")}
      </h2>
      <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {outcomes.map((outcome, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-6 text-ink">
            <Icon.Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{outcome}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Requirements / prerequisites list. */
export async function CourseRequirements({ requirements }: { requirements: string[] }) {
  if (!requirements.length) return null;
  const t = await getT("public");
  return (
    <section aria-labelledby="requirements-heading">
      <SectionHeading id="requirements-heading">{t("course.sections.requirements")}</SectionHeading>
      <ul className="space-y-2">
        {requirements.map((req, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-6 text-ink-muted">
            <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
            <span>{req}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Markdown course description ("About this course"). */
export async function CourseDescription({ description }: { description: string }) {
  if (!description.trim()) return null;
  const t = await getT("public");
  return (
    <section aria-labelledby="about-heading">
      <SectionHeading id="about-heading">{t("course.sections.about")}</SectionHeading>
      <Markdown content={description} />
    </section>
  );
}

export type AnnouncementView = Announcement & { author: PublicUser | null };

/** Latest course announcements from the instructors (simple card at the end of the course page). */
export async function CourseAnnouncements({ announcements }: { announcements: AnnouncementView[] }) {
  if (!announcements.length) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <SectionCard
      id="announcements"
      headingId="announcements-heading"
      title={t("course.sections.announcements")}
      description={t("course.page.announcementsDescription")}
    >
      <ol className="divide-y divide-border">
        {announcements.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon.Megaphone className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-ink">{a.subject}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                {a.author && (
                  <>
                    <span className="font-medium text-ink-muted">{a.author.name}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <time dateTime={a.createdAt} title={f.date(a.createdAt)}>
                  {f.relative(a.createdAt)}
                </time>
              </p>
              <div className="mt-2 line-clamp-3">
                <Markdown content={a.body} className="text-sm! text-ink-muted!" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

/** "Related courses" (three cards, hidden when there are none). */
export async function RelatedCourses({ courses, explicit }: { courses: CourseSummary[]; explicit: boolean }) {
  if (!courses.length) return null;
  const t = await getT("public");
  return (
    <section aria-labelledby="related-heading">
      <SectionHeading
        id="related-heading"
        aside={
          <Link href="/courses" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            {t("landing.browseAll")}
            <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        }
      >
        {explicit ? t("course.sections.related") : t("course.sections.moreLikeThis")}
      </SectionHeading>
      <CourseGrid courses={courses.slice(0, 3)} columns="compact" />
    </section>
  );
}

/** Certification details card linking to the certification page. */
export async function CertificationCard({
  slug,
  enableCertification,
  paidCertificate,
  certificatePrice,
  currency,
  evaluatorName,
  certificate,
  lessonCount,
  className,
}: {
  slug: string;
  enableCertification: boolean;
  paidCertificate: boolean;
  certificatePrice: number;
  currency: string;
  evaluatorName?: string | null;
  certificate: { code: string; issueDate: string } | null;
  lessonCount: number;
  className?: string;
}) {
  if (!enableCertification && !paidCertificate && !certificate) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const paidDescription = (): string => {
    const price = certificatePrice > 0 ? f.price(certificatePrice, currency) : null;
    if (evaluatorName && price) return t("course.certification.paidWithEvaluatorAndPrice", { evaluator: evaluatorName, price });
    if (evaluatorName) return t("course.certification.paidWithEvaluator", { evaluator: evaluatorName });
    if (price) return t("course.certification.paidWithPrice", { price });
    return t("course.certification.paid");
  };
  return (
    <section aria-labelledby="certification-heading" className={cn("overflow-hidden rounded-card border border-border bg-surface-1 shadow-card", className)}>
      <div className="flex items-start gap-3 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Icon.Certificate className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="certification-heading" className="font-semibold text-ink">
            {certificate ? t("course.certification.certified") : paidCertificate ? t("enroll.getCertified") : t("enroll.includes.certificateCompletion")}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {certificate
              ? t("course.certification.issued", { date: f.date(certificate.issueDate) })
              : paidCertificate
                ? paidDescription()
                : lessonCount > 0
                  ? t("course.certification.completeLessons", { count: lessonCount })
                  : t("course.certification.completeEvery")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2/40 px-5 py-3">
        {certificate && (
          <ButtonLink href={`/certificates/${certificate.code}`} size="sm" leftIcon={<Icon.GraduationCap className="size-4" />}>
            {t("enroll.viewCertificate")}
          </ButtonLink>
        )}
        <ButtonLink
          href={`/courses/${slug}/certification`}
          size="sm"
          variant={certificate ? "ghost" : "outline"}
          rightIcon={<Icon.ArrowRight className="size-3.5 rtl:rotate-180" />}
        >
          {t("course.certification.details")}
        </ButtonLink>
      </div>
    </section>
  );
}

/** Live batches that teach this course (simple card at the end of the course page). */
export async function CourseBatches({
  batches,
}: {
  batches: { slug: string; title: string; startDate: string; endDate: string; paidBatch: boolean; amount: number; currency: string }[];
}) {
  if (!batches.length) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <SectionCard id="batches" headingId="batches-heading" title={t("course.sections.cohort")} description={t("course.page.batchesDescription")}>
      <ul className="-my-3 divide-y divide-border">
        {batches.map((b) => (
          <li key={b.slug}>
            <Link href={`/batches/${b.slug}`} className="group flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon.Users className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink group-hover:text-accent">{b.title}</span>
                  <span className="block text-xs text-ink-faint">{t("home.batches.range", { start: f.date(b.startDate), end: f.date(b.endDate) })}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-ink">
                {b.paidBatch ? f.price(b.amount, b.currency, t("catalog.free")) : t("catalog.free")}
                <Icon.ChevronRight className="size-4 text-ink-faint rtl:rotate-180" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
