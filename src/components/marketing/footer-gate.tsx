"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { hasFullFooter } from "@/lib/seo/footer";

/**
 * Chooses between the two server-rendered footers by route: the full footer
 * on public pages, the one-line footer on working pages (dashboard, admin,
 * settings, checkout…). Both arrive as ready-made markup, so this component
 * ships no footer code to the browser.
 */
export function FooterGate({ full, compact }: { full: ReactNode; compact: ReactNode }) {
  const pathname = usePathname();
  return <>{hasFullFooter(pathname) ? full : compact}</>;
}
