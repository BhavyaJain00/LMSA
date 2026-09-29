/**
 * Level math for the points system (client-safe, no runtime imports).
 *
 * level = floor(sqrt(points / 50)) + 1, so level L starts at 50 × (L − 1)²
 * points: 0, 50, 200, 450, 800, 1250, … Levels are grouped into named tiers.
 */

/** Points scale of the level curve. */
export const LEVEL_POINTS_UNIT = 50;

export const LEVEL_TIERS = [
  { name: "Beginner", minLevel: 1, tone: "neutral" },
  { name: "Learner", minLevel: 3, tone: "info" },
  { name: "Achiever", minLevel: 5, tone: "success" },
  { name: "Expert", minLevel: 7, tone: "accent" },
  { name: "Master", minLevel: 10, tone: "warning" },
  { name: "Legend", minLevel: 15, tone: "dark" },
] as const;

export type LevelTier = (typeof LEVEL_TIERS)[number];
export type TierName = LevelTier["name"];
export type TierTone = LevelTier["tone"];

export interface LevelInfo {
  /** Total points used for the calculation (negative totals count as 0). */
  points: number;
  level: number;
  tier: TierName;
  tierTone: TierTone;
  /** 0-based index into LEVEL_TIERS. */
  tierIndex: number;
  /** Points at which the current level starts. */
  levelStart: number;
  /** Points needed to reach the next level. */
  nextLevelAt: number;
  pointsToNext: number;
  /** 0-100 progress through the current level. */
  progress: number;
  /** The next tier and the level/points where it begins (null at the top tier). */
  nextTier: { name: TierName; level: number; pointsAt: number } | null;
}

/** First point total of a level (level 1 starts at 0). */
export function pointsForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return LEVEL_POINTS_UNIT * (l - 1) * (l - 1);
}

/** Level reached with a point total. */
export function levelForPoints(points: number): number {
  const p = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  let level = Math.floor(Math.sqrt(p / LEVEL_POINTS_UNIT)) + 1;
  // Guard against floating point drift at exact boundaries.
  while (pointsForLevel(level + 1) <= p) level++;
  while (level > 1 && pointsForLevel(level) > p) level--;
  return level;
}

export function tierIndexForLevel(level: number): number {
  let index = 0;
  for (let i = 0; i < LEVEL_TIERS.length; i++) if (level >= LEVEL_TIERS[i]!.minLevel) index = i;
  return index;
}

export function tierForLevel(level: number): LevelTier {
  return LEVEL_TIERS[tierIndexForLevel(level)]!;
}

/** Everything the UI needs to show a level: number, tier, progress and what comes next. */
export function getLevelInfo(points: number): LevelInfo {
  const safe = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  const level = levelForPoints(safe);
  const tierIndex = tierIndexForLevel(level);
  const tier = LEVEL_TIERS[tierIndex]!;
  const levelStart = pointsForLevel(level);
  const nextLevelAt = pointsForLevel(level + 1);
  const span = nextLevelAt - levelStart;
  const progress = span > 0 ? Math.min(100, Math.max(0, Math.round(((safe - levelStart) / span) * 100))) : 100;
  const next = LEVEL_TIERS[tierIndex + 1];
  return {
    points: safe,
    level,
    tier: tier.name,
    tierTone: tier.tone,
    tierIndex,
    levelStart,
    nextLevelAt,
    pointsToNext: Math.max(0, nextLevelAt - safe),
    progress,
    nextTier: next ? { name: next.name, level: next.minLevel, pointsAt: pointsForLevel(next.minLevel) } : null,
  };
}

/** "1,250" style formatting used for point totals. */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(points));
}

/** "+25" / "−10" with a real minus sign. */
export function formatSignedPoints(points: number): string {
  const n = Math.round(points);
  if (n > 0) return `+${formatPoints(n)}`;
  if (n < 0) return `−${formatPoints(Math.abs(n))}`;
  return "0";
}
