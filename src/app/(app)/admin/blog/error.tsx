"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function AdminBlogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={retry} title={t("errorPages.blog")} backHref="/admin/blog" backLabel={t("errorPages.backToArticles")} />;
}
