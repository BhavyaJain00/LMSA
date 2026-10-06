import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function InstructorNotFound() {
  return (
    <EmptyState
      icon={<Icon.Presentation />}
      title="Instructor not found"
      description="This application doesn't exist anymore, or the link is wrong."
      action={
        <ButtonLink href="/admin/marketplace" variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
          All instructors
        </ButtonLink>
      }
    />
  );
}
