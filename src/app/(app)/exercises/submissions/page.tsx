import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getExerciseOptions, listExerciseSubmissions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { LinkRow } from "@/components/assessments/link-row";
import { ExerciseStatusBadge } from "@/components/assessments/status-badges";
import { RelativeTime } from "@/components/assessments/client-time";
import { LANGUAGE_LABELS, param, parsePaging } from "@/components/assessments/shared";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("learning");
  return { title: t("exercise.mine.metaTitle") };
}

export default async function MyExerciseSubmissionsPage(props: PageProps<"/exercises/submissions">) {
  const sp = await props.searchParams;
  const user = await requireUser("/exercises/submissions");
  const t = await getT("learning");
  const exerciseId = param(sp.exercise);
  const status = param(sp.status);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, exerciseOptions] = await Promise.all([listExerciseSubmissions({ exerciseId, status, memberId: user.id }), getExerciseOptions()]);
  const shown = rows.slice(0, limit);
  const filtered = !!(exerciseId || status);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: t("exercise.page.crumbSubmissions") }]} />}
        title={t("exercise.mine.title")}
        description={t("exercise.mine.description")}
        actions={
          canManageAssessments(user) ? (
            <ButtonLink href="/admin/exercises/submissions" variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
              {t("exercise.mine.allLearners")}
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        filters={[
          { param: "exercise", kind: "select", label: t("exercise.mine.exercise"), placeholder: t("exercise.mine.filterExercise"), options: exerciseOptions },
          {
            param: "status",
            kind: "select",
            label: t("exercise.mine.status"),
            placeholder: t("exercise.mine.filterStatus"),
            options: [
              { value: "passed", label: t("global.assess.passed") },
              { value: "failed", label: t("global.assess.failed") },
            ],
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Code />}
          title={filtered ? t("exercise.mine.noMatchTitle") : t("exercise.mine.emptyTitle")}
          description={filtered ? t("exercise.mine.noMatchBody") : t("exercise.mine.emptyBody")}
          action={!filtered ? <ButtonLink href="/courses">{t("quiz.page.browseCourses")}</ButtonLink> : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>{t("exercise.mine.exercise")}</TH>
                <TH className="hidden sm:table-cell">{t("exercise.mine.language")}</TH>
                <TH>{t("exercise.mine.status")}</TH>
                <TH className="hidden sm:table-cell">{t("exercise.mine.tests")}</TH>
                <TH className="text-end">{t("exercise.mine.modified")}</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((row) => (
                <LinkRow key={row.id} href={`/exercises/submissions/${row.id}`}>
                  <TD className="font-medium">
                    <Link href={`/exercises/submissions/${row.id}`} className="hover:underline">
                      {row.exerciseTitle}
                    </Link>
                  </TD>
                  <TD className="hidden text-ink-muted sm:table-cell">{row.language ? LANGUAGE_LABELS[row.language] : "—"}</TD>
                  <TD>
                    <ExerciseStatusBadge status={row.status} />
                  </TD>
                  <TD className="hidden text-ink-muted sm:table-cell">
                    {row.passedCount}/{row.totalCount}
                  </TD>
                  <TD className="text-end text-xs text-ink-muted">
                    <RelativeTime iso={row.submittedAt} />
                  </TD>
                </LinkRow>
              ))}
            </TBody>
          </Table>
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} />
        </>
      )}
    </div>
  );
}
