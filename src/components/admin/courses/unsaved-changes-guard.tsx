"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/dialog";

/**
 * Warns before leaving a page with unsaved edits: the browser prompt on
 * reload/close, and a confirm dialog when an in-app link is clicked.
 */
export function UnsavedChangesGuard({ dirty, message }: { dirty: boolean; message?: string }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.dataset.skipUnsavedGuard !== undefined) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onClose={() => setPendingHref(null)}
      onConfirm={() => {
        const href = pendingHref;
        setPendingHref(null);
        if (href) router.push(href);
      }}
      title="Discard unsaved changes?"
      description={message ?? "You have unsaved changes on this page. If you leave now, they will be lost."}
      confirmLabel="Leave page"
      cancelLabel="Keep editing"
      destructive
    />
  );
}
