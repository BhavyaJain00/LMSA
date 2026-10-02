import { ListPageSkeleton } from "@/components/assessments/list-skeleton";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT("learning");
  return <ListPageSkeleton columns={5} label={t("exercise.mine.loading")} />;
}
