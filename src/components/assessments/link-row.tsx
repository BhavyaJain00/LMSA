"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Table row that navigates on click. The row should also contain a real
 * link (e.g. on the title) so keyboard and screen-reader users can open it.
 */
export function LinkRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      className={cn("cursor-pointer transition-colors hover:bg-surface-2", className)}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,label,select,textarea")) return;
        if (window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
