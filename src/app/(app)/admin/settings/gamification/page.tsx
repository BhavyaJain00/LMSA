import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { listUsers } from "@/lib/data/users";
import { ensurePointsLedger, getLedgerStats, getLedgerStatus, getRecentManualAdjustments } from "@/lib/services/points";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { GamificationSettingsForm } from "@/components/admin/settings/gamification-settings-form";
import { ManualAdjustments } from "@/components/gamification/admin/manual-adjustments";
import { RecalculatePoints } from "@/components/gamification/admin/recalculate-points";
import { formatPoints, formatSignedPoints } from "@/components/gamification/levels";
import { LevelTiersCard } from "@/components/gamification/how-points-work";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.gamification.metaTitle") };
}

export default async function GamificationSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/gamification");
  // Opening the settings on a fresh ledger fills it from history, so the numbers below are real.
  await ensurePointsLedger();
  const [settings, stats, recent, users, status] = await Promise.all([getSettings(), getLedgerStats(), getRecentManualAdjustments(15), listUsers(), getLedgerStatus()]);
  const f = await getFormatter();
  const g = settings.gamification;
  const members = users.filter((u) => u.enabled).map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }));
  const topReasons = [...stats.byReason].sort((a, b) => b.points - a.points).slice(0, 4);

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.gamification.title")}
        description={t("pages.settings.gamification.description")}
        actions={
          g.enabled && g.showLeaderboard ? (
            <ButtonLink href="/leaderboard" variant="outline" size="sm" leftIcon={<Icon.Trophy className="size-4" />}>
              {t("pages.settings.gamification.viewLeaderboard")}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {g.enabled && !status.built && (
          <div role="alert" className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">{t("pages.settings.gamification.backfill.title")}</p>
              <p className="mt-0.5 text-ink-muted">
                {status.error
                  ? status.failedAt
                    ? t("pages.settings.gamification.backfill.failedAt", { time: f.dateTime(status.failedAt), error: status.error })
                    : t("pages.settings.gamification.backfill.failed", { error: status.error })
                  : t("pages.settings.gamification.backfill.running")}
              </p>
            </div>
          </div>
        )}
        <SettingsSection
          title={t("pages.settings.gamification.ledger.title")}
          description={stats.lastEntryAt ? t("pages.settings.gamification.ledger.last", { when: f.relative(stats.lastEntryAt) }) : t("pages.settings.gamification.ledger.none")}
        >
          <div className="px-4 py-4 sm:px-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { key: "total", label: t("pages.settings.gamification.ledger.total"), value: formatPoints(stats.totalPoints) },
                { key: "month", label: t("pages.settings.gamification.ledger.month"), value: formatPoints(stats.pointsThisMonth) },
                { key: "members", label: t("pages.settings.gamification.ledger.members"), value: formatPoints(stats.members) },
                { key: "entries", label: t("pages.settings.gamification.ledger.entries"), value: formatPoints(stats.entries), hint: stats.manualAdjustments ? t("pages.settings.gamification.ledger.manual", { count: formatPoints(stats.manualAdjustments) }) : undefined },
              ].map((s) => (
                <div key={s.key} className="rounded-lg bg-surface-2 p-3">
                  <dt className="text-xs text-ink-muted">{s.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{s.value}</dd>
                  {s.hint && <dd className="text-[11px] text-ink-faint">{s.hint}</dd>}
                </div>
              ))}
            </dl>
            {topReasons.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("pages.settings.gamification.ledger.sources")}</p>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {topReasons.map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink-muted">
                        {t(`pointsReasons.${r.reason}.label`)} <span className="text-ink-faint">×{formatPoints(r.count)}</span>
                      </span>
                      <span className="font-medium tabular-nums text-ink">{formatSignedPoints(r.points)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SettingsSection>

        <GamificationSettingsForm initial={g} guestAccess={settings.learning.allowGuestAccess} />

        <RecalculatePoints enabled={g.enabled} />

        <ManualAdjustments members={members} recent={recent} enabled={g.enabled} />

        <LevelTiersCard />
      </div>
    </>
  );
}
