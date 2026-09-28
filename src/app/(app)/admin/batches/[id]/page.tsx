import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { Batch, BatchSummary, User } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  buildAssessmentRows,
  canManageBatch,
  feedbackAverages,
  getAssessmentOptions,
  getBatchAnnouncements,
  getBatchById,
  getBatchCertificateCount,
  getBatchChartData,
  getBatchEmailTemplates,
  getBatchFeedback,
  getBatchLiveClasses,
  getBatchStudentRows,
  getBatchSummary,
  getBatchTimetable,
  getCourseOptions,
  getInstructorOptions,
  getStudentCandidates,
  getTimetableRefOptions,
  serverNow,
} from "@/lib/data/batches";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/batches/breadcrumbs";
import { BatchStatusBadge } from "@/components/batches/batch-meta";
import { BatchHeaderActions } from "@/components/batches/admin/batch-header-actions";
import { StudentProgressTable } from "@/components/batches/admin/student-progress";
import { BatchSummaryChart } from "@/components/batches/admin/batch-summary-chart";
import { FeedbackSummaryCard } from "@/components/batches/batch-feedback";
import { StudentsPanel } from "@/components/batches/admin/students-panel";
import { AssessmentsPanel, CoursesPanel } from "@/components/batches/admin/curriculum-panels";
import { LiveClassesPanel } from "@/components/batches/admin/live-classes-panel";
import { AnnouncementsPanel } from "@/components/batches/admin/announcements-panel";
import { EmailTemplatesPanel } from "@/components/batches/admin/email-templates-panel";
import { TimetableBuilder } from "@/components/batches/admin/timetable-builder";
import { BatchSettingsForm } from "@/components/batches/admin/batch-form";
import { dayKeyInZone, formatClock12, formatClockRange, formatDateRange, formatDayKey } from "@/components/batches/tz";
import type { AdminBatchTab } from "@/components/batches/types";

export async function generateMetadata(props: PageProps<"/admin/batches/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const batch = await getBatchById(id);
  return { title: batch ? `${batch.title} · Manage` : "Manage batch" };
}

const TABS: { value: AdminBatchTab; label: string; icon: React.ReactNode }[] = [
  { value: "dashboard", label: "Dashboard", icon: <Icon.TrendingUp className="hidden size-4 sm:block" /> },
  { value: "students", label: "Students", icon: <Icon.Users className="hidden size-4 sm:block" /> },
  { value: "courses", label: "Courses", icon: <Icon.BookOpen className="hidden size-4 sm:block" /> },
  { value: "assessments", label: "Assessments", icon: <Icon.ClipboardList className="hidden size-4 sm:block" /> },
  { value: "classes", label: "Classes", icon: <Icon.Video className="hidden size-4 sm:block" /> },
  { value: "announcements", label: "Announcements", icon: <Icon.Megaphone className="hidden size-4 sm:block" /> },
  { value: "emails", label: "Emails", icon: <Icon.Mail className="hidden size-4 sm:block" /> },
  { value: "timetable", label: "Timetable", icon: <Icon.Calendar className="hidden size-4 sm:block" /> },
  { value: "settings", label: "Settings", icon: <Icon.Settings className="hidden size-4 sm:block" /> },
];

export default async function AdminBatchPage(props: PageProps<"/admin/batches/[id]">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(`/admin/batches/${id}`);
  const batch = await getBatchById(id);
  if (!batch) notFound();
  if (!canManageBatch(user, batch)) redirect("/forbidden");
  const db = await getDb();
  if (!db.settings.features.batches) notFound();

  const summary = await getBatchSummary(batch, user);
  const requested = typeof sp.tab === "string" ? sp.tab : "dashboard";
  const tab = (TABS.some((t) => t.value === requested) ? requested : "dashboard") as AdminBatchTab;
  const counts: Partial<Record<AdminBatchTab, number>> = {
    students: summary.studentCount,
    courses: batch.courseIds.length,
    assessments: batch.assessments.length,
    classes: db.liveClasses.filter((c) => c.batchId === batch.id).length,
    announcements: db.announcements.filter((a) => a.batchId === batch.id).length,
    emails: db.emailTemplates.filter((t) => t.batchId === batch.id).length,
    timetable: batch.timetable.length,
  };

  return (
    <div className="animate-fade-in pb-10">
      <Breadcrumbs items={[{ label: "Batches", href: "/admin/batches" }, { label: batch.title }]} />
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <BatchStatusBadge status={summary.status} />
            {batch.published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Unpublished</Badge>}
            {batch.paidBatch && batch.amount > 0 ? <Badge tone="outline">{formatPrice(batch.amount, batch.currency)}</Badge> : <Badge tone="outline">Free</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{batch.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDateRange(batch.startDate, batch.endDate)} · {formatClockRange(batch.startTime, batch.endTime)} · {batch.timezone.replace(/_/g, " ")}
          </p>
        </div>
        <BatchHeaderActions batchId={batch.id} slug={batch.slug} published={batch.published} certification={batch.certification} />
      </div>
      <Tabs items={TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon, count: counts[t.value] }))} />
      <div className="mt-6">
        <TabBody tab={tab} batch={batch} summary={summary} user={user} />
      </div>
    </div>
  );
}

