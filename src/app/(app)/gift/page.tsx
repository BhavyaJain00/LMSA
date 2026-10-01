import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { verificationError } from "@/lib/auth/verification";
import { getDb } from "@/lib/db/store";
import { getSavedBillingDetails, itemCurrencies, priceItemIn } from "@/lib/data/commerce";
import { buyerTaxContext, viewerCurrency } from "@/lib/commerce/buyer";
import { countryName } from "@/lib/commerce/tax";
import { isKnownCountry } from "@/components/commerce/countries";
import { CurrencySwitcher } from "@/components/commerce/currency-switcher";
import { gatewayMode, isConfigured } from "@/lib/payments/gateway";
import { legalLinks } from "@/lib/legal/links";
import { agreementDocuments } from "@/lib/legal/agreement";
import { deliverDueGiftsQuietly, getMyGifts, giftSummary, resolveGiftItem, type GiftRow } from "@/lib/commerce/gift-service";
import { parseGiftItemType } from "@/lib/commerce/gifts";
import { intervalNoun } from "@/lib/commerce/plans";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { NotPermitted } from "@/components/commerce/not-permitted";
import { GiftCheckoutForm } from "@/components/commerce/gift-checkout-form";
import { MyGiftsList, type GiftRowData } from "@/components/commerce/gifts-manager";

export const metadata = { title: "Gifts", robots: { index: false } };

function toData(r: GiftRow): GiftRowData {
  return {
    id: r.id,
    code: r.code,
    itemType: r.itemType,
    title: r.title,
    href: r.href,
    recipientEmail: r.recipientEmail,
    recipientName: r.recipientName,
    message: r.message,
    sendAt: r.sendAt,
    sentAt: r.sentAt,
    redeemedAt: r.redeemedAt,
    redeemedByName: r.redeemedByName,
    purchaserName: r.purchaserName,
    purchaserEmail: r.purchaserEmail,
    orderId: r.orderId,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: r.createdAt,
  };
}

/**
 * `/gift?type=course|bundle|plan&id=<id or slug>` is the gift checkout;
 * `/gift` alone lists the gifts the member bought and received.
 */
