import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={5} filters={3} label="Loading exercises…" />;
}
