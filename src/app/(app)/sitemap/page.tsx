import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { getHtmlSitemap } from "@/lib/data/seo";
import { sectionTrail } from "@/lib/seo/breadcrumbs";
import { feedAlternates, pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { Icon } from "@/components/ui/icons";
import { pluralize } from "@/lib/utils";

const PATH = "/sitemap";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return pageMetadata(
    {
      title: "Sitemap",
      description: [`Every public page of ${settings.brand.name} in one place: courses, categories, topics, instructors, batches, programs, articles, jobs and legal pages.`],
      path: PATH,
    },
    settings,
  );
}

export default async function HtmlSitemapPage() {
  const [sections, settings] = await Promise.all([getHtmlSitemap(), getSettings()]);
  const total = sections.reduce((sum, section) => sum + section.links.length, 0);
  const feeds = settings.seo.noindexSite ? [] : feedAlternates(settings, siteOrigin());

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={sectionTrail("Sitemap")} />

      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Sitemap</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
          {pluralize(total, "page")} of {settings.brand.name}, grouped by section.
        </p>
      </header>

      {sections.length > 1 && (
        <nav aria-label="Sitemap sections" className="mb-8 rounded-card border border-border bg-surface-1 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">On this page</h2>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="font-medium text-accent hover:underline">
                  {section.title}
                </a>{" "}
                <span className="text-xs tabular-nums text-ink-muted">{section.links.length}</span>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2">
              <h2 id={`${section.id}-heading`} className="text-xl font-semibold tracking-tight text-ink">
                {section.title}
              </h2>
              {section.href && (
                <Link href={section.href} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Browse {section.title.toLowerCase()}
                  <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              )}
            </div>
            <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {section.links.map((link) => (
                <li key={link.href} className="flex min-w-0 items-baseline justify-between gap-3">
                  <Link href={link.href} className="min-w-0 truncate text-ink hover:text-accent hover:underline" title={link.label}>
                    {link.label}
                  </Link>
                  {link.hint && <span className="shrink-0 text-xs tabular-nums text-ink-muted">{link.hint}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="sitemap-machine-heading" className="mt-10 rounded-card border border-border bg-surface-1 p-4 text-sm">
        <h2 id="sitemap-machine-heading" className="font-semibold text-ink">
          For feed readers and search engines
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-ink-muted">
          <li>
            <a href="/sitemap.xml" className="font-medium text-accent hover:underline">
              XML sitemap
            </a>
          </li>
          {feeds.map((feed) => (
            <li key={feed.url}>
              <a href={feed.url} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                <Icon.Radio className="size-3.5" aria-hidden="true" />
                {feed.title} (RSS)
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
