import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RANGE_PRESETS, type DateRange } from "@/lib/growth/analytics-shared";
import { cn } from "@/lib/utils";

const PRESET_LABELS: Record<(typeof RANGE_PRESETS)[number], string> = { 7: "7 days", 30: "30 days", 90: "90 days", 365: "12 months" };

/**
 * Period picker of `/admin/analytics`: preset links plus a custom from/to
 * form (plain GET, works without JavaScript). Days are UTC.
 */
export function AnalyticsRangePicker({ range, basePath }: { range: DateRange; basePath: string }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <nav aria-label="Period" className="no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-0.5">
        {RANGE_PRESETS.map((days) => {
          const active = range.preset === days;
          return (
            <Link
              key={days}
              href={days === 30 ? basePath : `${basePath}?range=${days}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-1 hover:text-ink",
              )}
            >
              {PRESET_LABELS[days]}
            </Link>
          );
        })}
      </nav>
      <form method="get" action={basePath} aria-label="Custom period" className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <label htmlFor="range-from" className="sr-only">
          From
        </label>
        <Input id="range-from" name="from" type="date" defaultValue={range.from} required className="min-w-0" />
        <label htmlFor="range-to" className="sr-only">
          To
        </label>
        <Input id="range-to" name="to" type="date" defaultValue={range.to} required className="min-w-0" />
        <button type="submit" className={buttonClasses({ variant: range.preset ? "outline" : "primary", size: "sm" })}>
          Apply
        </button>
      </form>
    </div>
  );
}
