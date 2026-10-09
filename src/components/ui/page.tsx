import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type PageWidth = "narrow" | "default" | "wide";

const widths: Record<PageWidth, string> = {
  /** 720px: forms, settings, notifications, a single quiz. */
  narrow: "max-w-page-narrow",
  /** 1120px: most pages (lists, dashboards, detail pages). */
  default: "max-w-page",
  /** The full width the shell allows: wide tables, builders, analytics. */
  wide: "max-w-none",
};

/**
 * The content column of a page. Pick one of three widths instead of a
 * hand-written `mx-auto max-w-*`, so pages do not jump in width as people
 * move around. The shell already adds the side padding.
 */
export function PageContainer({ size = "default", className, ...props }: HTMLAttributes<HTMLDivElement> & { size?: PageWidth }) {
  return <div className={cn("mx-auto w-full min-w-0", widths[size], className)} {...props} />;
}
