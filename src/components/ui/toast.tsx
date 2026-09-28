"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export type ToastTone = "neutral" | "success" | "error" | "warning" | "info";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions | string) => void;
  success: (title: ReactNode, description?: ReactNode) => void;
  error: (title: ReactNode, description?: ReactNode) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const toneIcon: Record<ToastTone, ReactNode> = {
  neutral: <Icon.Info className="size-5 text-ink-muted" />,
  success: <Icon.CheckCircle className="size-5 text-success" />,
  error: <Icon.XCircle className="size-5 text-danger" />,
  warning: <Icon.AlertTriangle className="size-5 text-warning" />,
  info: <Icon.Info className="size-5 text-info" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions | string) => {
      const options: ToastOptions = typeof opts === "string" ? { title: opts } : opts;
      const id = ++counter.current;
      const duration = options.duration ?? (options.tone === "error" ? 6000 : 4000);
      setToasts((list) => [...list.slice(-4), { ...options, id }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "error" }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface-1 p-3.5 shadow-pop animate-toast-in",
            )}
          >
            <span className="mt-0.5 shrink-0">{toneIcon[t.tone ?? "neutral"]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-ink-muted">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink">
              <Icon.X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a one-time toast on mount. Rendered by the layout when a flash cookie is present. */
export function FlashToast({ message, tone = "success" }: { message: string; tone?: ToastTone }) {
  const { toast } = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ title: message, tone });
  }, [message, tone, toast]);
  return null;
}
