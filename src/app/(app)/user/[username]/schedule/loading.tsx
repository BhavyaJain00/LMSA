import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={4} rows={5} filters={0} label="Loading…" />;
}
