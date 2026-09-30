import type { Metadata } from "next";
import Link from "next/link";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { aiSiteStatus } from "@/lib/ai/access";
import { estimateCostUsd } from "@/lib/ai/models";
import { reviewableCourses, reviewRows, toUsageRows } from "@/lib/ai/service";
import { summarizeUsage } from "@/lib/ai/usage";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BarList } from "@/components/dashboard/charts/bar-list";
import { LineChart } from "@/components/dashboard/charts/line-chart";
import { FilterBar } from "@/components/assessments/list-controls";
import { param } from "@/components/assessments/shared";
import { AiAdminHeader } from "@/components/ai/admin-header";
import { formatNumber, percent } from "@/lib/utils";

export const metadata: Metadata = { title: "AI tutor usage" };

const PERIODS = [7, 30, 90] as const;

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "< $0.01";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default async function AiUsagePage(props: PageProps<"/admin/ai/usage">) {
  const user = await requireRole(["moderator", "course_creator"], "/admin/ai/usage");
  const sp = await props.searchParams;
  const courseId = param(sp.course);
  const requestedDays = Number(param(sp.days));
  const days = (PERIODS as readonly number[]).includes(requestedDays) ? requestedDays : 30;

  const db = await getDb();
  const site = aiSiteStatus(db.settings);
  const rows = reviewRows(db, user).filter((r) => !courseId || r.courseId === courseId);
  const usage = summarizeUsage(toUsageRows(rows), { days });
  const cost = estimateCostUsd(db.settings.ai.model, usage.tokensIn, usage.tokensOut);
  const rated = usage.helpful + usage.unhelpful;

  const courses = reviewableCourses(db, user);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const lessonById = new Map(db.lessons.map((l) => [l.id, l]));
  const courseOptions = courses
    .filter((c) => c.aiTutorEnabled || rows.some((r) => r.courseId === c.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => ({ value: c.id, label: c.title }));

  return (
    <div className="animate-fade-in">
      <AiAdminHeader site={site} isAdmin={isAdmin(user)} description="How learners use the tutor, what they ask most and where the course material doesn't have the answer." />

      <FilterBar
        filters={[
          { param: "course", kind: "select", label: "Courses", options: courseOptions },
          {
            param: "days",
            kind: "select",
            label: "Period",
            placeholder: "Last 30 days",
            options: [
              { value: "7", label: "Last 7 days" },
              { value: "90", label: "Last 90 days" },
            ],
          },
        ]}
      />

      {usage.answers === 0 ? (
        <EmptyState
          icon={<Icon.BarChart />}
          title="No tutor activity in this period"
          description={courseId ? "Nobody asked the tutor about this course yet. Try a longer period." : "Usage appears here once learners start asking the tutor questions."}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Answers" value={formatNumber(usage.answers)} hint={`${formatNumber(usage.conversations)} conversations`} icon={<Icon.MessageSquare className="size-5" />} />
            <StatCard label="Learners" value={formatNumber(usage.learners)} hint="Asked at least one question" icon={<Icon.Users className="size-5" />} />
            <StatCard
              label="Helpful"
              value={rated ? `${percent(usage.helpful, rated)}%` : "—"}
              hint={rated ? `${formatNumber(usage.helpful)} 👍 · ${formatNumber(usage.unhelpful)} 👎` : "No ratings yet"}
              icon={<Icon.CheckCircle className="size-5" />}
            />
            <StatCard
              label="Not covered"
              value={`${percent(usage.unknown, usage.answers)}%`}
              hint={`${formatNumber(usage.unknown)} questions without an answer in the course`}
              icon={<Icon.AlertCircle className="size-5" />}
            />
          </div>

          <Card>
            <CardHeader title="Answers per day" description={`Last ${days} days (UTC)`} />
            <CardBody>
              <LineChart data={usage.daily.map((d) => ({ date: d.date, value: d.answers }))} label="Answers" unit="answer" />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top questions" description="Similar wordings are grouped together." />
              <CardBody>
                {usage.topQuestions.length ? (
                  <BarList
                    valueLabel="times asked"
                    data={usage.topQuestions.map((cluster, i) => ({
                      id: `${i}`,
                      label: cluster.label,
                      value: cluster.count,
                      note: cluster.lessonIds.length === 1 ? lessonById.get(cluster.lessonIds[0]!)?.title : cluster.lessonIds.length > 1 ? `${cluster.lessonIds.length} lessons` : undefined,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-ink-muted">No questions in this period.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Tokens" description="Sent to and received from the model." />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Input</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatNumber(usage.tokensIn)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Output</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatNumber(usage.tokensOut)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Per answer</dt>
                    <dd className="mt-1 text-base font-medium tabular-nums text-ink">{formatNumber(Math.round((usage.tokensIn + usage.tokensOut) / usage.answers))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">Estimated cost</dt>
                    <dd className="mt-1 text-base font-medium tabular-nums text-ink">{cost === null ? "—" : formatUsd(cost)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-ink-faint">
                  {cost === null
                    ? "No list price is known for the configured model."
                    : `Estimated at the list price of ${db.settings.ai.model}. Your Anthropic invoice is the source of truth.`}
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Content gaps" description="Lessons where the tutor most often answered “I don't know based on this course” — consider adding the missing explanation." />
            <CardBody className="p-0 sm:p-0">
              {usage.gaps.length ? (
                <Table className="min-w-[36rem]">
                  <THead>
                    <tr>
                      <TH>Lesson</TH>
                      <TH className="text-right">Questions</TH>
                      <TH className="text-right">Not covered</TH>
                      <TH className="text-right">Rate</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {usage.gaps.slice(0, 20).map((gap) => {
                      const lesson = lessonById.get(gap.lessonId);
                      const course = lesson ? courseById.get(lesson.courseId) : undefined;
                      return (
                        <TR key={gap.lessonId}>
                          <TD>
                            {lesson && course ? (
                              <Link href={`/admin/courses/${course.id}/lessons/${lesson.id}`} className="font-medium text-ink hover:text-accent">
                                {lesson.title}
                              </Link>
                            ) : (
                              <span className="text-ink-muted">Deleted lesson</span>
                            )}
                            {course && <span className="block text-xs text-ink-faint">{course.title}</span>}
                          </TD>
                          <TD className="text-right tabular-nums">{formatNumber(gap.answers)}</TD>
                          <TD className="text-right tabular-nums">{formatNumber(gap.unknown)}</TD>
                          <TD className="text-right font-medium tabular-nums">{gap.rate}%</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              ) : (
                <p className="px-5 py-4 text-sm text-ink-muted">No gaps: the tutor found material for every lesson-specific question in this period.</p>
              )}
            </CardBody>
          </Card>

          {!courseId && usage.courses.length > 1 && (
            <Card>
              <CardHeader title="By course" />
              <CardBody className="p-0 sm:p-0">
                <Table className="min-w-[36rem]">
                  <THead>
                    <tr>
                      <TH>Course</TH>
                      <TH className="text-right">Answers</TH>
                      <TH className="text-right">Learners</TH>
                      <TH className="text-right">Not covered</TH>
                      <TH className="text-right">Flagged</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {usage.courses.map((row) => (
                      <TR key={row.courseId}>
                        <TD>
                          <Link href={`/admin/ai/usage?course=${row.courseId}&days=${days}`} className="font-medium text-ink hover:text-accent">
                            {courseById.get(row.courseId)?.title ?? "Deleted course"}
                          </Link>
                        </TD>
                        <TD className="text-right tabular-nums">{formatNumber(row.answers)}</TD>
                        <TD className="text-right tabular-nums">{formatNumber(row.learners)}</TD>
                        <TD className="text-right tabular-nums">{percent(row.unknown, row.answers)}%</TD>
                        <TD className="text-right tabular-nums">{formatNumber(row.flagged)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
