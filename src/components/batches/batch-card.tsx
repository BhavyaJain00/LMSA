import Link from "next/link";
import type { BatchSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { BatchCover, BatchStatusBadge, InstructorNames, MetaRow, SeatBadge, batchPriceLabel } from "./batch-meta";
import { LocalTimeRange } from "./local-time";
import { formatClockRange, formatDateRange, formatGmtOffset, zonedTimeToUtc } from "./tz";

/**
 * Batch card for lists: cover (image or gradient), status, title, short
 * description, date range, session time with timezone (+ the viewer's local
 * time), medium, seats left / Full, price and instructors.
 */
export function BatchCard({ batch, className }: { batch: BatchSummary; className?: string }) {
  const startsAt = zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone);
  const offset = Number.isNaN(startsAt) ? "" : formatGmtOffset(batch.timezone, startsAt);
  const price = batchPriceLabel(batch);

  return (
    <Link
      href={`/batches/${batch.slug}`}
      className={cn(
        "group flex min-h-full flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-colors hover:border-border-strong focus-visible:border-accent",
        className,
      )}
    >
      <BatchCover batch={batch} className="aspect-[16/7] w-full">
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <BatchStatusBadge status={batch.status} className="bg-surface-1/90 backdrop-blur" />
            {!batch.published && (
              <Badge tone="warning" className="bg-surface-1/90 backdrop-blur">
                Unpublished
              </Badge>
            )}
          </div>
          {batch.enrolled && (
            <Badge tone="dark" className="shrink-0">
              <Icon.Check className="size-3" /> Enrolled
            </Badge>
          )}
        </div>
      </BatchCover>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-ink group-hover:text-accent">{batch.title}</h3>
          <SeatBadge seatsLeft={batch.seatsLeft} className="mt-0.5 shrink-0" />
        </div>
        {batch.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-muted">{batch.description}</p>}

        <div className="mt-4 space-y-1.5">
          <MetaRow icon={<Icon.Calendar />}>{formatDateRange(batch.startDate, batch.endDate)}</MetaRow>
          <MetaRow icon={<Icon.Clock />}>
            <span>{formatClockRange(batch.startTime, batch.endTime)}</span>
            <span className="text-ink-faint">
              {" "}
              · {batch.timezone.replace(/_/g, " ")}
              {offset && ` (${offset})`}
            </span>
            <LocalTimeRange
              date={batch.startDate}
              startTime={batch.startTime}
              endTime={batch.endTime}
              timezone={batch.timezone}
              compact
              className="mt-0.5 flex"
            />
          </MetaRow>
          <MetaRow icon={batch.medium === "online" ? <Icon.Monitor /> : <Icon.MapPin />}>
            {batch.medium === "online" ? "Online" : "In person"}
            {batch.category && <span className="text-ink-faint"> · {batch.category.name}</span>}
            {batch.certification && <span className="text-ink-faint"> · Certificate</span>}
          </MetaRow>
        </div>

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <InstructorNames users={batch.instructors} />
            <span className={cn("shrink-0 text-sm font-semibold", price === "Free" ? "text-success" : "text-ink")}>{price}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
