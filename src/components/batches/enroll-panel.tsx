import type { ReactNode } from "react";
import type { BatchSummary } from "@/lib/types";
import { cn, pluralize } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { BatchCover, MetaRow, SeatBadge, batchPriceLabel } from "./batch-meta";
import { EnrollButton } from "./enroll-button";
import { LocalTimeRange } from "./local-time";
import { formatClockRange, formatDateRange, formatDayKey, formatTzLabel, zonedTimeToUtc } from "./tz";

export interface EnrollPanelProps {
  batch: BatchSummary;
  loggedIn: boolean;
  isManager: boolean;
  enrolled: boolean;
  acceptsEnrollment: boolean;
  liveClassCount: number;
  assessmentCount: number;
  className?: string;
}

function Disabled({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" disabled>
        {children}
      </Button>
      {hint && <p className="text-center text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * The batch "overlay" card: cover, seats, price, dates, session time (with the
 * viewer's local time) and the enrollment call to action.
 */
export function EnrollPanel({ batch, loggedIn, isManager, enrolled, acceptsEnrollment, liveClassCount, assessmentCount, className }: EnrollPanelProps) {
  const startsAt = zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone);
  const price = batchPriceLabel(batch);
  const full = batch.seatsLeft !== null && batch.seatsLeft <= 0;
  const paid = batch.paidBatch && batch.amount > 0;

  let cta: ReactNode;
  if (enrolled) {
    cta = (
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
          <Icon.CheckCircle className="size-4" /> You are enrolled in this batch
        </div>
        <ButtonLink href={`/batches/${batch.slug}?tab=courses`} size="lg" className="w-full" rightIcon={<Icon.ArrowRight className="size-4" />}>
          Go to courses
        </ButtonLink>
      </div>
    );
  } else if (isManager) {
    cta = (
      <ButtonLink href={`/admin/batches/${batch.id}`} size="lg" className="w-full" leftIcon={<Icon.Settings className="size-4" />}>
        Manage batch
      </ButtonLink>
    );
  } else if (batch.status === "completed") {
    cta = <Disabled hint="Look out for the next cohort on the batches page.">This batch has ended</Disabled>;
  } else if (full) {
    cta = <Disabled hint="All seats have been taken.">Batch is full</Disabled>;
  } else if (!acceptsEnrollment) {
    cta = <Disabled hint="This batch has already started and is not accepting new learners.">Enrollment closed</Disabled>;
  } else if (paid) {
    cta = (
      <ButtonLink href={`/billing/batch/${batch.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-5" />}>
        Register Now
      </ButtonLink>
    );
  } else if (batch.allowSelfEnrollment) {
    cta = loggedIn ? (
      <EnrollButton batchId={batch.id} />
    ) : (
      <ButtonLink href={`/login?next=${encodeURIComponent(`/batches/${batch.slug}`)}`} size="lg" className="w-full" leftIcon={<Icon.LogIn className="size-5" />}>
        Log in to enroll
      </ButtonLink>
    );
  } else {
    cta = <Disabled hint="Enrollment is by invitation. Contact the instructors to join.">Invitation only</Disabled>;
  }

  return (
    <aside className={cn("overflow-hidden rounded-card border-2 border-border bg-surface-1 shadow-card", className)} aria-label="Batch details and enrollment">
      <BatchCover batch={batch} className="aspect-video w-full" priority />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("text-2xl font-semibold tracking-tight", price === "Free" ? "text-success" : "text-ink")}>{price}</p>
          <SeatBadge seatsLeft={batch.seatsLeft} />
        </div>
        <div className="space-y-2.5">
          {batch.courseIds.length > 0 && <MetaRow icon={<Icon.BookOpen />}>{pluralize(batch.courseIds.length, "Course")}</MetaRow>}
          <MetaRow icon={<Icon.Calendar />}>{formatDateRange(batch.startDate, batch.endDate)}</MetaRow>
          <MetaRow icon={<Icon.Clock />}>
            <span className="block">{formatClockRange(batch.startTime, batch.endTime)}</span>
            <LocalTimeRange date={batch.startDate} startTime={batch.startTime} endTime={batch.endTime} timezone={batch.timezone} compact className="mt-0.5" />
          </MetaRow>
          <MetaRow icon={<Icon.Globe />}>{Number.isNaN(startsAt) ? batch.timezone : formatTzLabel(batch.timezone, startsAt)}</MetaRow>
          <MetaRow icon={batch.medium === "online" ? <Icon.Monitor /> : <Icon.MapPin />}>{batch.medium === "online" ? "Online" : "In person"}</MetaRow>
          {liveClassCount > 0 && <MetaRow icon={<Icon.Video />}>{pluralize(liveClassCount, "live class", "live classes")}</MetaRow>}
          {assessmentCount > 0 && <MetaRow icon={<Icon.ClipboardList />}>{pluralize(assessmentCount, "assessment")}</MetaRow>}
          {batch.certification && (
            <MetaRow icon={<Icon.Award />}>
              Certificate on completion
              {batch.evaluationEndDate && <span className="block text-xs text-ink-faint">Evaluations until {formatDayKey(batch.evaluationEndDate)}</span>}
            </MetaRow>
          )}
        </div>
        {cta}
      </div>
    </aside>
  );
}
