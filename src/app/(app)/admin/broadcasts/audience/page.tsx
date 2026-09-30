import { requireRole } from "@/lib/auth/session";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { decodeSegmentParam } from "@/lib/comms/segments";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BroadcastsNav } from "@/components/comms/broadcasts-nav";
import { SegmentBuilder } from "@/components/comms/segment-builder";

export const metadata = { title: "Broadcast audience" };

export default async function BroadcastAudiencePage(props: PageProps<"/admin/broadcasts/audience">) {
  await requireRole(["moderator"], "/admin/broadcasts/audience");
  const [courses, searchParams] = await Promise.all([segmentCourseOptions(), props.searchParams]);
  const raw = Array.isArray(searchParams.segment) ? searchParams.segment[0] : searchParams.segment;
  const initial = decodeSegmentParam(raw, new Set(courses.map((c) => c.id)));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Audience"
        description="Build a segment of members or leads and see exactly who it reaches before you send anything."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Audience" },
            ]}
          />
        }
      />
      <BroadcastsNav className="mb-6" />
      {courses.length === 0 && (
        <EmptyState
          compact
          className="mb-6"
          icon={<Icon.BookOpen />}
          title="No courses yet"
          description="Course conditions become available once you create a course. You can still reach members by role, activity and purchases, or reach your leads."
          action={
            <ButtonLink href="/admin/courses/new" variant="outline" leftIcon={<Icon.Plus className="size-4" />}>
              Create a course
            </ButtonLink>
          }
        />
      )}
      <SegmentBuilder courses={courses} defaultValue={initial} syncUrl exportHref="/admin/broadcasts/audience/export" composeHref="/admin/broadcasts/new" />
    </div>
  );
}
