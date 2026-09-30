import Link from "next/link";
import type { DataRequest } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { isTwoFactorActive } from "@/lib/auth/account-status";
import { readConsentCookie } from "@/lib/legal/consent";
import { legalLinks } from "@/lib/legal/links";
import { personalDataSections, summarizeSections } from "@/lib/legal/export";
import { billedSubscriptions, isLastAdmin } from "@/lib/legal/erase";
import { DATA_REQUEST_STATUS_LABELS, DATA_REQUEST_TYPE_LABELS } from "@/lib/legal/data-requests";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { ConsentStatus } from "@/components/legal/consent-status";
import { DataExportForm } from "@/components/legal/data-export-form";
import { DeleteAccountButton } from "./delete-account";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Privacy & data", robots: { index: false } };

/** Messages for `?export=<reason>` (set by /api/privacy/export when it cannot send the file). */
const EXPORT_NOTICES: Record<string, string> = {
  limited: "You've downloaded your data several times in the last hour. Please wait a while and try again.",
  missing: "Your data couldn't be collected right now. Please reload the page and try again.",
  denied: "You can only download your own data.",
};

/** How many non-empty sections are listed before "and N more". */
const SUMMARY_LIMIT = 12;

function RequestStatus({ request }: { request: DataRequest }) {
  const tone = request.status === "completed" ? "success" : request.status === "pending" ? "warning" : "neutral";
  return (
    <Badge tone={tone} dot>
      {DATA_REQUEST_STATUS_LABELS[request.status]}
    </Badge>
  );
}

export default async function PrivacySettingsPage(props: PageProps<"/settings/privacy">) {
  const user = await requireUser("/settings/privacy");
  const sp = await props.searchParams;
  const [db, consent, links] = await Promise.all([getDb(), readConsentCookie(), legalLinks()]);
  const settings = db.settings;

  const summary = summarizeSections(personalDataSections(db, user.id) ?? []).filter((s) => s.count > 0);
  const totalRecords = summary.reduce((n, s) => n + s.count, 0);
  const requests = db.dataRequests.filter((r) => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastExport = requests.find((r) => r.type === "export");

  const lastAdmin = isLastAdmin(db, user.id);
  const billed = billedSubscriptions(db, user.id);
  const exportNotice = typeof sp.export === "string" ? EXPORT_NOTICES[sp.export] : undefined;
  const contactEmail = settings.legal.contactEmail || settings.contact.email;
  const brand = settings.brand.name;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title="Privacy & data"
        description={`See what ${brand} keeps about you, download a copy, manage cookies or delete your account.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Account settings", href: "/settings" }, { label: "Privacy & data" }]} />}
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
            title="Download my data"
            description="A JSON file with everything linked to your account, readable by people and by other apps."
            actions={<Icon.Download className="size-5 text-ink-faint" aria-hidden="true" />}
          />
          <CardBody className="space-y-5">
            {summary.length > 0 ? (
              <div>
                <p className="mb-2 text-sm text-ink-muted">
                  Right now that&apos;s <span className="font-medium text-ink">{formatNumber(totalRecords)}</span> {totalRecords === 1 ? "record" : "records"}, including:
                </p>
                <ul className="flex flex-wrap gap-2">
                  {summary.slice(0, SUMMARY_LIMIT).map((s) => (
                    <li key={s.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-ink">
                      {s.description}
                      <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular-nums text-ink-muted">{formatNumber(s.count)}</span>
                    </li>
                  ))}
                  {summary.length > SUMMARY_LIMIT && <li className="px-1 py-1 text-xs text-ink-muted">and {summary.length - SUMMARY_LIMIT} more</li>}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Your profile and account settings are all we hold about you so far.</p>
            )}
            <p className="text-xs text-ink-muted">
              Left out for your safety: your password, two-step verification secrets and one-time codes (only a scrambled form of them is stored, and
              they are useless outside your account). Content you created, such as courses, is listed by title.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <DataExportForm />
              {lastExport && (
                <p className="text-xs text-ink-muted" title={formatDateTime(lastExport.createdAt)}>
                  Last downloaded {relativeTime(lastExport.createdAt)}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {settings.legal.cookieBanner && (
          <Card>
            <CardHeader title="Cookies" description="Choose which optional cookies this browser may use. You can change your mind at any time." />
            <CardBody>
              <ConsentStatus initial={consent} />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Your requests" description="Every data download and deletion request made for your account." />
          {requests.length === 0 ? (
            <CardBody>
              <EmptyState compact icon={<Icon.ClipboardList />} title="No requests yet" description="When you download your data, the request is listed here." />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {requests.slice(0, 20).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{DATA_REQUEST_TYPE_LABELS[r.type]}</p>
                    <p className="text-xs text-ink-muted">
                      <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>
                        {formatDate(r.createdAt)}
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
          <CardHeader title="Policies" description="How we handle your data and the terms you agreed to." />
          {links.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">Our policies haven&apos;t been published yet.{contactEmail ? ` Questions? Write to ${contactEmail}.` : ""}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li key={l.slug}>
                  <Link href={l.href} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                    <Icon.FileText className="size-4 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{l.title}</span>
                      <span className="block text-xs text-ink-muted">Last updated {formatDate(l.updatedAt)}</span>
                    </span>
                    <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {contactEmail && links.length > 0 && (
            <p className="border-t border-border px-5 py-3 text-xs text-ink-muted">
              Questions about your data? Write to{" "}
              <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline">
                {contactEmail}
              </a>
              .
            </p>
          )}
        </Card>

        <Card className="border-danger/30">
          <CardHeader title="Delete my account" description="Permanently remove your personal data and close your account." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium text-ink">Removed</p>
                <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                  <li>Your name, email, photo and profile</li>
                  <li>Notes, notifications, emails and sign-in history</li>
                  <li>AI tutor chats, job applications and newsletter sign-ups</li>
                  <li>Every signed-in device</li>
                </ul>
              </div>
              <div>
                <p className="mb-1.5 font-medium text-ink">Kept without your name</p>
                <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                  <li>Orders and invoices (amounts and numbers the law requires us to keep)</li>
                  <li>Discussion posts, reviews and messages you sent, shown as &quot;Deleted user&quot;</li>
                  <li>Coursework and progress, as anonymous course statistics</li>
                </ul>
              </div>
            </div>
            <p className="text-sm text-ink-muted">Consider downloading your data first — this can&apos;t be undone and certificates will no longer be linked to you.</p>
            {lastAdmin ? (
              <p role="note" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-ink">
                You are the only administrator. Make another member an administrator before deleting this account.
              </p>
            ) : billed.length > 0 ? (
              <p role="note" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-ink">
                {billed.length === 1 ? "A membership is" : `${billed.length} memberships are`} still billed automatically.{" "}
                <Link href="/billing/history" className="font-medium text-accent hover:underline">
                  Cancel {billed.length === 1 ? "it" : "them"} under Billing
                </Link>{" "}
                first so you aren&apos;t charged again.
              </p>
            ) : null}
            <DeleteAccountButton needsCode={isTwoFactorActive(user)} blocked={lastAdmin || billed.length > 0} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
