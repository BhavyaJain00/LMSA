import "server-only";
import type { EmailPreferences } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { EMAIL_PREFERENCE_KEYS, resolveEmailPreferences } from "./preferences";
import { type UnsubscribeScope, verifyUnsubscribeToken } from "./signing";

/**
 * Change a member's email preferences for one category (or all) — used by
 * the signed one-click unsubscribe link and its "Undo" button, which work
 * without a session. Returns the updated preferences, or null when the link
 * is invalid or the account no longer exists.
 */
export async function applySignedSubscription(
  userId: string | null | undefined,
  scope: string | null | undefined,
  token: string | null | undefined,
  subscribed: boolean,
): Promise<{ scope: UnsubscribeScope; preferences: EmailPreferences; name: string; email: string } | null> {
  if (!verifyUnsubscribeToken(userId, scope, token)) return null;
  const validScope = scope as UnsubscribeScope;
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;
    const next = resolveEmailPreferences(user);
    if (validScope === "all") for (const key of EMAIL_PREFERENCE_KEYS) next[key] = subscribed;
    else next[validScope] = subscribed;
    user.emailPreferences = next;
    return { scope: validScope, preferences: next, name: user.name, email: user.email };
  });
}
