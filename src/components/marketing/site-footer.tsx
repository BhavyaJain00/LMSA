import Link from "next/link";
import { getFooterData, type FooterData } from "@/lib/data/seo";
import { socialLabel } from "@/lib/seo/footer";
import { CookieSettingsLink } from "@/components/legal/cookie-settings-link";
import { Icon } from "@/components/ui/icons";
import { FooterGate } from "./footer-gate";

const linkClass = "rounded-sm text-ink-muted transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function FooterColumn({ id, title, links, more }: { id: string; title: string; links: { label: string; href: string }[]; more?: { label: string; href: string } }) {
  if (!links.length) return null;
  return (
    <nav aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href} className="min-w-0">
            <Link href={link.href} className={`${linkClass} line-clamp-2`}>
              {link.label}
            </Link>
          </li>
        ))}
        {more && (
          <li>
            <Link href={more.href} className="inline-flex items-center gap-1 rounded-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {more.label}
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Copyright line and legal links shared by both footers. */
function LegalLine({ data, className }: { data: FooterData; className?: string }) {
  return (
    <div className={className}>
      <p className="min-w-0">
        © {data.year} {data.brandName}
        {data.footerText && <span> · {data.footerText}</span>}
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {data.legal.map((page) => (
          <li key={page.slug}>
            <Link href={page.href} className={linkClass}>
              {page.label}
            </Link>
          </li>
        ))}
        {data.cookieBanner && (
          <li>
            <CookieSettingsLink className="text-ink-muted hover:text-ink" />
          </li>
        )}
        <li>
          <Link href="/sitemap" className={linkClass}>
            Sitemap
          </Link>
        </li>
      </ul>
    </div>
  );
}

function FullFooter({ data }: { data: FooterData }) {
  const socials = data.sameAs.map((url) => ({ url, label: socialLabel(url) })).filter((s): s is { url: string; label: string } => !!s.label);
  return (
    <footer className="border-t border-border bg-surface-1">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Link href="/" className="inline-flex max-w-full items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {data.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.logoUrl} alt="" width={32} height={32} loading="lazy" decoding="async" className="size-8 shrink-0 rounded-lg object-contain" />
              )}
              <span className="truncate text-base font-semibold tracking-tight text-ink">{data.brandName}</span>
            </Link>
            {data.tagline && <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">{data.tagline}</p>}
            {(data.contactEmail || data.contactUrl) && (
              <ul className="mt-4 space-y-2 text-sm" aria-label="Contact">
                {data.contactEmail && (
                  <li>
                    <a href={`mailto:${data.contactEmail}`} className={`${linkClass} inline-flex max-w-full items-center gap-2`}>
                      <Icon.Mail className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{data.contactEmail}</span>
                    </a>
                  </li>
                )}
                {data.contactUrl && (
                  <li>
                    <a href={data.contactUrl} target="_blank" rel="noopener" className={`${linkClass} inline-flex items-center gap-2`}>
                      <Icon.MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                      Contact us
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                )}
              </ul>
            )}
            {socials.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label={`${data.brandName} on the web`}>
                {socials.map((social) => (
                  <li key={social.url}>
                    <a href={social.url} target="_blank" rel="noopener me" className={linkClass}>
                      {social.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <FooterColumn id="footer-explore" title="Explore" links={data.explore} />
          <FooterColumn
            id="footer-categories"
            title="Categories"
            links={data.categories.map((c) => ({ label: c.name, href: c.href }))}
            more={data.categories.length ? { label: "All categories", href: "/courses/category" } : undefined}
          />
          <FooterColumn
            id="footer-courses"
            title="Popular courses"
            links={data.popularCourses.map((c) => ({ label: c.title, href: c.href }))}
            more={data.popularCourses.length ? { label: "All courses", href: "/courses" } : undefined}
          />
          <FooterColumn
            id="footer-articles"
            title="From the blog"
            links={data.latestPosts.map((p) => ({ label: p.title, href: p.href }))}
            more={data.latestPosts.length ? { label: "All articles", href: "/blog" } : undefined}
          />
        </div>

        <LegalLine data={data} className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between" />
      </div>
    </footer>
  );
}

function CompactFooter({ data }: { data: FooterData }) {
  return (
    <footer className="border-t border-border px-4 py-4 sm:px-6 lg:px-8">
      <LegalLine data={data} className="mx-auto flex w-full max-w-7xl flex-col gap-2 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between" />
    </footer>
  );
}

/**
 * Site footer, mounted once in the app shell. Public pages get the full
 * footer (brand, contact, official profiles, main sections, categories,
 * popular courses, latest articles, legal links, cookie settings, sitemap),
 * which gives every public page links to the site's key landing pages.
 * Working pages get a single line with the legal links.
 */
export async function SiteFooter() {
  const data = await getFooterData();
  return <FooterGate full={<FullFooter data={data} />} compact={<CompactFooter data={data} />} />;
}
