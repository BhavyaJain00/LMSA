import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getStatistics, parseStatRange, type StatRange } from "@/lib/data/statistics";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { LineChart } from "@/components/dashboard/charts/line-chart";
import { DonutChart } from "@/components/dashboard/charts/donut-chart";
import { BarList, StackedBar } from "@/components/dashboard/charts/bar-list";
import { categoricalColor, chartColor } from "@/components/dashboard/charts/scale";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Statistics" };

const rangeLabel: Record<StatRange, string> = { 30: "last 30 days", 90: "last 90 days", 365: "last 12 months" };

function KpiTile({ label, tooltip, value, delta, icon, range }: { label: string; tooltip: string; value: number; delta: number; icon: ReactNode; range: StatRange }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-ink-muted">{label}</p>
          <Tooltip label={tooltip}>
            <span tabIndex={0} className="rounded text-ink-faint hover:text-ink-muted" aria-label={tooltip}>
              <Icon.Info className="size-3.5" />
            </span>
          </Tooltip>
        </div>
        <span className="rounded-lg bg-accent/10 p-2 text-accent [&>svg]:size-4">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-ink">{formatNumber(value)}</p>
      <p className="mt-1 text-xs text-ink-muted">
        <span className={delta > 0 ? "font-medium text-success" : ""}>+{formatNumber(delta)}</span> in the {rangeLabel[range]}
      </p>
    </Card>
  );
}

