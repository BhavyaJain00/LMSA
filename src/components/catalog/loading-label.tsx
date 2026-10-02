"use client";

import { useT } from "@/i18n/client";

/** Screen-reader "Loading…" announcement for route skeletons (server `loading.tsx` files render it). */
export function LoadingLabel() {
  const t = useT("common");
  return <span className="sr-only">{t("status.loading")}</span>;
}
