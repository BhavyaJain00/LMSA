import Link from "next/link";
import { after } from "next/server";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { getSettings } from "@/lib/db/store";
import { cronKey } from "@/lib/email";
import { getLastCommsRun, runComms } from "@/lib/comms/runner";
import { GOAL_LABELS, sequenceGoal } from "@/lib/comms/sequence-core";
import { listSequences, parseSequenceFilters } from "@/lib/comms/sequences";
import { ratePercent } from "@/lib/comms/tracking-core";
import { RelativeTime } from "@/components/assessments/client-time";
import { CopyField } from "@/components/admin/emails/copy-field";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BroadcastsNav } from "@/components/comms/broadcasts-nav";
import { ListSearch } from "@/components/comms/list-search";
import { RunCommsButton, SequenceActiveToggle, SequenceMenu } from "@/components/comms/sequence-controls";
import { SequenceTemplates } from "@/components/comms/sequence-templates";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Email sequences" };

export default async function SequencesPage(props: PageProps<"/admin/sequences">) {
  const viewer = await requireRole(["moderator"], "/admin/sequences");
  const filters = parseSequenceFilters(await props.searchParams);
  const filtered = filters.status !== "all" || !!filters.q;
  const [list, settings] = await Promise.all([listSequences(filters), getSettings()]);
  const everything = filtered ? await listSequences({ status: "all", q: "" }) : list;
  const nothingYet = everything.total === 0;
  const lastRun = getLastCommsRun();

  let inProgress = 0;
  let sent = 0;
  let opens = 0;
  let goals = 0;
  let activeCount = 0;
  for (const row of everything.rows) {
    inProgress += row.summary.active;
    sent += row.sent;
    opens += row.uniqueOpens;
    goals += row.summary.goal;
    if (row.sequence.active) activeCount++;
  }

  // Lazy runner: enroll people whose trigger has no event and send the emails that are due once this page is sent.
  if (activeCount > 0) {
    after(async () => {
      await runComms().catch(() => undefined);
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Email sequences"
        description="Automated series of emails that start when someone signs up, becomes a lead, enrolls, buys or goes quiet — and stop by themselves when the goal is reached."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Sequences" },
            ]}
          />
        }
        actions={
          <ButtonLink href="/admin/sequences/new" leftIcon={<Icon.Plus className="size-4" />}>
            New sequence
          </ButtonLink>
        }
      />
      <BroadcastsNav className="mb-6" />

      {!settings.email.enabled && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">
            Email is turned off, so sequences are waiting: nobody is enrolled and no email is sent. An administrator can switch it on in{" "}
            <Link href="/admin/settings/email" className="font-medium underline">
              Settings → Email
            </Link>
            .
          </p>
        </div>
      )}

      {nothingYet ? (
        <div className="space-y-6">
          <EmptyState
            icon={<Icon.Zap />}
            title="No sequences yet"
            description="Start from one of the templates below, or build a sequence from scratch. New sequences are saved switched off, so nothing is sent until you're ready."
            action={
              <ButtonLink href="/admin/sequences/new" leftIcon={<Icon.Plus className="size-4" />}>
                Start from scratch
              </ButtonLink>
            }
          />
          <section aria-labelledby="sequence-templates">
            <h2 id="sequence-templates" className="mb-3 text-lg font-semibold tracking-tight text-ink">
              Templates
            </h2>
            <SequenceTemplates />
          </section>
        </div>
      ) : (
        <>
          <section aria-labelledby="sequence-summary" className="mb-6">
            <h2 id="sequence-summary" className="sr-only">
              Summary
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Switched on"
                value={formatNumber(activeCount)}
                hint={`of ${formatNumber(everything.total)} ${everything.total === 1 ? "sequence" : "sequences"}`}
                icon={<Icon.Zap className="size-4" />}
              />
              <StatCard label="People in progress" value={formatNumber(inProgress)} hint="Waiting for their next email" icon={<Icon.Users className="size-4" />} />
              <StatCard label="Emails sent" value={formatNumber(sent)} hint={`${ratePercent(opens, sent)}% opened`} icon={<Icon.Send className="size-4" />} />
              <StatCard label="Goals reached" value={formatNumber(goals)} hint="People who converted part-way through" icon={<Icon.Target className="size-4" />} />
            </div>
          </section>

          <div className="mb-4 space-y-3">
            <Tabs
              variant="pills"
              param="status"
              items={[
                { label: "All", value: "all", count: list.counts.all },
                { label: "On", value: "active", count: list.counts.active },
                { label: "Off", value: "paused", count: list.counts.paused },
              ]}
            />
            <ListSearch label="Search sequences" placeholder="Search by name or note" />
          </div>

          <Table>
            <THead>
              <tr>
                <TH>Sequence</TH>
                <TH>On</TH>
                <TH className="hidden text-right md:table-cell">In progress</TH>
                <TH className="hidden text-right md:table-cell">Sent</TH>
                <TH className="hidden text-right lg:table-cell">Opened</TH>
                <TH className="hidden text-right lg:table-cell">Clicked</TH>
                <TH className="hidden text-right xl:table-cell">Goal</TH>
                <TH className="w-10">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.rows.length === 0 ? (
                <TableEmpty colSpan={8}>
                  {filters.q ? `No sequences match “${filters.q}”.` : "No sequences with this status."}{" "}
                  <Link href="/admin/sequences" className="font-medium text-accent hover:underline">
                    Show all
                  </Link>
                </TableEmpty>
              ) : (
                list.rows.map((row) => {
                  const { sequence: s, summary } = row;
                  const goal = sequenceGoal(s);
                  return (
                    <TR key={s.id}>
                      <TD className="max-w-0 w-full md:w-[40%]">
                        <Link href={`/admin/sequences/${s.id}`} className="block truncate font-medium hover:underline">
                          {s.name}
                        </Link>
                        <p className="truncate text-xs text-ink-muted">{row.triggerLabel}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <Badge tone="neutral" size="xs">
                            {s.steps.length} {s.steps.length === 1 ? "email" : "emails"}
                          </Badge>
                          {goal !== "none" && (
                            <Badge tone="info" size="xs">
                              Goal: {GOAL_LABELS[goal].label.toLowerCase()}
                            </Badge>
                          )}
                          <span className="md:hidden">
                            {formatNumber(summary.active)} in progress · {formatNumber(row.sent)} sent
                          </span>
                        </p>
                      </TD>
                      <TD>
                        <SequenceActiveToggle id={s.id} name={s.name} active={s.active} />
                      </TD>
                      <TD className="hidden text-right tabular-nums md:table-cell">
                        {formatNumber(summary.active)}
                        <span className="block text-xs text-ink-muted">of {formatNumber(summary.total)}</span>
                      </TD>
                      <TD className="hidden text-right tabular-nums md:table-cell">{formatNumber(row.sent)}</TD>
                      <TD className="hidden text-right tabular-nums lg:table-cell">
                        {formatNumber(row.uniqueOpens)}
                        <span className="block text-xs text-ink-muted">{ratePercent(row.uniqueOpens, row.sent)}%</span>
                      </TD>
                      <TD className="hidden text-right tabular-nums lg:table-cell">
                        {formatNumber(row.uniqueClicks)}
                        <span className="block text-xs text-ink-muted">{ratePercent(row.uniqueClicks, row.sent)}%</span>
                      </TD>
                      <TD className="hidden text-right tabular-nums xl:table-cell">
                        {goal === "none" ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <>
                            {formatNumber(summary.goal)}
                            <span className="block text-xs text-ink-muted">{summary.goalRate}%</span>
                          </>
                        )}
                      </TD>
                      <TD className="text-right">
                        <SequenceMenu id={s.id} name={s.name} activePeople={summary.active} showOpen />
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>

          <section aria-labelledby="sequence-templates" className="mt-8">
            <h2 id="sequence-templates" className="mb-1 text-lg font-semibold tracking-tight text-ink">
              Start from a template
            </h2>
            <p className="mb-3 text-sm text-ink-muted">Each template opens in the editor, where you can change every email before saving.</p>
            <SequenceTemplates />
          </section>
        </>
      )}

      <Card className="mt-8">
        <CardHeader
          title="Sending schedule"
          description="Sequence emails and scheduled broadcasts go out from a background run. It runs by itself while the server is up and whenever these pages are opened."
          actions={<RunCommsButton />}
        />
        <CardBody className="space-y-4">
          <p className="text-sm text-ink-muted">
            {lastRun ? (
              <>
                Last run <RelativeTime iso={lastRun.startedAt} />: {formatNumber(lastRun.sequences.sent + lastRun.broadcasts.queued)} emails queued, {formatNumber(lastRun.sequences.enrolled)} people
                enrolled{lastRun.error ? " — part of it failed, see the error log" : ""}.
                {lastRun.nextRunAt && (
                  <>
                    {" "}
                    Next run <RelativeTime iso={lastRun.nextRunAt} />.
                  </>
                )}
              </>
            ) : (
              "No run yet since the server started."
            )}
          </p>
          {isAdmin(viewer) && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Cron URL</p>
              <CopyField value={`${siteConfig.appUrl}/api/cron/comms?key=${cronKey()}`} label="Cron URL" secret />
              <p className="mt-2 text-xs text-ink-muted">Call it every minute (every five is fine) from a scheduler so emails stay on time across restarts and quiet periods:</p>
              <p className="mt-1 font-mono text-[11px] text-ink-muted">* * * * * curl -fsS &quot;&lt;cron URL&gt;&quot; &gt; /dev/null</p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
