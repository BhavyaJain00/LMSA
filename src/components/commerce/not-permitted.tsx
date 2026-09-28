import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";

/** Frappe's NotPermitted card: red dot title, message and one action. */
export function NotPermitted({ message, actionHref, actionLabel, children }: { message: ReactNode; actionHref?: string; actionLabel?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto my-12 w-full max-w-md rounded-card border border-border bg-surface-1 p-6 shadow-card sm:my-24">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <span className="size-2.5 rounded-full bg-danger" aria-hidden="true" />
        Not Permitted
      </h2>
      <p className="mt-2 text-sm text-ink-muted">{message}</p>
      {children}
      {actionHref && actionLabel && (
        <ButtonLink href={actionHref} className="mt-5 w-full">
          {actionLabel}
        </ButtonLink>
      )}
    </div>
  );
}
