"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";
import { confirmUnsubscribeAction, resubscribeWithTokenAction, unsubscribeWithTokenAction } from "@/lib/actions/email-preferences";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { useT } from "@/i18n/client";

const strong = (text: ReactNode) => <span className="font-medium text-ink">{text}</span>;

interface SignedLinkProps {
  userId: string;
  scope: string;
  token: string;
  /** e.g. "announcement emails" */
  label: string;
  email: string;
}

function SignedFields({ userId, scope, token }: Pick<SignedLinkProps, "userId" | "scope" | "token">) {
  return (
    <>
      <input type="hidden" name="u" value={userId} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="t" value={token} />
    </>
  );
}

/**
 * Landing page of a one-click unsubscribe link. Opening the link changes
 * nothing (mail scanners and prefetchers open links too); the member
 * confirms with a POST. Works without a session: the signed token travels
 * with the form.
 */
export function UnsubscribeConfirm({ userId, scope, token, label, email, subscribed }: SignedLinkProps & { subscribed: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(subscribed ? confirmUnsubscribeAction : resubscribeWithTokenAction, null);
  const t = useT("account");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <span className="rounded-full bg-accent/12 p-2.5 text-accent">
        <Icon.Mail className="size-6" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{subscribed ? t("settings.notifications.unsub.confirmTitle", { label }) : t("settings.notifications.unsub.alreadyTitle", { label })}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {subscribed
              ? t.rich("settings.notifications.unsub.confirmBody", { email, label, b: strong })
              : t.rich("settings.notifications.unsub.alreadyBody", { email, label, b: strong })}
          </p>
        </div>
        <FormError message={state && !state.ok ? state.error : null} />
        <form action={action}>
          <SignedFields userId={userId} scope={scope} token={token} />
          <Button type="submit" size="sm" variant={subscribed ? "primary" : "outline"} loading={pending} leftIcon={subscribed ? <Icon.XCircle className="size-4" /> : <Icon.Replay className="size-4" />}>
            {subscribed ? t("settings.notifications.unsub.unsubscribe") : t("settings.notifications.unsub.subscribeAgain")}
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Outcome of a signed unsubscribe (or its undo), shown on the token-free
 * result URL. The state comes from the database on every render, so it can
 * never disagree with what is stored; the button flips it (Undo /
 * Unsubscribe again).
 */
export function UnsubscribeResult({ userId, scope, token, label, email, subscribed }: SignedLinkProps & { subscribed: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(subscribed ? unsubscribeWithTokenAction : resubscribeWithTokenAction, null);
  const t = useT("account");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <span className={subscribed ? "rounded-full bg-success/12 p-2.5 text-success" : "rounded-full bg-accent/12 p-2.5 text-accent"}>
        {subscribed ? <Icon.CheckCircle className="size-6" /> : <Icon.Mail className="size-6" />}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div aria-live="polite">
          <h2 className="text-base font-semibold text-ink">{subscribed ? t("settings.notifications.unsub.subscribedTitle") : t("settings.notifications.unsub.unsubscribedTitle")}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {subscribed
              ? t.rich("settings.notifications.unsub.subscribedBody", { email, label, b: strong })
              : t.rich("settings.notifications.unsub.unsubscribedBody", { email, label, b: strong })}
          </p>
        </div>
        <FormError message={state && !state.ok ? state.error : null} />
        <form action={action}>
          <SignedFields userId={userId} scope={scope} token={token} />
          <Button type="submit" variant="outline" size="sm" loading={pending} leftIcon={subscribed ? <Icon.XCircle className="size-4" /> : <Icon.Replay className="size-4" />}>
            {subscribed ? t("settings.notifications.unsub.unsubscribeAgain") : t("settings.notifications.unsub.undo")}
          </Button>
        </form>
      </div>
    </div>
  );
}
