import { DESCRIPTION_MAX, TITLE_MAX, clampText } from "@/lib/seo/text";
import { cn } from "@/lib/utils";

/**
 * Approximation of a Google result: breadcrumb-style address, title and
 * description, each cut where search engines usually cut them. Editors feed
 * it their live field values. Usable from Server and Client Components.
 */
export function SnippetPreview({ url, title, description, className }: { url: string; title: string; description: string; className?: string }) {
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/").filter(Boolean).join(" › ");
  return (
    <div className={cn("max-w-xl rounded-xl border border-border bg-surface p-4", className)} aria-label="Search result preview">
      <p className="truncate text-xs text-ink-muted">{display}</p>
      <p className="mt-0.5 truncate text-lg leading-snug text-info">{title.trim() ? clampText(title, TITLE_MAX + 5) : "Page title"}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        {description.trim() ? clampText(description, DESCRIPTION_MAX) : "Add a description to control the text shown under the title."}
      </p>
    </div>
  );
}
