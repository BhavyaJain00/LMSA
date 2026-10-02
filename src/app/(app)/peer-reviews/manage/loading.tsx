import { ListPageSkeleton } from "@/components/assessments/list-skeleton";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT("learning");
  return <ListPageSkeleton columns={4} filters={2} label={t("peer.admin.loadingList")} />;
}
