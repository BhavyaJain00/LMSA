import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={4} filters={2} label="Loading peer-reviewed assignments…" />;
}
