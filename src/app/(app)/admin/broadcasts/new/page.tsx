import { requireRole } from "@/lib/auth/session";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { decodeSegmentParam } from "@/lib/comms/segments";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BroadcastComposer } from "@/components/comms/broadcast-composer";

export const metadata = { title: "New broadcast" };

export default async function NewBroadcastPage(props: PageProps<"/admin/broadcasts/new">) {
  await requireRole(["moderator"], "/admin/broadcasts/new");
  const [courses, searchParams] = await Promise.all([segmentCourseOptions(), props.searchParams]);
  // "Write a broadcast" on the audience page hands its segment over in `?segment=`.
  const raw = Array.isArray(searchParams.segment) ? searchParams.segment[0] : searchParams.segment;
  const initialSegment = decodeSegmentParam(raw, new Set(courses.map((c) => c.id)));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="New broadcast"
        description="Write the email and choose who receives it. You review it, send yourself a test and pick the send time on the next page."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "New broadcast" },
            ]}
          />
        }
      />
      <BroadcastComposer courses={courses} initialSegment={initialSegment} />
    </div>
  );
}
