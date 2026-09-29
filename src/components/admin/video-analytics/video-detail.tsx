import Link from "next/link";
import { formatTime } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { RetentionChart } from "./retention-chart";
import { Hotspots } from "./hotspots";
import { LearnersTable } from "./learners-table";
import type { VideoAnalytics } from "./types";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Full analytics for one video: headline numbers, retention curve, hotspots and learners. */
export function VideoDetail({ video }: { video: VideoAnalytics }) {
  return (
    <Card id="video-detail" className="scroll-mt-24">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Lesson {video.position} · {video.chapterTitle}
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-ink">{video.title}</h2>
          {video.title !== video.lessonTitle && <p className="truncate text-sm text-ink-muted">{video.lessonTitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={video.learnHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2">
            <Icon.Eye className="size-4" /> View lesson
          </Link>
          <Link href={video.editorHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2">
            <Icon.Edit className="size-4" /> Edit lesson
          </Link>
        </div>
      </div>

      <div className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Viewers" value={String(video.viewers)} />
          <Metric label="Completion rate" value={`${video.completionRate}%`} hint={`${video.completed} of ${video.viewers} finished`} />
          <Metric label="Average watch time" value={formatTime(video.avgWatchSeconds)} hint={video.duration > 0 ? `of ${formatTime(video.duration)}` : undefined} />
          <Metric label="Average watched" value={`${video.avgPercentWatched}%`} hint="of the video, per viewer" />
        </div>

        {video.viewers === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-10 text-center text-sm text-ink-muted">
            Nobody has watched this video yet. Retention, hotspots and learner progress appear here as soon as learners start watching.
          </p>
        ) : (
          <>
            <div>
              <RetentionChart retention={video.retention} passes={video.passes} duration={video.duration} dropOffs={video.dropOffs} height={240} />
              {video.estimated && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                  <Icon.Info className="mt-px size-3.5 shrink-0 text-info" />
                  Some learners watched before detailed tracking was available; their part of the curve is estimated from the furthest point they reached.
                </p>
              )}
            </div>
            <Hotspots dropOffs={video.dropOffs} rewatches={video.rewatches} duration={video.duration} viewers={video.viewers} />
            <section aria-labelledby={`learners-${video.key}`}>
              <h3 id={`learners-${video.key}`} className="mb-3 text-sm font-semibold text-ink">
                Learners
              </h3>
              <LearnersTable rows={video.learners} duration={video.duration} />
            </section>
          </>
        )}
      </div>
    </Card>
  );
}
