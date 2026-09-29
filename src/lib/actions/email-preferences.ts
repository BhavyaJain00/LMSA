"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, EmailPreferences } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { fd, fdBool } from "@/lib/utils";
import { EMAIL_PREFERENCE_KEYS, preferenceLabel } from "@/lib/email/preferences";
import { applySignedSubscription } from "@/lib/email/subscriptions";

/**
 * Learner email preferences (/settings/notifications). The signed-link
 * actions work without a session: the HMAC in the link proves it was issued
 * for that member and category.
 */

export async function saveEmailPreferencesAction(_prev: ActionResult<EmailPreferences> | null, formData: FormData): Promise<ActionResult<EmailPreferences>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };
  const next = {} as EmailPreferences;
  for (const key of EMAIL_PREFERENCE_KEYS) next[key] = fdBool(formData, key);
  const saved = await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (!row) return false;
    row.emailPreferences = next;
    return true;
  });
  if (!saved) return { ok: false, error: "Your account could not be found." };
  revalidatePath("/settings/notifications");
  const on = EMAIL_PREFERENCE_KEYS.filter((k) => next[k]).length;
  return {
    ok: true,
    data: next,
    message: on === 0 ? "Saved — you'll only receive essential account emails" : on === EMAIL_PREFERENCE_KEYS.length ? "Saved — you'll receive all emails" : "Email preferences saved",
  };
}

/** Turn every optional email on or off for the signed-in member. */
export async function setAllEmailPreferencesAction(subscribed: boolean): Promise<ActionResult<EmailPreferences>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };
  const value = subscribed === true;
  const next = {} as EmailPreferences;
  for (const key of EMAIL_PREFERENCE_KEYS) next[key] = value;
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (row) row.emailPreferences = next;
  });
  revalidatePath("/settings/notifications");
  return { ok: true, data: next, message: value ? "You'll receive all emails" : "Unsubscribed from all optional emails" };
}

/** "Undo" on the one-click unsubscribe confirmation (no login needed). */
export async function resubscribeWithTokenAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await applySignedSubscription(fd(formData, "u"), fd(formData, "scope"), fd(formData, "t"), true);
  if (!result) return { ok: false, error: "This link is invalid. Open your email preferences to change your subscriptions." };
  revalidatePath("/settings/notifications");
  return { ok: true, data: undefined, message: `You're subscribed to ${preferenceLabel(result.scope).toLowerCase()} again` };
}

/** Unsubscribe again after an undo (no login needed). */
export async function unsubscribeWithTokenAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await applySignedSubscription(fd(formData, "u"), fd(formData, "scope"), fd(formData, "t"), false);
  if (!result) return { ok: false, error: "This link is invalid. Open your email preferences to change your subscriptions." };
  revalidatePath("/settings/notifications");
  return { ok: true, data: undefined, message: `Unsubscribed from ${preferenceLabel(result.scope).toLowerCase()}` };
}
