import "server-only";
import type { Notification, NotificationType } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { emailNotifications } from "@/lib/email/notifications";

export interface NotifyInput {
  type: NotificationType;
  subject: string;
  message?: string;
  link?: string;
  fromUserId?: string;
  /**
   * Round 2: set to `false` to skip the email copy — for callers that send
   * their own richer email (e.g. announcements). By default an email is
   * queued when Settings → Email and the member's preferences allow it.
   */
  email?: boolean;
}

/** Create an in-app notification for one user (and its email copy when enabled). */
export async function notify(userId: string, input: NotifyInput): Promise<Notification> {
  const n: Notification = {
    id: uid("ntf"),
    userId,
    fromUserId: input.fromUserId,
    type: input.type,
    subject: input.subject,
    message: input.message,
    link: input.link,
    read: false,
    createdAt: new Date().toISOString(),
  };
  await mutate((db) => {
    db.notifications.push(n);
  });
  if (input.email !== false) await emailNotifications([n]);
  return n;
}

export async function notifyMany(userIds: string[], input: NotifyInput): Promise<void> {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  if (!unique.length) return;
  const now = new Date().toISOString();
  const created: Notification[] = unique.map((userId) => ({
    id: uid("ntf"),
    userId,
    fromUserId: input.fromUserId,
    type: input.type,
    subject: input.subject,
    message: input.message,
    link: input.link,
    read: false,
    createdAt: now,
  }));
  await mutate((db) => {
    db.notifications.push(...created);
  });
  if (input.email !== false) await emailNotifications(created);
}

/**
 * Email copies for notifications that were written directly to the store
 * (e.g. deduplicated reminders created inside `mutate`). Safe to call with
 * any notifications; never throws. Returns the number of emails queued.
 */
export async function sendNotificationEmails(notifications: Notification[]): Promise<number> {
  return emailNotifications(notifications);
}

/** Notify everyone with the moderator/admin role (e.g. course submitted for review). */
export async function notifyModerators(input: NotifyInput): Promise<void> {
  const db = await getDb();
  const ids = db.users.filter((u) => u.enabled && u.roles.some((r) => r === "moderator" || r === "admin")).map((u) => u.id);
  await notifyMany(ids, input);
}

export async function getNotifications(userId: string, limit = 20): Promise<Notification[]> {
  const db = await getDb();
  return db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = await getDb();
  return db.notifications.filter((n) => n.userId === userId && !n.read).length;
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  await mutate((db) => {
    const n = db.notifications.find((x) => x.id === id && x.userId === userId);
    if (n) n.read = true;
  });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await mutate((db) => {
    for (const n of db.notifications) if (n.userId === userId) n.read = true;
  });
}
