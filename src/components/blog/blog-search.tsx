import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";

/**
 * Article search: a plain GET form to /blog (works without JavaScript).
 * Search results are noindexed and canonicalise to /blog. Server Component.
 */
export function BlogSearch({ query, className }: { query: string; className?: string }) {
  return (
    <form action="/blog" method="get" role="search" className={className}>
      <div className="flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search articles"
          aria-label="Search articles"
          maxLength={100}
          leftAddon={<Icon.Search className="size-4" />}
          className="min-w-0 flex-1"
        />
        <button type="submit" className={buttonClasses({ variant: "outline" })}>
          Search
        </button>
      </div>
    </form>
  );
}
