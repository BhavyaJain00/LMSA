import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { isMessageModerator } from "@/lib/comms/messages-core";
import { countOpenReports, listInbox } from "@/lib/comms/messages";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { ConversationList, InboxPanes } from "@/components/messages/conversation-list";

/**
 * Messages shell: the conversation list next to the open pane (inbox
 * placeholder, a thread, or the new-message form). While messaging is off
 * members see a notice; administrators get a link to switch it on.
 */
export default async function MessagesLayout({ children }: LayoutProps<"/messages">) {
  const user = await requireUser("/messages");
  const db = await getDb();
  const moderator = isMessageModerator(user);
  const admin = user.roles.includes("admin");
  const reports = moderator ? countOpenReports(db) : 0;

  const actions = (
    <>
      {moderator && (
        <ButtonLink href="/messages/moderation" variant="outline" size="sm" leftIcon={<Icon.Shield className="size-4" />}>
          Reports{reports ? ` (${reports})` : ""}
        </ButtonLink>
      )}
      {db.settings.messaging.enabled && (
        <ButtonLink href="/messages/new" size="sm" leftIcon={<Icon.Plus className="size-4" />}>
          New message
        </ButtonLink>
      )}
    </>
  );

  if (!db.settings.messaging.enabled) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Messages" actions={actions} />
        <EmptyState
          icon={<Icon.MessageCircle />}
          title="Direct messages are turned off"
          description={admin ? "Switch them on to let learners write to their instructors." : "This site doesn't use direct messages at the moment."}
          action={
            admin ? (
              <ButtonLink href="/messages/moderation#settings" size="sm">
                Messaging settings
              </ButtonLink>
            ) : undefined
          }
        />
      </div>
    );
  }

  const inbox = listInbox(db, user.id);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Messages" description="Private conversations with your instructors and classmates." actions={actions} className="mb-4" />
      <InboxPanes list={<ConversationList initial={inbox} />}>{children}</InboxPanes>
    </div>
  );
}
