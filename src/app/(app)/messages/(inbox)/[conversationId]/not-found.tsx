import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export default function ConversationNotFound() {
  return (
    <div className="flex min-h-96 flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
        <Icon.MessageCircle className="size-7" />
      </span>
      <h2 className="text-base font-semibold text-ink">Conversation not found</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">It may have been removed, or you aren&apos;t part of it.</p>
      <ButtonLink href="/messages" variant="outline" size="sm" className="mt-4" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
        Back to messages
      </ButtonLink>
    </div>
  );
}
