import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { previewSegment } from "@/lib/comms/audience";
import { broadcastPhase, broadcastRates, estimateSendMinutes, isEditable, normalizeRate, sendProgress } from "@/lib/comms/broadcast-core";
import { getBroadcastReport } from "@/lib/comms/broadcasts";
import { checkContent } from "@/lib/comms/campaign-core";
import { previewCampaign } from "@/lib/comms/preview";
import { runComms } from "@/lib/comms/runner";
import { totalExcluded } from "@/lib/comms/segments";
import { ratePercent } from "@/lib/comms/tracking-core";
import { LocalDateTime } from "@/components/assessments/client-time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { AutoRefresh } from "@/components/comms/auto-refresh";
import { BroadcastMenu, SendingControls } from "@/components/comms/broadcast-controls";
import { BroadcastPhaseBadge } from "@/components/comms/broadcast-phase-badge";
import { BroadcastSendPanel, BroadcastTestForm } from "@/components/comms/broadcast-send-panel";
import { EmailFrame } from "@/components/comms/email-frame";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Broadcast" };

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

function Conditions({ conditions }: { conditions: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Audience conditions">
      {conditions.map((c) => (
        <li key={c}>
          <Badge tone="neutral" className="whitespace-normal">
            {c}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export default async function BroadcastPage(props: PageProps<"/admin/broadcasts/[id]">) {
  const { id } = await props.params;
  const viewer = await requireRole(["moderator"], `/admin/broadcasts/${id}`);
  const report = await getBroadcastReport(id);
  if (!report) notFound();
  const { broadcast: b, events } = report;
  const phase = broadcastPhase(b);
  const editable = isEditable(b);
  const [preview, audience, settings] = await Promise.all([previewCampaign(viewer, b), editable ? previewSegment(report.segment, 5) : null, getSettings()]);
  const problems = editable ? Object.values(checkContent(b, "broadcast").errors) : [];
  const rates = broadcastRates(b);
  const progress = sendProgress(b);
  const rate = normalizeRate(b.ratePerMinute);
  const trackingOff = !settings.email.trackOpens || !settings.email.trackClicks;

  // Lazy runner: a due schedule starts and the next batch is queued once this page is sent.
  if (b.status === "scheduled" || b.status === "sending") {
    after(async () => {
      await runComms().catch(() => undefined);
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={<span className="break-words">{b.subject}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BroadcastPhaseBadge phase={phase} />
            <span>
              by {report.authorName}
              {b.status === "sent" && b.sentAt && (
                <>
                  {" "}
                  · {b.canceledAt ? "stopped" : "sent"} <LocalDateTime iso={b.sentAt} />
                </>
              )}
            </span>
          </span>
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: b.subject },
            ]}
          />
        }
        actions={
          <>
            {editable && (
              <ButtonLink href={`/admin/broadcasts/${b.id}/edit`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
                Edit
              </ButtonLink>
            )}
            <BroadcastMenu id={b.id} subject={b.subject} editable={false} deletable={phase !== "sending"} variant="button" />
          </>
        }
      />
      {b.status === "sending" && !b.pausedAt && <AutoRefresh />}

      {editable ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <section aria-labelledby="broadcast-preview" className="min-w-0 space-y-3">
            <h2 id="broadcast-preview" className="text-lg font-semibold tracking-tight text-ink">
              Preview
            </h2>
            {problems.length > 0 && (
              <div role="alert" className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                <p className="font-medium">This message can&apos;t be sent yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <Link href={`/admin/broadcasts/${b.id}/edit`} className="mt-2 inline-block font-medium underline">
                  Edit the message
                </Link>
              </div>
            )}
            <EmailFrame subject={preview.subject} html={preview.html} />
            <p className="text-xs text-ink-muted">Shown with your own name in place of the recipient&apos;s. Each recipient gets their own unsubscribe link in the footer.</p>
          </section>

          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader
                title="Audience"
                actions={
                  <ButtonLink href={`/admin/broadcasts/${b.id}/edit`} variant="ghost" size="sm">
                    Change
                  </ButtonLink>
                }
              />
              <CardBody className="space-y-3">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-ink tabular-nums">{formatNumber(audience?.count ?? 0)}</p>
                  <p className="text-sm text-ink-muted">
                    {audience?.count === 1 ? "person matches" : "people match"} right now
                    {audience && audience.leads > 0 && audience.members > 0 ? ` (${formatNumber(audience.members)} members, ${formatNumber(audience.leads)} leads)` : ""}
                  </p>
                </div>
                <Conditions conditions={report.conditions} />
                {audience && totalExcluded(audience.excluded) > 0 && (
                  <p className="text-xs text-ink-muted">
                    {formatNumber(totalExcluded(audience.excluded))} matching {totalExcluded(audience.excluded) === 1 ? "person is" : "people are"} left out: unsubscribed,
                    unconfirmed or disabled addresses never receive broadcasts.
                  </p>
                )}
                {audience && audience.sample.length > 0 && (
                  <ul className="divide-y divide-border border-t border-border">
                    {audience.sample.map((r) => (
                      <li key={`${r.kind}:${r.email}`} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.name || r.email}</span>
                        {r.name && <span className="hidden max-w-[45%] truncate text-xs text-ink-muted sm:block">{r.email}</span>}
                        {r.kind === "lead" && (
                          <Badge tone="info" size="xs">
                            Lead
                          </Badge>
                        )}
                      </li>
                    ))}
                    {audience.count > audience.sample.length && <li className="pt-2 text-xs text-ink-muted">and {formatNumber(audience.count - audience.sample.length)} more</li>}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Test" description="See the email in a real inbox before it goes out." />
              <CardBody>
                <BroadcastTestForm id={b.id} defaultTo={viewer.email} disabled={!report.emailEnabled || problems.length > 0} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Send" />
              <CardBody>
                {problems.length > 0 ? (
                  <p className="text-sm text-ink-muted">Fix the message first, then come back here to send or schedule it.</p>
                ) : (
                  <BroadcastSendPanel
                    id={b.id}
                    recipients={audience?.count ?? 0}
                    scheduledAt={b.status === "scheduled" ? b.scheduledAt : undefined}
                    ratePerMinute={rate}
                    emailEnabled={report.emailEnabled}
                  />
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {b.status === "sending" && (
            <Card>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{b.pausedAt ? "Sending is paused" : "Sending in progress"}</h2>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {b.pausedAt
                        ? `${formatNumber(progress.remaining)} ${progress.remaining === 1 ? "person is" : "people are"} still waiting. Resume to continue where it stopped.`
                        : report.emailEnabled
                          ? `Up to ${rate} emails per minute · about ${estimateSendMinutes(progress.remaining, rate)} ${estimateSendMinutes(progress.remaining, rate) === 1 ? "minute" : "minutes"} left. You can leave this page; sending continues.`
                          : "Email is turned off, so the send is waiting. It continues when email is switched on again."}
                    </p>
                  </div>
                  <SendingControls id={b.id} paused={!!b.pausedAt} remaining={progress.remaining} />
                </div>
                <ProgressBar
                  value={progress.percent}
                  tone={b.pausedAt ? "warning" : "accent"}
                  showLabel
                  label={`${formatNumber(progress.done)} of ${formatNumber(progress.total)} recipients handled`}
                />
              </CardBody>
            </Card>
          )}

          {b.canceledAt && (
            <p role="status" className="flex gap-2 rounded-card border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This send was stopped early: {formatNumber(rates.queued)} of {formatNumber(b.recipients)} recipients were emailed.
              </span>
            </p>
          )}

          <section aria-labelledby="broadcast-results">
            <h2 id="broadcast-results" className="sr-only">
              Results
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Recipients"
                value={formatNumber(b.recipients)}
                hint={`${formatNumber(rates.queued)} queued${b.skipped ? ` · ${formatNumber(b.skipped)} skipped` : ""}`}
                icon={<Icon.Users className="size-4" />}
              />
              <StatCard
                label="Delivered"
                value={formatNumber(rates.delivered)}
                hint={
                  rates.failed > 0
                    ? `${formatNumber(rates.failed)} failed${report.waiting ? ` · ${formatNumber(report.waiting)} in the outbox` : ""}`
                    : report.waiting
                      ? `${formatNumber(report.waiting)} waiting in the outbox`
                      : `${ratePercent(rates.delivered, rates.queued)}% of queued emails`
                }
                icon={<Icon.CheckCircle className="size-4" />}
              />
              <StatCard
                label="Opened"
                value={formatNumber(b.opens)}
                hint={`${rates.openRate}% open rate · ${formatNumber(Math.max(events.totalOpens, b.opens))} total`}
                icon={<Icon.Eye className="size-4" />}
              />
              <StatCard
                label="Clicked"
                value={formatNumber(b.clicks)}
                hint={`${rates.clickRate}% click rate · ${rates.clickToOpenRate}% of openers`}
                icon={<Icon.Link className="size-4" />}
              />
              <StatCard
                label="Unsubscribed"
                value={formatNumber(b.unsubscribes ?? 0)}
                hint={`${rates.unsubscribeRate}% of delivered emails`}
                icon={<Icon.XCircle className="size-4" />}
              />
            </div>
            {trackingOff && (
              <p className="mt-3 text-xs text-ink-muted">
                {!settings.email.trackOpens && !settings.email.trackClicks ? "Open and click tracking are" : !settings.email.trackOpens ? "Open tracking is" : "Click tracking is"} switched off, so
                these numbers are incomplete.{" "}
                <Link href="/admin/broadcasts/tracking" className="font-medium text-accent hover:underline">
                  Tracking settings
                </Link>
              </p>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="min-w-0 space-y-5">
              <Card>
                <CardHeader title="Link clicks" description="Every tracked link in the email, most clicked first." />
                {events.links.length === 0 ? (
                  <CardBody>
                    <p className="text-sm text-ink-muted">No link has been clicked yet. Clicks appear here as recipients open the email.</p>
                  </CardBody>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <THead>
                        <tr>
                          <TH>Link</TH>
                          <TH className="text-right">People</TH>
                          <TH className="text-right">Clicks</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {events.links.map((link) => (
                          <TR key={link.url}>
                            <TD className="max-w-0 w-full">
                              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" title={link.url} className="block truncate hover:underline">
                                {shortUrl(link.url)}
                              </a>
                            </TD>
                            <TD className="text-right tabular-nums">
                              {formatNumber(link.uniqueClicks)}
                              <span className="block text-xs text-ink-muted">{ratePercent(link.uniqueClicks, rates.delivered || rates.queued)}%</span>
                            </TD>
                            <TD className="text-right tabular-nums">{formatNumber(link.clicks)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </table>
                  </div>
                )}
              </Card>

              <section aria-labelledby="broadcast-message" className="space-y-3">
                <h2 id="broadcast-message" className="text-lg font-semibold tracking-tight text-ink">
                  Message
                </h2>
                <EmailFrame subject={preview.subject} html={preview.html} />
              </section>
            </div>

            <Card className="min-w-0">
              <CardHeader title="Details" />
              <CardBody>
                <dl className="space-y-4">
                  <DetailItem label="Audience">
                    <Conditions conditions={report.conditions} />
                  </DetailItem>
                  {b.startedAt && (
                    <DetailItem label="Started">
                      <LocalDateTime iso={b.startedAt} mode="weekday-datetime" />
                    </DetailItem>
                  )}
                  {b.sentAt && (
                    <DetailItem label={b.canceledAt ? "Stopped" : "Finished"}>
                      <LocalDateTime iso={b.sentAt} mode="weekday-datetime" />
                    </DetailItem>
                  )}
                  {b.scheduledAt && (
                    <DetailItem label="Was scheduled for">
                      <LocalDateTime iso={b.scheduledAt} mode="weekday-datetime" />
                    </DetailItem>
                  )}
                  <DetailItem label="Sending speed">Up to {rate} emails per minute</DetailItem>
                  <DetailItem label="Skipped">
                    {formatNumber(b.skipped ?? 0)}
                    <span className="block text-xs text-ink-muted">Unsubscribed, disabled or removed between building the list and sending.</span>
                  </DetailItem>
                  {rates.failed > 0 && (
                    <DetailItem label="Failed deliveries">
                      {formatNumber(rates.failed)}{" "}
                      <Link href="/admin/emails?status=failed&category=announcement" className="text-accent hover:underline">
                        Open the outbox
                      </Link>
                    </DetailItem>
                  )}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
