"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function AdminBlogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} reset={retry} title="The blog admin failed to load" backHref="/admin/blog" backLabel="Back to articles" />;
}