export default async function GiftPage(props: PageProps<"/gift">) {
  const sp = await props.searchParams;
  const type = parseGiftItemType(sp.type);
  const id = typeof sp.id === "string" ? sp.id.slice(0, 120) : "";
  const self = type && id ? `/gift?type=${type}&id=${encodeURIComponent(id)}` : "/gift";
  const user = await requireUser(self);
  await deliverDueGiftsQuietly();

  if (!type || !id) {
    const { sent, received } = await getMyGifts(user);
    return (
      <>
        <PageHeader
          title="Gifts"
          description="Courses, bundles and memberships you gave, and the gifts you received."
          actions={
            <ButtonLink href="/redeem" variant="outline" size="sm" leftIcon={<Icon.Ticket className="size-4" />}>
              Redeem a gift code
            </ButtonLink>
          }
        />
        <div className="space-y-8 pb-10">
          <section aria-labelledby="gifts-sent-heading">
            <h2 id="gifts-sent-heading" className="mb-3 text-base font-semibold text-ink">
              Gifts you gave
            </h2>
            {sent.length ? (
              <MyGiftsList rows={sent.map(toData)} />
            ) : (
              <EmptyState
                icon={<Icon.Gift />}
                title="You haven't given a gift yet"
                description="Open any paid course, bundle or membership plan and choose “Give as a gift”. We email the recipient a code on the day you pick."
                action={
                  <ButtonLink href="/courses" size="sm">
                    Browse courses
                  </ButtonLink>
                }
              />
            )}
          </section>
          {received.length > 0 && (
            <section aria-labelledby="gifts-received-heading">
              <h2 id="gifts-received-heading" className="mb-3 text-base font-semibold text-ink">
                Gifts for you
              </h2>
              <ul className="space-y-3">
                {received.map((g) => (
                  <li key={g.id} className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{g.title}</p>
                      <p className="text-sm text-ink-muted">From {g.purchaserName}</p>
                    </div>
                    {g.status === "redeemed" ? (
                      <ButtonLink href={g.href} variant="outline" size="sm" rightIcon={<Icon.ArrowRight className="size-4" />}>
                        Open
                      </ButtonLink>
                    ) : (
                      <ButtonLink href={`/redeem?code=${encodeURIComponent(g.code)}`} size="sm" leftIcon={<Icon.Gift className="size-4" />}>
                        Redeem
                      </ButtonLink>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </>
    );
  }

  const header = (title: string, href: string) => (
    <PageHeader title="Give as a gift" breadcrumbs={<Breadcrumbs items={[{ label: title, href }, { label: "Gift" }]} />} />
  );
  const check = await resolveGiftItem(type, id);
  if (!check.ok) {
    return (
      <>
        <PageHeader title="Give as a gift" />
        <NotPermitted message={check.error} actionHref="/courses" actionLabel="Browse courses" />
      </>
    );
  }
  const blocked = await verificationError(user);
  if (blocked) {
    return (
      <>
        {header(check.item.name, check.item.href)}
        <NotPermitted message={blocked} actionHref="/settings/security" actionLabel="Go to security settings" />
      </>
    );
  }

  const [db, links, saved, wantedCurrency] = await Promise.all([getDb(), legalLinks(), getSavedBillingDetails(user.id), viewerCurrency()]);
  const settings = db.settings;
  // Priced in the viewer's currency when the item has a fixed price in it; taxed for the billing country.
  const item = priceItemIn(check.item, wantedCurrency, settings);
  const currencies = itemCurrencies(check.item, settings);
  const pickedCountry = typeof sp.country === "string" && isKnownCountry(sp.country) ? sp.country : null;
  const tax = await buyerTaxContext(db, pickedCountry ?? saved?.address?.country);
  const guessedCountry = !pickedCountry && !saved?.address?.country && tax.country ? countryName(tax.country) : "";
  const formCountry = pickedCountry ?? saved?.address?.country ?? (isKnownCountry(guessedCountry) ? guessedCountry : "");
  const summary = giftSummary(item, settings, tax);
  const gateway = settings.commerce.paymentGateway;
  const what =
    item.plan && item.plan.interval !== "one_time"
      ? `1 ${intervalNoun(item.plan.interval)} of ${item.plan.name}. It doesn't renew, and the recipient can keep it going on their own afterwards.`
      : item.plan
        ? `Lifetime access with ${item.plan.name}.`
        : item.bundle
          ? "Every course of the bundle, theirs for good."
          : "The full course, theirs for good.";

  return (
    <>
      {header(item.name, item.href)}
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:order-last">
          <OrderSummary
            itemType="gift"
            title={item.title}
            subtitle={item.description}
            imageUrl={item.imageUrl}
            gradient={item.gradient}
            lines={{
              currency: summary.currency,
              originalAmount: summary.originalAmount,
              discountAmount: summary.discountAmount,
              taxAmount: summary.taxAmount,
              taxLabel: summary.taxLabel,
              taxPercentage: summary.taxPercentage,
              taxInclusive: summary.taxInclusive,
              total: summary.total,
              usdEquivalent: summary.usdEquivalent,
            }}
            footer={
              <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-ink-muted">
                <li className="flex items-start gap-2">
                  <Icon.Gift className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{what}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon.Mail className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span>The recipient gets an email with a single-use code. They redeem it with any account, new or existing.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon.Receipt className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span>The invoice is yours; the recipient never sees the price.</span>
                </li>
              </ul>
            }
          />
          {currencies.length > 1 && <CurrencySwitcher currencies={currencies} current={summary.currency} />}
          <p className="text-xs text-ink-muted">
            Already have a code?{" "}
            <Link href="/redeem" className="font-medium text-accent hover:underline">
              Redeem it here
            </Link>
            .
          </p>
        </aside>
        <div className="min-w-0">
          <GiftCheckoutForm
            giftType={type}
            itemId={item.id}
            expectedTotal={summary.total}
            currency={summary.currency}
            repriceOnCountry={settings.growth.taxMode === "by_country"}
            totalLabel={money(summary.total, summary.currency)}
            gateway={gateway}
            gatewayReady={isConfigured(gateway)}
            gatewayMode={gatewayMode(gateway)}
            applyTax={settings.commerce.applyTax}
            taxLabel={settings.commerce.taxLabel}
            contactEmail={settings.contact.email}
            legal={agreementDocuments("checkout", links)}
            defaults={{
              billingName: saved?.billingName ?? user.name,
              line1: saved?.address?.line1 ?? "",
              line2: saved?.address?.line2 ?? "",
              city: saved?.address?.city ?? "",
              state: saved?.address?.state ?? "",
              country: formCountry,
              pincode: saved?.address?.pincode ?? "",
              gstin: saved?.gstin ?? "",
              pan: saved?.pan ?? "",
              source: saved?.source ?? "",
            }}
          />
        </div>
      </div>
    </>
  );
}
