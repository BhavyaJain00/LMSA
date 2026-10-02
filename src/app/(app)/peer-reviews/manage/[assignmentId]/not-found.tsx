import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT("learning");
  return (
    <EmptyState
      icon={<Icon.ClipboardList />}
      title={t("peer.admin.goneTitle")}
      description={t("peer.admin.goneBody")}
      action={<ButtonLink href="/peer-reviews/manage">{t("peer.review.back")}</ButtonLink>}
    />
  );
}
