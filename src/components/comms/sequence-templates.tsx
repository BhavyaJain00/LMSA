import Link from "next/link";
import { SEQUENCE_TEMPLATES, TRIGGER_OPTIONS } from "@/lib/comms/sequence-core";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Starter sequences: each card opens the editor pre-filled with the template's trigger, goal and emails. */
export function SequenceTemplates({ current, className }: { current?: string; className?: string }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {SEQUENCE_TEMPLATES.map((template) => {
        const active = template.key === current;
        const trigger = TRIGGER_OPTIONS.find((t) => t.value === template.draft.trigger);
        return (
          <li key={template.key}>
            <Link
              href={`/admin/sequences/new?template=${template.key}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-full flex-col rounded-card border bg-surface-1 p-4 transition-colors hover:border-border-strong hover:bg-surface-2",
                active ? "border-accent ring-1 ring-accent" : "border-border",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon.Zap className="size-4 shrink-0 text-accent" />
                {template.title}
              </span>
              <span className="mt-1 flex-1 text-xs text-ink-muted">{template.summary}</span>
              <span className="mt-3 text-xs text-ink-faint">
                {trigger?.label} · {template.draft.steps.length} emails
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
