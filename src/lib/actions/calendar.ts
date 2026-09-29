"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { getPublicBaseUrl } from "@/lib/data/certificates";
import { feedPathFor, newCalendarSecret } from "@/lib/calendar/token";

/**
 * Personal calendar feed management (Settings → Calendar). Each action acts
 * only on the signed-in member's own account.
 */

export interface CalendarFeedInfo {
  /** Absolute https feed URL, or null when the feed is turned off. */
  feedUrl: string | null;
}

const SIGNED_OUT: ActionResult<CalendarFeedInfo> = { ok: false, error: "Your session has expired. Sign in again to manage your calendar." };

async function setSecret(userId: string, secret: string | undefined): Promise<boolean> {
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user || !user.enabled) return false;
    user.calendarToken = secret;
    return true;
  });
}

async function feedUrlFor(userId: string, secret: string | undefined): Promise<string | null> {
  const path = feedPathFor({ id: userId, calendarToken: secret });
  return path ? `${await getPublicBaseUrl()}${path}` : null;
}

/** Turn the feed on (keeps the existing link when there already is one). */
export async function enableCalendarFeedAction(): Promise<ActionResult<CalendarFeedInfo>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const secret = user.calendarToken || newCalendarSecret();
  if (!user.calendarToken && !(await setSecret(user.id, secret))) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return { ok: true, data: { feedUrl: await feedUrlFor(user.id, secret) }, message: "Your calendar link is ready" };
}

/** Replace the secret: every previously shared link stops working. */
export async function regenerateCalendarFeedAction(): Promise<ActionResult<CalendarFeedInfo>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  let secret = newCalendarSecret();
  while (secret === user.calendarToken) secret = newCalendarSecret();
  if (!(await setSecret(user.id, secret))) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return {
    ok: true,
    data: { feedUrl: await feedUrlFor(user.id, secret) },
    message: "New calendar link created. Subscribe again with the new link.",
  };
}

/** Turn the feed off: the current link stops working immediately. */
export async function disableCalendarFeedAction(): Promise<ActionResult<CalendarFeedInfo>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (user.calendarToken && !(await setSecret(user.id, undefined))) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return { ok: true, data: { feedUrl: null }, message: "Calendar feed turned off" };
}
