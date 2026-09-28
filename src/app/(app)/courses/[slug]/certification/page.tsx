import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canViewCourse, getCourseBySlug } from "@/lib/data/courses";
import { getCertificationState } from "@/lib/data/certificates";
import { formatPrice } from "@/lib/utils";
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
  const course = await getCourseBySlug(slug);
  return { title: course ? `Certification · ${course.title}` : "Certification" };
}

const STEPS_PAID = [
  { icon: "CreditCard", title: "Buy the certificate", text: "Unlock an evaluator-graded certificate for this course." },
  { icon: "Calendar", title: "Book a slot", text: "Pick a 30-minute evaluation slot in the next two weeks." },
  { icon: "Video", title: "Meet your evaluator", text: "Join the call and walk through what you built." },
  { icon: "Award", title: "Get certified", text: "Pass the evaluation and your certificate is issued instantly." },
] as const;

export default async function CourseCertificationPage(props: PageProps<"/courses/[slug]/certification">) {
  const { slug } = await props.params;
  const user = await requireUser(`/courses/${slug}/certification`);
  const course = await getCourseBySlug(slug);
  if (!course || !canViewCourse(user, course)) notFound();
  const settings = await getSettings();

  const header = (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: "Courses", href: "/courses" },
            { label: course.title, href: `/courses/${course.slug}` },
            { label: "Certification" },
          ]}
        />
      }
      title="Certification"
      description={course.title}
    />
  );

  if (!settings.features.certifications) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState
          icon={<Icon.Certificate />}
          title="Certificates are turned off"
          description="This site isn't issuing certificates right now."
          action={<ButtonLink href={`/courses/${course.slug}`}>Back to course</ButtonLink>}
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
        <p className="text-sm text-ink-muted">You are already certified for this course. Click on the card below to open your certificate.</p>
        <Link
          href={`/certificates/${state.certificate.code}`}
          className="group flex max-w-md items-center gap-4 rounded-card border border-border bg-surface-1 p-5 shadow-card transition-colors hover:border-accent"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon.Certificate className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink group-hover:text-accent">{course.title}</p>
            <p className="text-sm text-ink-muted">Issued On: {formatShortDate(state.certificate.issueDate)}</p>
            {state.certificate.expiryDate && <p className="text-xs text-ink-faint">Valid until {formatShortDate(state.certificate.expiryDate)}</p>}
          </div>
          <Icon.ArrowUpRight className="size-5 shrink-0 text-ink-faint group-hover:text-accent" />
        </Link>
        {!state.certificate.published && (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon.EyeOff className="size-3.5" />
            Your certificate isn&apos;t published on the certified members page yet.
          </p>
        )}
      </div>
    );
  } else if (!offersCertificate) {
    body = (
      <EmptyState
        icon={<Icon.Certificate />}
        title="This course doesn't offer a certificate"
        description="Keep learning — you can still find certificate courses in the catalog."
        action={<ButtonLink href="/courses?certification=true">Browse certificate courses</ButtonLink>}
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
            <p className="font-semibold text-ink">Enroll to get certified</p>
            <p className="text-sm text-ink-muted">Join the course first. Your certification options appear here once you&apos;re enrolled.</p>
          </div>
          <ButtonLink href={`/courses/${course.slug}`}>View course</ButtonLink>
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
            <p className="font-semibold text-ink">{done ? "You completed the course!" : "Certificate of completion"}</p>
            <p className="text-sm text-ink-muted">
              {done
                ? "Your certificate is ready to be generated. It gets a public link you can share."
                : `Complete every lesson to earn your certificate. You're ${state.progress}% of the way there.`}
            </p>
          </div>
          {done ? (
            <CompletionCertificateButton courseId={course.id} />
          ) : (
            state.nextLessonHref && (
              <ButtonLink href={state.nextLessonHref} rightIcon={<Icon.ArrowRight className="size-4" />}>
                Continue learning
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-ink">Get Certified</p>
                <p className="text-sm text-ink-muted">An evaluator-graded certificate for {course.title}.</p>
              </div>
              <p className="text-2xl font-semibold text-ink">{formatPrice(course.certificatePrice, course.currency)}</p>
            </div>
            <ButtonLink href={`/billing/certificate/${course.id}`} size="lg" className="w-full sm:w-auto" leftIcon={<Icon.GraduationCap className="size-5" />}>
              Get Certified
            </ButtonLink>
            <p className="text-xs text-ink-muted">After payment you can book your evaluation right here.</p>
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
              <Icon.Users className="size-4" />
              Evaluation through the batch{" "}
              <Link href={`/batches/${state.batch.slug}`} className="font-medium text-accent hover:underline">
                {state.batch.title}
              </Link>
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
              <CardHeader title="Evaluation results" description="Outcomes recorded by your evaluators." />
              <CardBody>
                <ul className="divide-y divide-border">
                  {state.history.map((h) => (
                    <li key={h.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">
                          {formatLongDate(h.date)} · {h.evaluatorName}
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
        {course.paidCertificate && <Badge tone="accent">Paid certificate · {formatPrice(course.certificatePrice, course.currency)}</Badge>}
        {course.enableCertification && !course.paidCertificate && <Badge tone="success">Certificate of completion</Badge>}
        {state.batch && <Badge tone="info">Batch evaluation</Badge>}
        {state.purchased && <Badge tone="success">Certificate purchased</Badge>}
      </div>
      {body}
    </div>
  );
}

function HowItWorks({ purchased = false }: { purchased?: boolean }) {
  return (
    <Card className="h-fit">
      <CardHeader title="How certification works" />
      <CardBody>
        <ol className="space-y-4">
          {STEPS_PAID.map((step, i) => {
            const StepIcon = Icon[step.icon];
            const done = purchased && i === 0;
            return (
              <li key={step.title} className="flex gap-3">
                <span className={done ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" : "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted"}>
                  {done ? <Icon.Check className="size-4" /> : <StepIcon className="size-4" />}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{step.title}</p>
                  <p className="text-xs text-ink-muted">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
