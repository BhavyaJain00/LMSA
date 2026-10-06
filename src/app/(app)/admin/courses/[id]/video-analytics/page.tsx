import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse, getCourseById } from "@/lib/data/courses";
import { requireManageableCourse } from "@/lib/data/admin-courses";
import { getCourseVideoAnalytics } from "@/lib/media/analytics";
import { formatDuration, formatNumber } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { VideosOverview } from "@/components/admin/video-analytics/videos-overview";
import { VideoDetail } from "@/components/admin/video-analytics/video-detail";

export async function generateMetadata(props: PageProps<"/admin/courses/[id]/video-analytics">) {
  const { id } = await props.params;
  const [course, user] = await Promise.all([getCourseById(id), getCurrentUser()]);
  if (!course || !canManageCourse(user, course)) return { title: "Video analytics" };
  return { title: `Video analytics · ${course.title}`, robots: { index: false } };
}

/**
 * Per-video analytics for course managers: viewers, completion, watch time,
 * audience retention (from the player's watched ranges), drop-off and
 * rewatch hotspots, and a learner breakdown.
 */
export default async function VideoAnalyticsPage(props: PageProps<"/admin/courses/[id]/video-analytics">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { course } = await requireManageableCourse(id, `/admin/courses/${id}/video-analytics`);
  const analytics = await getCourseVideoAnalytics(course.id);
  if (!analytics) notFound();

  const baseHref = `/admin/courses/${course.id}/video-analytics`;
  const requested = typeof sp.video === "string" ? sp.video : null;
  const selected =
    analytics.videos.find((v) => v.key === requested) ??
    // Default: the most watched video, else the first one.
    [...analytics.videos].sort((a, b) => b.viewers - a.viewers)[0] ??
    null;
  const { totals } = analytics;

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <Link href="/admin/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
            <Icon.ChevronRight className="size-3.5 rtl:rotate-180" />
            <Link href={`/admin/courses/${course.id}?tab=dashboard`} className="max-w-60 truncate hover:text-ink hover:underline">
              {course.title}
            </Link>
            <Icon.ChevronRight className="size-3.5 rtl:rotate-180" />
            <span className="text-ink" aria-current="page">
              Video analytics
            </span>
          </nav>
        }
        title="Video analytics"
        description="See how far learners get in each video, where they drop off and which parts they replay."
        actions={
          <ButtonLink href={`/admin/courses/${course.id}?tab=dashboard`} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
            Course dashboard
          </ButtonLink>
        }
      />

      {analytics.videos.length === 0 ? (
        <EmptyState
          icon={<Icon.Video />}
          title="This course has no videos yet"
          description="Add a video block to a lesson and its viewing statistics will appear here once learners start watching."
          action={
            <ButtonLink href={`/admin/courses/${course.id}?tab=outline`} size="sm" leftIcon={<Icon.Layers className="size-4" />}>
              Open the outline
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Videos" value={formatNumber(totals.videos)} icon={<Icon.Video className="size-4" />} />
            <StatCard label="Learners watching" value={formatNumber(totals.viewers)} icon={<Icon.Users className="size-4" />} />
            <StatCard label="Total watch time" value={formatDuration(totals.watchSeconds)} icon={<Icon.Clock className="size-4" />} />
            <StatCard label="Views completed" value={`${totals.completionRate}%`} icon={<Icon.CheckCircle className="size-4" />} />
          </div>

          <section aria-labelledby="videos-heading">
            <h2 id="videos-heading" className="mb-3 text-lg font-semibold tracking-tight text-ink">
              All videos
            </h2>
            <VideosOverview videos={analytics.videos} selectedKey={selected?.key ?? null} baseHref={baseHref} />
          </section>

          {selected && <VideoDetail key={selected.key} video={selected} />}
        </div>
      )}
    </div>
  );
}
