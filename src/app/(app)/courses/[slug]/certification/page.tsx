import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canViewCourse, getCourseBySlug } from "@/lib/data/courses";
import { getCertificationState } from "@/lib/data/certificates";
import { getFormatter, getT } from "@/i18n/server";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { UpcomingEvaluations } from "@/components/certificates/upcoming-evaluations";
import { CompletionCertificateButton } from "@/components/certificates/completion-certificate-button";
import { StarRatingDisplay } from "@/components/certificates/star-rating";
import { formatLongDate, formatShortDate } from "@/components/certificates/time";

export async function generateMetadata(props: PageProps<"/courses/[slug]/certification">): Promise<Metadata> {
  const { slug } = await props.params;
  const [course, t] = await Promise.all([getCourseBySlug(slug), getT("public")]);
  return { title: course ? t("certification.metaTitle", { title: course.title }) : t("certification.title") };
}

const STEPS_PAID = [
  { id: "buy", icon: "CreditCard" },
  { id: "book", icon: "Calendar" },
  { id: "meet", icon: "Video" },
  { id: "certified", icon: "Award" },
] as const;

export default async function CourseCertificationPage(props: PageProps<"/courses/[slug]/certification">) {
  const { slug } = await props.params;
  const user = await requireUser(`/courses/${slug}/certification`);
  const course = await getCourseBySlug(slug);
  if (!course || !canViewCourse(user, course)) notFound();
  const [settings, t, f] = await Promise.all([getSettings(), getT("public"), getFormatter()]);

  const header = (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: t("certification.breadcrumbCourses"), href: "/courses" },
            { label: course.title, href: `/courses/${course.slug}` },
            { label: t("certification.title") },
          ]}
        />
      }
      title={t("certification.title")}
      description={course.title}
    />
  );

  if (!settings.features.certifications) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState
          icon={<Icon.Certificate />}
          title={t("certification.disabled.title")}
          description={t("certification.disabled.description")}
          action={<ButtonLink href={`/courses/${course.slug}`}>{t("certification.backToCourse")}</ButtonLink>}
        />
      </div>
    );
  }

  const state = await getCertificationState(user, course);
  const offersCertificate = course.enableCertification || course.paidCertificate || !!state.batch;

  let body: React.ReactNode;
  if (state.certificate) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{t("certification.alreadyCertified")}</p>
        <Link
          href={`/certificates/${state.certificate.code}`}
          className="group flex max-w-md items-center gap-4 rounded-card border border-border bg-surface-1 p-5 shadow-card transition-colors hover:border-accent"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon.Certificate className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink group-hover:text-accent">{course.title}</p>
            <p className="text-sm text-ink-muted">{t("certification.issuedOn", { date: formatShortDate(state.certificate.issueDate, f.locale) })}</p>
            {state.certificate.expiryDate && (
              <p className="text-xs text-ink-faint">{t("certification.validUntil", { date: formatShortDate(state.certificate.expiryDate, f.locale) })}</p>
            )}
          </div>
          <Icon.ArrowUpRight className="size-5 shrink-0 text-ink-faint group-hover:text-accent rtl:-scale-x-100" />
        </Link>
        {!state.certificate.published && (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon.EyeOff className="size-3.5" />
            {t("certification.notPublished")}
          </p>
        )}
      </div>
    );
  } else if (!offersCertificate) {
    body = (
      <EmptyState
        icon={<Icon.Certificate />}
        title={t("certification.none.title")}
        description={t("certification.none.description")}
        action={<ButtonLink href="/courses?certification=true">{t("certification.none.browse")}</ButtonLink>}
      />
    );
  } else if (!state.enrolled) {
    body = (
      <Card className="max-w-xl">
        <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon.GraduationCap className="size-6" />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-ink">{t("certification.enrollFirst.title")}</p>
            <p className="text-sm text-ink-muted">{t("certification.enrollFirst.description")}</p>
          </div>
          <ButtonLink href={`/courses/${course.slug}`}>{t("certification.viewCourse")}</ButtonLink>
        </CardBody>
      </Card>
    );
  } else if (state.completion && !state.canSchedule) {
    const done = state.progress >= 100;
    body = (
      <Card className="max-w-xl">
        <CardBody className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <ProgressRing value={state.progress} size={72} stroke={6} tone={done ? "success" : "accent"} />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-ink">{done ? t("certification.completion.doneTitle") : t("enroll.includes.certificateCompletion")}</p>
            <p className="text-sm text-ink-muted">
              {done ? t("certification.completion.doneDescription") : t("certification.completion.progress", { percent: state.progress })}
            </p>
          </div>
          {done ? (
            <CompletionCertificateButton courseId={course.id} />
          ) : (
            state.nextLessonHref && (
              <ButtonLink href={state.nextLessonHref} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                {t("enroll.continueLearning")}
              </ButtonLink>
            )
          )}
        </CardBody>
      </Card>
    );
  } else if (state.needsPurchase) {
    body = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <p className="text-lg font-semibold text-ink">{t("enroll.getCertified")}</p>
                <p className="text-sm text-ink-muted">{t("certification.purchase.description", { title: course.title })}</p>
              </div>
              <p className="text-2xl font-semibold text-ink">{f.price(course.certificatePrice, course.currency)}</p>
            </div>
            <ButtonLink href={`/billing/certificate/${course.id}`} size="lg" className="w-full sm:w-auto" leftIcon={<Icon.GraduationCap className="size-5" />}>
              {t("enroll.getCertified")}
            </ButtonLink>
            <p className="text-xs text-ink-muted">{t("certification.purchase.after")}</p>
          </CardBody>
        </Card>
        <HowItWorks />
      </div>
    );
  } else {
    body = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {state.batch && (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Icon.Users className="size-4 shrink-0" />
              <span>
                {t.rich("certification.throughBatch", {
                  link: () => (
                    <Link href={`/batches/${state.batch!.slug}`} className="font-medium text-accent hover:underline">
                      {state.batch!.title}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
          <UpcomingEvaluations
            evaluations={state.upcoming}
            canSchedule={state.canSchedule && state.upcoming.length === 0}
            deadline={state.deadline}
            schedule={{
              courseId: course.id,
              courseTitle: course.title,
              batchId: state.batch?.id ?? null,
              availability: state.availability,
              timeZoneLabel: state.timeZoneLabel,
            }}
          />
          {state.history.length > 0 && (
            <Card>
              <CardHeader title={t("certification.results.title")} description={t("certification.results.description")} />
              <CardBody>
                <ul className="divide-y divide-border">
                  {state.history.map((h) => (
                    <li key={h.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">
                          {formatLongDate(h.date, f.locale)} · {h.evaluatorName}
                        </p>
                        <div className="flex items-center gap-2">
                          {h.rating > 0 && <StarRatingDisplay value={h.rating} />}
                          <StatusBadge status={h.status} />
                        </div>
                      </div>
                      {h.summary && <p className="text-sm text-ink-muted">{h.summary}</p>}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
        <HowItWorks purchased={state.purchased} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-5 flex flex-wrap gap-2">
        {course.paidCertificate && <Badge tone="accent">{t("certification.badge.paid", { price: f.price(course.certificatePrice, course.currency) })}</Badge>}
        {course.enableCertification && !course.paidCertificate && <Badge tone="success">{t("enroll.includes.certificateCompletion")}</Badge>}
        {state.batch && <Badge tone="info">{t("certification.badge.batch")}</Badge>}
        {state.purchased && <Badge tone="success">{t("certification.badge.purchased")}</Badge>}
      </div>
      {body}
    </div>
  );
}

async function HowItWorks({ purchased = false }: { purchased?: boolean }) {
  const t = await getT("public");
  return (
    <Card className="h-fit">
      <CardHeader title={t("certification.how.title")} />
      <CardBody>
        <ol className="space-y-4">
          {STEPS_PAID.map((step, i) => {
            const StepIcon = Icon[step.icon];
            const done = purchased && i === 0;
            return (
              <li key={step.id} className="flex gap-3">
                <span className={done ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" : "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted"}>
                  {done ? <Icon.Check className="size-4" /> : <StepIcon className="size-4" />}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{t(`certification.how.${step.id}.title`)}</p>
                  <p className="text-xs text-ink-muted">{t(`certification.how.${step.id}.text`)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
