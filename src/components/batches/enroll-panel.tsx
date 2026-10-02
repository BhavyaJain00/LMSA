import type { ReactNode } from "react";
import type { BatchSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { BatchCover, MetaRow, SeatBadge, batchPriceLabel } from "./batch-meta";
import { EnrollButton } from "./enroll-button";
import { LocalTimeRange } from "./local-time";
import { formatClockRange, formatDateRange, formatDayKey, formatTzLabel, zonedTimeToUtc } from "./tz";
import { getLocale, getT } from "@/i18n/server";

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
export async function EnrollPanel({ batch, loggedIn, isManager, enrolled, acceptsEnrollment, liveClassCount, assessmentCount, className }: EnrollPanelProps) {
  const startsAt = zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone);
  const [t, locale, paidPrice] = await Promise.all([getT("public"), getLocale(), batchPriceLabel(batch)]);
  const price = paidPrice ?? t("catalog.free");
  const full = batch.seatsLeft !== null && batch.seatsLeft <= 0;
  const paid = batch.paidBatch && batch.amount > 0;

  let cta: ReactNode;
  if (enrolled) {
    cta = (
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
          <Icon.CheckCircle className="size-4" /> {t("batches.panel.enrolled")}
        </div>
        <ButtonLink href={`/batches/${batch.slug}?tab=courses`} size="lg" className="w-full" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
          {t("batches.panel.goToCourses")}
        </ButtonLink>
      </div>
    );
  } else if (isManager) {
    cta = (
      <ButtonLink href={`/admin/batches/${batch.id}`} size="lg" className="w-full" leftIcon={<Icon.Settings className="size-4" />}>
        {t("batches.manageBatch")}
      </ButtonLink>
    );
  } else if (batch.status === "completed") {
    cta = <Disabled hint={t("batches.panel.endedHint")}>{t("batches.panel.ended")}</Disabled>;
  } else if (full) {
    cta = <Disabled hint={t("batches.panel.fullHint")}>{t("batches.panel.full")}</Disabled>;
  } else if (!acceptsEnrollment) {
    cta = <Disabled hint={t("batches.panel.closedHint")}>{t("batches.panel.closed")}</Disabled>;
  } else if (paid) {
    cta = (
      <ButtonLink href={`/billing/batch/${batch.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-5" />}>
        {t("batches.panel.register")}
      </ButtonLink>
    );
  } else if (batch.allowSelfEnrollment) {
    cta = loggedIn ? (
      <EnrollButton batchId={batch.id} />
    ) : (
      <ButtonLink href={`/login?next=${encodeURIComponent(`/batches/${batch.slug}`)}`} size="lg" className="w-full" leftIcon={<Icon.LogIn className="size-5" />}>
        {t("batches.panel.logInToEnroll")}
      </ButtonLink>
    );
  } else {
    cta = <Disabled hint={t("batches.panel.inviteHint")}>{t("batches.panel.invite")}</Disabled>;
  }

  return (
    <aside className={cn("overflow-hidden rounded-card border-2 border-border bg-surface-1 shadow-card", className)} aria-label={t("batches.panel.label")}>
      <BatchCover batch={batch} className="aspect-video w-full" priority />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("text-2xl font-semibold tracking-tight", paidPrice === null ? "text-success" : "text-ink")}>{price}</p>
          <SeatBadge seatsLeft={batch.seatsLeft} />
        </div>
        <div className="space-y-2.5">
          {batch.courseIds.length > 0 && <MetaRow icon={<Icon.BookOpen />}>{t("catalog.courseCount", { count: batch.courseIds.length })}</MetaRow>}
          <MetaRow icon={<Icon.Calendar />}>{formatDateRange(batch.startDate, batch.endDate, locale)}</MetaRow>
          <MetaRow icon={<Icon.Clock />}>
            <span className="block">{formatClockRange(batch.startTime, batch.endTime, locale)}</span>
            <LocalTimeRange date={batch.startDate} startTime={batch.startTime} endTime={batch.endTime} timezone={batch.timezone} compact className="mt-0.5" />
          </MetaRow>
          <MetaRow icon={<Icon.Globe />}>{Number.isNaN(startsAt) ? batch.timezone : formatTzLabel(batch.timezone, startsAt)}</MetaRow>
          <MetaRow icon={batch.medium === "online" ? <Icon.Monitor /> : <Icon.MapPin />}>{batch.medium === "online" ? t("batches.medium.online") : t("batches.medium.inPerson")}</MetaRow>
          {liveClassCount > 0 && <MetaRow icon={<Icon.Video />}>{t("batches.liveClassCount", { count: liveClassCount })}</MetaRow>}
          {assessmentCount > 0 && <MetaRow icon={<Icon.ClipboardList />}>{t("batches.assessmentCount", { count: assessmentCount })}</MetaRow>}
          {batch.certification && (
            <MetaRow icon={<Icon.Award />}>
              {t("batches.panel.certificate")}
              {batch.evaluationEndDate && <span className="block text-xs text-ink-faint">{t("batches.panel.evaluationsUntil", { date: formatDayKey(batch.evaluationEndDate, "short", locale) })}</span>}
            </MetaRow>
          )}
        </div>
        {cta}
      </div>
    </aside>
  );
}
