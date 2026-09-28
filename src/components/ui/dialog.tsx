"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button, IconButton } from "./button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Hide the close (×) button. */
  hideClose?: boolean;
  className?: string;
}

const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw] h-[90vh]",
};

/** Accessible modal built on the native <dialog> element. */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", hideClose, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={cn(
        "m-auto w-full rounded-2xl border border-border bg-surface-1 p-0 text-ink shadow-pop backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-scale-in",
        sizes[size],
        className,
      )}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={title ? "dialog-title" : undefined}
    >
      <div className={cn("flex max-h-[85vh] flex-col", size === "full" && "h-full max-h-full")}>
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title && (
                <h2 id="dialog-title" className="text-base font-semibold">
                  {title}
                </h2>
              )}
              {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
            </div>
            {!hideClose && (
              <IconButton label="Close" size="icon-sm" onClick={onClose} className="-mr-1 -mt-1">
                <Icon.X className="size-4" />
              </IconButton>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  loading,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={() => void onConfirm()} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm text-ink-muted">{description}</p>}
    </Dialog>
  );
}
