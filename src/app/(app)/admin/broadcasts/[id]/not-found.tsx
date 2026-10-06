import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function BroadcastNotFound() {
  return (
    <EmptyState
      icon={<Icon.Megaphone />}
      title="Broadcast not found"
      description="It may have been deleted by another member of the team."
      action={
        <ButtonLink href="/admin/broadcasts" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
          Back to broadcasts
        </ButtonLink>
      }
    />
  );
}
