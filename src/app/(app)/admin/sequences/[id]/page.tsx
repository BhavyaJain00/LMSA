import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { SequenceEnrollment } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { runComms } from "@/lib/comms/runner";
import { type EnrollmentFilters, GOAL_LABELS, enrollmentStateLabel, formatDelay, parseEnrollmentFilters, sequenceGoal } from "@/lib/comms/sequence-core";
import { getSequenceReport, listSequenceEnrollments } from "@/lib/comms/sequences";
import { ratePercent } from "@/lib/comms/tracking-core";
import { LocalDateTime, RelativeTime } from "@/components/assessments/client-time";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { ListSearch } from "@/components/comms/list-search";
import { Pager } from "@/components/comms/pager";
import { SequenceActiveToggle, SequenceMenu, StepActions, StopEnrollmentButton } from "@/components/comms/sequence-controls";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Email sequence" };

function hrefFor(id: string, filters: EnrollmentFilters, patch: Partial<EnrollmentFilters> = {}, suffix = ""): string {
  const next = { ...filters, ...patch };
  const qs = new URLSearchParams();
  if (next.status !== "all") qs.set("status", next.status);
  if (next.q) qs.set("q", next.q);
  if (next.page > 1) qs.set("page", String(next.page));
  const query = qs.toString();
  return `/admin/sequences/${id}${suffix}${query ? `?${query}` : ""}`;
}

function stateTone(e: Pick<SequenceEnrollment, "status" | "stopReason">): BadgeTone {
  if (e.status === "active") return "accent";
  if (e.status === "completed" || e.stopReason === "goal") return "success";
  return e.stopReason === "unsubscribed" ? "warning" : "neutral";
}

