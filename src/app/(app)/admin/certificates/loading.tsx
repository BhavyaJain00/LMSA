import { ListPageSkeleton } from "@/components/assessments/list-skeleton";

export default function Loading() {
  return <ListPageSkeleton columns={5} filters={4} label="Loading certificates…" />;
}
