"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTime, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import type { VideoLearnerRow } from "./types";

type SortKey = "watched" | "time" | "recent" | "name";
type StatusFilter = "all" | "completed" | "in_progress";

const PAGE = 25;

/** Per-learner breakdown for one video: search, filter, sort and paging on the client. */
export function LearnersTable({ rows, duration }: { rows: VideoLearnerRow[]; duration: number }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("watched");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (status === "completed" && !r.completed) return false;
      if (status === "in_progress" && r.completed) return false;
      if (!q) return true;
      return r.user.name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q) || r.user.username.toLowerCase().includes(q);
    });
    const sorted = [...list];
    switch (sort) {
      case "time":
        sorted.sort((a, b) => b.watchSeconds - a.watchSeconds);
        break;
      case "recent":
        sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        break;
      case "name":
        sorted.sort((a, b) => a.user.name.localeCompare(b.user.name));
        break;
      default:
        sorted.sort((a, b) => b.percentWatched - a.percentWatched || b.watchSeconds - a.watchSeconds);
    }
    return sorted;
  }, [rows, query, sort, status]);

  const shown = filtered.slice(0, limit);
  const anyEstimated = rows.some((r) => r.estimated);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-64">
          <Input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search learners"
            aria-label="Search learners"
            leftAddon={<Icon.Search className="size-4" />}
          />
        </div>
        <div className="flex gap-2">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setLimit(PAGE);
            }}
            options={[
              { value: "all", label: "All learners" },
              { value: "completed", label: "Completed" },
              { value: "in_progress", label: "Not finished" },
            ]}
          />
          <Select
            aria-label="Sort learners"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            options={[
              { value: "watched", label: "Most watched" },
              { value: "time", label: "Watch time" },
              { value: "recent", label: "Recently active" },
              { value: "name", label: "Name" },
            ]}
          />
        </div>
        <p className="text-xs text-ink-muted sm:ml-auto">
          {filtered.length} of {rows.length} {rows.length === 1 ? "learner" : "learners"}
        </p>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Learner</TH>
            <TH className="w-40">Watched</TH>
            <TH className="hidden sm:table-cell">Watch time</TH>
            <TH className="hidden md:table-cell">Last position</TH>
            <TH className="hidden lg:table-cell">Last watched</TH>
          </TR>
        </THead>
        <TBody>
          {shown.length === 0 ? (
            <TableEmpty colSpan={5}>{rows.length === 0 ? "Nobody has watched this video yet." : "No learners match your filters."}</TableEmpty>
          ) : (
            shown.map((row) => (
              <TR key={row.user.id}>
                <TD>
                  <Link href={`/user/${row.user.username}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                    <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{row.user.name}</span>
                      <span className="block truncate text-xs text-ink-muted">{row.user.email}</span>
                    </span>
                  </Link>
                </TD>
                <TD>
                  <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                    <span className="font-medium tabular-nums text-ink">
                      {row.percentWatched}%{row.estimated && <span className="text-ink-faint">*</span>}
                    </span>
                    {row.completed ? (
                      <Badge tone="success" size="xs">
                        Completed
                      </Badge>
                    ) : row.replayFactor >= 1.5 ? (
                      <span className="tabular-nums" title="Average views of the parts watched">
                        {row.replayFactor.toFixed(1)}× views
                      </span>
                    ) : null}
                  </div>
                  <ProgressBar value={row.percentWatched} size="xs" tone={row.completed ? "success" : "accent"} className="mt-1" label={`${row.user.name}: ${row.percentWatched}% watched`} />
                </TD>
                <TD className="hidden tabular-nums sm:table-cell">{formatTime(row.watchSeconds)}</TD>
                <TD className="hidden tabular-nums md:table-cell">
                  {formatTime(row.lastPositionSeconds)}
                  {duration > 0 && <span className="text-ink-faint"> / {formatTime(duration)}</span>}
                </TD>
                <TD className="hidden text-ink-muted lg:table-cell">{relativeTime(row.updatedAt)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {anyEstimated ? (
          <p className="text-xs text-ink-faint">* Watched before detailed tracking was available; estimated from the furthest point reached.</p>
        ) : (
          <span />
        )}
        {filtered.length > shown.length && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-sm font-medium text-accent hover:underline">
            Show {Math.min(PAGE, filtered.length - shown.length)} more
          </button>
        )}
      </div>
    </div>
  );
}
