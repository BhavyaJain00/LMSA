import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function AdminTeamNotFound() {
  return (
    <EmptyState
      icon={<Icon.Building />}
      title="Team not found"
      description="This team doesn't exist anymore, or the link is wrong."
      action={
        <ButtonLink href="/admin/teams" variant="outline" leftIcon={<Icon.ArrowLeft className="size-4" />}>
          All teams
        </ButtonLink>
      }
    />
  );
}
