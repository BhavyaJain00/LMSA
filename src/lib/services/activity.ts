import "server-only";
import type { ActivityType } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { addDays, toDateKey, uid } from "@/lib/utils";
import { awardPoints, isLearningActivity } from "./points";

/** Record learning activity (used for streaks and the activity heatmap). */
export async function logActivity(userId: string, type: ActivityType, refId?: string): Promise<void> {
  const date = toDateKey();
  await mutate((db) => {
    // One row per user/day/type/ref keeps the log small.
    const exists = db.activities.some((a) => a.userId === userId && a.date === date && a.type === type && a.refId === refId);
    if (!exists) {
      db.activities.push({ id: uid("act"), userId, date, type, refId, createdAt: new Date().toISOString() });
    }
  });
  if (isLearningActivity(type)) await awardPoints(userId, "streak_day", { refId: date });
}

export interface StreakInfo {
  current: number;
  longest: number;
  /** Set of YYYY-MM-DD dates with activity. */
  days: Set<string>;
  activeToday: boolean;
}

export async function getStreak(userId: string): Promise<StreakInfo> {
  const db = await getDb();
  const days = new Set(db.activities.filter((a) => a.userId === userId).map((a) => a.date));
  const today = toDateKey();
  const activeToday = days.has(today);

  // Current streak: count back from today (or yesterday if not active today).
  let current = 0;
  let cursor = activeToday ? new Date() : addDays(new Date(), -1);
  while (days.has(toDateKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Longest streak over all history.
  const sorted = Array.from(days).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev && toDateKey(addDays(new Date(`${prev}T00:00:00`), 1)) === d) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest, days, activeToday };
}

/** Activity counts per day for the last `weeks` weeks (for a heatmap). */
export async function getActivityHeatmap(userId: string, weeks = 16): Promise<{ date: string; count: number }[]> {
  const db = await getDb();
  const counts = new Map<string, number>();
  for (const a of db.activities) if (a.userId === userId) counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
  const out: { date: string; count: number }[] = [];
  const start = addDays(new Date(), -(weeks * 7 - 1));
  for (let i = 0; i < weeks * 7; i++) {
    const key = toDateKey(addDays(start, i));
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}
