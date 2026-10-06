import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { cronKey } from "@/lib/email";
import { getStorageStatus, isRemoteStorage, localUsage, publicBaseUrl } from "@/lib/storage";
import { getUploadSessionStats } from "@/lib/media/resumable";
import { detectFfmpeg } from "@/lib/media/transcode/ffmpeg";
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
import { cn, formatBytes } from "@/lib/utils";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.storage.metaTitle") };
}

const PATH = "/admin/settings/storage";

const STATUS_TONES: Record<string, BadgeTone> = { queued: "neutral", running: "info", done: "success", failed: "danger" };

function Code({ children }: { children: ReactNode }) {
  return <code dir="ltr" className="rounded bg-surface-2 px-1 font-mono text-xs break-all">{children}</code>;
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
  const t = await getT("admin");
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
  const f = await getFormatter();
  const formatNumber = (n: number) => f.number(n);
  const relativeTime = (iso: string) => f.relative(iso);
  const statusLabel = (s: QueueFilter) => t(`pages.settings.storage.status.${s}`);
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
        title={t("pages.settings.storage.title")}
        description={t("pages.settings.storage.description")}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("pages.settings.storage.stats.storage")}
          value={status.driver === "s3" ? (status.s3?.provider ?? "S3") : t("pages.settings.storage.stats.thisServer")}
          icon={<Icon.Database className="size-4" />}
          hint={status.driver === "s3" ? t("pages.settings.storage.stats.bucket", { bucket: status.s3?.bucket ?? "" }) : t("pages.settings.storage.stats.files", { count: usage.files, size: formatBytes(usage.bytes) })}
        />
        <StatCard
          label={t("pages.settings.storage.stats.streaming")}
          value={`${formatNumber(streaming)} / ${formatNumber(uploadedVideos)}`}
          icon={<Icon.Layers className="size-4" />}
          hint={settings.transcodeToHls ? t("pages.settings.storage.stats.streamingHint") : t("pages.settings.storage.stats.conversionOff")}
        />
        <StatCard
          label={t("pages.settings.storage.queue.title")}
          value={formatNumber(queue.counts.queued + queue.counts.running)}
          icon={<Icon.Loader className="size-4" />}
          hint={queue.counts.failed ? t("pages.settings.storage.stats.failed", { count: queue.counts.failed }) : t("pages.settings.storage.stats.nothingFailed")}
        />
        <StatCard
          label={t("pages.settings.storage.stats.uploads")}
          value={formatNumber(uploads.active)}
          icon={<Icon.Upload className="size-4" />}
          hint={uploads.active ? t("pages.settings.storage.stats.received", { received: formatBytes(uploads.receivedBytes), total: formatBytes(uploads.activeBytes) }) : t("pages.settings.storage.stats.finished", { count: uploads.completedLastWeek })}
        />
      </div>

      <div className="space-y-6">
        <SettingsSection title={t("pages.settings.storage.files.title")} description={t("pages.settings.storage.files.description")}>
          {status.misconfigured && (
            <div role="alert" className="flex items-start gap-2.5 bg-warning/10 px-4 py-3 text-sm text-ink sm:px-5">
              <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                <span className="font-medium">{t("pages.settings.storage.files.misconfigured", { missing: f.list(status.missing), count: status.missing.length })}</span>{" "}
                {t("pages.settings.storage.files.misconfiguredDetail")}
              </p>
            </div>
          )}
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
            {status.driver === "s3" && status.s3 ? (
              <>
                <DetailItem label={t("pages.settings.storage.files.provider")}>{status.s3.provider}</DetailItem>
                <DetailItem label={t("pages.settings.storage.files.bucket")}>
                  <Code>{status.s3.bucket}</Code>
                </DetailItem>
                <DetailItem label={t("pages.settings.storage.files.endpoint")}>{status.s3.endpoint ? <Code>{status.s3.endpoint}</Code> : t("pages.settings.storage.files.awsDefault")}</DetailItem>
                <DetailItem label={t("pages.settings.storage.files.region")}>
                  {status.s3.region} · {status.s3.pathStyle ? t("pages.settings.storage.files.pathStyle") : t("pages.settings.storage.files.virtualHosted")}
                </DetailItem>
                <DetailItem label={t("pages.settings.storage.files.accessKey")}>
                  <Code>{status.s3.accessKeyId}</Code>
                </DetailItem>
                <DetailItem label={t("pages.settings.storage.files.secretKey")}>{status.s3.secretSet ? t("pages.settings.storage.files.set") : <span className="text-danger">{t("pages.settings.storage.files.missing")}</span>}</DetailItem>
                <DetailItem label={t("pages.settings.storage.files.publicUrl")}>{cdn ? <Code>{cdn}</Code> : t("pages.settings.storage.files.noPublicUrl")}</DetailItem>
              </>
            ) : (
              <>
                <DetailItem label={t("pages.settings.storage.files.driver")}>{t("pages.settings.storage.files.localDisk")}</DetailItem>
                <DetailItem label={t("pages.settings.storage.files.folder")}>
                  <Code>{status.localDir}</Code>
                </DetailItem>
                <DetailItem label={t("pages.settings.storage.files.used")}>
                  {t("pages.settings.storage.stats.files", { count: usage.files, size: formatBytes(usage.bytes) })}
                </DetailItem>
                <DetailItem label={t("pages.settings.storage.files.free")}>{status.disk ? t("pages.settings.storage.files.freeOf", { free: formatBytes(status.disk.free), total: formatBytes(status.disk.total) }) : t("pages.settings.storage.files.unknown")}</DetailItem>
              </>
            )}
          </dl>
          <SettingsRow
            label={t("pages.settings.storage.files.test")}
            description={t("pages.settings.storage.files.testHint")}
          >
            <StorageConnectionTest />
          </SettingsRow>
          {status.driver === "local" && !status.misconfigured && (
            <div className="px-4 py-3 text-xs leading-relaxed text-ink-muted sm:px-5">
              {t.rich("pages.settings.storage.files.howToS3", { code: (chunks) => <Code>{chunks}</Code> })}
            </div>
          )}
          {remote && usage.files > 0 && (
            <SettingsRow label={t("pages.settings.storage.files.leftover")} description={t("pages.settings.storage.files.leftoverHint", { count: usage.files, size: formatBytes(usage.bytes) })}>
              <StorageActionButton
                action={migrateLocalFilesAction}
                label={t("pages.settings.storage.files.move")}
                icon={<Icon.Upload className="size-4" />}
                confirm={{
                  title: t("pages.settings.storage.files.moveTitle"),
                  description: t("pages.settings.storage.files.moveDescription"),
                  confirmLabel: t("pages.settings.storage.files.moveConfirm"),
                }}
              />
            </SettingsRow>
          )}
        </SettingsSection>

        <SettingsSection title={t("pages.settings.storage.ffmpeg.title")} description={t("pages.settings.storage.ffmpeg.description")}>
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              {ffmpeg.available ? <Icon.CheckCircle className="mt-0.5 size-5 shrink-0 text-success" /> : <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />}
              <div className="min-w-0 text-sm">
                {ffmpeg.available ? (
                  <>
                    <p className="font-medium text-ink">{t("pages.settings.storage.ffmpeg.installed", { version: ffmpeg.ffmpegVersion ?? "" })}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      <Code>{ffmpeg.ffmpegPath}</Code> · {t("pages.settings.storage.ffmpeg.checked", { when: relativeTime(ffmpeg.checkedAt) })}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-ink">{t("pages.settings.storage.ffmpeg.notFound")}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                      {ffmpeg.error ? `${ffmpeg.error}. ` : ""}
                      {t.rich("pages.settings.storage.ffmpeg.installHint", { code: (chunks) => <Code>{chunks}</Code> })} {t("pages.settings.storage.ffmpeg.until")}
                    </p>
                  </>
                )}
              </div>
            </div>
            <StorageActionButton action={recheckFfmpegAction} label={t("pages.settings.storage.ffmpeg.recheck")} icon={<Icon.Refresh className="size-4" />} className="shrink-0 self-start" />
          </div>
        </SettingsSection>

        <StorageSettingsForm initial={settings} remote={remote} ffmpegAvailable={ffmpeg.available} transcribeConfigured={transcription.apiConfigured} />

        <section id="queue" className="scroll-mt-20 rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="queue-title">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="min-w-0">
              <h3 id="queue-title" className="text-base font-semibold text-ink">
                {t("pages.settings.storage.queue.title")}
              </h3>
              <p className="mt-0.5 text-sm text-ink-muted">
                {t("pages.settings.storage.queue.oneAtATime")} {workerRunning ? t("pages.settings.storage.queue.working") : active ? t("pages.settings.storage.queue.waiting") : t("pages.settings.storage.queue.idle")}
              </p>
              <div className="mt-1">
                <QueueAutoRefresh active={active} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StorageActionButton
                action={retryFailedTranscodesAction}
                label={t("pages.settings.storage.queue.retryFailed")}
                icon={<Icon.Refresh className="size-4" />}
                disabled={!queue.counts.failed}
              />
              <StorageActionButton
                action={convertAllVideosAction}
                label={t("pages.settings.storage.queue.convertAll")}
                icon={<Icon.Layers className="size-4" />}
                disabled={!settings.transcodeToHls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <nav aria-label={t("pages.settings.storage.queue.filter")} className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {QUEUE_FILTERS.map((option) => (
                <Link
                  key={option}
                  href={queueHref(option, q)}
                  aria-current={option === filter ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    option === filter ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted hover:text-ink",
                  )}
                >
                  {statusLabel(option)}
                  <span className="tabular-nums opacity-80">{formatNumber(queue.counts[option])}</span>
                </Link>
              ))}
            </nav>
            <form action={PATH} method="get" role="search" className="flex gap-2 sm:w-72">
              {filter !== "all" && <input type="hidden" name="status" value={filter} />}
              <Input name="q" type="search" defaultValue={q} placeholder={t("pages.settings.storage.queue.searchPlaceholder")} aria-label={t("pages.settings.storage.queue.searchLabel")} leftAddon={<Icon.Search className="size-4" />} />
              <Button type="submit" variant="outline" size="sm">
                {t("pages.shared.search")}
              </Button>
            </form>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <Table>
              <THead>
                <TR>
                  <TH>{t("pages.settings.storage.queue.video")}</TH>
                  <TH>{t("pages.settings.storage.queue.status")}</TH>
                  <TH className="hidden sm:table-cell">{t("pages.settings.storage.queue.updated")}</TH>
                  <TH className="text-end">
                    <span className="sr-only">{t("pages.shared.actions")}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {queue.rows.length === 0 && (
                  <TableEmpty colSpan={4}>
                    {q || filter !== "all" ? t("pages.settings.storage.queue.noMatch") : settings.transcodeToHls ? t("pages.settings.storage.queue.empty") : t("pages.settings.storage.queue.off")}
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
                        <span className="block truncate font-medium text-ink-muted">{t("pages.settings.storage.queue.deletedLesson")}</span>
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
                        {statusLabel(job.status)}
                      </Badge>
                      {job.status === "running" && <ProgressBar value={job.progress} size="xs" className="mt-1.5" label={t("pages.settings.storage.queue.converting", { title: lessonTitle ?? t("pages.settings.storage.queue.video") })} />}
                      {job.attempts > 1 && <span className="mt-1 block text-xs text-ink-muted">{t("pages.settings.storage.queue.attempt", { count: job.attempts })}</span>}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs text-ink-muted sm:table-cell">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</TD>
                    <TD className="text-end">
                      <TranscodeJobActions jobId={job.id} status={job.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {queue.pages > 1 && (
              <nav aria-label={t("pages.settings.storage.queue.pages")} className="mt-3 flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-muted">
                  {t("pages.settings.storage.queue.pageOf", { page: queue.page, pages: queue.pages, total: queue.total })}
                </span>
                <div className="flex gap-2">
                  {queue.page > 1 && (
                    <ButtonLink href={queueHref(filter, q, queue.page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />}>
                      {t("pages.shared.previous")}
                    </ButtonLink>
                  )}
                  {queue.page < queue.pages && (
                    <ButtonLink href={queueHref(filter, q, queue.page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />}>
                      {t("pages.shared.next")}
                    </ButtonLink>
                  )}
                </div>
              </nav>
            )}
          </div>
        </section>

        <SettingsSection title={t("pages.settings.storage.cron.title")} description={t("pages.settings.storage.cron.description")}>
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <CopyField value={cronUrl} label={t("pages.settings.storage.cron.url")} secret />
            <p className="text-xs leading-relaxed text-ink-muted">
              {remote ? t("pages.settings.storage.cron.detailRemote", { count: uploads.abortedLastWeek }) : t("pages.settings.storage.cron.detail", { count: uploads.abortedLastWeek })}
            </p>
            <StorageActionButton action={runMediaMaintenanceAction} label={t("pages.settings.storage.cron.run")} icon={<Icon.Zap className="size-4" />} />
          </div>
        </SettingsSection>
      </div>
    </>
  );
}
