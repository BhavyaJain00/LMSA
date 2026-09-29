"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, EmailPreferences } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { fd, fdBool } from "@/lib/utils";
import { EMAIL_PREFERENCE_KEYS } from "@/lib/email/preferences";
import { applySignedSubscription, setUnsubscribeReceipt } from "@/lib/email/subscriptions";

/**
 * Learner email preferences (/settings/notifications). The signed-link
 * actions work without a session: the HMAC in the link proves it was issued
 * for that member and category. They are the only place a signed link
 * changes anything — opening the link (GET) just asks for confirmation.
 */

/** Where signed-link actions land: no token in the URL, the outcome comes from the receipt cookie. */
const SIGNED_RESULT_PATH = "/settings/notifications?confirmed=1";

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

const INVALID_LINK = "This link is invalid. Open your email preferences to change your subscriptions.";

/** Apply a signed-link change, remember it for the result page and leave the tokenised URL. */
async function applySigned(formData: FormData, subscribed: boolean): Promise<ActionResult> {
  const userId = fd(formData, "u");
  const scope = fd(formData, "scope");
  const token = fd(formData, "t");
  const result = await applySignedSubscription(userId, scope, token, subscribed);
  if (!result) return { ok: false, error: INVALID_LINK };
  await setUnsubscribeReceipt({ userId, scope, token });
  revalidatePath("/settings/notifications");
  redirect(SIGNED_RESULT_PATH);
}

/** "Unsubscribe" on the confirmation page of a one-click link (no login needed). */
export async function confirmUnsubscribeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return applySigned(formData, false);
}

/** "Undo — keep me subscribed" after a signed unsubscribe (no login needed). */
export async function resubscribeWithTokenAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return applySigned(formData, true);
}

/** Unsubscribe again after an undo (no login needed). */
export async function unsubscribeWithTokenAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return applySigned(formData, false);
}
