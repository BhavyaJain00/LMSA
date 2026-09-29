import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function EmailNotFound() {
  return (
    <EmptyState
      icon={<Icon.Inbox />}
      title="Email not found"
      description="It may have been deleted or cleaned up from the outbox."
      action={
        <ButtonLink href="/admin/emails" leftIcon={<Icon.ArrowLeft className="size-4" />}>
          Back to the outbox
        </ButtonLink>
      }
    />
  );
}
