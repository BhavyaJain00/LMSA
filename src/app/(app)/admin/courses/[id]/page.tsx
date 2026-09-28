import Link from "next/link";
import { getDb } from "@/lib/db/store";
import { getCourseById } from "@/lib/data/courses";
import { getWorkflowFlags, requireManageableCourse } from "@/lib/data/admin-courses";
import { PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { CourseWorkflow } from "@/components/admin/courses/course-workflow";
import { DetailsTab } from "./_tabs/details-tab";
import { OutlineTab } from "./_tabs/outline-tab";
import { SettingsTab } from "./_tabs/settings-tab";
import { DashboardTab } from "./_tabs/dashboard-tab";
import { AnnouncementsTab } from "./_tabs/announcements-tab";
import { ExportTab } from "./_tabs/export-tab";

const TABS = ["details", "outline", "settings", "dashboard", "announcements", "export"] as const;
type CourseTab = (typeof TABS)[number];

export async function generateMetadata(props: PageProps<"/admin/courses/[id]">) {
  const { id } = await props.params;
  const course = await getCourseById(id);
  return { title: course ? `${course.title} · Manage` : "Course not found" };
}

export default async function ManageCoursePage(props: PageProps<"/admin/courses/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab: CourseTab = TABS.includes(sp.tab as CourseTab) ? (sp.tab as CourseTab) : "details";
  const { user, course } = await requireManageableCourse(id, `/admin/courses/${id}${tab === "details" ? "" : `?tab=${tab}`}`);

  const db = await getDb();
  const flags = getWorkflowFlags(user, course);
  const lessonCount = db.lessons.filter((l) => l.courseId === course.id).length;
  const learnerCount = db.enrollments.filter((e) => e.courseId === course.id && e.memberType === "student").length;
  const announcementCount = db.announcements.filter((a) => a.courseId === course.id).length;

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-ink-muted">
            <Link href="/admin/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
            <Icon.ChevronRight className="size-3.5" />
            <span className="truncate text-ink">{course.title}</span>
          </nav>
        }
        title={course.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {course.published ? (
              <Badge tone="success" dot>
                Published
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Draft
              </Badge>
            )}
            <StatusBadge status={course.status} />
            {course.upcoming && <Badge tone="info">Upcoming</Badge>}
            {course.featured && <Badge tone="warning">Featured</Badge>}
            <span className="text-xs text-ink-faint">/courses/{course.slug}</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/courses/${course.slug}`} variant="outline" size="sm" leftIcon={<Icon.Eye className="size-4" />}>
              View course
            </ButtonLink>
            <CourseWorkflow courseId={course.id} status={course.status} published={course.published} publishedOn={course.publishedOn} flags={flags} lessonCount={lessonCount} variant="inline" />
          </>
        }
      />

      <Tabs
        className="mb-6"
        items={[
          { value: "details", label: "Details", icon: <Icon.Edit className="size-4" /> },
          { value: "outline", label: "Outline", icon: <Icon.Layers className="size-4" />, count: lessonCount },
          { value: "settings", label: "Settings", icon: <Icon.Settings className="size-4" /> },
          { value: "dashboard", label: "Dashboard", icon: <Icon.TrendingUp className="size-4" />, count: learnerCount },
          { value: "announcements", label: "Announcements", icon: <Icon.Megaphone className="size-4" />, count: announcementCount },
          { value: "export", label: "Export", icon: <Icon.Download className="size-4" /> },
        ]}
      />

      {tab === "details" && <DetailsTab course={course} user={user} />}
      {tab === "outline" && <OutlineTab course={course} />}
      {tab === "settings" && <SettingsTab course={course} user={user} />}
      {tab === "dashboard" && <DashboardTab course={course} />}
      {tab === "announcements" && <AnnouncementsTab course={course} />}
      {tab === "export" && <ExportTab course={course} />}
    </div>
  );
}
