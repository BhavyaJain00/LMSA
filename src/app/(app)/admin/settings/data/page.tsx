import fs from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { MAX_BACKUP_UPLOAD_BYTES, getBackupManager, type BackupInfo, type StorageOverview } from "@/lib/db/backup";
import { BUSY_TIMEOUT_MS } from "@/lib/db/sqlite-core.mjs";
import { StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { BackupsManager } from "@/components/admin/settings/backups-manager";
import { BackupIntegrity } from "@/components/admin/settings/backup-integrity";
import { DataPanel } from "@/components/admin/settings/data-panel";
import { sortedCounts, type BackupRow } from "@/components/admin/settings/data-labels";
import { formatBytes, formatDateTime, formatNumber, pluralize, relativeTime } from "@/lib/utils";

export const metadata = { title: "Backup & restore" };

/** Stop counting the uploads folder after this many files (keeps the page fast on huge libraries). */
const MAX_UPLOAD_ENTRIES = 5000;
const MB = 1024 * 1024;
/** With automatic backups on, a newest backup older than this is flagged. */
const STALE_BACKUP_MS = 48 * 60 * 60 * 1000;

const ORIGIN_LABELS: Record<NonNullable<StorageOverview["stats"]["origin"]>, string> = {
  existing: "Opened an existing database",
  "imported-json": "Imported from the JSON database",
  seeded: "Created with starting data",
};

async function uploadsUsage(uploadPath: string): Promise<{ files: number; bytes: number; truncated: boolean } | null> {
  try {
    const entries = await fs.readdir(uploadPath, { recursive: true, withFileTypes: true });
    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (files >= MAX_UPLOAD_ENTRIES) return { files, bytes, truncated: true };
      files++;
      try {
        const stat = await fs.stat(path.join(entry.parentPath, entry.name));
        bytes += stat.size;
      } catch {
        // The file disappeared while we were counting; skip it.
      }
    }
    return { files, bytes, truncated: false };
  } catch {
    return null;
  }
}

/** Whether a deployment variable is set in the environment (as opposed to using the built-in default). */
function fromEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/** Backups as the client list shows them; dates are formatted here so server and browser render the same text. */
function toRows(backups: BackupInfo[], now: Date): BackupRow[] {
  return backups.map((b) => ({ ...b, createdLabel: formatDateTime(b.createdAt), ageLabel: relativeTime(b.createdAt, now) }));
}

function InfoRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-3.5 sm:flex sm:items-start sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0 sm:max-w-sm sm:flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="mt-1.5 min-w-0 text-sm text-ink sm:mt-0 sm:w-96 sm:shrink-0 sm:text-right">{children}</div>
    </div>
  );
}

