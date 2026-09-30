import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <EmptyState
      icon={<Icon.Inbox />}
      title="This review isn't available"
      description="It may have been reassigned to another classmate, or peer review was turned off for the assignment."
      action={<ButtonLink href="/peer-reviews">Back to peer reviews</ButtonLink>}
    />
  );
}
