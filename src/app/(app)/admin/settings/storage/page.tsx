import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { cronKey } from "@/lib/email";
import { getStorageStatus, isRemoteStorage, localUsage, publicBaseUrl } from "@/lib/storage";
import { getUploadSessionStats } from "@/lib/media/resumable";
import { detectFfmpeg, FFMPEG_INSTALL_HINT } from "@/lib/media/transcode/ffmpeg";
import { isWorkerRunning } from "@/lib/media/transcode/queue";
import { QUEUE_FILTERS, errorSummary, parsePage, parseQueueFilter, queuePage, type QueueFilter } from "@/lib/media/transcode/overview";
import { transcriptionAvailability } from "@/lib/transcripts/auto";
import {
  convertAllVideosAction,
  migrateLocalFilesAction,
  recheckFfmpegAction,
  retryFailedTranscodesAction,
  runMediaMaintenanceAction,
} from "@/lib/actions/storage-settings";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Button, ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CopyField } from "@/components/admin/emails/copy-field";
import { DetailItem, SettingsPanelHeader, SettingsRow, SettingsSection } from "@/components/admin/settings/settings-ui";
import { QueueAutoRefresh, StorageActionButton, StorageConnectionTest, StorageSettingsForm, TranscodeJobActions } from "@/components/admin/settings/storage-settings-form";
import { cn, formatBytes, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Storage & video settings" };

const PATH = "/admin/settings/storage";

const STATUS_TONES: Record<string, BadgeTone> = { queued: "neutral", running: "info", done: "success", failed: "danger" };
const STATUS_LABELS: Record<QueueFilter, string> = { all: "All", queued: "Queued", running: "Converting", failed: "Failed", done: "Done" };

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 font-mono text-xs break-all">{children}</code>;
}

function queueHref(filter: QueueFilter, q: string, page = 1): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `${PATH}${qs ? `?${qs}` : ""}#queue`;
}

