import Link from "next/link";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { findById, getSettings } from "@/lib/db/store";
import { resolveEmailPreferences } from "@/lib/email/preferences";
import { readSignedSubscription, readUnsubscribeReceipt, type SignedSubscription } from "@/lib/email/subscriptions";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmailPreferencesForm } from "./preferences-form";
import { UnsubscribeConfirm, UnsubscribeResult } from "./unsubscribe-result";
import { getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";

export async function generateMetadata() {
  return { title: (await getT("account"))("settings.notifications.metaTitle") };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** "announcement emails", "all optional emails", … in the active language. */
function scopeLabel(sub: SignedSubscription, t: Translator<MessageKey<"account">>): string {
  return t(`settings.notifications.scope.${sub.scope}`);
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
  const [settings, t] = await Promise.all([getSettings(), getT("account")]);
  const fresh = viewer ? await findById("users", viewer.id) : null;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title={t("settings.notifications.metaTitle")}
        description={t("settings.notifications.description")}
        breadcrumbs={
          viewer ? (
            <nav aria-label={t("settings.breadcrumb")} className="mb-2 text-sm text-ink-muted">
              <Link href="/settings" className="hover:text-ink hover:underline">
                {t("settings.metaTitle")}
              </Link>
              <span aria-hidden="true"> / </span>
              <span className="font-medium text-ink">{t("settings.notifications.metaTitle")}</span>
            </nav>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {hasLink && linkState && (
          <Card>
            <CardBody>
              <UnsubscribeConfirm userId={userId} scope={linkState.scope} token={token} label={scopeLabel(linkState, t)} email={linkState.email} subscribed={linkState.subscribed} />
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
                label={scopeLabel(receiptState, t)}
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
                <h2 className="text-base font-semibold text-ink">{t("settings.notifications.invalidTitle")}</h2>
                <p className="text-sm text-ink-muted">
                  {viewer ? t("settings.notifications.invalidBodySignedIn") : t("settings.notifications.invalidBodyGuest")}
                </p>
                {!viewer && (
                  <ButtonLink href="/login?next=%2Fsettings%2Fnotifications" size="sm" leftIcon={<Icon.LogIn className="size-4" />}>
                    {t("settings.notifications.logIn")}
                  </ButtonLink>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {!settings.email.enabled && (
          <div className="flex gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-info">
            <Icon.Info className="mt-0.5 size-5 shrink-0" />
            <p>{t("settings.notifications.disabledGlobally")}</p>
          </div>
        )}

        {fresh ? (
          <Card>
            <CardHeader title={t("settings.notifications.categoriesTitle")} description={t("settings.notifications.sentTo", { email: fresh.email })} />
            <CardBody>
              <EmailPreferencesForm key={JSON.stringify(resolveEmailPreferences(fresh))} initial={resolveEmailPreferences(fresh)} />
            </CardBody>
          </Card>
        ) : (
          (linkState || receiptState) && (
            <p className="text-center text-sm text-ink-muted">
              {t.rich("settings.notifications.loginToManage", {
                link: (text) => (
                  <Link href="/login?next=%2Fsettings%2Fnotifications" className="font-medium text-accent hover:underline">
                    {text}
                  </Link>
                ),
              })}
            </p>
          )
        )}

        {fresh && (
          <Card>
            <CardHeader title={t("settings.notifications.alwaysTitle")} description={t("settings.notifications.alwaysDescription")} />
            <CardBody>
              <ul className="grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
                {(
                  [
                    "settings.notifications.always.passwordReset",
                    "settings.notifications.always.emailConfirmation",
                    "settings.notifications.always.security",
                    "settings.notifications.always.receipts",
                  ] as const
                ).map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Icon.ShieldCheck className="size-4 shrink-0 text-success" />
                    {t(item)}
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
