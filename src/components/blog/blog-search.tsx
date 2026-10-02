import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { getT } from "@/i18n/server";

/**
 * Article search: a plain GET form to /blog (works without JavaScript).
 * Search results are noindexed and canonicalise to /blog. Server Component.
 */
export async function BlogSearch({ query, className }: { query: string; className?: string }) {
  const [t, common] = await Promise.all([getT("public"), getT("common")]);
  return (
    <form action="/blog" method="get" role="search" className={className}>
      <div className="flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("blog.search.label")}
          aria-label={t("blog.search.label")}
          maxLength={100}
          leftAddon={<Icon.Search className="size-4" />}
          className="min-w-0 flex-1"
        />
        <button type="submit" className={buttonClasses({ variant: "outline" })}>
          {common("actions.search")}
        </button>
      </div>
    </form>
  );
}
