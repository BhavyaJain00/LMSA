import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { directoryOf, isMessageId, lookupRecipient, searchRecipients, threadPath } from "@/lib/comms/messages";
import { isMessagingStaff } from "@/lib/comms/messages-core";
import { Icon } from "@/components/ui/icons";
import { NewMessageForm } from "@/components/messages/new-message-form";

export const metadata = { title: "New message" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Start a conversation. `?to=<username>` (from "Message instructor" buttons)
 * pre-selects the member — or opens the existing conversation — and
 * `?course=<id>` sets the course the conversation is about.
 */
export default async function NewMessagePage(props: PageProps<"/messages/new">) {
  const search = await props.searchParams;
  const to = first(search.to).slice(0, 100);
  const course = first(search.course);
  const user = await requireUser(to ? `/messages/new?to=${encodeURIComponent(to)}` : "/messages/new");
  const db = await getDb();
  const lookup = to ? lookupRecipient(db, user, to, isMessageId(course) ? course : undefined) : null;
  if (lookup?.ok && lookup.recipient.conversationId) redirect(threadPath(lookup.recipient.conversationId));
  const staff = isMessagingStaff(user, directoryOf(db));

  return (
    <section aria-labelledby="new-message-heading" className="rounded-card border border-border bg-surface-1 p-4 sm:p-6 lg:min-h-112">
      <div className="mb-5 flex items-center gap-2">
        <Link href="/messages" className="-ml-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Back to conversations">
          <Icon.ArrowLeft className="size-5" />
        </Link>
        <h2 id="new-message-heading" className="text-lg font-semibold text-ink">
          New message
        </h2>
      </div>
      {lookup && !lookup.ok && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {lookup.recipient && <strong className="font-medium">{lookup.recipient.name}: </strong>}
            {lookup.error}
          </span>
        </p>
      )}
      <NewMessageForm initialRecipient={lookup?.ok ? lookup.recipient : null} suggestions={searchRecipients(db, user, "", 12)} staff={staff} />
    </section>
  );
}