function ChartCard({ title, subtitle, total, children }: { title: string; subtitle: string; total?: ReactNode; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader title={title} description={subtitle} actions={total !== undefined ? <span className="text-2xl font-semibold tabular-nums text-ink">{total}</span> : undefined} />
      <div className="px-4 pb-4 pt-3 sm:px-5">{children}</div>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating} out of 5`}>
      <Icon.StarFilled className="size-3.5 text-warning" />
      <span className="tabular-nums">{rating.toFixed(1)}</span>
    </span>
  );
}

export default async function StatisticsPage(props: PageProps<"/statistics">) {
  const user = await requireRole(["moderator", "course_creator"], "/statistics");
  const settings = await getSettings();
  if (!settings.features.statistics) notFound();
  const sp = await props.searchParams;
  const range = parseStatRange(sp.range);
  const stats = await getStatistics(user, range);
  const f = settings.features;
  const sumSeries = (s: { value: number }[]) => s.reduce((acc, p) => acc + p.value, 0);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Statistics"
        description="How people are signing up, enrolling and completing courses across the platform."
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-ink-muted">
            <Link href="/dashboard" className="hover:text-ink">
              Dashboard
            </Link>
            <span className="mx-1.5 text-ink-faint">/</span>
            <span aria-current="page">Statistics</span>
          </nav>
        }
        actions={
          <Tabs
            param="range"
            variant="pills"
            className="rounded-full bg-surface-2 p-0.5"
            items={[
              { label: "30 days", value: "30" },
              { label: "90 days", value: "90" },
              { label: "12 months", value: "365" },
            ]}
          />
        }
      />

      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile label="Courses" tooltip="Published Courses" value={stats.kpis.courses} delta={stats.inRange.courses} icon={<Icon.BookOpen />} range={range} />
        <KpiTile label="Signups" tooltip="Active Members" value={stats.kpis.users} delta={stats.inRange.users} icon={<Icon.UserPlus />} range={range} />
        <KpiTile label="Enrollments" tooltip="Course Enrollments" value={stats.kpis.enrollments} delta={stats.inRange.enrollments} icon={<Icon.Users />} range={range} />
        <KpiTile label="Completions" tooltip="Course Completions" value={stats.kpis.completions} delta={stats.inRange.completions} icon={<Icon.Trophy />} range={range} />
        <KpiTile
          label="Certifications"
          tooltip="Certified Members"
          value={stats.kpis.certifications}
          delta={stats.inRange.certifications}
          icon={<Icon.Certificate />}
          range={range}
        />
      </section>

      <section aria-label="Trends" className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Signups" subtitle="Signups per day" total={sumSeries(stats.series.signups)}>
          <LineChart data={stats.series.signups} label="Signups" unit="signup" tone="info" />
        </ChartCard>
        <ChartCard title="Enrollments" subtitle="Enrollments per day" total={sumSeries(stats.series.enrollments)}>
          <LineChart data={stats.series.enrollments} label="Enrollments" unit="enrollment" tone="accent" />
        </ChartCard>
        <ChartCard title="Completions" subtitle="Course completions per day" total={sumSeries(stats.series.completions)}>
          <LineChart data={stats.series.completions} label="Completions" unit="completion" tone="success" />
        </ChartCard>
        {f.certifications && (
          <ChartCard title="Certifications" subtitle="Certifications per day" total={sumSeries(stats.series.certifications)}>
            <LineChart data={stats.series.certifications} label="Certifications" unit="certificate" tone="warning" />
          </ChartCard>
        )}
      </section>

      <section aria-label="Courses" className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className={stats.completion.completed > 0 ? "lg:col-span-2" : "lg:col-span-3"}>
          <ChartCard title="Top courses" subtitle="Enrollments per course (top 10)">
            {stats.topCourses.length === 0 ? (
              <EmptyState compact icon={<Icon.BarChart />} title="No enrollments yet" description="Courses will be ranked here once learners start enrolling." />
            ) : (
              <BarList
                valueLabel="enrollments"
                data={stats.topCourses.map((c) => ({
                  id: c.id,
                  label: c.title,
                  value: c.enrollments,
                  href: `/courses/${c.slug}`,
                  note: c.enrollmentsInRange ? `+${c.enrollmentsInRange} in the ${rangeLabel[range]}` : undefined,
                }))}
              />
            )}
          </ChartCard>
        </div>
        {stats.completion.completed > 0 && (
          <ChartCard title="Completions" subtitle="Course Completion">
            <DonutChart
              centerLabel="Enrollments"
              segments={[
                { label: "Completed", value: stats.completion.completed, color: chartColor("success") },
                { label: "In Progress", value: stats.completion.inProgress, color: chartColor("accent") },
              ]}
            />
          </ChartCard>
        )}
      </section>

      <section aria-label="Categories" className="mt-6">
        <ChartCard title="Categories" subtitle="Published courses and enrollments by category">
          {stats.categories.length === 0 ? (
            <EmptyState compact icon={<Icon.Tag />} title="No published courses" description="Category breakdown appears once courses are published." />
          ) : (
            <div className="space-y-4">
              <StackedBar
                label="Enrollments by category"
                segments={stats.categories.map((c, i) => ({ id: c.id, label: c.name, value: c.enrollments, color: categoricalColor(i) }))}
              />
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {stats.categories.map((c, i) => {
                  const totalEnrollments = stats.categories.reduce((acc, x) => acc + x.enrollments, 0);
                  return (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoricalColor(i) }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {c.courses} {c.courses === 1 ? "course" : "courses"} · {c.enrollments} enrolled
                        {totalEnrollments > 0 && <span className="text-ink-faint"> ({Math.round((c.enrollments / totalEnrollments) * 100)}%)</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </ChartCard>
      </section>

      {f.batches && (
        <section aria-labelledby="batch-stats" className="mt-8">
          <h2 id="batch-stats" className="mb-3 text-lg font-semibold tracking-tight text-ink">
            Batches
          </h2>
          <Table>
            <THead>
              <tr>
                <TH>Batch</TH>
                <TH>Status</TH>
                <TH className="text-right">Students</TH>
                <TH className="hidden text-right md:table-cell">Courses</TH>
                <TH className="hidden text-right md:table-cell">Live classes</TH>
                <TH className="hidden text-right lg:table-cell">Assessments</TH>
                <TH className="text-right">Feedback</TH>
              </tr>
            </THead>
            <TBody>
              {stats.batches.length === 0 && <TableEmpty colSpan={7}>No batches yet.</TableEmpty>}
              {stats.batches.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link href={`/batches/${b.slug}`} className="block min-w-44 font-medium hover:text-accent">
                      {b.title}
                    </Link>
                    <span className="text-xs text-ink-muted">
                      {formatDate(b.startDate)} – {formatDate(b.endDate)}
                      {!b.published && " · Unpublished"}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={b.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {b.students}
                    {b.seats > 0 && <span className="text-ink-faint">/{b.seats}</span>}
                  </TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">{b.courses}</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">
                    {b.liveClassesHeld}
                    <span className="text-ink-faint">/{b.liveClasses}</span>
                  </TD>
                  <TD className="hidden text-right tabular-nums lg:table-cell">{b.assessments}</TD>
                  <TD className="text-right">
                    {b.feedbackAverage !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Stars rating={b.feedbackAverage} />
                        <span className="text-xs text-ink-faint">({b.feedbackCount})</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <section aria-labelledby="course-stats" className="mt-8">
        <h2 id="course-stats" className="mb-3 text-lg font-semibold tracking-tight text-ink">
          Courses
        </h2>
        <Table>
          <THead>
            <tr>
              <TH>Course</TH>
              <TH className="text-right">Enrollments</TH>
              <TH className="hidden text-right sm:table-cell">Completions</TH>
              <TH className="w-44">Completion</TH>
              <TH className="hidden text-right md:table-cell">Avg. progress</TH>
              <TH className="text-right">Rating</TH>
              {f.certifications && <TH className="hidden text-right lg:table-cell">Certificates</TH>}
            </tr>
          </THead>
          <TBody>
            {stats.courses.length === 0 && <TableEmpty colSpan={7}>No courses yet.</TableEmpty>}
            {stats.courses.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link href={`/courses/${c.slug}`} className="block min-w-48 font-medium hover:text-accent">
                    {c.title}
                  </Link>
                  <span className="text-xs text-ink-muted">
                    {c.lessons} {c.lessons === 1 ? "lesson" : "lessons"}
                    {!c.published && " · Unpublished"}
                    {c.upcoming && " · Upcoming"}
                    {c.status === "under_review" && " · Under review"}
                  </span>
                </TD>
                <TD className="text-right tabular-nums">
                  {c.enrollments}
                  {c.enrollmentsInRange > 0 && <span className="block text-[11px] text-success">+{c.enrollmentsInRange}</span>}
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{c.completions}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={c.completionRate} size="xs" tone="success" label={`${c.title} completion rate`} />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">{c.completionRate}%</span>
                  </div>
                </TD>
                <TD className="hidden text-right tabular-nums md:table-cell">{c.averageProgress}%</TD>
                <TD className="text-right">
                  {c.averageRating !== null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Stars rating={c.averageRating} />
                      <span className="text-xs text-ink-faint">({c.reviewCount})</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </TD>
                {f.certifications && <TD className="hidden text-right tabular-nums lg:table-cell">{c.certificates}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
