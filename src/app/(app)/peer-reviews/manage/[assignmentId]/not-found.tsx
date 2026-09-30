import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <EmptyState
      icon={<Icon.ClipboardList />}
      title="This assignment no longer exists"
      description="It may have been deleted. Its peer reviews were removed with it."
      action={<ButtonLink href="/peer-reviews/manage">Back to peer reviews</ButtonLink>}
    />
  );
}
