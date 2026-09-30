import { requireRole } from "@/lib/auth/session";
import { getIndexingOverview } from "@/lib/data/seo";
import { INDEXNOW_KEY_PATH, describeIndexNowResult } from "@/lib/seo/indexnow";
import { SITEMAP_MAX_URLS } from "@/lib/seo/sitemap";
import { SettingsRow, SettingsSection } from "@/components/admin/settings/settings-ui";
import { IndexNowPanel } from "@/components/seo/admin/indexnow-panel";
import { Icon } from "@/components/ui/icons";
import { formatNumber, pluralize, relativeTime } from "@/lib/utils";

export const metadata = { title: "Indexing · SEO settings" };

function FileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex max-w-full items-center gap-1.5 break-all font-mono text-xs text-accent hover:underline">
      {children}
      <Icon.ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default async function SeoIndexingPage() {
  await requireRole(["admin"], "/admin/settings/seo/indexing");
  const overview = await getIndexingOverview();
  const { origin, sitemap } = overview;
  const last = overview.lastSubmission;
  const lastSummary = last ? describeIndexNowResult(last) : null;

  return (
    <div className="space-y-6">
      {overview.noindexSite && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink">
          <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <p>
            <span className="font-medium">The site is hidden from search engines.</span>{" "}
            <span className="text-ink-muted">The sitemap and feeds are empty, robots.txt blocks every crawler and nothing is submitted. Turn this off under Search appearance before launch.</span>
          </p>
        </div>
      )}
      {!overview.noindexSite && !overview.reachable && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium">APP_URL is {origin}.</span>{" "}
            <span className="text-ink-muted">Search engines cannot reach a local address, so nothing is submitted. Every address below will use your real domain once APP_URL is set to it.</span>
          </p>
        </div>
      )}

      <SettingsSection title="Sitemap" description="Every public page with its last change, images and preview videos. It is rebuilt from the live content, so there is nothing to regenerate.">
        <SettingsRow label="Sitemap address" description="Submit this once in Google Search Console and Bing Webmaster Tools (Sitemaps → Add a new sitemap)." stacked>
          <FileLink href={`${origin}/sitemap.xml`}>{origin}/sitemap.xml</FileLink>
          {overview.sitemapFiles > 1 && (
            <p className="mt-1.5 text-xs text-ink-muted">
              Split into {overview.sitemapFiles} files of up to {formatNumber(SITEMAP_MAX_URLS)} addresses; this address is the index that lists them.
            </p>
          )}
        </SettingsRow>
        <SettingsRow label="What is listed" description="Drafts, scheduled items, private batches, closed jobs and pages marked noindex are left out." stacked>
          {sitemap.total === 0 ? (
            <p className="text-sm text-ink-muted">Nothing yet. Publish a course or an article and it appears here straight away.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {sitemap.sections.map((section) => (
                  <div key={section.key} className="rounded-lg border border-border bg-surface px-3 py-2">
                    <dt className="truncate text-xs text-ink-muted">{section.label}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">{formatNumber(section.count)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-ink-muted">
                {pluralize(sitemap.total, "address", "addresses")} in total, with {pluralize(sitemap.images, "image")} and {pluralize(sitemap.videos, "video")}.
              </p>
            </>
          )}
        </SettingsRow>
        <SettingsRow label="robots.txt" description="Tells crawlers which areas to skip (admin, account, checkout, API) and where the sitemap is." stacked>
          <FileLink href={`${origin}/robots.txt`}>{origin}/robots.txt</FileLink>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Feeds" description="RSS feeds for readers and aggregators. They are announced in the head of every page.">
        {overview.feeds.map((feed) => (
          <SettingsRow key={feed.url} label={feed.title} stacked>
            <FileLink href={feed.url}>{feed.url}</FileLink>
          </SettingsRow>
        ))}
      </SettingsSection>

      <IndexNowPanel
        indexNowKey={overview.indexNowKey ?? ""}
        keyFileUrl={`${origin}${INDEXNOW_KEY_PATH}`}
        active={overview.reachable && !overview.noindexSite}
        lastSubmission={last && lastSummary ? { ok: lastSummary.ok, text: lastSummary.text, when: relativeTime(last.at) } : null}
      />
    </div>
  );
}
