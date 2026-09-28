import type { Course } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { getCourseAnnouncements } from "@/lib/data/admin-courses";
import { Markdown } from "@/lib/markdown";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { AnnouncementComposer, DeleteAnnouncementButton } from "@/components/admin/courses/announcements";

export async function AnnouncementsTab({ course }: { course: Course }) {
  const [announcements, db] = await Promise.all([getCourseAnnouncements(course.id), getDb()]);
  const recipientCount = db.enrollments.filter((e) => e.courseId === course.id && e.memberType !== "staff").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <AnnouncementComposer key={announcements.length} courseId={course.id} recipientCount={recipientCount} />
      </div>
      <section aria-labelledby="past-announcements">
        <SectionTitle>
          <span id="past-announcements">Sent announcements</span>
        </SectionTitle>
        {announcements.length === 0 ? (
          <EmptyState compact icon={<Icon.Megaphone />} title="No announcements yet" description="Announcements you send appear here and on learners' notification feeds." />
        ) : (
          <ol className="space-y-4">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <Avatar name={a.author?.name ?? "Former member"} src={a.author?.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink">{a.subject}</h3>
                        <p className="text-xs text-ink-muted">
                          {a.author?.name ?? "Former member"} · <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>{relativeTime(a.createdAt)}</time>
                          {a.cc?.length ? <> · CC {a.cc.join(", ")}</> : null}
                        </p>
                      </div>
                      <DeleteAnnouncementButton id={a.id} subject={a.subject} />
                    </div>
                    <Markdown content={a.body} className="mt-3 text-sm" />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
