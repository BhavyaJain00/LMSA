import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

/** Shown inside the app shell when a page calls notFound(). */
export default function AppNotFound() {
  return (
    <EmptyState
      icon={<Icon.Search />}
      title="We couldn't find that"
      description="It may have been removed, unpublished, or the link is wrong."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/courses">Browse courses</ButtonLink>
          <ButtonLink href="/dashboard" variant="outline">
            Go to dashboard
          </ButtonLink>
        </div>
      }
    />
  );
}
