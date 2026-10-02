"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmRazorpayMembershipAction, confirmRazorpayPaymentAction } from "@/lib/actions/payments";
import type { CheckoutNext, RazorpayLaunchOptions } from "@/lib/payments/types";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/catalog";
import type { Translator } from "@/i18n/translate";

/**
 * Client side of checkout: follows the server's `CheckoutNext` instruction —
 * a redirect (Stripe's hosted page, or an internal page) or the Razorpay
 * Checkout modal. Razorpay's script is only loaded when a Razorpay payment
 * is actually about to happen.
 */

const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_payment_id: string;
  /** One-time payments. */
  razorpay_order_id?: string;
  /** Membership checkouts (a Razorpay subscription is authorized instead of an order). */
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: { code?: string; description?: string; reason?: string; metadata?: { order_id?: string; payment_id?: string } };
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: RazorpayFailure) => void): void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let razorpayLoader: Promise<RazorpayConstructor> | null = null;

/** Load Razorpay Checkout once per page (deduplicated, retried after a failure). */
export function loadRazorpayScript(): Promise<RazorpayConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Razorpay can only load in the browser."));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (razorpayLoader) return razorpayLoader;
  razorpayLoader = new Promise<RazorpayConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const fail = () => {
      razorpayLoader = null;
      script.remove();
      reject(new Error("Razorpay Checkout could not be loaded. Check your connection or disable content blockers, then try again."));
    };
    script.addEventListener("load", () => (window.Razorpay ? resolve(window.Razorpay) : fail()), { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = RAZORPAY_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return razorpayLoader;
}

/** Preload Razorpay Checkout while the learner fills in the form (only when Razorpay is the gateway). */
export function usePreloadRazorpay(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    loadRazorpayScript().catch(() => undefined);
  }, [enabled]);
}

export type LaunchStatus = "idle" | "redirecting" | "paying" | "verifying";

export function useCheckoutLauncher() {
  const toast = useToast();
  const t = useT("account");
  const router = useRouter();
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const settledRef = useRef(false);

  // Coming back from Stripe with the browser's back button restores this page from the
  // back/forward cache: the buttons must not stay stuck in "Redirecting…".
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setStatus("idle");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  /** External URLs (Stripe Checkout) need a full page load; app pages use the router and refresh server data. */
  const navigate = useCallback(
    (url: string) => {
      if (/^https?:\/\//i.test(url)) {
        setStatus("redirecting");
        window.location.assign(url);
        return;
      }
      router.push(url);
      router.refresh();
      setStatus("idle");
    },
    [router],
  );

  const openRazorpay = useCallback(
    async (options: RazorpayLaunchOptions) => {
      let Razorpay: RazorpayConstructor;
      try {
        Razorpay = await loadRazorpayScript();
      } catch (error) {
        toast.error(t("global.checkout.couldNotStart"), error instanceof Error ? t("global.checkout.scriptFailed") : undefined);
        setStatus("idle");
        return;
      }
      settledRef.current = false;
      setStatus("paying");
      const cancelledUrl = `/billing/cancelled?order=${encodeURIComponent(options.orderId)}`;
      const membership = !!options.razorpaySubscriptionId;
      const rzp = new Razorpay({
        key: options.keyId,
        // A subscription carries its own amount and currency (from its Razorpay plan).
        ...(membership
          ? { subscription_id: options.razorpaySubscriptionId }
          : { amount: options.amount, currency: options.currency, order_id: options.razorpayOrderId }),
        name: options.name,
        description: options.description,
        image: options.image,
        prefill: { name: options.prefill.name, email: options.prefill.email },
        notes: { orderId: options.orderId },
        theme: options.themeColor ? { color: options.themeColor } : undefined,
        modal: {
          escape: true,
          confirm_close: true,
          ondismiss: () => {
            if (settledRef.current) return;
            settledRef.current = true;
            navigate(cancelledUrl);
          },
        },
        handler: (response: RazorpaySuccess) => {
          settledRef.current = true;
          setStatus("verifying");
          void (async () => {
            try {
              const res = membership
                ? await confirmRazorpayMembershipAction({
                    orderId: options.orderId,
                    razorpaySubscriptionId: response.razorpay_subscription_id ?? options.razorpaySubscriptionId ?? "",
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                  })
                : await confirmRazorpayPaymentAction({
                    orderId: options.orderId,
                    razorpayOrderId: response.razorpay_order_id ?? "",
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                  });
              if (res.ok) {
                if (res.message) toast.success(res.message);
                navigate(res.data.redirectTo);
                return;
              }
              toast.error(t("global.checkout.confirmFailed"), res.error);
            } catch {
              toast.error(t("global.checkout.confirmFailed"), t("global.checkout.confirmFailedBody"));
            }
            navigate(`/billing/success/${encodeURIComponent(options.orderId)}`);
          })();
        },
      });
      rzp.on("payment.failed", (response) => {
        const description = response.error?.description;
        toast.error(t("global.checkout.failed"), description ? t("global.checkout.failedBody", { reason: description }) : t("global.checkout.failedBodyGeneric"));
      });
      rzp.open();
    },
    [toast, navigate, t],
  );

  const launch = useCallback(
    async (next: CheckoutNext) => {
      if (next.kind === "redirect") {
        navigate(next.url);
        return;
      }
      await openRazorpay(next.options);
    },
    [openRazorpay, navigate],
  );

  const reset = useCallback(() => setStatus("idle"), []);

  return { launch, status, busy: status !== "idle", reset };
}

/** What the checkout is doing, in the active language. `gatewayName` is a brand name ("Stripe") or null. */
export function launchStatusLabel(status: LaunchStatus, gatewayName: string | null, t: Translator<MessageKey<"account">>): string | null {
  switch (status) {
    case "redirecting":
      return gatewayName ? t("global.checkout.redirecting", { gateway: gatewayName }) : t("global.checkout.redirectingGeneric");
    case "paying":
      return gatewayName ? t("global.checkout.paying", { gateway: gatewayName }) : t("global.checkout.payingGeneric");
    case "verifying":
      return t("global.checkout.verifying");
    default:
      return null;
  }
}
