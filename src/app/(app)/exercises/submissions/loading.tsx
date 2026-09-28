import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={5} label="Loading submissions…" />;
}