async function TabBody({ tab, batch, summary, user }: { tab: AdminBatchTab; batch: Batch; summary: BatchSummary; user: User }) {
  const db = await getDb();
  const now = serverNow();
  const todayKey = dayKeyInZone(now, batch.timezone);

  switch (tab) {
    case "dashboard": {
      const [students, chart, feedback, certified, classes] = await Promise.all([
        getBatchStudentRows(batch),
        getBatchChartData(batch),
        getBatchFeedback(batch.id),
        getBatchCertificateCount(batch.id),
        getBatchLiveClasses(batch.id),
      ]);
      const averages = feedbackAverages(feedback);
      const avgProgress = students.length ? Math.round(students.reduce((a, s) => a + s.overallProgress, 0) / students.length) : 0;
      const completedCourses = students.reduce((a, s) => a + s.completedCourses, 0);
      const next = classes.find((c) => c.endsAt >= now);
      const courseTitles = batch.courseIds
        .map((cid) => db.courses.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, title: c.title }));
      return (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <StatCard label="Students" value={summary.studentCount} hint={certified ? `${certified} certified` : "Enrolled"} icon={<Icon.Users className="size-4" />} />
            <StatCard
              label="Seats"
              value={batch.seatCount > 0 ? `${summary.seatsLeft ?? 0} left` : "Unlimited"}
              hint={batch.seatCount > 0 ? `${summary.studentCount} of ${batch.seatCount} taken` : "No seat limit"}
              icon={<Icon.Ticket className="size-4" />}
            />
            <StatCard label="Avg progress" value={`${avgProgress}%`} hint="Courses and assessments" icon={<Icon.TrendingUp className="size-4" />} />
            <StatCard
              label="Completed courses"
              value={completedCourses}
              hint={`${batch.courseIds.length} course${batch.courseIds.length === 1 ? "" : "s"} × ${summary.studentCount} students`}
              icon={<Icon.CheckCircle className="size-4" />}
            />
            <StatCard
              label="Upcoming class"
              value={next ? <span className="line-clamp-1 text-lg">{next.title}</span> : <span className="text-lg text-ink-muted">None scheduled</span>}
              hint={next ? `${formatDayKey(next.date)} · ${formatClock12(next.time)}` : "Schedule one from Classes"}
              icon={<Icon.Video className="size-4" />}
            />
            <StatCard
              label="Feedback"
              value={averages.overall !== null ? `${averages.overall.toFixed(1)} / 5` : "—"}
              hint={averages.count ? `${averages.count} response${averages.count === 1 ? "" : "s"}` : "No feedback received yet."}
              icon={<Icon.Star className="size-4" />}
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="order-2 min-w-0 xl:order-1">
              <StudentProgressTable batchId={batch.id} students={students} courseTitles={courseTitles} />
            </div>
            <div className="order-1 space-y-6 xl:order-2">
              <BatchSummaryChart data={chart} studentCount={summary.studentCount} />
              <FeedbackSummaryCard averages={averages} feedback={feedback} />
            </div>
          </div>
        </div>
      );
    }
    case "students": {
      const [students, candidates] = await Promise.all([getBatchStudentRows(batch), getStudentCandidates(batch)]);
      return <StudentsPanel batchId={batch.id} students={students} candidates={candidates} seatCount={batch.seatCount} />;
    }
    case "courses": {
      const options = await getCourseOptions(batch, user);
      const studentIds = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
      const courses = batch.courseIds
        .map((cid) => db.courses.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          id: c.id,
          title: c.title,
          slug: c.slug,
          published: c.published,
          lessonCount: db.lessons.filter((l) => l.courseId === c.id).length,
          completedBy: db.enrollments.filter((e) => e.courseId === c.id && studentIds.has(e.userId) && (e.progress >= 100 || !!e.completedAt)).length,
        }));
      return <CoursesPanel batchId={batch.id} courses={courses} options={options} studentCount={summary.studentCount} />;
    }
    case "assessments": {
      const [options, chart] = await Promise.all([getAssessmentOptions(batch), getBatchChartData(batch)]);
      const rows = buildAssessmentRows(db, batch, null);
      const passes = new Map(chart.filter((c) => c.kind !== "course").map((c) => [`${c.kind}:${c.refId}`, c.value]));
      const assessments = rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        href: r.href,
        courseTitle: r.courseTitle,
        missing: r.missing,
        passedBy: passes.get(`${r.type}:${r.refId}`) ?? 0,
      }));
      return <AssessmentsPanel batchId={batch.id} assessments={assessments} options={options} studentCount={summary.studentCount} />;
    }
    case "classes": {
      const [classes, instructors] = await Promise.all([getBatchLiveClasses(batch.id), getInstructorOptions()]);
      const hosts = [...instructors.filter((o) => batch.instructorIds.includes(o.value)), ...instructors.filter((o) => !batch.instructorIds.includes(o.value))];
      const students = db.batchEnrollments
        .filter((e) => e.batchId === batch.id)
        .map((e) => db.users.find((u) => u.id === e.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }));
      return (
        <LiveClassesPanel
          batch={{
            id: batch.id,
            slug: batch.slug,
            timezone: batch.timezone,
            startDate: batch.startDate,
            endDate: batch.endDate,
            startTime: batch.startTime,
            conferencingProvider: batch.conferencingProvider,
            instructorIds: batch.instructorIds,
          }}
          classes={classes}
          hosts={hosts}
          students={students}
          currentUserId={user.id}
          serverNow={now}
          todayKey={todayKey}
        />
      );
    }
    case "announcements": {
      const announcements = await getBatchAnnouncements(batch.id);
      return <AnnouncementsPanel batchId={batch.id} announcements={announcements} studentCount={summary.studentCount} />;
    }
    case "emails": {
      const templates = await getBatchEmailTemplates(batch.id);
      const sample: Record<string, string> = {
        member_name: "Alex Johnson",
        member_email: "alex@example.com",
        batch_title: batch.title,
        batch_url: `/batches/${batch.slug}`,
        start_date: formatDayKey(batch.startDate, "long"),
        end_date: formatDayKey(batch.endDate, "long"),
        start_time: formatClock12(batch.startTime),
        end_time: formatClock12(batch.endTime),
        timezone: batch.timezone,
        medium: batch.medium === "online" ? "Online" : "Offline",
        instructors: summary.instructors.map((i) => i.name).join(", ") || "The instructors",
        site_name: db.settings.brand.name,
      };
      return <EmailTemplatesPanel batchId={batch.id} templates={templates} sample={sample} />;
    }
    case "timetable": {
      const [preview, refOptions] = await Promise.all([getBatchTimetable(batch, null), getTimetableRefOptions(batch)]);
      const lastDay = batch.evaluationEndDate && batch.evaluationEndDate > batch.endDate ? batch.evaluationEndDate : batch.endDate;
      return (
        <TimetableBuilder
          batchId={batch.id}
          items={preview.filter((e) => e.source === "timetable")}
          legends={batch.timetableLegends}
          refOptions={refOptions}
          previewEntries={preview}
          startDate={batch.startDate}
          endDate={batch.endDate}
          lastDay={lastDay}
          todayKey={todayKey}
          timezone={batch.timezone}
        />
      );
    }
    case "settings": {
      const instructors = await getInstructorOptions();
      const categories = [...db.categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }));
      return (
        <BatchSettingsForm
          batch={batch}
          categories={categories}
          instructors={instructors}
          studentCount={summary.studentCount}
          certificatesEnabled={db.settings.features.certifications}
        />
      );
    }
  }
}
