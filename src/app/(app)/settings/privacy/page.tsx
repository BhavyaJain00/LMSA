import Link from "next/link";
import type { DataRequest } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { isTwoFactorActive } from "@/lib/auth/account-status";
import { readConsentCookie } from "@/lib/legal/consent";
import { legalLinks } from "@/lib/legal/links";
import { countPersonalData } from "@/lib/legal/export";
import { billedSubscriptions, isLastAdmin } from "@/lib/legal/erase";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { ConsentStatus } from "@/components/legal/consent-status";
import { DataExportForm } from "@/components/legal/data-export-form";
import { DeleteAccountButton } from "./delete-account";
import { getFormatter, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/catalog";

export async function generateMetadata() {
  return { title: (await getT("account"))("settings.privacy.metaTitle"), robots: { index: false } };
}

/** Messages for `?export=<reason>` (set by /api/privacy/export when it cannot send the file). */
const EXPORT_NOTICES: Record<string, MessageKey<"account">> = {
  limited: "settings.privacy.exportNotice.limited",
  missing: "settings.privacy.exportNotice.missing",
  denied: "settings.privacy.exportNotice.denied",
};

/** How many non-empty sections are listed before "and N more". */
const SUMMARY_LIMIT = 12;

async function RequestStatus({ request }: { request: DataRequest }) {
  const t = await getT("account");
  const tone = request.status === "completed" ? "success" : request.status === "pending" ? "warning" : "neutral";
  return (
    <Badge tone={tone} dot>
      {t(`settings.privacy.requests.status.${request.status}`)}
    </Badge>
  );
}

export default async function PrivacySettingsPage(props: PageProps<"/settings/privacy">) {
  const user = await requireUser("/settings/privacy");
  const sp = await props.searchParams;
  const [db, consent, links, t, f] = await Promise.all([getDb(), readConsentCookie(), legalLinks(), getT("account"), getFormatter()]);
  const settings = db.settings;

  const summary = (countPersonalData(db, user.id) ?? []).filter((s) => s.count > 0);
  const totalRecords = summary.reduce((n, s) => n + s.count, 0);
  const requests = db.dataRequests.filter((r) => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastExport = requests.find((r) => r.type === "export");

  const lastAdmin = isLastAdmin(db, user.id);
  const billed = billedSubscriptions(db, user.id);
  const exportNoticeKey = typeof sp.export === "string" && Object.hasOwn(EXPORT_NOTICES, sp.export) ? EXPORT_NOTICES[sp.export] : undefined;
  const exportNotice = exportNoticeKey ? t(exportNoticeKey) : undefined;
  const contactEmail = settings.legal.contactEmail || settings.contact.email;
  const brand = settings.brand.name;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title={t("settings.privacy.metaTitle")}
        description={t("settings.privacy.description", { brand })}
        breadcrumbs={<Breadcrumbs items={[{ label: t("settings.metaTitle"), href: "/settings" }, { label: t("settings.privacy.metaTitle") }]} />}
      />

      {exportNotice && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>{exportNotice}</p>
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t("settings.privacy.download.title")}
            description={t("settings.privacy.download.description")}
            actions={<Icon.Download className="size-5 text-ink-faint" aria-hidden="true" />}
          />
          <CardBody className="space-y-5">
            {summary.length > 0 ? (
              <div>
                <p className="mb-2 text-sm text-ink-muted">
                  {t.rich("settings.privacy.download.summary", {
                    total: f.number(totalRecords),
                    count: totalRecords,
                    hl: (text) => <span className="font-medium text-ink">{text}</span>,
                  })}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {summary.slice(0, SUMMARY_LIMIT).map((s) => (
                    <li key={s.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-ink">
                      {s.description}
                      <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular-nums text-ink-muted">{f.number(s.count)}</span>
                    </li>
                  ))}
                  {summary.length > SUMMARY_LIMIT && <li className="px-1 py-1 text-xs text-ink-muted">{t("settings.privacy.download.more", { count: f.number(summary.length - SUMMARY_LIMIT) })}</li>}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">{t("settings.privacy.download.onlyProfile")}</p>
            )}
            <p className="text-xs text-ink-muted">
              {t("settings.privacy.download.leftOut")}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <DataExportForm />
              {lastExport && (
                <p className="text-xs text-ink-muted" title={f.dateTime(lastExport.createdAt)}>
                  {t("settings.privacy.download.last", { when: f.relative(lastExport.createdAt) })}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {settings.legal.cookieBanner && (
          <Card>
            <CardHeader title={t("settings.privacy.cookies.title")} description={t("settings.privacy.cookies.description")} />
            <CardBody>
              <ConsentStatus initial={consent} />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title={t("settings.privacy.requests.title")} description={t("settings.privacy.requests.description")} />
          {requests.length === 0 ? (
            <CardBody>
              <EmptyState compact icon={<Icon.ClipboardList />} title={t("settings.privacy.requests.emptyTitle")} description={t("settings.privacy.requests.emptyBody")} />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {requests.slice(0, 20).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t(`settings.privacy.requests.type.${r.type}`)}</p>
                    <p className="text-xs text-ink-muted">
                      <time dateTime={r.createdAt} title={f.dateTime(r.createdAt)}>
                        {f.date(r.createdAt)}
                      </time>
                    </p>
                  </div>
                  <RequestStatus request={r} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("settings.privacy.policies.title")} description={t("settings.privacy.policies.description")} />
          {links.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">{contactEmail ? t("settings.privacy.policies.noneContact", { email: contactEmail }) : t("settings.privacy.policies.none")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li key={l.slug}>
                  <Link href={l.href} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                    <Icon.FileText className="size-4 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{l.title}</span>
                      <span className="block text-xs text-ink-muted">{t("settings.privacy.policies.updated", { date: f.date(l.updatedAt) })}</span>
                    </span>
                    <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink rtl:rotate-180" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {contactEmail && links.length > 0 && (
            <p className="border-t border-border px-5 py-3 text-xs text-ink-muted">
              {t.rich("settings.privacy.policies.questions", {
                email: contactEmail,
                link: (text) => (
                  <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline" dir="ltr">
                    {text}
                  </a>
                ),
              })}
            </p>
          )}
        </Card>

        <Card className="border-danger/30">
          <CardHeader title={t("settings.privacy.delete.title")} description={t("settings.privacy.delete.description")} />
          <CardBody className="space-y-4">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium text-ink">{t("settings.privacy.delete.removed")}</p>
                <ul className="list-disc space-y-1 ps-5 text-ink-muted">
                  <li>{t("settings.privacy.delete.removed1")}</li>
                  <li>{t("settings.privacy.delete.removed2")}</li>
                  <li>{t("settings.privacy.delete.removed3")}</li>
                  <li>{t("settings.privacy.delete.removed4")}</li>
                </ul>
              </div>
              <div>
                <p className="mb-1.5 font-medium text-ink">{t("settings.privacy.delete.kept")}</p>
                <ul className="list-disc space-y-1 ps-5 text-ink-muted">
                  <li>{t("settings.privacy.delete.kept1")}</li>
                  <li>{t("settings.privacy.delete.kept2")}</li>
                  <li>{t("settings.privacy.delete.kept3")}</li>
                </ul>
              </div>
            </div>
            <p className="text-sm text-ink-muted">{t("settings.privacy.delete.consider")}</p>
            {lastAdmin ? (
              <p role="note" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-ink">
                {t("settings.privacy.delete.lastAdmin")}
              </p>
            ) : billed.length > 0 ? (
              <p role="note" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-ink">
                {t("settings.privacy.delete.billed", { count: billed.length })}{" "}
                {t.rich("settings.privacy.delete.billedAction", {
                  link: (text) => (
                    <Link href="/billing/history" className="font-medium text-accent hover:underline">
                      {text}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
            <DeleteAccountButton needsCode={isTwoFactorActive(user)} blocked={lastAdmin || billed.length > 0} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
