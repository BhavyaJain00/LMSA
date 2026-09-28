import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "No permission" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={<Icon.Lock />}
      title="You don't have permission to view this page"
      description="Ask an administrator to grant you the required role, or go back to your dashboard."
      action={<ButtonLink href="/dashboard">Go to dashboard</ButtonLink>}
    />
  );
}
