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

type SecretChange = "ensure" | "rotate" | "clear";

/**
 * Change the member's feed secret and return the value stored afterwards
 * (`undefined` = feed off), or null when the account is gone or disabled.
 * The decision is made inside the serialized mutation from the stored row,
 * not from the copy loaded with the session, so overlapping requests (two
 * tabs, a retried request) never return a link that another write replaced
 * in between. Regenerating stays last-writer-wins by design: each rotation
 * revokes every earlier link.
 */
async function changeSecret(userId: string, change: SecretChange): Promise<{ secret: string | undefined } | null> {
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user || !user.enabled) return null;
    if (change === "clear") {
      if (user.calendarToken) user.calendarToken = undefined;
    } else if (change === "rotate" || !user.calendarToken) {
      let secret = newCalendarSecret();
      while (secret === user.calendarToken) secret = newCalendarSecret();
      user.calendarToken = secret;
    }
    return { secret: user.calendarToken };
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
  const stored = await changeSecret(user.id, "ensure");
  if (!stored) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return { ok: true, data: { feedUrl: await feedUrlFor(user.id, stored.secret) }, message: "Your calendar link is ready" };
}

/** Replace the secret: every previously shared link stops working. */
export async function regenerateCalendarFeedAction(): Promise<ActionResult<CalendarFeedInfo>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const stored = await changeSecret(user.id, "rotate");
  if (!stored) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return {
    ok: true,
    data: { feedUrl: await feedUrlFor(user.id, stored.secret) },
    message: "New calendar link created. Subscribe again with the new link.",
  };
}

/** Turn the feed off: the current link stops working immediately. */
export async function disableCalendarFeedAction(): Promise<ActionResult<CalendarFeedInfo>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!(await changeSecret(user.id, "clear"))) return SIGNED_OUT;
  revalidatePath("/settings/calendar");
  return { ok: true, data: { feedUrl: null }, message: "Calendar feed turned off" };
}
