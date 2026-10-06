import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function AffiliateNotFound() {
  return (
    <EmptyState
      icon={<Icon.Handshake />}
      title="Affiliate not found"
      description="This affiliate doesn't exist anymore, or the link is wrong."
      action={
        <ButtonLink href="/admin/affiliates" variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
          All affiliates
        </ButtonLink>
      }
    />
  );
}
