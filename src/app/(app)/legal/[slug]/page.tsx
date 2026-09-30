import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getLegalPage, renderLegalMarkdown } from "@/lib/legal/pages";
import { legalLinks } from "@/lib/legal/links";
import { isTemplateContent, isValidLegalSlug, legalHref, removeTemplateNotice } from "@/lib/legal/pages-shared";
import { pageMetadata } from "@/lib/seo/metadata";
import { extractHeadings, Markdown } from "@/lib/markdown";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CookieSettingsLink } from "@/components/legal/cookie-settings-link";
import { cn, formatDate, stripMarkdown, truncate } from "@/lib/utils";

/**
 * Public legal page (/legal/privacy, /legal/terms, /legal/refunds,
 * /legal/cookies and custom pages). Unpublished pages are only visible to
 * administrators, as a marked preview that search engines never index.
 */

async function loadPage(slug: string) {
  if (!isValidLegalSlug(slug)) return null;
  const page = await getLegalPage(slug);
  if (!page) return null;
  if (page.published) return { page, preview: false };
  const viewer = await getCurrentUser();
  return viewer && isAdmin(viewer) ? { page, preview: true } : null;
}

function summary(markdown: string): string {
  const text = stripMarkdown(removeTemplateNotice(markdown)).replace(/\s+/g, " ").trim();
  return truncate(text, 160);
}

export async function generateMetadata(props: PageProps<"/legal/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const found = await loadPage(slug);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };
  const [settings, markdown] = await Promise.all([getSettings(), renderLegalMarkdown(found.page)]);
  return pageMetadata(
    {
      title: found.page.title,
      description: summary(markdown),
      path: legalHref(found.page.slug),
      noindex: found.preview,
      follow: true,
    },
    settings,
  );
}

export default async function LegalPageView(props: PageProps<"/legal/[slug]">) {
  const { slug } = await props.params;
  const found = await loadPage(slug);
  if (!found) notFound();
  const { page, preview } = found;
  const [settings, markdown, links, viewer] = await Promise.all([getSettings(), renderLegalMarkdown(page), legalLinks(), getCurrentUser()]);
  const toc = extractHeadings(markdown).filter((h) => h.level === 2 && h.id);
  const others = links.filter((l) => l.slug !== page.slug);
  const contactEmail = settings.legal.contactEmail || settings.contact.email;

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      {preview && (
        <div role="status" className="mb-6 flex flex-col gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <strong>Preview.</strong> This page is not published, so only administrators can see it.
              {isTemplateContent(page.content) && " It still contains the starter-template notice."}
            </span>
          </p>
          <ButtonLink href={`/admin/settings/legal/${page.slug}`} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
            Edit page
          </ButtonLink>
        </div>
      )}

      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/" className="hover:text-ink hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <Icon.ChevronRight className="size-3.5 text-ink-faint" />
          </li>
          <li>Legal</li>
          <li aria-hidden="true">
            <Icon.ChevronRight className="size-3.5 text-ink-faint" />
          </li>
          <li aria-current="page" className="font-medium text-ink">
            {page.title}
          </li>
        </ol>
      </nav>

      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{page.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span>
            Last updated <time dateTime={page.updatedAt}>{formatDate(page.updatedAt, { year: "numeric", month: "long", day: "numeric" })}</time>
          </span>
          {page.version > 0 && <span aria-label={`Version ${page.version}`}>Version {page.version}</span>}
          <span>{settings.legal.companyName || settings.brand.name}</span>
        </p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <article className="min-w-0">
          <Markdown content={markdown} className="max-w-none" />

          {page.slug === "cookies" && (
            <div className="mt-8 rounded-card border border-border bg-surface-2 p-4 text-sm">
              <p className="font-medium text-ink">Change your cookie choice</p>
              <p className="mt-1 text-ink-muted">Open the cookie settings to turn analytics or marketing cookies on or off for this browser.</p>
              <CookieSettingsLink className={cn(buttonClasses({ variant: "outline", size: "sm" }), "mt-3 hover:no-underline")} />
            </div>
          )}
          {page.slug === "privacy" && (
            <div className="mt-8 rounded-card border border-border bg-surface-2 p-4 text-sm">
              <p className="font-medium text-ink">Your data, your choice</p>
              <p className="mt-1 text-ink-muted">
                {viewer
                  ? "Download a copy of your personal data or delete your account from your privacy settings."
                  : "Signed-in members can download a copy of their personal data or delete their account from their privacy settings."}
              </p>
              <ButtonLink href={viewer ? "/settings/privacy" : "/login?next=/settings/privacy"} variant="outline" size="sm" className="mt-3" leftIcon={<Icon.Shield className="size-4" />}>
                {viewer ? "Open privacy settings" : "Log in to manage your data"}
              </ButtonLink>
            </div>
          )}
        </article>

        <aside className="space-y-6 text-sm lg:sticky lg:top-20 lg:self-start print:hidden">
          {toc.length > 1 && (
            <nav aria-labelledby="legal-toc">
              <p id="legal-toc" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                On this page
              </p>
              <ol className="space-y-1.5 border-l border-border">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-muted hover:border-ink hover:text-ink">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {others.length > 0 && (
            <nav aria-labelledby="legal-more">
              <p id="legal-more" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Other policies
              </p>
              <ul className="space-y-1.5">
                {others.map((l) => (
                  <li key={l.slug}>
                    <Link href={l.href} className="text-ink-muted hover:text-ink hover:underline">
                      {l.title}
                    </Link>
                  </li>
                ))}
                <li>
                  <CookieSettingsLink className="text-ink-muted hover:text-ink" />
                </li>
              </ul>
            </nav>
          )}
          {contactEmail && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Questions?</p>
              <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1.5 break-all text-accent hover:underline">
                <Icon.Mail className="size-4 shrink-0" />
                {contactEmail}
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
