import Link from "next/link";
import { cn, formatTime } from "@/lib/utils";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RetentionSparkline } from "./retention-sparkline";
import type { VideoAnalytics } from "./types";

/** Every video of the course with its headline numbers; a row links to its detail view. */
export function VideosOverview({ videos, selectedKey, baseHref }: { videos: VideoAnalytics[]; selectedKey: string | null; baseHref: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Video</TH>
          <TH className="text-right">Viewers</TH>
          <TH className="hidden text-right sm:table-cell">Completion</TH>
          <TH className="hidden text-right md:table-cell">Avg. watch time</TH>
          <TH className="hidden lg:table-cell">Retention</TH>
        </TR>
      </THead>
      <TBody>
        {videos.map((v) => {
          const selected = v.key === selectedKey;
          return (
            <TR key={v.key} className={cn(selected && "bg-accent/5")}>
              <TD className="max-w-0 w-full">
                <Link
                  href={`${baseHref}?video=${encodeURIComponent(v.key)}#video-detail`}
                  scroll={false}
                  aria-current={selected ? "true" : undefined}
                  className="group flex min-w-0 items-center gap-3"
                >
                  <span className={cn("w-9 shrink-0 font-mono text-xs tabular-nums", selected ? "text-accent" : "text-ink-faint")}>{v.position}</span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-medium group-hover:underline", selected ? "text-accent" : "text-ink")}>{v.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {v.duration > 0 ? formatTime(v.duration) : "Duration unknown"}
                      <span className="sm:hidden"> · {v.completionRate}% completed</span>
                    </span>
                  </span>
                </Link>
              </TD>
              <TD className="text-right tabular-nums">{v.viewers}</TD>
              <TD className="hidden text-right tabular-nums sm:table-cell">{v.viewers ? `${v.completionRate}%` : "—"}</TD>
              <TD className="hidden text-right tabular-nums md:table-cell">{v.viewers ? formatTime(v.avgWatchSeconds) : "—"}</TD>
              <TD className="hidden lg:table-cell">
                <RetentionSparkline retention={v.retention} className="h-7 w-28" />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