/** "example.com/pricing" for display; the full URL stays in the title and link. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return `${u.host}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

export default async function SequencePage(props: PageProps<"/admin/sequences/[id]">) {
  const { id } = await props.params;
  const viewer = await requireRole(["moderator"], `/admin/sequences/${id}`);
  const filters = parseEnrollmentFilters(await props.searchParams);
  const [report, people] = await Promise.all([getSequenceReport(id), listSequenceEnrollments(id, filters)]);
  if (!report) notFound();
  const { sequence: s, summary, events } = report;
  const goal = sequenceGoal(s);
  const filtered = filters.status !== "all" || !!filters.q;

  // Lazy runner: emails that are due go out once this page is sent.
  if (s.active) {
    after(async () => {
      await runComms().catch(() => undefined);
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={<span className="break-words">{s.name}</span>}
        description={
          <>
            {report.triggerLabel}
            {goal !== "none" && <> · stops when the person {GOAL_LABELS[goal].label.toLowerCase()}</>}
          </>
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Sequences", href: "/admin/sequences" },
              { label: s.name },
            ]}
          />
        }
        actions={
          <>
            <SequenceActiveToggle id={s.id} name={s.name} active={s.active} withLabel />
            <ButtonLink href={`/admin/sequences/${s.id}/edit`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              Edit
            </ButtonLink>
            <SequenceMenu id={s.id} name={s.name} activePeople={summary.active} variant="button" />
          </>
        }
      />

      {s.description && <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-ink-muted">{s.description}</p>}

      {!report.emailEnabled ? (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">
            Email is turned off, so this sequence is waiting. An administrator can switch it on in{" "}
            <Link href="/admin/settings/email" className="font-medium underline">
              Settings → Email
            </Link>
            .
          </p>
        </div>
      ) : !s.active ? (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-border bg-surface-2 p-4 text-sm text-ink-muted">
          <Icon.Pause className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">
            This sequence is switched off: nobody new starts it and no email goes out.
            {summary.active > 0 && ` ${formatNumber(summary.active)} ${summary.active === 1 ? "person" : "people"} part-way through will continue when you switch it on.`}
          </p>
        </div>
      ) : s.courseId && !report.courseTitle ? (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">The course this sequence is limited to was deleted, so nobody new starts it. Edit the sequence and choose another course.</p>
        </div>
      ) : null}

      <section aria-labelledby="sequence-results" className="mb-6">
        <h2 id="sequence-results" className="sr-only">
          Results
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="People started"
            value={formatNumber(summary.total)}
            hint={`${formatNumber(summary.active)} in progress · ${formatNumber(summary.completed)} finished`}
            icon={<Icon.Users className="size-4" />}
          />
          <StatCard
            label={goal === "none" ? "Stopped early" : "Goal reached"}
            value={goal === "none" ? formatNumber(summary.stopped) : formatNumber(summary.goal)}
            hint={
              goal === "none"
                ? `${formatNumber(summary.unsubscribed)} unsubscribed · ${formatNumber(summary.manual)} by staff`
                : `${summary.goalRate}% of everyone who started · ${formatNumber(summary.stopped - summary.goal)} stopped otherwise`
            }
            icon={<Icon.Target className="size-4" />}
          />
          <StatCard
            label="Emails sent"
            value={formatNumber(report.sent)}
            hint={`${ratePercent(events.uniqueOpens, report.sent)}% opened · ${ratePercent(events.uniqueClicks, report.sent)}% clicked`}
            icon={<Icon.Send className="size-4" />}
          />
          <StatCard
            label="Unsubscribed"
            value={formatNumber(s.unsubscribes ?? 0)}
            hint={`${ratePercent(s.unsubscribes ?? 0, summary.total)}% of everyone who started`}
            icon={<Icon.XCircle className="size-4" />}
          />
        </div>
      </section>

      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="min-w-0">
          <CardHeader title="Emails" description="Each delay counts from the moment the previous email was sent." />
          {report.steps.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">
                This sequence has no emails yet.{" "}
                <Link href={`/admin/sequences/${s.id}/edit`} className="font-medium text-accent hover:underline">
                  Add the first one
                </Link>
              </p>
            </CardBody>
          ) : (
            <ol className="divide-y divide-border">
              {report.steps.map((row, index) => (
                <li key={row.step.id} className="flex gap-3 px-4 py-4 sm:px-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">{index + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="break-words text-sm font-medium text-ink">{row.step.subject}</p>
                      <p className="text-xs text-ink-muted">
                        {row.step.delayHours === 0
                          ? index === 0
                            ? "Right after the trigger"
                            : `Right after email ${index}`
                          : `${formatDelay(row.step.delayHours)} after ${index === 0 ? "the trigger" : `email ${index}`}`}
                        {index > 0 && row.offsetHours > 0 && ` · ${formatDelay(row.offsetHours)} in total`}
                      </p>
                    </div>
                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                      <div className="flex gap-1">
                        <dt>Sent</dt>
                        <dd className="font-medium tabular-nums text-ink">{formatNumber(row.sent)}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Opened</dt>
                        <dd className="font-medium tabular-nums text-ink">
                          {formatNumber(row.uniqueOpens)} ({ratePercent(row.uniqueOpens, row.sent)}%)
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Clicked</dt>
                        <dd className="font-medium tabular-nums text-ink">
                          {formatNumber(row.uniqueClicks)} ({ratePercent(row.uniqueClicks, row.sent)}%)
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Waiting for it</dt>
                        <dd className="font-medium tabular-nums text-ink">{formatNumber(row.waiting)}</dd>
                      </div>
                    </dl>
                    <StepActions
                      sequenceId={s.id}
                      stepId={row.step.id}
                      subject={row.step.subject}
                      body={row.step.body}
                      courseId={s.courseId}
                      defaultTo={viewer.email}
                      emailEnabled={report.emailEnabled}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Link clicks" description="Across every email of the sequence." />
          {events.links.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">No link has been clicked yet.</p>
            </CardBody>
          ) : (
            <ol className="divide-y divide-border">
              {events.links.slice(0, 10).map((link) => (
                <li key={link.url} className="flex items-center gap-3 px-5 py-3">
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" title={link.url} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
                    {shortUrl(link.url)}
                  </a>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    <span className="font-medium text-ink">{formatNumber(link.uniqueClicks)}</span>
                    <span className="block text-xs text-ink-muted">{formatNumber(link.clicks)} clicks</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <section aria-labelledby="sequence-people" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sequence-people" className="text-lg font-semibold tracking-tight text-ink">
            People
          </h2>
          {summary.total > 0 && (
            <a href={hrefFor(s.id, filters, { page: 1 }, "/export")} download className={buttonClasses({ variant: "outline", size: "sm" })}>
              <Icon.Download className="size-4" />
              Export CSV
            </a>
          )}
        </div>
        <Tabs
          variant="pills"
          param="status"
          items={[
            { label: "Everyone", value: "all", count: summary.total },
            { label: "In progress", value: "active", count: summary.active },
            { label: "Finished", value: "completed", count: summary.completed },
            { label: "Stopped", value: "stopped", count: summary.stopped },
          ]}
        />
        <ListSearch label="Search people" placeholder="Search by name or email" />
        <Table>
          <THead>
            <tr>
              <TH>Person</TH>
              <TH>State</TH>
              <TH className="hidden text-right sm:table-cell">Emails sent</TH>
              <TH className="hidden md:table-cell">Next email</TH>
              <TH className="hidden lg:table-cell">Started</TH>
              <TH className="w-16">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {people.rows.length === 0 ? (
              <TableEmpty colSpan={6}>
                {filtered ? (
                  <>
                    Nobody matches these filters.{" "}
                    <Link href={`/admin/sequences/${s.id}`} className="font-medium text-accent hover:underline">
                      Show everyone
                    </Link>
                  </>
                ) : s.active ? (
                  "Nobody has started this sequence yet. People appear here as soon as its trigger happens for them."
                ) : (
                  "Nobody has started this sequence yet. Switch it on to start enrolling people."
                )}
              </TableEmpty>
            ) : (
              people.rows.map((e) => {
                const next = e.status === "active" ? s.steps[e.nextStepIndex] : undefined;
                return (
                  <TR key={e.id}>
                    <TD className="max-w-0 w-[45%] md:w-[30%]">
                      <p className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{e.name || e.email}</span>
                        {e.leadId && (
                          <Badge tone="info" size="xs">
                            Lead
                          </Badge>
                        )}
                      </p>
                      {e.name && <p className="truncate text-xs text-ink-muted">{e.email}</p>}
                      <p className="text-xs text-ink-muted sm:hidden">
                        {formatNumber(e.sentCount ?? 0)} of {s.steps.length} sent
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={stateTone(e)} dot>
                        {enrollmentStateLabel(e)}
                      </Badge>
                      {e.endedAt && (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          <RelativeTime iso={e.endedAt} />
                        </span>
                      )}
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">
                      {formatNumber(e.sentCount ?? 0)}
                      <span className="text-ink-muted"> / {s.steps.length}</span>
                    </TD>
                    <TD className="hidden max-w-0 md:table-cell">
                      {next ? (
                        <>
                          <p className="truncate">{next.subject}</p>
                          <p className="text-xs text-ink-muted">
                            <LocalDateTime iso={e.nextRunAt} />
                          </p>
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">
                      <RelativeTime iso={e.createdAt} />
                    </TD>
                    <TD className="text-right">{e.status === "active" && <StopEnrollmentButton enrollmentId={e.id} who={e.name || e.email} />}</TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
        <Pager page={people.page} pageCount={people.pageCount} total={people.total} noun="person" plural="people" hrefFor={(page) => hrefFor(s.id, filters, { page })} />
      </section>
    </div>
  );
}
