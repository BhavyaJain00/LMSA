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
import { getT } from "@/i18n/server";

/**
 * Certification block for learners of a batch with certification enabled:
 * the scheduling deadline, booked evaluations (cancellable) and, per batch
 * course, the certificate status with a link to book an evaluation.
 */
export async function BatchEvaluations({ info, evaluations, className }: { info: BatchCertificationInfo; evaluations: EvaluationCard[]; className?: string }) {
  const t = await getT("public");
  const closed = !!info.deadline?.passed;
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)}>
      <UpcomingEvaluations evaluations={evaluations} canSchedule={false} deadline={info.deadline} schedule={null} />

      <Card className="h-fit">
        <CardHeader title={t("certification.title")} description={t("batches.evaluations.description")} />
        <CardBody className="p-0">
          {info.courses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">{t("batches.courses.emptyTitle")}</p>
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
                        <ProgressBar value={c.progress} size="xs" className="w-24" tone={c.progress >= 100 ? "success" : "accent"} label={t("batches.evaluations.progressLabel", { title: c.title })} />
                        <span className="text-xs tabular-nums text-ink-muted">{t("batches.evaluations.percent", { percent: c.progress })}</span>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-ink-muted">{t("batches.courses.notEnrolled")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {c.certificateCode ? (
                      <ButtonLink href={`/certificates/${c.certificateCode}`} size="sm" variant="outline" leftIcon={<Icon.Award className="size-4" />}>
                        {t("enroll.viewCertificate")}
                      </ButtonLink>
                    ) : c.booked ? (
                      <Badge tone="info" dot>
                        {t("batches.evaluations.booked")}
                      </Badge>
                    ) : closed ? (
                      <Badge tone={c.result === "fail" ? "danger" : "neutral"}>{c.result === "fail" ? t("batches.evaluations.notPassed") : t("certificates.upcoming.closedTitle")}</Badge>
                    ) : (
                      <>
                        {c.result === "fail" && <Badge tone="danger">{t("batches.evaluations.notPassed")}</Badge>}
                        <ButtonLink href={`/courses/${c.slug}/certification`} size="sm" variant={c.result === "fail" ? "outline" : "primary"} leftIcon={<Icon.Calendar className="size-4" />}>
                          {c.result === "fail" ? t("batches.evaluations.bookAgain") : t("batches.evaluations.schedule")}
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
