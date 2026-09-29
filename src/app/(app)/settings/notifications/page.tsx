import Link from "next/link";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { findById, getSettings } from "@/lib/db/store";
import { preferenceLabel, resolveEmailPreferences } from "@/lib/email/preferences";
import { readSignedSubscription, readUnsubscribeReceipt, type SignedSubscription } from "@/lib/email/subscriptions";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmailPreferencesForm } from "./preferences-form";
import { UnsubscribeConfirm, UnsubscribeResult } from "./unsubscribe-result";

export const metadata = { title: "Email notifications" };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function scopeLabel(sub: SignedSubscription): string {
  return `${preferenceLabel(sub.scope).toLowerCase()} emails`;
}

/**
 * Email preferences. Also the landing page of one-click unsubscribe links
 * (`?unsubscribe=<category>&u=<userId>&t=<signature>`), which work without
 * logging in: the HMAC signature proves the link was issued for that member
 * and category. Rendering never changes anything — the link only shows a
 * confirmation, the member confirms with a POST, and the action redirects to
 * `?confirmed=1` (no token in the URL; the outcome comes from a short-lived
 * receipt cookie and the current database state).
 */
export default async function EmailNotificationsPage(props: PageProps<"/settings/notifications">) {
  const sp = await props.searchParams;
  const scope = one(sp.unsubscribe);
  const userId = one(sp.u);
  const token = one(sp.t);
  const hasLink = !!(scope || userId || token);

  const linkState = hasLink ? await readSignedSubscription(userId, scope, token) : null;
  const receipt = !hasLink && one(sp.confirmed) === "1" ? await readUnsubscribeReceipt() : null;
  const receiptState = receipt ? await readSignedSubscription(receipt.userId, receipt.scope, receipt.token) : null;
  const signed = hasLink || !!receiptState;

  const viewer = signed ? await getCurrentUser() : await requireUser("/settings/notifications");
  const settings = await getSettings();
  const fresh = viewer ? await findById("users", viewer.id) : null;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title="Email notifications"
        description="Choose which emails you receive. In-app notifications are not affected."
        breadcrumbs={
          viewer ? (
            <nav aria-label="Breadcrumb" className="mb-2 text-sm text-ink-muted">
              <Link href="/settings" className="hover:text-ink hover:underline">
                Account settings
              </Link>
              <span aria-hidden="true"> / </span>
              <span className="font-medium text-ink">Email notifications</span>
            </nav>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {hasLink && linkState && (
          <Card>
            <CardBody>
              <UnsubscribeConfirm userId={userId} scope={linkState.scope} token={token} label={scopeLabel(linkState)} email={linkState.email} subscribed={linkState.subscribed} />
            </CardBody>
          </Card>
        )}
        {receipt && receiptState && (
          <Card>
            <CardBody>
              <UnsubscribeResult
                userId={receipt.userId}
                scope={receiptState.scope}
                token={receipt.token}
                label={scopeLabel(receiptState)}
                email={receiptState.email}
                subscribed={receiptState.subscribed}
              />
            </CardBody>
          </Card>
        )}
        {hasLink && !linkState && (
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="rounded-full bg-danger/12 p-2.5 text-danger">
                <Icon.AlertTriangle className="size-6" />
              </span>
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold text-ink">This unsubscribe link isn&apos;t valid</h2>
                <p className="text-sm text-ink-muted">
                  The link may be incomplete or was changed. {viewer ? "You can manage your email preferences below." : "Log in to manage your email preferences."}
                </p>
                {!viewer && (
                  <ButtonLink href="/login?next=%2Fsettings%2Fnotifications" size="sm" leftIcon={<Icon.LogIn className="size-4" />}>
                    Log in
                  </ButtonLink>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {!settings.email.enabled && (
          <div className="flex gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-info">
            <Icon.Info className="mt-0.5 size-5 shrink-0" />
            <p>Email notifications are currently turned off for everyone by the administrators. Your choices below apply when they are turned back on.</p>
          </div>
        )}

        {fresh ? (
          <Card>
            <CardHeader title="Email categories" description={`Emails are sent to ${fresh.email}.`} />
            <CardBody>
              <EmailPreferencesForm key={JSON.stringify(resolveEmailPreferences(fresh))} initial={resolveEmailPreferences(fresh)} />
            </CardBody>
          </Card>
        ) : (
          (linkState || receiptState) && (
            <p className="text-center text-sm text-ink-muted">
              <Link href="/login?next=%2Fsettings%2Fnotifications" className="font-medium text-accent hover:underline">
                Log in
              </Link>{" "}
              to manage all of your email preferences.
            </p>
          )
        )}

        {fresh && (
          <Card>
            <CardHeader title="Always sent" description="These emails are needed to keep your account working and can't be turned off." />
            <CardBody>
              <ul className="grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
                {["Password reset links", "Email address confirmation", "Security notices about your account", "Payment receipts"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Icon.ShieldCheck className="size-4 shrink-0 text-success" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
