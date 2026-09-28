import Link from "next/link";
import type { Announcement, CourseSummary, PublicUser } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Markdown } from "@/lib/markdown";
import { cn, formatDate, formatPrice, relativeTime } from "@/lib/utils";
import { CourseGrid } from "./course-grid";

/** Section heading used across the course page. */
export function SectionHeading({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-2xl font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {aside && <div className="text-sm text-ink-muted">{aside}</div>}
    </div>
  );
}

/** "What you'll learn" checklist (course outcomes). */
export function CourseOutcomes({ outcomes }: { outcomes: string[] }) {
  if (!outcomes.length) return null;
  return (
    <section aria-labelledby="outcomes-heading" className="rounded-card border border-border bg-surface-1 p-5 sm:p-6">
      <h2 id="outcomes-heading" className="text-xl font-semibold tracking-tight text-ink">
        What you&apos;ll learn
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
export function CourseRequirements({ requirements }: { requirements: string[] }) {
  if (!requirements.length) return null;
  return (
    <section aria-labelledby="requirements-heading">
      <SectionHeading id="requirements-heading">Requirements</SectionHeading>
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
export function CourseDescription({ description }: { description: string }) {
  if (!description.trim()) return null;
  return (
    <section aria-labelledby="about-heading">
      <SectionHeading id="about-heading">About this course</SectionHeading>
      <Markdown content={description} />
    </section>
  );
}

export type AnnouncementView = Announcement & { author: PublicUser | null };

/** Latest course announcements from the instructors. */
export function CourseAnnouncements({ announcements }: { announcements: AnnouncementView[] }) {
  if (!announcements.length) return null;
  return (
    <section aria-labelledby="announcements-heading">
      <SectionHeading id="announcements-heading" aside={`${announcements.length} recent`}>
        Announcements
      </SectionHeading>
      <ol className="space-y-3">
        {announcements.map((a) => (
          <li key={a.id} className="rounded-card border border-border bg-surface-1 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Icon.Megaphone className="size-4.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-ink">{a.subject}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  {a.author && (
                    <>
                      <Avatar name={a.author.name} src={a.author.avatarUrl} size="xs" />
                      <span className="font-medium text-ink">{a.author.name}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <time dateTime={a.createdAt} title={formatDate(a.createdAt)}>
                    {relativeTime(a.createdAt)}
                  </time>
                </p>
                <Markdown content={a.body} className="mt-3 text-sm! text-ink-muted!" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Related Courses" grid (hidden when there are none). */
export function RelatedCourses({ courses, explicit }: { courses: CourseSummary[]; explicit: boolean }) {
  if (!courses.length) return null;
  return (
    <section aria-labelledby="related-heading">
      <SectionHeading
        id="related-heading"
        aside={
          <Link href="/courses" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            Browse all courses
            <Icon.ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      >
        {explicit ? "Related Courses" : "More courses like this"}
      </SectionHeading>
      <CourseGrid courses={courses} />
    </section>
  );
}

/** Certification details card linking to the certification page. */
export function CertificationCard({
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
  return (
    <section aria-labelledby="certification-heading" className={cn("overflow-hidden rounded-card border border-border bg-surface-1 shadow-card", className)}>
      <div className="flex items-start gap-3 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Icon.Certificate className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="certification-heading" className="font-semibold text-ink">
            {certificate ? "You're certified" : paidCertificate ? "Get certified" : "Certificate of completion"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {certificate
              ? `Issued on ${formatDate(certificate.issueDate)}. Share it or download a printable copy.`
              : paidCertificate
                ? `Finish the course, then book an evaluation${evaluatorName ? ` with ${evaluatorName}` : ""} to earn a verified certificate${certificatePrice > 0 ? ` (${formatPrice(certificatePrice, currency)})` : ""}.`
                : lessonCount > 0
                  ? `Complete all ${lessonCount} ${lessonCount === 1 ? "lesson" : "lessons"} to receive a certificate you can share and verify online.`
                  : "Complete every lesson to receive a certificate you can share and verify online."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2/40 px-5 py-3">
        {certificate && (
          <ButtonLink href={`/certificates/${certificate.code}`} size="sm" leftIcon={<Icon.GraduationCap className="size-4" />}>
            View certificate
          </ButtonLink>
        )}
        <ButtonLink href={`/courses/${slug}/certification`} size="sm" variant={certificate ? "ghost" : "outline"} rightIcon={<Icon.ArrowRight className="size-3.5" />}>
          Certification details
        </ButtonLink>
      </div>
    </section>
  );
}

/** Live batches that teach this course. */
export function CourseBatches({ batches }: { batches: { slug: string; title: string; startDate: string; endDate: string; paidBatch: boolean; amount: number; currency: string }[] }) {
  if (!batches.length) return null;
  return (
    <section aria-labelledby="batches-heading" className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
      <h2 id="batches-heading" className="flex items-center gap-2 font-semibold text-ink">
        <Icon.Users className="size-4.5 text-accent" aria-hidden="true" />
        Learn with a cohort
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {batches.map((b) => (
          <li key={b.slug}>
            <Link href={`/batches/${b.slug}`} className="group flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink group-hover:text-accent">{b.title}</span>
                <span className="block text-xs text-ink-muted">
                  {formatDate(b.startDate)} – {formatDate(b.endDate)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-ink">{b.paidBatch ? formatPrice(b.amount, b.currency) : "Free"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