export default async function StorageSettingsPage({ searchParams }: PageProps<"/admin/settings/storage">) {
  await requireRole(["admin"], PATH);
  const sp = await searchParams;
  const filter = parseQueueFilter(sp.status);
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) ?? "";

  const [db, status, ffmpeg, uploads, transcription, usage] = await Promise.all([
    getDb(),
    getStorageStatus(),
    detectFfmpeg(),
    getUploadSessionStats(),
    transcriptionAvailability(),
    localUsage(),
  ]);
  const settings = db.settings.storage;
  const remote = isRemoteStorage();
  const cdn = publicBaseUrl(db.settings);
  const queue = queuePage(db, { filter, query: q, page: parsePage(sp.page) });
  const active = queue.counts.queued + queue.counts.running > 0;
  const workerRunning = isWorkerRunning();
  const cronUrl = `${siteConfig.appUrl}/api/cron/media?key=${cronKey()}`;

  let uploadedVideos = 0;
  let streaming = 0;
  for (const lesson of db.lessons) {
    for (const block of lesson.blocks) {
      if (block.type !== "video" || !block.transcode) continue;
      uploadedVideos++;
      if (block.transcode.status === "ready") streaming++;
    }
  }

  return (
    <>
      <SettingsPanelHeader
        title="Storage & video"
        description="Where uploads are kept, how lesson videos are converted for adaptive streaming, and the conversion queue."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Storage"
          value={status.driver === "s3" ? (status.s3?.provider ?? "S3") : "This server"}
          icon={<Icon.Database className="size-4" />}
          hint={status.driver === "s3" ? `Bucket ${status.s3?.bucket ?? ""}` : `${formatNumber(usage.files)} files · ${formatBytes(usage.bytes)}`}
        />
        <StatCard
          label="Adaptive streaming"
          value={`${formatNumber(streaming)} / ${formatNumber(uploadedVideos)}`}
          icon={<Icon.Layers className="size-4" />}
          hint={settings.transcodeToHls ? "Uploaded videos with an HLS stream" : "Conversion is off"}
        />
        <StatCard
          label="Conversion queue"
          value={formatNumber(queue.counts.queued + queue.counts.running)}
          icon={<Icon.Loader className="size-4" />}
          hint={queue.counts.failed ? `${formatNumber(queue.counts.failed)} failed` : "Nothing failed"}
        />
        <StatCard
          label="Uploads in progress"
          value={formatNumber(uploads.active)}
          icon={<Icon.Upload className="size-4" />}
          hint={uploads.active ? `${formatBytes(uploads.receivedBytes)} of ${formatBytes(uploads.activeBytes)} received` : `${formatNumber(uploads.completedLastWeek)} finished this week`}
        />
      </div>

      <div className="space-y-6">
        <SettingsSection title="File storage" description="Chosen in the server's .env file (STORAGE_DRIVER and S3_* values). Keys are never shown in full.">
          {status.misconfigured && (
            <div role="alert" className="flex items-start gap-2.5 bg-warning/10 px-4 py-3 text-sm text-ink sm:px-5">
              <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                <span className="font-medium">STORAGE_DRIVER is s3, but {status.missing.join(", ")} {status.missing.length === 1 ? "is" : "are"} missing.</span> Files are kept on this
                server until the values are added and the app is restarted.
              </p>
            </div>
          )}
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
            {status.driver === "s3" && status.s3 ? (
              <>
                <DetailItem label="Provider">{status.s3.provider}</DetailItem>
                <DetailItem label="Bucket">
                  <Code>{status.s3.bucket}</Code>
                </DetailItem>
                <DetailItem label="Endpoint">{status.s3.endpoint ? <Code>{status.s3.endpoint}</Code> : "AWS default"}</DetailItem>
                <DetailItem label="Region">
                  {status.s3.region} · {status.s3.pathStyle ? "path-style URLs" : "virtual-hosted URLs"}
                </DetailItem>
                <DetailItem label="Access key">
                  <Code>{status.s3.accessKeyId}</Code>
                </DetailItem>
                <DetailItem label="Secret key">{status.s3.secretSet ? "Set" : <span className="text-danger">Missing</span>}</DetailItem>
                <DetailItem label="Public URL">{cdn ? <Code>{cdn}</Code> : "None: every file goes through this server"}</DetailItem>
              </>
            ) : (
              <>
                <DetailItem label="Driver">Local disk</DetailItem>
                <DetailItem label="Folder">
                  <Code>{status.localDir}</Code>
                </DetailItem>
                <DetailItem label="Used">
                  {formatNumber(usage.files)} files · {formatBytes(usage.bytes)}
                </DetailItem>
                <DetailItem label="Free space">{status.disk ? `${formatBytes(status.disk.free)} of ${formatBytes(status.disk.total)}` : "Unknown"}</DetailItem>
              </>
            )}
          </dl>
          <SettingsRow
            label="Test connection"
            description="Writes a small file, reads it back (and through a signed link with S3), then deletes it."
          >
            <StorageConnectionTest />
          </SettingsRow>
          {status.driver === "local" && !status.misconfigured && (
            <div className="px-4 py-3 text-xs leading-relaxed text-ink-muted sm:px-5">
              To keep files in AWS S3, Cloudflare R2, Backblaze B2 or MinIO, set <Code>STORAGE_DRIVER=s3</Code>, <Code>S3_BUCKET</Code>, <Code>S3_ACCESS_KEY_ID</Code>,{" "}
              <Code>S3_SECRET_ACCESS_KEY</Code> and, for anything but AWS, <Code>S3_ENDPOINT</Code> in .env, then restart the app.
            </div>
          )}
          {remote && usage.files > 0 && (
            <SettingsRow label="Files still on this server" description={`${formatNumber(usage.files)} files (${formatBytes(usage.bytes)}) were uploaded before the bucket was set up. The media cron moves them gradually; you can also move a batch now.`}>
              <StorageActionButton
                action={migrateLocalFilesAction}
                label="Move to bucket"
                icon={<Icon.Upload className="size-4" />}
                confirm={{
                  title: "Move local files to the bucket?",
                  description: "Up to 500 files are copied to the bucket and removed from this server once the copy is verified. Links keep working.",
                  confirmLabel: "Move files",
                }}
              />
            </SettingsRow>
          )}
        </SettingsSection>

        <SettingsSection title="Video converter" description="ffmpeg converts uploads into adaptive HLS streams and makes poster frames.">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              {ffmpeg.available ? <Icon.CheckCircle className="mt-0.5 size-5 shrink-0 text-success" /> : <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />}
              <div className="min-w-0 text-sm">
                {ffmpeg.available ? (
                  <>
                    <p className="font-medium text-ink">ffmpeg {ffmpeg.ffmpegVersion ?? ""} is installed</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      <Code>{ffmpeg.ffmpegPath}</Code> · checked {relativeTime(ffmpeg.checkedAt)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-ink">ffmpeg not found</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                      {ffmpeg.error ? `${ffmpeg.error}. ` : ""}
                      {FFMPEG_INSTALL_HINT} Until then, videos play as uploaded.
                    </p>
                  </>
                )}
              </div>
            </div>
            <StorageActionButton action={recheckFfmpegAction} label="Check again" icon={<Icon.Refresh className="size-4" />} className="shrink-0 self-start" />
          </div>
        </SettingsSection>

        <StorageSettingsForm initial={settings} remote={remote} ffmpegAvailable={ffmpeg.available} transcribeConfigured={transcription.apiConfigured} />

        <section id="queue" className="scroll-mt-20 rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="queue-title">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="min-w-0">
              <h3 id="queue-title" className="text-base font-semibold text-ink">
                Conversion queue
              </h3>
              <p className="mt-0.5 text-sm text-ink-muted">
                One video is converted at a time. {workerRunning ? "The converter is working." : active ? "Waiting for the converter to start." : "The converter is idle."}
              </p>
              <div className="mt-1">
                <QueueAutoRefresh active={active} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StorageActionButton
                action={retryFailedTranscodesAction}
                label="Retry failed"
                icon={<Icon.Refresh className="size-4" />}
                disabled={!queue.counts.failed}
              />
              <StorageActionButton
                action={convertAllVideosAction}
                label="Convert all videos"
                icon={<Icon.Layers className="size-4" />}
                disabled={!settings.transcodeToHls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <nav aria-label="Filter conversions" className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {QUEUE_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={queueHref(f, q)}
                  aria-current={f === filter ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    f === filter ? "bg-accent text-white" : "bg-surface-2 text-ink-muted hover:text-ink",
                  )}
                >
                  {STATUS_LABELS[f]}
                  <span className="tabular-nums opacity-80">{formatNumber(queue.counts[f])}</span>
                </Link>
              ))}
            </nav>
            <form action={PATH} method="get" role="search" className="flex gap-2 sm:w-72">
              {filter !== "all" && <input type="hidden" name="status" value={filter} />}
              <Input name="q" type="search" defaultValue={q} placeholder="Search lesson or course" aria-label="Search conversions" leftAddon={<Icon.Search className="size-4" />} />
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
            </form>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <Table>
              <THead>
                <TR>
                  <TH>Video</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Updated</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {queue.rows.length === 0 && (
                  <TableEmpty colSpan={4}>
                    {q || filter !== "all" ? "No conversions match this filter." : settings.transcodeToHls ? "No conversions yet. Uploaded lesson videos show up here." : "Turn on adaptive streaming to convert uploaded videos."}
                  </TableEmpty>
                )}
                {queue.rows.map(({ job, lessonTitle, courseTitle, editHref }) => (
                  <TR key={job.id}>
                    <TD className="max-w-0 min-w-48">
                      {editHref ? (
                        <Link href={editHref} className="block truncate font-medium text-ink hover:underline">
                          {lessonTitle}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-ink-muted">Deleted lesson</span>
                      )}
                      <span className="block truncate text-xs text-ink-muted">{courseTitle ?? job.sourceKey}</span>
                      {job.status === "failed" && job.error && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-danger">{errorSummary(job.error)}</summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-muted">{job.error}</pre>
                        </details>
                      )}
                    </TD>
                    <TD className="w-40">
                      <Badge tone={STATUS_TONES[job.status] ?? "neutral"} dot>
                        {STATUS_LABELS[job.status]}
                      </Badge>
                      {job.status === "running" && <ProgressBar value={job.progress} size="xs" className="mt-1.5" label={`Converting ${lessonTitle ?? "video"}`} />}
                      {job.attempts > 1 && <span className="mt-1 block text-xs text-ink-muted">Attempt {job.attempts}</span>}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs text-ink-muted sm:table-cell">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</TD>
                    <TD className="text-right">
                      <TranscodeJobActions jobId={job.id} status={job.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {queue.pages > 1 && (
              <nav aria-label="Queue pages" className="mt-3 flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-muted">
                  Page {queue.page} of {queue.pages} · {formatNumber(queue.total)} conversions
                </span>
                <div className="flex gap-2">
                  {queue.page > 1 && (
                    <ButtonLink href={queueHref(filter, q, queue.page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
                      Previous
                    </ButtonLink>
                  )}
                  {queue.page < queue.pages && (
                    <ButtonLink href={queueHref(filter, q, queue.page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
                      Next
                    </ButtonLink>
                  )}
                </div>
              </nav>
            )}
          </div>
        </section>

        <SettingsSection title="Scheduled housekeeping" description="Call this URL every 5–15 minutes from a cron job or uptime monitor.">
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <CopyField value={cronUrl} label="Media cron URL" secret />
            <p className="text-xs leading-relaxed text-ink-muted">
              Each run removes uploads abandoned for a day ({formatNumber(uploads.abortedLastWeek)} cleaned or cancelled this week), queues videos that still need converting, resumes
              the converter after a restart, deletes streams no lesson uses any more{remote ? " and moves files left on this server to the bucket" : ""}. It uses the same key as the
              email cron.
            </p>
            <StorageActionButton action={runMediaMaintenanceAction} label="Run now" icon={<Icon.Zap className="size-4" />} />
          </div>
        </SettingsSection>
      </div>
    </>
  );
}
