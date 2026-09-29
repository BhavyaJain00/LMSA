import fs from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { COLLECTIONS, getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import type { CollectionName } from "@/lib/types";
import { StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { DataPanel } from "@/components/admin/settings/data-panel";
import { formatBytes, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Backup & reset" };

const LABELS: Partial<Record<CollectionName, string>> = {
  users: "Members",
  courses: "Courses",
  chapters: "Chapters",
  lessons: "Lessons",
  enrollments: "Enrollments",
  progress: "Lesson progress",
  quizzes: "Quizzes",
  questions: "Questions",
  quizSubmissions: "Quiz submissions",
  assignments: "Assignments",
  assignmentSubmissions: "Assignment submissions",
  exercises: "Exercises",
  exerciseSubmissions: "Exercise submissions",
  batches: "Batches",
  batchEnrollments: "Batch enrollments",
  liveClasses: "Live classes",
  programs: "Programs",
  certificates: "Certificates",
  badges: "Badges",
  badgeAssignments: "Badge assignments",
  payments: "Payments",
  coupons: "Coupons",
  jobs: "Job openings",
  jobApplications: "Job applications",
  discussionTopics: "Discussion topics",
  discussionReplies: "Discussion replies",
  notifications: "Notifications",
  activities: "Activity log entries",
  sessions: "Active sessions",
};

/** Stop counting the uploads folder after this many files (keeps the page fast on huge libraries). */
const MAX_UPLOAD_ENTRIES = 5000;
const MB = 1024 * 1024;

async function databaseFile(dataPath: string): Promise<{ size: number; modifiedAt: string } | null> {
  try {
    const stat = await fs.stat(dataPath);
    return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

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

export default async function DataSettingsPage() {
  await requireRole(["admin"], "/admin/settings/data");
  // DATA_FILE and UPLOAD_DIR may be relative to the project root or absolute.
  const dataPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.dataFile);
  const uploadPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir);
  const [db, file, uploads] = await Promise.all([getDb(), databaseFile(dataPath), uploadsUsage(uploadPath)]);

  const totalRecords = COLLECTIONS.reduce((sum, name) => sum + db[name].length, 0);
  const rows = COLLECTIONS.filter((name) => LABELS[name]).map((name) => ({ name, label: LABELS[name]!, count: db[name].length }));

  return (
    <>
      <SettingsPanelHeader title="Backup & reset" description="Download a snapshot of the database, start over with the demo content, and check how this deployment is configured." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Records" value={formatNumber(totalRecords)} hint={`${COLLECTIONS.length} collections`} icon={<Icon.Database className="size-5" />} />
        <StatCard
          label="Database size"
          value={file ? formatBytes(file.size) : "—"}
          hint={file ? `Written ${relativeTime(file.modifiedAt)}` : "Not written to disk yet"}
          icon={<Icon.Archive className="size-5" />}
        />
        <StatCard
          label="Uploads"
          value={uploads ? formatBytes(uploads.bytes) : "—"}
          hint={uploads ? `${uploads.truncated ? "More than " : ""}${formatNumber(uploads.files)} ${uploads.files === 1 ? "file" : "files"}` : "No uploads yet"}
          icon={<Icon.Upload className="size-5" />}
        />
      </div>

      <div className="mt-6">
        <DataPanel seedDemoData={siteConfig.seedDemoData} />
      </div>

      <SettingsSection
        title="Environment"
        description="Deployment values read from your .env file when the server started. Edit .env and restart the server to change them."
        className="mt-6"
      >
        <EnvRow name="APP_URL" env={fromEnv("APP_URL")} description="Public address of the site, used for absolute links and share metadata." value={siteConfig.appUrl} />
        <EnvRow name="DATA_FILE" env={fromEnv("DATA_FILE")} description="The JSON database file. Relative paths start at the project root." value={siteConfig.dataFile}>
          {dataPath !== siteConfig.dataFile && <p className="mt-1 break-all text-xs text-ink-muted">Resolved: {dataPath}</p>}
          {file && <p className="mt-0.5 text-xs text-ink-muted">Last written {formatDateTime(file.modifiedAt)}</p>}
        </EnvRow>
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
        <EnvRow name="SEED_DEMO_DATA" env={fromEnv("SEED_DEMO_DATA")} description="What a brand-new database starts with. Only used when the database file does not exist yet.">
          <p className="flex flex-wrap items-center gap-2 sm:justify-end">
            <code className="font-mono text-[13px]">{siteConfig.seedDemoData ? "true" : "false"}</code>
            <span className="text-xs text-ink-muted">{siteConfig.seedDemoData ? "Demo courses and members" : "Empty site with one admin account"}</span>
          </p>
        </EnvRow>
      </SettingsSection>

      <SettingsSection title="Database statistics" description="Number of records in each collection." className="mt-6">
        <dl className="grid grid-cols-1 gap-x-8 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
              <dt className="text-ink-muted">{r.label}</dt>
              <dd className="font-medium tabular-nums text-ink">{formatNumber(r.count)}</dd>
            </div>
          ))}
        </dl>
        <p className="px-4 py-3 text-xs text-ink-muted sm:px-5">Settings last updated {formatDateTime(db.settings.updatedAt) || "never"}.</p>
      </SettingsSection>
    </>
  );
}
