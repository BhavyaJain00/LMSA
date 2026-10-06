import Link from "next/link";
import type { AiUnavailableReason } from "@/lib/ai/types";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface AiSetupNoticeProps {
  /** What is missing. */
  reason: Extract<AiUnavailableReason, "site_disabled" | "no_key" | "course_disabled">;
  /** Admins get links to the site settings; instructors are told whom to ask. */
  isAdmin: boolean;
  /** Where the course's own switch lives, for "course_disabled". */
  courseSettingsHref?: string;
  compact?: boolean;
  className?: string;
}

const STEPS: Record<AiSetupNoticeProps["reason"], { title: string; admin: string; staff: string }> = {
  site_disabled: {
    title: "The AI tutor is turned off",
    admin: "Turn it on in Settings → AI tutor. Learners won't see it until it is on for the site and for the course.",
    staff: "An administrator needs to turn it on in the site settings before learners can use it.",
  },
  no_key: {
    title: "The AI tutor needs an API key",
    admin: "Add ANTHROPIC_API_KEY to the server environment and restart the app, then test the connection in Settings → AI tutor.",
    staff: "An administrator needs to add the Anthropic API key on the server before learners can use it.",
  },
  course_disabled: {
    title: "The AI tutor is off for this course",
    admin: "Switch on “AI tutor” in the course's Settings tab to let enrolled learners ask it questions.",
    staff: "Switch on “AI tutor” in the course's Settings tab to let enrolled learners ask it questions.",
  },
};

/** Setup instructions shown to staff where learners would see the AI tutor (learners never see this). */
export function AiSetupNotice({ reason, isAdmin, courseSettingsHref, compact, className }: AiSetupNoticeProps) {
  const copy = STEPS[reason];
  const href = reason === "course_disabled" ? courseSettingsHref : isAdmin ? "/admin/settings/ai" : undefined;
  const linkLabel = reason === "course_disabled" ? "Open course settings" : "Open AI tutor settings";
  return (
    <div role="note" className={cn("rounded-card border border-dashed border-border-strong bg-surface-1 text-left", compact ? "p-4" : "p-5", className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
          <Icon.Sparkles className="size-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{copy.title}</p>
          <p className="mt-1 text-sm text-ink-muted">{isAdmin ? copy.admin : copy.staff}</p>
          <p className="mt-1 text-xs text-ink-faint">Only course staff see this message.</p>
          {href && (
            <Link href={href} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {linkLabel} <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
