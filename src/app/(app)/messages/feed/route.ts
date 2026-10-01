import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { MESSAGE_LIMITS, isInboxFilter } from "@/lib/comms/messages-core";
import { allowPoll, isMessageId, listInbox, pollThread } from "@/lib/comms/messages";

/**
 * Polling feed for /messages (every 10 s while the page is visible).
 *
 * `GET /messages/feed?inbox=1&q=&filter=&limit=` — the first page of the inbox;
 * `GET /messages/feed?c=<conversationId>&after=<messageId>&known=<ids>&read=1` —
 * new messages of an open thread, removals among the shown ones and the read
 * receipt; `read=1` marks the thread read for a participant looking at it.
 * Both can be combined in one request. Signed-in members only, rate limited.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.enabled) return NextResponse.json({ error: "Sign in to use messages." }, { status: 401, headers: NO_STORE });
  const db = await getDb();
  if (!db.settings.messaging.enabled) return NextResponse.json({ error: "Direct messages are turned off." }, { status: 403, headers: NO_STORE });
  if (!allowPoll(user.id)) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });

  const params = req.nextUrl.searchParams;
  const body: Record<string, unknown> = {};

  const conversationId = params.get("c");
  if (conversationId) {
    if (!isMessageId(conversationId)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    const after = params.get("after");
    const known = (params.get("known") ?? "").split(",").filter(isMessageId).slice(0, 200);
    const thread = await pollThread(user, conversationId, after && isMessageId(after) ? after : null, known, params.get("read") === "1");
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    body.thread = thread;
  }

  if (params.get("inbox") === "1") {
    const filter = params.get("filter");
    const limit = Math.min(100, Math.max(MESSAGE_LIMITS.inboxPage, Number(params.get("limit")) || 0));
    // Read after the thread poll so a thread that was just marked read shows no unread count.
    body.inbox = listInbox(await getDb(), user.id, { q: (params.get("q") ?? "").slice(0, 100), filter: isInboxFilter(filter) ? filter : "all", limit });
  }

  return NextResponse.json(body, { headers: NO_STORE });
}
