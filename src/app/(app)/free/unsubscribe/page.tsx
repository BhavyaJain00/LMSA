import type { Metadata } from "next";
import { getLead } from "@/lib/seo/lead-capture";
import { checkUnsubscribeLink } from "@/lib/seo/lead-tokens";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { LeadLinkAction } from "@/components/marketing/lead-link-action";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export const metadata: Metadata = privatePageMetadata("Unsubscribe");

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200);
}

/** Unsubscribe landing for marketing leads (signed link from every lead email). */
export default async function UnsubscribeLeadPage(props: PageProps<"/free/unsubscribe">) {
  const sp = await props.searchParams;
  const fields = { l: first(sp.l), t: first(sp.t) };
  const lead = await getLead(fields.l);
  const valid = checkUnsubscribeLink(lead, fields.t);

  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-card border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        {!valid || !lead ? (
          <>
            <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Icon.AlertTriangle className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-ink">This link doesn&apos;t work</h1>
            <p className="mt-3 text-sm text-ink-muted">The unsubscribe link is incomplete or no longer valid. Use the link at the bottom of our most recent email, or contact us and we&apos;ll remove you.</p>
            <ButtonLink href="/" variant="outline" className="mt-5">
              Go to the home page
            </ButtonLink>
          </>
        ) : lead.unsubscribedAt ? (
          <>
            <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/12 text-success">
              <Icon.CheckCircle className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-ink">You&apos;re already unsubscribed</h1>
            <p className="mt-3 text-sm text-ink-muted">{lead.email} doesn&apos;t receive marketing emails from us.</p>
          </>
        ) : (
          <>
            <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon.Mail className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Unsubscribe from our emails?</h1>
            <p className="mt-3 text-sm text-ink-muted">
              <span className="font-medium text-ink">{lead.email}</span> will stop receiving free lessons, newsletters and offers. Emails about your account, if you have one, are not affected.
            </p>
            <div className="mt-5">
              <LeadLinkAction kind="unsubscribe" fields={fields} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