function EnvRow({ name, description, value, env, children }: { name: string; description: string; value?: ReactNode; env: boolean; children?: ReactNode }) {
  return (
    <div className="px-4 py-3.5 sm:flex sm:items-start sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0 sm:max-w-sm sm:flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-ink">{name}</code>
          {env ? (
            <Badge tone="accent" size="xs">
              Set in .env
            </Badge>
          ) : (
            <Badge tone="neutral" size="xs">
              Default
            </Badge>
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      </div>
      <div className="mt-2 min-w-0 text-sm text-ink sm:mt-0 sm:w-80 sm:shrink-0 sm:text-right">
        {value !== undefined && <p className="break-all font-mono text-[13px]">{value}</p>}
        {children}
      </div>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "danger" | "warning" | "info"; title: string; children: ReactNode }) {
  const styles = {
    danger: { box: "border-danger/30 bg-danger/10", icon: <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" /> },
    warning: { box: "border-warning/30 bg-warning/10", icon: <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> },
    info: { box: "border-info/30 bg-info/10", icon: <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" /> },
  }[tone];
  return (
    <div role={tone === "info" ? undefined : "alert"} className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-ink ${styles.box}`}>
      {styles.icon}
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 wrap-break-word text-ink-muted">{children}</div>
      </div>
    </div>
  );
}

/**
 * Sizing figures from `tests/data-sqlite-scale.test.ts` (its diagnostics print
 * the same numbers). Keep in step with the "Sizing" part of DEPLOYMENT.md.
 */
const SCALE_MEASUREMENTS: readonly { label: string; value: string }[] = [
  { label: "Start-up", value: "about 2 seconds to check the file and load every record into memory, using about 330 MB of memory" },
  {
    label: "Saving progress",
    value: "1,000 video and lesson heartbeats in a row, each saved to disk on its own: 1.2 ms typical, 2.2 ms for 95% of them, 3.3 ms for 99%",
  },
  { label: "Bursts", value: "1,000 heartbeats at the same moment are saved together in one transaction of 400 records" },
  {
    label: "Background check",
    value: "the check for edits made outside the store reads all 256,000 records in 96 short steps of at most 9 ms each, so pages keep responding while it runs",
  },
];

function Command({ children }: { children: ReactNode }) {
  return <code className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>;
}

export default async function DataSettingsPage() {
  await requireRole(["admin"], "/admin/settings/data");
  const uploadPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir);
  const manager = await getBackupManager();
  const [overview, uploads] = await Promise.all([manager.overview(), uploadsUsage(uploadPath)]);
  const { info, stats, automatic } = overview;
  const sqlite = info.driver === "sqlite";
  const now = new Date();

  // A write error matters until a later write succeeded.
  const saveError = stats.lastError && (!stats.lastFlushAt || stats.lastFlushAt < stats.lastError.at) ? stats.lastError : null;
  const newest = overview.backups[0] ?? null;
  const staleBackups = automatic.enabled && (!newest || now.getTime() - new Date(newest.createdAt).getTime() > STALE_BACKUP_MS);
  const collections = sortedCounts(overview.counts);
  const emptyCollections = Object.keys(overview.counts).length - collections.length;
  const backupsTotalBytes = overview.backups.reduce((sum, b) => sum + b.sizeBytes, 0);

  return (
    <>
      <SettingsPanelHeader
        title="Backup & restore"
        description="Back up the database, download or restore a copy, check the database file, and start over with the demo content."
      />

      <div className="space-y-3">
        {saveError && (
          <Notice tone="danger" title="Recent changes could not be saved to disk">
            {saveError.message} ({relativeTime(saveError.at, now)}). The server keeps them in memory and retries on its own; download the current data to be safe.
          </Notice>
        )}
        {automatic.lastError && (
          <Notice tone="warning" title="The last automatic backup failed">
            {automatic.lastError.message} ({relativeTime(automatic.lastError.at, now)}). It is tried again within the hour. Create a backup by hand meanwhile.
          </Notice>
        )}
        {staleBackups && !automatic.lastError && (
          <Notice tone="warning" title={newest ? "No backup in the last two days" : "There is no backup yet"}>
            The daily backup starts with the first visit of each day. Create one now, and schedule <Command>npm run db:backup -- --auto</Command> if the site can go a day without visitors.
          </Notice>
        )}
        {!automatic.enabled && (
          <Notice tone="info" title="Automatic backups are turned off">
            <Command>DB_AUTO_BACKUP</Command> is off, so only the backups you create here or with <Command>npm run db:backup</Command> exist.
          </Notice>
        )}
        {!sqlite && (
          <Notice tone="info" title="This site stores its data in a JSON file">
            <Command>DB_DRIVER=json</Command> rewrites the whole file on every change. Remove the setting and restart to move the data into SQLite automatically (the JSON file is kept).
          </Notice>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Records"
          value={formatNumber(overview.records)}
          hint={`${collections.length} of ${Object.keys(overview.counts).length} collections in use`}
          icon={<Icon.Layers className="size-5" />}
        />
        <StatCard
          label="Database size"
          value={info.sizeBytes === null ? "—" : formatBytes(info.sizeBytes)}
          hint={info.modifiedAt ? `Written ${relativeTime(info.modifiedAt, now)}` : "Not written to disk yet"}
          icon={<Icon.Database className="size-5" />}
        />
        <StatCard
          label="Latest backup"
          value={newest ? relativeTime(newest.createdAt, now) : "None yet"}
          hint={`${pluralize(overview.backups.length, "backup")}, ${formatBytes(backupsTotalBytes)}`}
          icon={<Icon.Archive className="size-5" />}
        />
        <StatCard
          label="Uploads"
          value={uploads ? formatBytes(uploads.bytes) : "—"}
          hint={uploads ? `${uploads.truncated ? "More than " : ""}${pluralize(uploads.files, "file")} (not in backups)` : "No uploads yet"}
          icon={<Icon.Upload className="size-5" />}
        />
      </div>

      <SettingsSection
        title="Backups"
        description={
          automatic.enabled
            ? `A backup is made automatically every day; the newest ${automatic.keep} are kept. Manual backups stay until you delete them.`
            : "Automatic daily backups are off. Manual backups stay until you delete them."
        }
        className="mt-6"
      >
        <div className="px-4 py-4 sm:px-5">
          <BackupsManager backups={toRows(overview.backups, now)} storageFormat={sqlite ? "sqlite" : "json"} maxUploadBytes={MAX_BACKUP_UPLOAD_BYTES} />
          <p className="mt-4 break-all text-xs text-ink-muted">
            Stored in <span className="font-mono">{overview.backupsDir}</span>, on the same disk as the database. Download important backups or copy this folder to another machine.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Database" description="Where the data lives and how it is being written." className="mt-6">
        <InfoRow label="Storage" description={sqlite ? "SQLite through Node's built-in driver. Only changed records are written." : "One JSON file, rewritten on every change."}>
          <p className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge tone={sqlite ? "success" : "neutral"} size="xs">
              {sqlite ? "SQLite" : "JSON file"}
            </Badge>
            {sqlite && info.sqliteVersion && <span className="text-xs text-ink-muted">SQLite {info.sqliteVersion}</span>}
            {info.schemaVersion !== null && <span className="text-xs text-ink-muted">schema {info.schemaVersion}</span>}
          </p>
        </InfoRow>
        <InfoRow label="File">
          <p className="break-all font-mono text-[13px]">{info.file}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {info.sizeBytes === null ? "Not created yet" : formatBytes(info.sizeBytes)}
            {sqlite && info.walBytes ? ` (${formatBytes(info.walBytes)} in the write-ahead log)` : ""}
            {info.modifiedAt && ` · written ${formatDateTime(info.modifiedAt)}`}
          </p>
        </InfoRow>
        <InfoRow label="Since the server started" description={stats.openedAt ? `${stats.origin ? ORIGIN_LABELS[stats.origin] : "Opened"} ${relativeTime(stats.openedAt, now)}.` : undefined}>
          <p className="tabular-nums">
            {pluralize(stats.documentsWritten, "record")} written in {pluralize(stats.flushes, "save")}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {stats.lastFlushAt ? `Last save ${relativeTime(stats.lastFlushAt, now)}${stats.lastFlushMs !== null ? ` (${formatNumber(stats.lastFlushMs)} ms)` : ""}` : "Nothing saved yet"}
            {stats.pending && " · changes waiting to be saved"}
            {stats.externalReloads > 0 && ` · reloaded ${formatNumber(stats.externalReloads)}× after changes by another process`}
          </p>
        </InfoRow>
        <BackupIntegrity driver={info.driver} />
      </SettingsSection>

      <SettingsSection title="Records per collection" description="What the database holds right now. Every backup lists the same counts under “What is in it”." className="mt-6">
        {collections.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted sm:px-5">The database holds no records yet.</p>
        ) : (
          <div className="px-4 py-3 sm:px-5">
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm">
                  <dt className="min-w-0 truncate text-ink-muted" title={entry.name}>
                    {entry.label}
                  </dt>
                  <dd className="font-medium tabular-nums text-ink">{formatNumber(entry.count)}</dd>
                </div>
              ))}
            </dl>
            {emptyCollections > 0 && (
              <p className="pt-3 text-xs text-ink-muted">
                {pluralize(emptyCollections, "empty collection")} not shown.
              </p>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Running in production" description="How to deploy and look after the database safely." className="mt-6">
        <div className="space-y-4 px-4 py-4 text-sm leading-relaxed text-ink-muted sm:px-5">
          <div>
            <h4 className="font-medium text-ink">Run one app process per database</h4>
            <p className="mt-0.5">
              {sqlite ? "SQLite lets one process write at a time, and the" : "The"} app keeps the whole database in memory. Run a single server process (one{" "}
              <Command>npm start</Command>, no cluster mode, no second replica or serverless instance on the same {sqlite ? "file" : "JSON file"}). A second process would wait for the
              write lock (up to {formatNumber(BUSY_TIMEOUT_MS / 1000)} seconds, then the change fails with “database is locked”){sqlite ? "" : " or overwrite the other process's changes"}.
              Scale up with a larger server rather than more processes.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-ink">How large a school one server handles</h4>
            <p className="mt-0.5">
              Measured by the scale test (<span className="font-mono">tests/data-sqlite-scale.test.ts</span>) on an 8-core desktop running Node 24, with a school of 5,000 learners,
              50,000 enrollments and 200,000 lesson-progress and video-progress records (about 256,000 records, a 93 MB database file):
            </p>
            <ul className="mt-1.5 list-disc space-y-1 ps-5">
              {SCALE_MEASUREMENTS.map((item) => (
                <li key={item.label}>
                  <span className="text-ink">{item.label}:</span> {item.value}
                </li>
              ))}
            </ul>
            <p className="mt-1.5">
              Cost grows with what changes, not with the size of the school, so a busy site stays fast. Memory grows with the number of records: allow roughly 1.5 GB of RAM per
              million records, plus the operating system and video conversion.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-ink">Keep the storage folder on a persistent local disk</h4>
            <p className="mt-0.5">
              Mount <span className="font-mono">storage/</span> on a volume that survives restarts and redeploys. Do not put the database on a network share (NFS, SMB): file locking there is not
              reliable and can damage it.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-ink">Keep copies somewhere else</h4>
            <p className="mt-0.5">
              Backups sit next to the database, so a lost disk takes both. Download a backup regularly, or copy the backups folder off the server on a schedule. Uploaded files (
              <span className="font-mono">{siteConfig.uploadDir}</span>) are not part of database backups: copy that folder too.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-ink">Command line, on the server</h4>
            <ul className="mt-1 space-y-1.5">
              <li>
                <Command>npm run db:backup</Command> makes a backup while the site keeps running (<Command>-- --auto</Command> for a daily cron job, <Command>-- --list</Command> to list them).
              </li>
              <li>
                <Command>npm run db:restore -- latest</Command> restores the newest backup, or give a backup name or file; <Command>-- --dry-run</Command> shows what would change first.
              </li>
              <li>
                <Command>npm run db:export -- --out export.json</Command> writes everything as one JSON file.
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-ink">If the server will not start because the database is damaged</h4>
            <p className="mt-0.5">
              Every start runs SQLite&apos;s quick integrity check and stops with instructions when it fails, rather than serving damaged data. Stop the app, run{" "}
              <Command>npm run db:restore -- latest</Command>, then start it again. The damaged file is kept next to the database as <span className="font-mono">*.damaged-&lt;time&gt;</span>.
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Environment"
        description="Deployment values read from your .env file when the server started. Edit .env and restart the server to change them."
        className="mt-6"
      >
        <EnvRow name="DB_DRIVER" env={fromEnv("DB_DRIVER")} description="Where the data is stored: sqlite (default) or json (the original single JSON file)." value={info.driver} />
        {sqlite ? (
          <EnvRow name="SQLITE_PATH" env={fromEnv("SQLITE_PATH")} description="The SQLite database file. Relative paths start at the project root. Backups go to a backups folder next to it." value={info.file} />
        ) : (
          <EnvRow name="DATA_FILE" env={fromEnv("DATA_FILE")} description="The JSON database file. Relative paths start at the project root." value={info.file} />
        )}
        <EnvRow
          name="DB_AUTO_BACKUP"
          env={fromEnv("DB_AUTO_BACKUP")}
          description="Daily automatic backup on the first request of each day. Set to false to turn it off."
          value={automatic.enabled ? "on" : "off"}
        />
        <EnvRow name="DB_BACKUP_KEEP" env={fromEnv("DB_BACKUP_KEEP")} description="How many automatic daily backups are kept (1–3650)." value={formatNumber(automatic.keep)} />
        <EnvRow name="UPLOAD_DIR" env={fromEnv("UPLOAD_DIR")} description="Folder that stores uploaded videos, images and documents." value={siteConfig.uploadDir}>
          {uploadPath !== siteConfig.uploadDir && <p className="mt-1 break-all text-xs text-ink-muted">Resolved: {uploadPath}</p>}
          {!uploads && <p className="mt-0.5 text-xs text-ink-muted">The folder is created on the first upload.</p>}
        </EnvRow>
        <EnvRow
          name="MAX_VIDEO_UPLOAD_MB"
          env={fromEnv("MAX_VIDEO_UPLOAD_MB")}
          description="Largest video a course creator can upload."
          value={`${formatNumber(Math.round(siteConfig.maxUploadBytes / MB))} MB`}
        />
        <EnvRow
          name="MAX_FILE_UPLOAD_MB"
          env={fromEnv("MAX_FILE_UPLOAD_MB")}
          description="Largest image, document or audio file anyone can upload (resumes, logos, attachments)."
          value={`${formatNumber(Math.round(siteConfig.maxAssetBytes / MB))} MB`}
        />
        <EnvRow name="SEED_DEMO_DATA" env={fromEnv("SEED_DEMO_DATA")} description="What a brand-new database starts with. Only used when no database exists yet.">
          <p className="flex flex-wrap items-center gap-2 sm:justify-end">
            <code className="font-mono text-[13px]">{siteConfig.seedDemoData ? "true" : "false"}</code>
            <span className="text-xs text-ink-muted">{siteConfig.seedDemoData ? "Demo courses and members" : "Empty site with one admin account"}</span>
          </p>
        </EnvRow>
      </SettingsSection>

      <div className="mt-6">
        <DataPanel seedDemoData={siteConfig.seedDemoData} />
      </div>
    </>
  );
}
