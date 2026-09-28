import fs from "node:fs/promises";
import path from "node:path";
import { requireRole } from "@/lib/auth/session";
import { COLLECTIONS, getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import type { CollectionName } from "@/lib/types";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { DataPanel } from "@/components/admin/settings/data-panel";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/utils";

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

async function fileSize(): Promise<number | null> {
  try {
    const stat = await fs.stat(path.join(process.cwd(), siteConfig.dataFile));
    return stat.size;
  } catch {
    return null;
  }
}

export default async function DataSettingsPage() {
  await requireRole(["admin"], "/admin/settings/data");
  const [db, size] = await Promise.all([getDb(), fileSize()]);
  const totalRecords = COLLECTIONS.reduce((sum, name) => sum + db[name].length, 0);
  const rows = COLLECTIONS.filter((name) => LABELS[name]).map((name) => ({ name, label: LABELS[name]!, count: db[name].length }));

  return (
    <>
      <SettingsPanelHeader title="Backup & reset" description="Download a snapshot of the database or start over with the demo content." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Records" value={formatNumber(totalRecords)} hint={`${COLLECTIONS.length} collections`} icon={<Icon.Database className="size-5" />} />
        <StatCard label="Database size" value={size === null ? "—" : formatBytes(size)} hint={siteConfig.dataFile} icon={<Icon.Archive className="size-5" />} />
        <StatCard label="Settings updated" value={<span className="text-lg">{formatDateTime(db.settings.updatedAt) || "Never"}</span>} icon={<Icon.Clock className="size-5" />} />
      </div>
      <div className="mt-6">
        <DataPanel />
      </div>
      <SettingsSection title="Database statistics" description="Number of records in each collection." className="mt-6">
        <dl className="grid grid-cols-1 gap-x-8 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
              <dt className="text-ink-muted">{r.label}</dt>
              <dd className="font-medium tabular-nums text-ink">{formatNumber(r.count)}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>
    </>
  );
}
