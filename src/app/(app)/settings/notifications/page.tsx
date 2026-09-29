import Link from "next/link";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { findById, getSettings } from "@/lib/db/store";
import { preferenceLabel, resolveEmailPreferences } from "@/lib/email/preferences";
import { applySignedSubscription } from "@/lib/email/subscriptions";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmailPreferencesForm } from "./preferences-form";
import { UnsubscribeResult } from "./unsubscribe-result";

export const metadata = { title: "Email notifications" };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Email preferences. Also the landing page of one-click unsubscribe links
 * (`?unsubscribe=<category>&u=<userId>&t=<signature>`), which work without
 * logging in: the HMAC signature proves the link was issued for that member
 * and category. Opening the link applies it; the page offers Undo.
 */
export default async function EmailNotificationsPage(props: PageProps<"/settings/notifications">) {
  const sp = await props.searchParams;
  const scope = one(sp.unsubscribe);
  const userId = one(sp.u);
  const token = one(sp.t);
  const hasLink = !!(scope || userId || token);

  const unsubscribed = hasLink ? await applySignedSubscription(userId, scope, token, false) : null;
  const viewer = hasLink ? await getCurrentUser() : await requireUser("/settings/notifications");
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
        {hasLink && unsubscribed && (
          <Card>
            <CardBody>
              <UnsubscribeResult userId={userId} scope={unsubscribed.scope} token={token} label={`${preferenceLabel(unsubscribed.scope).toLowerCase()} emails`} email={unsubscribed.email} />
            </CardBody>
          </Card>
        )}
        {hasLink && !unsubscribed && (
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
              <EmailPreferencesForm initial={resolveEmailPreferences(fresh)} />
            </CardBody>
          </Card>
        ) : (
          hasLink &&
          unsubscribed && (
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
