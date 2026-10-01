import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { isReportStatus, type ReportStatus } from "@/lib/comms/messages-core";
import { listReports } from "@/lib/comms/messages";
import { LocalDateTime } from "@/components/assessments/client-time";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { ListSearch } from "@/components/comms/list-search";
import { Pager } from "@/components/comms/pager";
import { MessagingSettingsForm, ResolveReportButton } from "@/components/messages/moderation-controls";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Message reports" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function hrefFor(status: ReportStatus, q: string, page = 1): string {
  const qs = new URLSearchParams();
  if (status !== "open") qs.set("status", status);
  if (q) qs.set("q", q);
  if (page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/messages/moderation?${query}` : "/messages/moderation";
}

/**
 * Moderation of direct messages (moderators and admins): reported
 * conversations (open / resolved) with search, pagination and a CSV export,
 * plus the messaging switches (administrators change them).
 */
export default async function MessageModerationPage(props: PageProps<"/messages/moderation">) {
  const user = await requireRole(["moderator"], "/messages/moderation");
  const search = await props.searchParams;
  const statusParam = first(search.status);
  const status: ReportStatus = isReportStatus(statusParam) ? statusParam : "open";
  const q = first(search.q).slice(0, 100);
  const page = Number.parseInt(first(search.page), 10) || 1;
  const db = await getDb();
  const reports = listReports(db, { status, q, page });
  const messaging = db.settings.messaging;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Message reports"
        description="Conversations members reported. Moderators can read a reported conversation, remove messages that break the rules and resolve the report."
        breadcrumbs={
          <Link href="/messages" className="mb-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
            <Icon.ArrowLeft className="size-3.5" /> Messages
          </Link>
        }
        actions={
          <ButtonLink href="/messages/moderation/export" variant="outline" size="sm" leftIcon={<Icon.Download className="size-4" />} prefetch={false}>
            Export CSV
          </ButtonLink>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open reports" value={formatNumber(reports.counts.open)} icon={<Icon.AlertTriangle className="size-5" />} />
        <StatCard label="Resolved" value={formatNumber(reports.counts.resolved)} icon={<Icon.CheckCircle className="size-5" />} />
        <StatCard label="Direct messages" value={messaging.enabled ? "On" : "Off"} hint={messaging.enabled && messaging.studentToStudent ? "Learners can message classmates" : undefined} icon={<Icon.MessageCircle className="size-5" />} />
      </div>

      <section aria-labelledby="reports-heading" className="space-y-3">
        <h2 id="reports-heading" className="sr-only">
          Reports
        </h2>
        <Tabs
          items={[
            { label: "Open", value: "open", count: reports.counts.open },
            { label: "Resolved", value: "resolved", count: reports.counts.resolved },
          ]}
          param="status"
        />
        <ListSearch label="Search reports" placeholder="Search by member, reason or course" />
        {reports.rows.length === 0 ? (
          <EmptyState
            compact
            icon={<Icon.ShieldCheck />}
            title={q ? "No reports match" : status === "open" ? "No open reports" : "No resolved reports yet"}
            description={q ? "Try another name or word." : status === "open" ? "When a member reports a conversation it shows up here." : undefined}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
            {reports.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="flex shrink-0 -space-x-2">
                  {r.participants.slice(0, 2).map((p) => (
                    <Avatar key={p.id} name={p.name} src={p.avatarUrl} size="sm" ring />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={`/messages/${r.id}`} className="hover:text-accent hover:underline">
                      {r.participants.map((p) => p.name).join(" · ")}
                    </Link>
                    {r.count > 1 && (
                      <Badge tone="warning" size="xs">
                        {r.count} reports
                      </Badge>
                    )}
                    {r.courseTitle && <span className="text-xs font-normal text-ink-faint">{r.courseTitle}</span>}
                  </p>
                  {r.reason && <p className="mt-1 text-sm text-ink-muted">“{r.reason}”</p>}
                  <p className="mt-1 text-xs text-ink-faint">
                    {r.reportedBy ? `Reported by ${r.reportedBy.name}` : "Reported"} · <LocalDateTime iso={r.reportedAt} /> · {formatNumber(r.messageCount)} messages
                    {r.status === "resolved" && r.resolvedAt && (
                      <>
                        {" "}
                        · Resolved{r.resolvedBy ? ` by ${r.resolvedBy}` : ""} <LocalDateTime iso={r.resolvedAt} />
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ButtonLink href={`/messages/${r.id}`} size="xs" variant="outline">
                    Review
                  </ButtonLink>
                  {r.status === "open" && <ResolveReportButton conversationId={r.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={reports.page} pageCount={reports.pageCount} total={reports.total} noun="report" hrefFor={(p) => hrefFor(status, q, p)} />
      </section>

      <Card id="settings" className="scroll-mt-20">
        <CardHeader title="Messaging settings" description="Who can use direct messages on this site." />
        <CardBody>
          <MessagingSettingsForm enabled={messaging.enabled} studentToStudent={messaging.studentToStudent} canEdit={user.roles.includes("admin")} />
        </CardBody>
      </Card>
    </div>
  );
}
