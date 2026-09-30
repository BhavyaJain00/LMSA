import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { listLegalPages } from "@/lib/legal/pages";
import { CORE_LEGAL_META, CORE_LEGAL_SLUGS, isCoreLegalSlug, isTemplateContent, legalHref } from "@/lib/legal/pages-shared";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { LegalSettingsForm } from "@/components/legal/legal-settings-form";
import { NewLegalPageDialog } from "@/components/legal/new-legal-page-dialog";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Legal pages" };

export default async function LegalSettingsPage() {
  await requireRole(["admin"], "/admin/settings/legal");
  const [settings, pages, db] = await Promise.all([getSettings(), listLegalPages(), getDb()]);
  const storedSlugs = new Set(db.legalPages.map((p) => p.slug));
  const corePages = pages.filter((p) => isCoreLegalSlug(p.slug));
  const unpublishedCore = CORE_LEGAL_SLUGS.filter((slug) => !corePages.find((p) => p.slug === slug)?.published);
  const needsReview = pages.filter((p) => isTemplateContent(p.content)).length;

  return (
    <>
      <SettingsPanelHeader
        title="Legal pages"
        description="Privacy policy, terms, refund and cookie policies, plus any custom pages. Published pages appear in the footer, at sign-up and at checkout."
        actions={<NewLegalPageDialog />}
      />

      {unpublishedCore.length > 0 && (
        <div role="status" className="mb-6 flex gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold">Not ready for launch</p>
            <p className="mt-0.5 text-ink-muted">
              {unpublishedCore.map((slug) => CORE_LEGAL_META[slug].title).join(", ")} {unpublishedCore.length === 1 ? "is" : "are"} not published yet. Sign-up and checkout mention
              these pages, so review the starter templates (ideally with a lawyer) and publish them before taking real members or payments.
            </p>
          </div>
        </div>
      )}

      <SettingsSection
        title="Pages"
        description={needsReview ? `${needsReview} ${needsReview === 1 ? "page still carries" : "pages still carry"} the starter-template notice.` : "Every page has been reviewed."}
      >
        <ul className="divide-y divide-border">
          {pages.map((page) => {
            const core = isCoreLegalSlug(page.slug);
            const template = isTemplateContent(page.content);
            const stored = storedSlugs.has(page.slug);
            return (
              <li key={page.slug} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 gap-3">
                  <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg", page.published ? "bg-success/12 text-success" : "bg-surface-2 text-ink-faint")}>
                    <Icon.FileText className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <Link href={`/admin/settings/legal/${page.slug}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {page.title}
                    </Link>
                    <p className="truncate font-mono text-xs text-ink-faint">{legalHref(page.slug)}</p>
                    {core && <p className="mt-0.5 text-xs text-ink-muted">{CORE_LEGAL_META[page.slug as keyof typeof CORE_LEGAL_META].description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {page.published ? (
                        <Badge tone="success" dot>
                          Published · v{page.version}
                        </Badge>
                      ) : stored ? (
                        <Badge tone="warning" dot>
                          Draft
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          Starter template
                        </Badge>
                      )}
                      {template && <Badge tone="warning">Review with a lawyer</Badge>}
                      {!core && <Badge tone="outline">Custom</Badge>}
                      {stored && <span className="text-xs text-ink-muted">Updated {formatDate(page.updatedAt)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 pl-12 sm:pl-0">
                  {page.published && (
                    <ButtonLink href={legalHref(page.slug)} variant="ghost" size="sm" target="_blank" rightIcon={<Icon.ExternalLink className="size-3.5" />}>
                      View
                    </ButtonLink>
                  )}
                  <ButtonLink href={`/admin/settings/legal/${page.slug}`} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                    Edit
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      <div className="mt-6">
        <LegalSettingsForm initial={settings.legal} fallbackContactEmail={settings.contact.email || undefined} />
      </div>
    </>
  );
}
