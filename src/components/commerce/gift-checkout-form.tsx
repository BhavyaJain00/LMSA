"use client";

import { useState } from "react";
import { placeGiftOrderAction } from "@/lib/actions/gifts";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { BillingForm, type BillingDefaults } from "./billing-form";
import type { AgreementLink } from "@/lib/legal/agreement";
import type { Settings } from "@/lib/types";
import type { GiftItemType } from "@/lib/commerce/gifts";

const MESSAGE_MAX = 600;

/** `YYYY-MM-DD` of a date in the viewer's own time zone. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 9:00 in the viewer's time zone on `day` (YYYY-MM-DD), as an ISO time, or "" when invalid. */
function morningOf(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
  return Number.isFinite(at.getTime()) ? at.toISOString() : "";
}

/** Recipient section of the gift checkout, shown above the buyer's billing address. */
function RecipientFields({ errors, giftType, itemId }: { errors: Record<string, string>; giftType: GiftItemType; itemId: string }) {
  const [when, setWhen] = useState<"now" | "later">("now");
  const [day, setDay] = useState("");
  const [message, setMessage] = useState("");
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const lastDay = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
  // A date must be picked for "later": an unparseable value makes the server ask for one.
  const sendAt = when === "later" ? morningOf(day) || "no-date" : "";

  return (
    <fieldset className="rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
      <input type="hidden" name="giftType" value={giftType} />
      <input type="hidden" name="sendAt" value={sendAt} />
      <legend className="sr-only">Who is the gift for?</legend>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Icon.Gift className="size-5 text-accent" aria-hidden="true" />
        Who is the gift for?
      </h2>
      <p className="mt-1 text-sm text-ink-muted">We email them a personal gift card with a code to redeem it. You can change the details until it is sent.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Recipient's name" htmlFor="recipientName" error={errors.recipientName}>
          <Input id="recipientName" name="recipientName" maxLength={80} autoComplete="off" invalid={!!errors.recipientName} />
        </Field>
        <Field label="Recipient's email" htmlFor="recipientEmail" error={errors.recipientEmail} required>
          <Input id="recipientEmail" name="recipientEmail" type="email" inputMode="email" maxLength={254} autoComplete="off" invalid={!!errors.recipientEmail} />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Personal message" htmlFor="message" error={errors.message} hint={errors.message ? undefined : `${message.length}/${MESSAGE_MAX} · Optional, shown in the gift email.`}>
          <Textarea id="message" name="message" rows={3} maxLength={MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} invalid={!!errors.message} />
        </Field>
      </div>
      <div className="mt-4" role="radiogroup" aria-labelledby={`gift-when-${itemId}`}>
        <p id={`gift-when-${itemId}`} className="text-sm font-medium text-ink">
          When should we send it?
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["now", "later"] as const).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${when === option ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2"}`}
            >
              <input type="radio" name="giftWhen" value={option} checked={when === option} onChange={() => setWhen(option)} className="mt-0.5 size-4 accent-accent" />
              <span>
                <span className="block font-medium text-ink">{option === "now" ? "Right after payment" : "On a date I choose"}</span>
                <span className="block text-xs text-ink-muted">{option === "now" ? "Perfect for a last-minute gift." : "Birthdays, holidays, graduations…"}</span>
              </span>
            </label>
          ))}
        </div>
        {when === "later" && (
          <div className="mt-3 max-w-xs">
            <Field label="Send on" htmlFor="giftDay" error={errors.sendAt} hint={errors.sendAt ? undefined : "Delivered around 9:00 in your time zone."} required>
              <Input id="giftDay" type="date" value={day} min={localDateKey(tomorrow)} max={localDateKey(lastDay)} onChange={(e) => setDay(e.target.value)} invalid={!!errors.sendAt} />
            </Field>
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** Gift checkout: recipient details, then the buyer's billing details and payment. */
export function GiftCheckoutForm({
  giftType,
  itemId,
  expectedTotal,
  currency,
  repriceOnCountry,
  totalLabel,
  gateway,
  gatewayReady,
  gatewayMode,
  applyTax,
  taxLabel,
  defaults,
  contactEmail,
  legal,
}: {
  giftType: GiftItemType;
  itemId: string;
  expectedTotal: number;
  /** Currency the gift was priced in. */
  currency: string;
  /** By-country tax: picking another country re-prices the summary. */
  repriceOnCountry: boolean;
  totalLabel: string;
  gateway: Settings["commerce"]["paymentGateway"];
  gatewayReady: boolean;
  gatewayMode: "test" | "live" | null;
  applyTax: boolean;
  taxLabel: string;
  defaults: BillingDefaults;
  contactEmail?: string;
  legal: AgreementLink[];
}) {
  return (
    <BillingForm
      itemType="gift"
      itemId={itemId}
      couponCode=""
      currency={currency}
      repriceOnCountry={repriceOnCountry}
      expectedTotal={expectedTotal}
      totalLabel={totalLabel}
      gateway={gateway}
      gatewayReady={gatewayReady}
      gatewayMode={gatewayMode}
      applyTax={applyTax}
      taxLabel={taxLabel}
      defaults={defaults}
      contactEmail={contactEmail}
      legal={legal}
      action={placeGiftOrderAction}
      gift
      extraFields={(errors) => <RecipientFields errors={errors} giftType={giftType} itemId={itemId} />}
    />
  );
}
