import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getRequestInfo } from "@/lib/auth/request-info";
import { getSettings } from "@/lib/db/store";
import { deliverDueGiftsQuietly, lookupGift, type GiftPreview } from "@/lib/commerce/gift-service";
import { GIFT_STATUS_LABELS, normalizeGiftCode } from "@/lib/commerce/gifts";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { RedeemGiftForm } from "@/components/commerce/redeem-gift-form";

export const metadata = { title: "Redeem a gift", robots: { index: false } };

const ITEM_NOUN: Record<GiftPreview["itemType"], string> = { course: "course", bundle: "course bundle", plan: "membership" };

function GiftCard({ gift }: { gift: GiftPreview }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <div className="relative flex aspect-[16/7] items-center justify-center bg-gradient-to-br from-accent/25 via-accent/10 to-success/15">
        {gift.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded or external course art
          <img src={gift.imageUrl} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
        ) : (
          <Icon.Gift className="size-14 text-accent" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-3 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">A gift from {gift.fromName}</p>
        <h2 className="text-xl font-semibold tracking-tight text-ink">{gift.title}</h2>
        <p className="text-sm text-ink-muted">{gift.contents}</p>
        {gift.message && (
          <blockquote className="border-l-2 border-accent/50 pl-3 text-sm italic text-ink">
            “{gift.message}”
            <footer className="mt-1 not-italic text-xs text-ink-muted">— {gift.fromName}</footer>
          </blockquote>
        )}
      </div>
    </div>
  );
}

/**
 * `/redeem?code=GIFT-…`: the link in the gift email. Visitors are asked to
 * log in or sign up first (with any email address); members see the gift
 * and redeem it with one click, or type a code by hand.
 */
export default async function RedeemPage(props: PageProps<"/redeem">) {
  const sp = await props.searchParams;
  const raw = typeof sp.code === "string" ? sp.code.slice(0, 40) : "";
  const code = normalizeGiftCode(raw);
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const self = code ? `/redeem?code=${encodeURIComponent(code)}` : "/redeem";

  if (!user) {
    return (
      <>
        <PageHeader title="Redeem a gift" />
        <div className="mx-auto my-8 w-full max-w-md rounded-card border border-border bg-surface-1 p-6 text-center shadow-card sm:my-16">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Icon.Gift className="size-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">Someone sent you a gift</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Log in or create a free {settings.brand.name} account to see it and redeem it. Any email address works, it doesn&apos;t have to be the one the gift was sent to.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <ButtonLink href={`/register?next=${encodeURIComponent(self)}`}>Create an account</ButtonLink>
            <ButtonLink href={`/login?next=${encodeURIComponent(self)}`} variant="outline">
              Log in
            </ButtonLink>
          </div>
        </div>
      </>
    );
  }

  await deliverDueGiftsQuietly();
  const { ip } = await getRequestInfo();
  const found = raw ? await lookupGift(raw, user, ip) : { preview: null, error: null };
  const gift = found.preview;

  return (
    <>
      <PageHeader title="Redeem a gift" description="Unlock a course, bundle or membership someone gave you." />
      <div className="mx-auto w-full max-w-lg space-y-5 pb-10">
        {gift ? (
          <>
            <GiftCard gift={gift} />
            <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
              {gift.redeemable ? (
                <>
                  <p className="mb-4 text-sm text-ink-muted">
                    Redeem it to add this {ITEM_NOUN[gift.itemType]} to <strong className="text-ink">your account ({user.email})</strong>. The code works once.
                  </p>
                  <RedeemGiftForm fixedCode={gift.code} label={`Redeem ${ITEM_NOUN[gift.itemType]}`} />
                </>
              ) : gift.mine ? (
                <div className="space-y-3">
                  <p role="status" className="flex items-start gap-2 text-sm text-ink">
                    <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    You redeemed this gift. It&apos;s in your account.
                  </p>
                  <ButtonLink href={gift.href} className="w-full" rightIcon={<Icon.ArrowRight className="size-4" />}>
                    {gift.itemType === "plan" ? "Browse courses" : "Start learning"}
                  </ButtonLink>
                </div>
              ) : (
                <p role="status" className="flex items-start gap-2 text-sm text-ink">
                  <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  {gift.status === "redeemed"
                    ? "This gift code was already used."
                    : gift.status === "refunded"
                      ? "This gift was refunded, so the code no longer works."
                      : gift.status === "awaiting_payment"
                        ? "This gift isn't paid yet. The code works once the payment is confirmed."
                        : `This gift can't be redeemed (${GIFT_STATUS_LABELS[gift.status].toLowerCase()}).`}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent/12 text-accent">
                <Icon.Ticket className="size-5" aria-hidden="true" />
              </span>
              <p className="text-sm text-ink-muted">Enter the code from your gift email to add the gift to your account.</p>
            </div>
            {found.error && (
              <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink">
                <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                {found.error}
              </p>
            )}
            <RedeemGiftForm defaultCode={raw} />
          </div>
        )}
        <p className="text-center text-sm text-ink-muted">
          Want to give one yourself? Open a course, bundle or{" "}
          <Link href="/pricing" className="font-medium text-accent hover:underline">
            membership plan
          </Link>{" "}
          and choose “Give as a gift”. Your gifts are on the{" "}
          <Link href="/gift" className="font-medium text-accent hover:underline">
            gifts page
          </Link>
          .
        </p>
      </div>
    </>
  );
}
