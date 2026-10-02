import type { TocEntry } from "@/lib/seo/blog";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

function TocList({ entries }: { entries: TocEntry[] }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className={cn(entry.level === 3 && "ps-4")}>
          <a
            href={`#${entry.id}`}
            className="block rounded-sm py-0.5 leading-snug text-ink-muted transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Table of contents of an article, built from its H2/H3 headings. On small
 * screens it is a collapsible block above the article; from `lg` it is a
 * sticky sidebar. Plain anchor links: works without JavaScript. Server Component.
 */
export async function PostToc({ entries, variant }: { entries: TocEntry[]; variant: "inline" | "sidebar" }) {
  if (!entries.length) return null;
  const t = await getT("public");
  if (variant === "inline") {
    return (
      <details className="group rounded-card border border-border bg-surface-1 p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <Icon.ListChecks className="size-4 text-ink-muted" aria-hidden="true" />
            {t("blog.toc.title")}
          </span>
          <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <nav aria-label={t("blog.toc.label")} className="mt-3">
          <TocList entries={entries} />
        </nav>
      </details>
    );
  }
  return (
    <nav aria-labelledby="toc-heading" className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto lg:block">
      <h2 id="toc-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {t("blog.toc.title")}
      </h2>
      <TocList entries={entries} />
    </nav>
  );
}
