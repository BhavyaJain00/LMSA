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
import { REASON_META } from "@/components/gamification/reasons";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Points & leaderboard settings" };

export default async function GamificationSettingsPage() {
  await requireRole(["admin"], "/admin/settings/gamification");
  // Opening the settings on a fresh ledger fills it from history, so the numbers below are real.
  await ensurePointsLedger();
  const [settings, stats, recent, users, status] = await Promise.all([getSettings(), getLedgerStats(), getRecentManualAdjustments(15), listUsers(), getLedgerStatus()]);
  const g = settings.gamification;
  const members = users.filter((u) => u.enabled).map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }));
  const topReasons = [...stats.byReason].sort((a, b) => b.points - a.points).slice(0, 4);

  return (
    <>
      <SettingsPanelHeader
        title="Points & leaderboard"
        description="Reward learning with points and levels, rank members on a leaderboard, and adjust points by hand."
        actions={
          g.enabled && g.showLeaderboard ? (
            <ButtonLink href="/leaderboard" variant="outline" size="sm" leftIcon={<Icon.Trophy className="size-4" />}>
              View leaderboard
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {g.enabled && !status.built && (
          <div role="alert" className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">Past activity has not been added to the points yet</p>
              <p className="mt-0.5 text-ink-muted">
                {status.error
                  ? `The automatic fill from history failed${status.failedAt ? ` (${formatDateTime(status.failedAt)} server time)` : ""}: ${status.error}. It is retried automatically; you can also run "Recalculate points from history" below.`
                  : "Points from earlier lessons, quizzes and certificates are being added. Reload in a moment, or run \"Recalculate points from history\" below."}
              </p>
            </div>
          </div>
        )}
        <SettingsSection
          title="Ledger"
          description={stats.lastEntryAt ? `Last points awarded ${relativeTime(stats.lastEntryAt)}.` : "No points have been awarded yet."}
        >
          <div className="px-4 py-4 sm:px-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Points awarded", value: formatPoints(stats.totalPoints) },
                { label: "This month", value: formatPoints(stats.pointsThisMonth) },
                { label: "Members with points", value: formatPoints(stats.members) },
                { label: "Ledger entries", value: formatPoints(stats.entries), hint: stats.manualAdjustments ? `${formatPoints(stats.manualAdjustments)} manual` : undefined },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-surface-2 p-3">
                  <dt className="text-xs text-ink-muted">{s.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{s.value}</dd>
                  {s.hint && <dd className="text-[11px] text-ink-faint">{s.hint}</dd>}
                </div>
              ))}
            </dl>
            {topReasons.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Biggest sources</p>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {topReasons.map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink-muted">
                        {REASON_META[r.reason].label} <span className="text-ink-faint">×{formatPoints(r.count)}</span>
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
