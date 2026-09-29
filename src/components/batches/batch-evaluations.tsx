import Link from "next/link";
import type { EvaluationCard } from "@/lib/data/certificates";
import type { BatchCertificationInfo } from "@/lib/data/batches";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { UpcomingEvaluations } from "@/components/certificates/upcoming-evaluations";

/**
 * Certification block for learners of a batch with certification enabled:
 * the scheduling deadline, booked evaluations (cancellable) and, per batch
 * course, the certificate status with a link to book an evaluation.
 */
export function BatchEvaluations({ info, evaluations, className }: { info: BatchCertificationInfo; evaluations: EvaluationCard[]; className?: string }) {
  const closed = !!info.deadline?.passed;
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)}>
      <UpcomingEvaluations evaluations={evaluations} canSchedule={false} deadline={info.deadline} schedule={null} />

      <Card className="h-fit">
        <CardHeader title="Certification" description="Complete each course, then book an evaluation with an evaluator to earn its certificate." />
        <CardBody className="p-0">
          {info.courses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No courses added to this batch</p>
          ) : (
            <ul className="divide-y divide-border">
              {info.courses.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link href={`/courses/${c.slug}`} className="block truncate font-medium text-ink hover:text-accent">
                      {c.title}
                    </Link>
                    {c.progress !== null ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <ProgressBar value={c.progress} size="xs" className="w-24" tone={c.progress >= 100 ? "success" : "accent"} label={`${c.title} progress`} />
                        <span className="text-xs tabular-nums text-ink-muted">{c.progress}%</span>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-ink-muted">Not enrolled in this course yet.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {c.certificateCode ? (
                      <ButtonLink href={`/certificates/${c.certificateCode}`} size="sm" variant="outline" leftIcon={<Icon.Award className="size-4" />}>
                        View certificate
                      </ButtonLink>
                    ) : c.booked ? (
                      <Badge tone="info" dot>
                        Evaluation booked
                      </Badge>
                    ) : closed ? (
                      <Badge tone={c.result === "fail" ? "danger" : "neutral"}>{c.result === "fail" ? "Not passed" : "Scheduling closed"}</Badge>
                    ) : (
                      <>
                        {c.result === "fail" && <Badge tone="danger">Not passed</Badge>}
                        <ButtonLink href={`/courses/${c.slug}/certification`} size="sm" variant={c.result === "fail" ? "outline" : "primary"} leftIcon={<Icon.Calendar className="size-4" />}>
                          {c.result === "fail" ? "Book again" : "Schedule evaluation"}
                        </ButtonLink>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
