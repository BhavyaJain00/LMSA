import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { isEditable } from "@/lib/comms/broadcast-core";
import { getBroadcast } from "@/lib/comms/broadcasts";
import { normalizeSegmentFilter, staleSegmentCourses } from "@/lib/comms/segments";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BroadcastComposer } from "@/components/comms/broadcast-composer";

export const metadata = { title: "Edit broadcast" };

export default async function EditBroadcastPage(props: PageProps<"/admin/broadcasts/[id]/edit">) {
  const { id } = await props.params;
  await requireRole(["moderator"], `/admin/broadcasts/${id}/edit`);
  const [broadcast, courses] = await Promise.all([getBroadcast(id), segmentCourseOptions()]);
  if (!broadcast) notFound();
  // Once sending has started the message is fixed; the report offers "Duplicate" instead.
  if (!isEditable(broadcast)) redirect(`/admin/broadcasts/${broadcast.id}`);
  const knownCourseIds = new Set(courses.map((c) => c.id));
  const stale = staleSegmentCourses(broadcast.segment, knownCourseIds);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit broadcast"
        description="Change the message or the audience. Nothing is sent until you send or schedule it on the review page."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: broadcast.subject, href: `/admin/broadcasts/${broadcast.id}` },
              { label: "Edit" },
            ]}
          />
        }
      />
      <BroadcastComposer
        courses={courses}
        broadcast={{
          id: broadcast.id,
          subject: broadcast.subject,
          preheader: broadcast.preheader ?? "",
          body: broadcast.body,
          // Courses deleted since the draft was saved drop out of the audience (and the composer says so).
          segment: normalizeSegmentFilter(broadcast.segment, knownCourseIds),
          scheduledAt: broadcast.status === "scheduled" ? broadcast.scheduledAt : undefined,
        }}
        segmentNotice={
          stale
            ? `${stale === 1 ? "A course" : `${stale} courses`} in this audience no longer ${stale === 1 ? "exists" : "exist"}, so ${stale === 1 ? "its condition was" : "their conditions were"} removed. Check who will receive this broadcast before saving.`
            : undefined
        }
      />
    </div>
  );
}
