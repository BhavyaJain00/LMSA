import type { Metadata } from "next";
import { getLead } from "@/lib/seo/lead-capture";
import { checkConfirmLink } from "@/lib/seo/lead-tokens";
import { leadStatus } from "@/lib/seo/leads";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { LeadLinkAction } from "@/components/marketing/lead-link-action";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export const metadata: Metadata = privatePageMetadata("Confirm your email");

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200);
}

function Panel({ icon, tone, title, children }: { icon: keyof typeof Icon; tone: "accent" | "success" | "warning"; title: string; children: React.ReactNode }) {
  const PanelIcon = Icon[icon];
  const toneClass = { accent: "bg-accent/10 text-accent", success: "bg-success/12 text-success", warning: "bg-warning/15 text-warning" }[tone];
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-card border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <span className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-full ${toneClass}`}>
          <PanelIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <div className="mt-3 space-y-4 text-sm text-ink-muted">{children}</div>
      </div>
    </div>
  );
}

/** Double opt-in landing: checks the signed link, then confirms on a click. */
export default async function ConfirmLeadPage(props: PageProps<"/free/confirm">) {
  const sp = await props.searchParams;
  const fields = { l: first(sp.l), e: first(sp.e), t: first(sp.t) };
  const lead = await getLead(fields.l);
  const check = checkConfirmLink(lead, fields.e, fields.t);

  if (check === "invalid" || !lead) {
    return (
      <Panel icon="AlertTriangle" tone="warning" title="This link doesn't work">
        <p>The confirmation link is incomplete or was changed. Open it again from the email, or sign up once more to get a new one.</p>
        <ButtonLink href="/free">Sign up again</ButtonLink>
      </Panel>
    );
  }
  if (check === "expired") {
    return (
      <Panel icon="Clock" tone="warning" title="This link has expired">
        <p>Confirmation links work for 7 days. Sign up again and we&apos;ll send you a fresh one.</p>
        <ButtonLink href="/free">Sign up again</ButtonLink>
      </Panel>
    );
  }
  if (leadStatus(lead) === "confirmed") {
    return (
      <Panel icon="CheckCircle" tone="success" title="You're already confirmed">
        <p>{lead.email} is on our list. Thanks for being here!</p>
        <ButtonLink href="/free">See the free lessons</ButtonLink>
      </Panel>
    );
  }
  return (
    <Panel icon="Mail" tone="accent" title="Confirm your email">
      <p>
        Confirm that <span className="font-medium text-ink">{lead.email}</span> should receive emails from us. You can unsubscribe at any time.
      </p>
      <LeadLinkAction kind="confirm" fields={fields} />
    </Panel>
  );
}
