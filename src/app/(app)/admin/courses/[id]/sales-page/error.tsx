"use client";

import { useParams } from "next/navigation";
import { RouteError } from "@/components/admin/settings/route-error";

export default function SalesPageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ id: string }>();
  return (
    <RouteError
      error={error}
      reset={retry}
      title="The sales page builder failed to load"
      backHref={params?.id ? `/admin/courses/${params.id}` : "/admin/courses"}
      backLabel="Back to the course"
    />
  );
}
