import { DetailPageSkeleton } from "@/components/assessments/detail-skeleton";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT("learning");
  return <DetailPageSkeleton label={t("peer.review.loading")} />;
}
