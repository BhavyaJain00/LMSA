import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={3} filters={2} label="Loading peer reviews…" />;
}
