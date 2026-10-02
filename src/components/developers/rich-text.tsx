import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Text from the API registry with `backtick` spans shown as inline code.
 * Everything else is rendered as plain text (React escapes it).
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <InlineCode key={index}>{part.slice(1, -1)}</InlineCode>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return <code dir="ltr" className={cn("rounded bg-surface-2 px-1 py-px font-mono text-[0.85em] text-ink break-words", className)}>{children}</code>;
}
