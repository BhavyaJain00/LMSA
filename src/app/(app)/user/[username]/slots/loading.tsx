import { ListPageSkeleton } from "@/components/assessments/list-skeleton";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const tc = await getT("common");
  return <ListPageSkeleton columns={4} rows={5} filters={0} label={tc("status.loading")} />;
}
