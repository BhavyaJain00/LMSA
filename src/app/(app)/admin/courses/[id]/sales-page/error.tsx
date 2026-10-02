"use client";

import { useParams } from "next/navigation";
import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function SalesPageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ id: string }>();
  const t = useT("admin");
  return (
    <RouteError
      error={error}
      reset={retry}
      title={t("errorPages.salesPage")}
      backHref={params?.id ? `/admin/courses/${params.id}` : "/admin/courses"}
      backLabel={t("errorPages.backToCourse")}
    />
  );
}
