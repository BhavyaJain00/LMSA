"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/services/notifications";

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markNotificationRead(user.id, id);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markAllNotificationsRead(user.id);
  revalidatePath("/", "layout");
}
