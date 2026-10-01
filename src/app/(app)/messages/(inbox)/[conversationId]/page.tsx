import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { buildThread, isMessageId } from "@/lib/comms/messages";
import { ThreadView } from "@/components/messages/thread-view";

export async function generateMetadata(props: PageProps<"/messages/[conversationId]">): Promise<Metadata> {
  const { conversationId } = await props.params;
  const user = await getCurrentUser();
  if (!user || !isMessageId(conversationId)) return { title: "Messages" };
  const result = buildThread(await getDb(), user, conversationId);
  if (!result.ok) return { title: "Conversation not found" };
  const others = result.thread.participants.filter((p) => p.id !== user.id).map((p) => p.name);
  return { title: others.length ? `Messages · ${others.join(", ")}` : "Messages" };
}

/** One conversation (its participants, or moderators for reported conversations). */
export default async function ConversationPage(props: PageProps<"/messages/[conversationId]">) {
  const { conversationId } = await props.params;
  const user = await requireUser(`/messages/${encodeURIComponent(conversationId)}`);
  if (!isMessageId(conversationId)) notFound();
  const db = await getDb();
  if (!db.settings.messaging.enabled) notFound();
  const result = buildThread(db, user, conversationId);
  if (!result.ok) notFound();
  return <ThreadView key={result.thread.id} initial={result.thread} viewerId={user.id} />;
}
