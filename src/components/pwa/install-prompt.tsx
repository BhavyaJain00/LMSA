"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { PwaIcon } from "./icons";
import {
  DISMISS_DAYS,
  dismissInstallCard,
  getDismissed,
  getInstallPrompt,
  getServerInstallPrompt,
  getStandalone,
  isIosSafari,
  isIpad,
  promptInstall,
  subscribeDismissed,
  subscribeInstallPrompt,
  subscribeStandalone,
} from "./install-store";

/** Screens where a floating card would get in the way (player, quiz, checkout, offline). */
const HIDDEN_ON = [/^\/offline(\/|$)/, /^\/courses\/[^/]+\/learn(\/|$)/, /^\/quiz(\/|$)/, /^\/billing(\/|$)/, /^\/exercises\/[^/]+$/];

const IOS_DELAY_MS = 4000;

const noopSubscribe = () => () => {};

function useIosEligible(): boolean {
  return useSyncExternalStore(noopSubscribe, isIosSafari, () => false);
}

/**
 * Install card:
 *  - Chromium browsers: shown when the browser offers installation
 *    (`beforeinstallprompt`), with an Install button that opens the native dialog.
 *  - iPhone / iPad Safari: explains Share → Add to Home Screen.
 * Hidden when running installed, for 14 days after "Not now", and on
 * focus-heavy screens.
 */
export function InstallPrompt({ appName }: { appName: string }) {
  const pathname = usePathname() ?? "/";
  const toast = useToast();
  const titleId = useId();
  const deferred = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, getServerInstallPrompt);
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => true);
  const dismissed = useSyncExternalStore(subscribeDismissed, getDismissed, () => true);
  const ios = useIosEligible();
  const [iosReady, setIosReady] = useState(false);
  const [installing, setInstalling] = useState(false);

  const hiddenHere = HIDDEN_ON.some((re) => re.test(pathname));
  const iosEligible = ios && !standalone && !dismissed;

  useEffect(() => {
    if (!iosEligible) return;
    const timer = window.setTimeout(() => setIosReady(true), IOS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [iosEligible]);

  if (standalone || dismissed || hiddenHere) return null;
  const mode: "native" | "ios" | null = deferred ? "native" : iosEligible && iosReady ? "ios" : null;
  if (!mode) return null;

  const dismiss = () => {
    dismissInstallCard();
    toast.toast({ title: "Okay, we won't ask again for a while", description: `You can install ${appName} from your browser menu at any time.`, tone: "neutral" });
  };

  const install = async () => {
    setInstalling(true);
    const outcome = await promptInstall();
    setInstalling(false);
    if (outcome === "accepted") toast.success(`${appName} is being installed`, "Open it from your home screen or app list.");
    else if (outcome === "dismissed") dismissInstallCard(DISMISS_DAYS);
  };

  return (
    <aside
      aria-labelledby={titleId}
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md animate-fade-in rounded-card border border-border bg-surface-1 p-4 shadow-pop sm:inset-x-auto sm:end-4 sm:bottom-4 sm:start-auto sm:w-96 lg:bottom-4 print:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <PwaIcon.AppWindow className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {mode === "ios" ? `Add ${appName} to your ${isIpad() ? "iPad" : "iPhone"}` : `Install ${appName}`}
          </h2>
          {mode === "native" ? (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
              Open it from your home screen or desktop like any app, in its own window, with an offline page when your connection drops.
            </p>
          ) : (
            <ol className="mt-1.5 space-y-1.5 text-xs text-ink-muted">
              <li className="flex items-center gap-1.5">
                <span className="font-medium text-ink">1.</span> Tap
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-medium text-ink">
                  <PwaIcon.Share className="size-3.5 text-info" /> Share
                </span>
                in the toolbar
              </li>
              <li className="flex items-center gap-1.5">
                <span className="font-medium text-ink">2.</span> Choose
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-medium text-ink">
                  <PwaIcon.PlusSquare className="size-3.5" /> Add to Home Screen
                </span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="font-medium text-ink">3.</span> Tap <span className="font-medium text-ink">Add</span>
              </li>
            </ol>
          )}
          <div className="mt-3 flex items-center gap-2">
            {mode === "native" ? (
              <>
                <Button size="sm" onClick={() => void install()} loading={installing} leftIcon={<Icon.Download className="size-4" />}>
                  Install
                </Button>
                <Button size="sm" variant="ghost" onClick={dismiss}>
                  Not now
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => dismissInstallCard()}>
                Got it
              </Button>
            )}
          </div>
        </div>
        <IconButton label="Close" size="icon-sm" onClick={() => dismissInstallCard()} className="-mt-1 -mr-1 shrink-0">
          <Icon.X className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}
