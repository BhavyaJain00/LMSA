"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";

/**
 * Protects a dirty manual-save form (Frappe: "Discard changes?" dialog).
 *
 * - In-app link clicks are intercepted in the capture phase (before Next's
 *   <Link> handler runs) and confirmed with a dialog.
 * - Reloading or closing the tab triggers the browser's native prompt.
 *
 * Render it anywhere inside the form with `when={dirty}`.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!when) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (e.g. a hash link): nothing is lost.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      // Also stops other guards on the page from opening a second dialog.
      event.stopImmediatePropagation();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [when]);

  return (
    <ConfirmDialog
      open={target !== null}
      onClose={() => setTarget(null)}
      onConfirm={() => {
        const href = target;
        setTarget(null);
        if (href) router.push(href);
      }}
      destructive
      title="Discard changes?"
      description="This form has unsaved changes. Leaving now discards them."
      confirmLabel="Discard"
      cancelLabel="Keep editing"
    />
  );
}
