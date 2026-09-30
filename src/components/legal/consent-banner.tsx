"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { recordConsentAction } from "@/lib/actions/privacy";
import { CONSENT_OPEN_EVENT } from "@/lib/legal/consent-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { onConsentChange, setConsent, type ConsentState } from "./consent-client";

export interface ConsentBannerProps {
  /** `settings.legal.cookieBanner` */
  enabled: boolean;
  /** Decision read from the `ll_consent` cookie on the server (avoids a banner flash). */
  initialConsent: ConsentState;
  /** The published cookie policy (or privacy policy), when there is one. */
  policy?: { href: string; title: string };
}

type Choice = Pick<ConsentState, "analytics" | "marketing">;

const CATEGORIES: { key: keyof Choice; title: string; description: string }[] = [
  {
    key: "analytics",
    title: "Analytics",
    description: "Help us understand which pages and lessons are useful and where learners get stuck (for example Google Analytics).",
  },
  {
    key: "marketing",
    title: "Marketing",
    description: "Measure how our ads perform and show you relevant offers on other sites (for example the Meta Pixel).",
  },
];

const REJECT_ALL: Choice = { analytics: false, marketing: false };
const ACCEPT_ALL: Choice = { analytics: true, marketing: true };

/**
 * Cookie-consent banner and preferences dialog (rendered by `ConsentManager`
 * in the root layout).
 *
 * - The banner is a fixed, non-modal region at the bottom of the screen
 *   (nothing on the page moves) with equally weighted "Accept all" and
 *   "Reject non-essential" buttons and a "Customize" option.
 * - `<CookieSettingsLink />` anywhere on the site reopens the dialog, even
 *   when the banner is switched off in the legal settings.
 * - The decision is stored in the `ll_consent` cookie for a year and, as
 *   evidence, in a `ConsentRecord` on the server. Optional tags listen with
 *   `onConsentChange()`; undecided means everything optional stays off.
 */
export function ConsentBanner({ enabled, initialConsent, policy }: ConsentBannerProps) {
  const [consent, setConsentState] = useState<ConsentState>(initialConsent);
  const [bannerOpen, setBannerOpen] = useState(enabled && !initialConsent.decided);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Choice>({ analytics: initialConsent.analytics, marketing: initialConsent.marketing });
  const customizeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Latest decision for the stable "open" handler (the draft always starts from what is in force).
  const consentRef = useRef(consent);
  useEffect(() => {
    consentRef.current = consent;
  }, [consent]);

  const openDialog = useCallback(() => {
    setDraft({ analytics: consentRef.current.analytics, marketing: consentRef.current.marketing });
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(CONSENT_OPEN_EVENT, openDialog);
    const unsubscribe = onConsentChange((next) => {
      setConsentState(next);
      setDraft({ analytics: next.analytics, marketing: next.marketing });
      if (next.decided) setBannerOpen(false);
    });
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, openDialog);
      unsubscribe();
    };
  }, [openDialog]);

  const decide = (choice: Choice) => {
    setConsent(choice);
    setBannerOpen(false);
    setDialogOpen(false);
    // Evidence only: the choice already applies in this browser, so failures are not shown.
    void recordConsentAction(choice).catch(() => undefined);
  };

  const closeDialog = () => {
    setDraft({ analytics: consent.analytics, marketing: consent.marketing });
    setDialogOpen(false);
    // Opened from the banner: its "Customize" button unmounted while the dialog was open, so hand focus back to it.
    if (bannerOpen) requestAnimationFrame(() => customizeRef.current?.focus());
  };

  const policyLink = policy && (
    <Link href={policy.href} className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => setDialogOpen(false)}>
      Read the {policy.title}
    </Link>
  );

  return (
    <>
      {bannerOpen && !dialogOpen && (
        <section
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-60 p-3 sm:p-4 print:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="pointer-events-auto mx-auto max-h-[70vh] max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-4 text-ink shadow-pop sm:p-5">
            <div className="flex gap-3">
              <span className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent sm:flex">
                <Icon.ShieldCheck className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 id={titleId} className="text-sm font-semibold">
                  Your privacy choices
                </h2>
                <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                  We use essential cookies to keep you signed in and the site secure. With your permission we&apos;d also like to use analytics and marketing cookies.{" "}
                  {policyLink}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:flex sm:items-center sm:justify-end">
              <Button ref={customizeRef} variant="ghost" size="sm" onClick={openDialog} aria-haspopup="dialog">
                Customize
              </Button>
              <Button variant="secondary" size="sm" onClick={() => decide(REJECT_ALL)}>
                Reject non-essential
              </Button>
              <Button variant="secondary" size="sm" onClick={() => decide(ACCEPT_ALL)}>
                Accept all
              </Button>
            </div>
          </div>
        </section>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title="Cookie settings"
        description="Choose which optional cookies we may use. You can change this at any time from the “Cookie settings” link."
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" size="sm" onClick={() => decide(REJECT_ALL)}>
              Reject non-essential
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" size="sm" onClick={() => decide(draft)}>
                Save choices
              </Button>
              <Button size="sm" onClick={() => decide(ACCEPT_ALL)}>
                Accept all
              </Button>
            </div>
          </div>
        }
      >
        <ul className="divide-y divide-border">
          <li className="flex items-start justify-between gap-4 pb-4">
            <div>
              <p className="text-sm font-medium text-ink">Strictly necessary</p>
              <p className="text-xs text-ink-muted">Sign-in, security, your theme and this cookie choice. The site can&apos;t work without them, so they are always on.</p>
            </div>
            <Badge tone="neutral" className="shrink-0">
              Always on
            </Badge>
          </li>
          {CATEGORIES.map((category) => (
            <li key={category.key} className="py-4 last:pb-0">
              <Switch
                id={`consent-${category.key}`}
                checked={draft[category.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [category.key]: e.target.checked }))}
                label={category.title}
                description={category.description}
              />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-faint" aria-live="polite">
          {consent.decided
            ? `Current choice: analytics ${consent.analytics ? "on" : "off"}, marketing ${consent.marketing ? "on" : "off"}.`
            : "You haven't chosen yet, so only strictly necessary cookies are used."}
        </p>
        {policyLink && <p className="mt-2 text-xs">{policyLink}</p>}
      </Dialog>
    </>
  );
}
