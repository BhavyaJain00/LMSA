"use client";

import { isValidSlug, suggestSlug } from "@/lib/seo/text";
import { cn } from "@/lib/utils";

/**
 * Helper shown under a slug field in editors (courses, batches, programs,
 * jobs, articles, categories):
 *
 *  - the address the page will have,
 *  - a suggested slug derived from the title (lowercase, hyphenated, filler
 *    words removed, cut at a word boundary) with a one-click "Use",
 *  - a format warning for slugs that would be rejected,
 *  - and, when the slug of an existing page changes, a note that the old
 *    address keeps working through a permanent redirect.
 *
 * The parent owns the field: `slug` is its current value and `onApply` sets it.
 */
export function SlugSuggestion({
  title,
  slug,
  onApply,
  basePath,
  originalSlug,
  className,
}: {
  /** Title the suggestion is derived from. */
  title: string;
  /** Current value of the slug field. */
  slug: string;
  onApply: (slug: string) => void;
  /** Path prefix of the page, e.g. "/courses/". */
  basePath: string;
  /** Slug the page was saved with (omit for new pages). */
  originalSlug?: string;
  className?: string;
}) {
  const current = slug.trim();
  const suggestion = title.trim() ? suggestSlug(title) : "";
  const invalid = current.length > 0 && !isValidSlug(current);
  const showSuggestion = !!suggestion && suggestion !== current;
  const renamed = !!originalSlug && !!current && !invalid && current !== originalSlug;

  return (
    <div className={cn("mt-1.5 space-y-1 text-xs text-ink-muted", className)}>
      <p className="break-all font-mono">
        {basePath}
        <span className={cn("font-medium", invalid ? "text-danger" : "text-ink")}>{current || suggestion || "…"}</span>
      </p>
      {invalid && (
        <p className="text-danger" role="alert">
          Use lowercase letters, numbers and single hyphens, for example “{suggestion || "intro-to-design"}”.
        </p>
      )}
      {showSuggestion && (
        <p>
          Suggested: <span className="break-all font-mono text-ink">{suggestion}</span>{" "}
          <button
            type="button"
            onClick={() => onApply(suggestion)}
            className="cursor-pointer rounded-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Use<span className="sr-only"> the suggested slug {suggestion}</span>
          </button>
        </p>
      )}
      {renamed && (
        <p role="status">
          <span className="break-all font-mono">
            {basePath}
            {originalSlug}
          </span>{" "}
          will redirect here permanently, so existing links and search rankings carry over.
        </p>
      )}
    </div>
  );
}
