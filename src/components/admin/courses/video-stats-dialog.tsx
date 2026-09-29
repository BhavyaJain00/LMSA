"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatTime, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { RetentionChart } from "@/components/admin/video-analytics/retention-chart";
import { Hotspots } from "@/components/admin/video-analytics/hotspots";
import type { VideoAnalytics } from "@/components/admin/video-analytics/types";
import type { VideoStat } from "./types";

type RetentionState =
  | { status: "idle" | "loading" }
  | { status: "ready"; videos: VideoAnalytics[]; analyticsHref: string }
  | { status: "error"; message: string };

interface RetentionResponse {
  ok: boolean;
  error?: string;
  analyticsHref?: string;
  videos?: VideoAnalytics[];
}

/**
 * Per-video watch statistics for a lesson (who watched, how much,
 * completion) plus the audience retention curve and hotspots, loaded on
 * demand from /api/video-progress/retention. Links to the course's full
 * video analytics page.
 */
export function VideoStatsDialog({ open, onClose, stats }: { open: boolean; onClose: () => void; stats: VideoStat[] }) {
  const params = useParams<{ id?: string; lessonId?: string }>();
  const lessonId = typeof params?.lessonId === "string" ? params.lessonId : null;
  const courseId = typeof params?.id === "string" ? params.id : null;
  const [active, setActive] = useState(stats[0]?.blockId ?? "");
  const [retention, setRetention] = useState<RetentionState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const stat = stats.find((s) => s.blockId === active) ?? stats[0];

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!lessonId) return;
      setRetention({ status: "loading" });
      try {
        const res = await fetch(`/api/video-progress/retention?lesson=${encodeURIComponent(lessonId)}`, { cache: "no-store", signal });
        const body = (await res.json().catch(() => null)) as RetentionResponse | null;
        if (!res.ok || !body?.ok || !body.videos) {
          setRetention({ status: "error", message: body?.error ?? "Retention data could not be loaded." });
          return;
        }
        setRetention({ status: "ready", videos: body.videos, analyticsHref: body.analyticsHref ?? (courseId ? `/admin/courses/${courseId}/video-analytics` : "#") });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setRetention({ status: "error", message: "Check your connection and try again." });
      }
    },
    [lessonId, courseId],
  );

  useEffect(() => {
    if (!open || !lessonId || !stats.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, lessonId, stats.length, load, attempt]);

  const detail = retention.status === "ready" ? retention.videos.find((v) => v.blockId === stat?.blockId) : undefined;
  const analyticsHref =
    retention.status === "ready" ? retention.analyticsHref : courseId ? `/admin/courses/${courseId}/video-analytics` : null;
  const detailHref = analyticsHref && lessonId && stat ? `${analyticsHref}?video=${encodeURIComponent(`${lessonId}:${stat.blockId}`)}` : analyticsHref;

  return (
    <Dialog open={open} onClose={onClose} title="Video Statistics" size="xl">
      {!stat ? (
        <p className="text-sm text-ink-muted">This lesson has no videos.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {stats.length > 1 ? (
              <div className="no-scrollbar max-w-full overflow-x-auto" aria-label="Select video">
                <SegmentedControl value={stat.blockId} onChange={setActive} options={stats.map((s, i) => ({ value: s.blockId, label: `Video ${i + 1}` }))} />
              </div>
            ) : (
              <span />
            )}
            {detailHref && (
              <Link href={detailHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                Full video analytics <Icon.ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-ink-muted">Viewers</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{stat.rows.length}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-ink-muted">Average watch time</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatTime(stat.averageWatchSeconds)}</p>
              {stat.duration > 0 && <p className="text-xs text-ink-faint">of {formatTime(stat.duration)}</p>}
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-ink-muted">Watched to the end</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{stat.completionRate}%</p>
            </div>
          </div>
          <p className="truncate text-sm font-medium text-ink" title={stat.src}>
            {stat.title}
          </p>

          {stat.rows.length > 0 && lessonId && (
            <section aria-label="Audience retention" className="rounded-xl border border-border p-4">
              {retention.status === "error" ? (
                <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
                  <Icon.AlertTriangle className="size-6 text-warning" />
                  <p className="text-sm text-ink-muted">{retention.message}</p>
                  <Button size="sm" variant="outline" onClick={() => setAttempt((a) => a + 1)} leftIcon={<Icon.Refresh className="size-4" />}>
                    Try again
                  </Button>
                </div>
              ) : retention.status === "ready" && detail ? (
                <div className="space-y-4">
                  <RetentionChart retention={detail.retention} passes={detail.passes} duration={detail.duration || stat.duration} dropOffs={detail.dropOffs} height={180} />
                  {detail.estimated && (
                    <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                      <Icon.Info className="mt-px size-3.5 shrink-0 text-info" />
                      Part of this curve is estimated from views recorded before detailed tracking was available.
                    </p>
                  )}
                  <Hotspots dropOffs={detail.dropOffs} rewatches={detail.rewatches} duration={detail.duration || stat.duration} viewers={detail.viewers} />
                </div>
              ) : retention.status === "ready" ? (
                <p className="py-4 text-center text-sm text-ink-muted">Retention data for this video is not available yet.</p>
              ) : (
                <div aria-busy="true" aria-live="polite">
                  <span className="sr-only">Loading retention…</span>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-3 h-44 w-full rounded-lg" />
                </div>
              )}
            </section>
          )}

          {stat.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-ink-muted">No statistics available for this video.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[1fr_6rem] gap-3 bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted sm:grid-cols-[1fr_8rem_9rem]">
                <span>Member</span>
                <span className="text-right sm:text-left">Watch time</span>
                <span className="hidden sm:block">{detail ? "Watched" : "Furthest point"}</span>
              </div>
              <ul className="scrollbar-thin max-h-[50vh] divide-y divide-border overflow-y-auto">
                {stat.rows.map((row) => {
                  const learner = detail?.learners.find((l) => l.user.id === row.user.id);
                  const pct = learner ? learner.percentWatched : row.durationSeconds ? Math.min(100, (row.maxPositionSeconds / row.durationSeconds) * 100) : 0;
                  return (
                    <li key={row.user.id} className="grid grid-cols-[1fr_6rem] items-center gap-3 px-4 py-2.5 sm:grid-cols-[1fr_8rem_9rem]">
                      <Link href={`/user/${row.user.username}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                        <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{row.user.name}</span>
                          <span className="block truncate text-xs text-ink-muted">{row.user.email}</span>
                        </span>
                      </Link>
                      <span className="text-right text-sm tabular-nums text-ink sm:text-left">
                        {formatTime(row.watchSeconds)}
                        <span className="block text-xs text-ink-faint">{relativeTime(row.updatedAt)}</span>
                      </span>
                      <span className="hidden sm:block">
                        <span className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                          {learner ? `${learner.percentWatched}% · at ${formatTime(learner.lastPositionSeconds)}` : formatTime(row.maxPositionSeconds)}
                          {row.completed && (
                            <Badge tone="success" size="xs">
                              Completed
                            </Badge>
                          )}
                        </span>
                        <ProgressBar value={pct} size="xs" tone={row.completed ? "success" : "accent"} label={`${row.user.name} ${learner ? "share watched" : "furthest point"}`} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
