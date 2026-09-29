"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type View = "preview" | "text" | "headers" | "source";

/**
 * Email body viewer. The HTML preview renders in an `<iframe sandbox>` with
 * no scripts, forms or same-origin access (links open in a new tab via
 * `allow-popups`), so stored HTML can never run in the admin's session.
 */
export function EmailPreview({
  previewHtml,
  html,
  text,
  headers,
  subject,
}: {
  previewHtml: string;
  html: string;
  text: string;
  headers: [string, string][];
  subject: string;
}) {
  const toast = useToast();
  const hasHtml = html.trim().length > 0;
  const [view, setView] = useState<View>(hasHtml ? "preview" : "text");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  const views: { value: View; label: string; icon: React.ReactNode }[] = [
    ...(hasHtml ? [{ value: "preview" as const, label: "Preview", icon: <Icon.Eye className="size-3.5" /> }] : []),
    { value: "text", label: "Plain text", icon: <Icon.FileText className="size-3.5" /> },
    { value: "headers", label: "Headers", icon: <Icon.ListChecks className="size-3.5" /> },
    ...(hasHtml ? [{ value: "source" as const, label: "HTML", icon: <Icon.Code className="size-3.5" /> }] : []),
  ];

  return (
    <div className="rounded-card border border-border bg-surface-1 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <SegmentedControl value={view} onChange={setView} options={views} />
        <div className="flex items-center gap-1">
          {view === "preview" && (
            <SegmentedControl
              size="xs"
              value={width}
              onChange={setWidth}
              options={[
                { value: "desktop", label: <span className="sr-only">Desktop width</span>, icon: <Icon.Monitor className="size-3.5" /> },
                { value: "mobile", label: <span className="sr-only">Phone width</span>, icon: <Icon.Smartphone className="size-3.5" /> },
              ]}
            />
          )}
          {view === "text" && (
            <IconButton label="Copy plain text" size="icon-sm" onClick={() => copy(text, "Text")}>
              <Icon.Copy className="size-4" />
            </IconButton>
          )}
          {view === "source" && (
            <IconButton label="Copy HTML source" size="icon-sm" onClick={() => copy(html, "HTML")}>
              <Icon.Copy className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {view === "preview" && (
        <div className="bg-surface-2 p-2 sm:p-4">
          <iframe
            title={`Preview of “${subject}”`}
            srcDoc={previewHtml}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className={cn(
              "mx-auto block h-[640px] max-h-[75vh] rounded-lg border border-border bg-white transition-[width]",
              width === "mobile" ? "w-[375px] max-w-full" : "w-full",
            )}
          />
        </div>
      )}
      {view === "text" && (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed text-ink">
          {text || "This email has no plain-text part."}
        </pre>
      )}
      {view === "headers" && (
        <dl className="divide-y divide-border">
          {headers.map(([name, value], i) => (
            <div key={`${name}-${i}`} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-mono text-xs font-medium text-ink-muted">{name}</dt>
              <dd className="break-all font-mono text-xs text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view === "source" && <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-ink">{html}</pre>}
    </div>
  );
}
