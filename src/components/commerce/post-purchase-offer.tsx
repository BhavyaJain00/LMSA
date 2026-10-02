"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acceptUpsellAction } from "@/lib/actions/upsells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { launchStatusLabel, useCheckoutLauncher, usePreloadRazorpay } from "./checkout-launcher";
import { useT } from "@/i18n/client";

export interface PostPurchaseOfferView {
  orderId: string;
  headline: string;
  title: string;
  description?: string;
  href: string;
  imageUrl?: string;
  priceLabel: string;
  /** Price without the upsell discount, when it is higher. */
  listPriceLabel: string | null;
  discountPercent: number;
  gateway: string;
}

const GATEWAY_NAME: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

/**
 * One-click offer on the order page after a purchase: places the order for
 * the offer with the billing details just used, then pays it the usual way
 * (no form to fill again). "No thanks" hides it for this visit.
 */
export function PostPurchaseOffer({ offer }: { offer: PostPurchaseOfferView }) {
  const toast = useToast();
  const t = useT("account");
  const launcher = useCheckoutLauncher();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  usePreloadRazorpay(offer.gateway === "razorpay");
  if (hidden) return null;
  const busy = pending || launcher.busy;
  const status = launchStatusLabel(launcher.status, GATEWAY_NAME[offer.gateway] ?? null, t);

  const accept = () =>
    startTransition(async () => {
      const res = await acceptUpsellAction(offer.orderId);
      if (!res.ok) {
        toast.error(t("commerce.offer.addFailed"), res.error);
        return;
      }
      if (res.message) toast.success(res.message);
      await launcher.launch(res.data);
    });

  return (
    <section aria-labelledby="upsell-heading" className="overflow-hidden rounded-card border-2 border-accent/40 bg-surface-1 shadow-card">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-accent/20 to-success/15 sm:w-40">
          {offer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded or external course art
            <img src={offer.imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-accent">
              <Icon.Sparkles className="size-8" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" size="sm">
              {t("commerce.offer.justForYou")}
            </Badge>
            {offer.discountPercent > 0 && (
              <Badge tone="success" size="sm">
                {t("commerce.offer.percentOff", { percent: offer.discountPercent })}
              </Badge>
            )}
          </div>
          <h2 id="upsell-heading" className="mt-2 text-lg font-semibold tracking-tight text-ink">
            {offer.headline}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            <Link href={offer.href} className="font-medium text-ink hover:text-accent hover:underline">
              {offer.title}
            </Link>
            {offer.description ? ` · ${offer.description}` : ""}
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-semibold tabular-nums text-ink">{offer.priceLabel}</span>
            {offer.listPriceLabel && (
              <span className="text-sm tabular-nums text-ink-muted line-through">
                <span className="sr-only">{t("commerce.offer.usually")} </span>
                {offer.listPriceLabel}
              </span>
            )}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={accept} loading={busy} leftIcon={<Icon.Plus className="size-4" />}>
              {t("commerce.offer.accept", { price: offer.priceLabel })}
            </Button>
            <Button variant="ghost" onClick={() => setHidden(true)} disabled={busy}>
              {t("commerce.offer.noThanks")}
            </Button>
          </div>
          {status ? (
            <p className="mt-2 text-xs text-ink-muted" role="status" aria-live="polite">
              {status}
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">{t("commerce.offer.note")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
