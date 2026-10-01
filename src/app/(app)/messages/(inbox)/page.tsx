import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export const metadata = { title: "Messages" };

/** Right-hand pane of /messages on wide screens (phones show the conversation list instead). */
export default function MessagesIndexPage() {
  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-112 flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
        <Icon.MessageCircle className="size-7" />
      </span>
      <h2 className="text-base font-semibold text-ink">Pick a conversation</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">Choose a conversation from the list, or start a new one with an instructor of one of your courses.</p>
      <ButtonLink href="/messages/new" size="sm" className="mt-4" leftIcon={<Icon.Plus className="size-4" />}>
        New message
      </ButtonLink>
    </div>
  );
}
