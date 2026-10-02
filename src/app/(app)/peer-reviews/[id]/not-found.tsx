import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT("learning");
  return (
    <EmptyState
      icon={<Icon.Inbox />}
      title={t("peer.review.notFoundTitle")}
      description={t("peer.review.notFoundBody")}
      action={<ButtonLink href="/peer-reviews">{t("peer.review.back")}</ButtonLink>}
    />
  );
}
