"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, PointsEntry, Settings } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { notify } from "@/lib/services/notifications";
import {
  addManualAdjustment,
  ensurePointsLedger,
  recalculatePointsLedger,
  removeManualAdjustment,
  type RecalculateResult,
} from "@/lib/services/points";
import { CONFIGURABLE_REASONS, MAX_MANUAL_POINTS, MAX_REASON_POINTS, REASON_META } from "@/components/gamification/reasons";
import { formatPoints } from "@/components/gamification/levels";
import { fd, fdBool } from "@/lib/utils";

/**
 * Admin actions for points, levels and the leaderboard
 * (/admin/settings/gamification). Every action is admin-only and re-checks
 * the role on the server.
 */

type Errors = Record<string, string>;

const DENIED = { ok: false as const, error: "Only administrators can manage points and the leaderboard." };

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/** Pages that show points, levels or ranks. */
function revalidatePointsPages() {
  revalidatePath("/admin/settings/gamification");
  revalidatePath("/leaderboard");
  revalidatePath("/leaderboard/points");
  revalidatePath("/dashboard");
  revalidatePath("/community");
  revalidatePath("/(app)/user/[username]", "layout");
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export async function saveGamificationSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;

  const errors: Errors = {};
  const values = {} as Record<(typeof CONFIGURABLE_REASONS)[number], number>;
  for (const reason of CONFIGURABLE_REASONS) {
    const raw = fd(formData, `points_${reason}`);
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_REASON_POINTS) {
      errors[`points_${reason}`] = `Enter a whole number from 0 to ${formatPoints(MAX_REASON_POINTS)}.`;
    } else values[reason] = n;
  }
  if (Object.keys(errors).length) {
    return { ok: false, error: "Some point values are not valid. Use whole numbers from 0 upward.", fieldErrors: errors };
  }

  const enabled = fdBool(formData, "enabled");
  const db = await getDb();
  const wasEnabled = db.settings.gamification.enabled;
  await mutate((d) => {
    const g: Settings["gamification"] = d.settings.gamification;
    g.enabled = enabled;
    g.showLeaderboard = fdBool(formData, "showLeaderboard");
    g.excludeStaff = fdBool(formData, "excludeStaff");
    g.points = { ...g.points, ...values, manual: 0 };
    d.settings.updatedAt = new Date().toISOString();
  });
  // Turning points on for the first time fills the ledger from past activity.
  if (enabled && !wasEnabled) await ensurePointsLedger();

  revalidatePath("/", "layout");
  return {
    ok: true,
    data: undefined,
    message: enabled ? "Points settings saved" : "Points settings saved. Points and the leaderboard are now hidden.",
  };
}

/* ------------------------------------------------------------------ */
/* Recalculate                                                          */
/* ------------------------------------------------------------------ */

export async function recalculatePointsAction(): Promise<ActionResult<RecalculateResult>> {
  if (!(await requireAdmin())) return DENIED;
  const db = await getDb();
  if (!db.settings.gamification.enabled) {
    return { ok: false, error: "Turn on points first, then recalculate." };
  }
  try {
    const result = await recalculatePointsLedger();
    revalidatePointsPages();
    const kept = result.manualKept ? ` ${result.manualKept} manual ${result.manualKept === 1 ? "adjustment was" : "adjustments were"} kept.` : "";
    return {
      ok: true,
      data: result,
      message: `Recalculated ${formatPoints(result.entries)} ${result.entries === 1 ? "entry" : "entries"} for ${result.members} ${result.members === 1 ? "member" : "members"}.${kept}`,
    };
  } catch (err) {
    console.error("[points] recalculation failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "The points could not be recalculated. Nothing was changed — please try again." };
  }
}

/* ------------------------------------------------------------------ */
/* Manual adjustments                                                   */
/* ------------------------------------------------------------------ */

export async function adjustPointsAction(_prev: ActionResult<{ entry: PointsEntry }> | null, formData: FormData): Promise<ActionResult<{ entry: PointsEntry }>> {
  const admin = await requireAdmin();
  if (!admin) return DENIED;

  const userId = fd(formData, "userId");
  const direction = fd(formData, "direction") === "deduct" ? -1 : 1;
  const rawAmount = fd(formData, "amount");
  const note = fd(formData, "note").replace(/\s+/g, " ");

  const errors: Errors = {};
  const db = await getDb();
  const member = userId ? db.users.find((u) => u.id === userId) : undefined;
  if (!userId) errors.userId = "Choose the member to adjust.";
  else if (!member) errors.userId = "This member no longer exists.";
  else if (!member.enabled) errors.userId = "This account is disabled.";
  const amount = rawAmount === "" ? NaN : Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) errors.amount = "Enter a whole number of points (at least 1).";
  else if (amount > MAX_MANUAL_POINTS) errors.amount = `A single adjustment can be at most ${formatPoints(MAX_MANUAL_POINTS)} points.`;
  if (note.length < 3) errors.note = "Add a short note so the member knows why (at least 3 characters).";
  else if (note.length > 200) errors.note = "Keep the note under 200 characters.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };
  if (!db.settings.gamification.enabled) return { ok: false, error: "Points are turned off. Turn them on above before adjusting a member's points." };

  const points = direction * amount;
  const entry = await addManualAdjustment(member!.id, points, note);
  if (!entry) return { ok: false, error: "The adjustment could not be saved. Please try again." };

  await notify(member!.id, {
    type: "system",
    subject: points > 0 ? `You received ${formatPoints(points)} points` : `${formatPoints(Math.abs(points))} points were deducted from your total`,
    message: note,
    link: "/leaderboard/points",
    fromUserId: admin.id,
  });
  revalidatePointsPages();
  return {
    ok: true,
    data: { entry },
    message: `${points > 0 ? "Added" : "Deducted"} ${formatPoints(Math.abs(points))} points ${points > 0 ? "to" : "from"} ${member!.name}.`,
  };
}

export async function removeManualAdjustmentAction(entryId: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  if (typeof entryId !== "string" || !entryId) return { ok: false, error: "Invalid request." };
  const removed = await removeManualAdjustment(entryId);
  if (!removed) return { ok: false, error: `This ${REASON_META.manual.label.toLowerCase()} no longer exists.` };
  revalidatePointsPages();
  return { ok: true, data: undefined, message: "Adjustment removed" };
}
