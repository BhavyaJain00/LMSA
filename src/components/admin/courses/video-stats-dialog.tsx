"use client";

import Link from "next/link";
import { useState } from "react";
import { formatTime, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/tabs";
import type { VideoStat } from "./types";

/** Per-video watch statistics for a lesson (who watched, how much, completion). */
export function VideoStatsDialog({ open, onClose, stats }: { open: boolean; onClose: () => void; stats: VideoStat[] }) {
  const [active, setActive] = useState(stats[0]?.blockId ?? "");
  const stat = stats.find((s) => s.blockId === active) ?? stats[0];

  return (
    <Dialog open={open} onClose={onClose} title="Video Statistics" size="xl">
      {!stat ? (
        <p className="text-sm text-ink-muted">This lesson has no videos.</p>
      ) : (
        <div className="space-y-4">
          {stats.length > 1 && (
            <div className="no-scrollbar overflow-x-auto" aria-label="Select video">
              <SegmentedControl
                value={stat.blockId}
                onChange={setActive}
                options={stats.map((s, i) => ({ value: s.blockId, label: `Video ${i + 1}` }))}
              />
            </div>
          )}
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
          {stat.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-ink-muted">No statistics available for this video.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[1fr_6rem] gap-3 bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted sm:grid-cols-[1fr_8rem_9rem]">
                <span>Member</span>
                <span className="text-right sm:text-left">Watch time</span>
                <span className="hidden sm:block">Furthest point</span>
              </div>
              <ul className="scrollbar-thin max-h-[50vh] divide-y divide-border overflow-y-auto">
                {stat.rows.map((row) => {
                  const pct = row.durationSeconds ? Math.min(100, (row.maxPositionSeconds / row.durationSeconds) * 100) : 0;
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
                          {formatTime(row.maxPositionSeconds)}
                          {row.completed && (
                            <Badge tone="success" size="xs">
                              Completed
                            </Badge>
                          )}
                        </span>
                        <ProgressBar value={pct} size="xs" tone={row.completed ? "success" : "accent"} label={`${row.user.name} furthest point`} />
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
