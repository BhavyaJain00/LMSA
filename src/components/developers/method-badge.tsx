import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  GET: "bg-info/12 text-info",
  POST: "bg-success/12 text-success",
  PATCH: "bg-warning/15 text-warning",
  DELETE: "bg-danger/12 text-danger",
};

/** HTTP method chip used in the endpoint list and headings. */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span className={cn("inline-flex w-14 shrink-0 justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide", TONES[method] ?? "bg-surface-2 text-ink-muted", className)}>
      {method}
    </span>
  );
}

/** Colour of an HTTP status code: 2xx green, 4xx amber, 5xx red. */
export function StatusCode({ status, className }: { status: number | string; className?: string }) {
  const code = String(status);
  const tone = code.startsWith("2") ? "text-success" : code.startsWith("5") ? "text-danger" : code.startsWith("4") ? "text-warning" : "text-ink-muted";
  return <span className={cn("font-mono text-xs font-semibold", tone, className)}>{code}</span>;
}
