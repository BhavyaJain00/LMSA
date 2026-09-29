import type { Settings } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { LevelEmblem } from "./level-chip";
import { LEVEL_TIERS, formatPoints, pointsForLevel } from "./levels";
import { CONFIGURABLE_REASONS, REASON_META } from "./reasons";

/** "How to earn points": every reason with a non-zero value. */
export function EarnPointsCard({ points, className }: { points: Settings["gamification"]["points"]; className?: string }) {
  const reasons = CONFIGURABLE_REASONS.filter((r) => points[r] > 0).sort((a, b) => points[b] - points[a]);
  return (
    <Card className={cn("p-4", className)} id="how-points-work">
      <h2 className="text-sm font-semibold text-ink">How to earn points</h2>
      {reasons.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">Point values have not been set up yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {reasons.map((reason) => {
            const meta = REASON_META[reason];
            const IconCmp = Icon[meta.icon];
            return (
              <li key={reason} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent" aria-hidden="true">
                  <IconCmp className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{meta.label}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-success">+{formatPoints(points[reason])}</span>
                  </span>
                  <span className="block text-xs text-ink-muted">{meta.description}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The level tiers with the level and points where each begins. */
export function LevelTiersCard({ currentLevel, className }: { currentLevel?: number; className?: string }) {
  return (
    <Card className={cn("p-4", className)}>
      <h2 className="text-sm font-semibold text-ink">Levels</h2>
      <p className="mt-0.5 text-xs text-ink-muted">Every level needs a little more than the last. Your level counts all points you have ever earned.</p>
      <ol className="mt-3 space-y-2">
        {LEVEL_TIERS.map((tier, i) => {
          const next = LEVEL_TIERS[i + 1];
          const range = next ? `Levels ${tier.minLevel}–${next.minLevel - 1}` : `Level ${tier.minLevel}+`;
          const active = currentLevel !== undefined && currentLevel >= tier.minLevel && (!next || currentLevel < next.minLevel);
          return (
            <li key={tier.name} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", active && "bg-accent/5 ring-1 ring-accent/30")}>
              <LevelEmblem level={tier.minLevel} tone={tier.tone} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {tier.name}
                  {active && <span className="ml-1.5 text-xs font-normal text-accent">· you are here</span>}
                </span>
                <span className="block text-xs text-ink-muted">{range}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatPoints(pointsForLevel(tier.minLevel))} pts</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
