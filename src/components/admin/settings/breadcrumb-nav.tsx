"use client";

import type { ReactNode } from "react";
import { useT } from "@/i18n/client";

/** The labelled `<nav>` around `Breadcrumbs` (client, so the label follows the interface language on any page). */
export function BreadcrumbNav({ className, children }: { className?: string; children: ReactNode }) {
  const t = useT("admin");
  return (
    <nav aria-label={t("global.breadcrumbs.label")} className={className}>
      {children}
    </nav>
  );
}
