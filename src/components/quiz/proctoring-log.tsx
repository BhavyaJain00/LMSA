import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import { violationLogLabels, type ViolationEvent } from "./types";

function Timeline({ events, violationCount }: { events: ViolationEvent[]; violationCount: number }) {
  if (!events.length) {
    return (
      <p className="text-sm text-ink-muted">
        {violationCount > 0 ? "No event details were recorded for this attempt." : "No proctoring events were recorded."}
      </p>
    );
  }
  return (
    <ol className="relative space-y-4 border-l border-border pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-surface-1",
              e.severity === "violation" ? "bg-danger" : "bg-warning",
            )}
          />
          <p className="text-sm font-medium text-ink">{violationLogLabels[e.eventType]}</p>
          <p className="text-xs text-ink-muted">
            <span className={cn("font-medium", e.severity === "violation" ? "text-danger" : "text-warning")}>
              {e.severity === "violation" ? "Violation" : "Warning"}
            </span>
            {" · "}
            <LocalTime iso={e.timestamp} format="time" className="tabular-nums" />
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Proctoring events of a submission. Always expanded on large screens,
 * collapsible (closed by default) on small ones.
 */
export function ProctoringLog({ events, violationCount }: { events: ViolationEvent[]; violationCount: number }) {
  if (violationCount <= 0 && !events.length) return null;
  const heading = (
    <>
      <Icon.ShieldCheck className="size-4 text-ink-muted" />
      <span className="flex-1">Proctoring Log</span>
      <span className="text-xs font-normal text-ink-muted">({events.length})</span>
    </>
  );
  return (
    <div className="rounded-card border border-border bg-surface-1 shadow-card">
      <details className="group lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          {heading}
          <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border px-4 py-4">
          <Timeline events={events} violationCount={violationCount} />
        </div>
      </details>
      <div className="hidden lg:block">
        <h3 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-ink">{heading}</h3>
        <div className="px-4 py-4">
          <Timeline events={events} violationCount={violationCount} />
        </div>
      </div>
    </div>
  );
}
