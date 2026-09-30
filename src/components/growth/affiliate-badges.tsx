import type { Affiliate, Commission } from "@/lib/types";
import { FRAUD_FLAG_LABELS, type FraudFlag } from "@/lib/growth/affiliates-shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { money } from "@/components/commerce/order-summary";

/** Shared presentational pieces of the affiliate pages (server and client safe). */

const COMMISSION_TONES: Record<Commission["status"], BadgeTone> = {
  pending: "warning",
  approved: "info",
  paid: "success",
  void: "neutral",
};

const COMMISSION_LABELS: Record<Commission["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  void: "Void",
};

export function CommissionStatusBadge({ status }: { status: Commission["status"] }) {
  return (
    <Badge tone={COMMISSION_TONES[status]} dot>
      {COMMISSION_LABELS[status]}
    </Badge>
  );
}

const AFFILIATE_TONES: Record<Affiliate["status"], BadgeTone> = { pending: "warning", active: "success", paused: "neutral" };
const AFFILIATE_LABELS: Record<Affiliate["status"], string> = { pending: "Awaiting review", active: "Active", paused: "Paused" };

export function AffiliateStatusBadge({ status }: { status: Affiliate["status"] }) {
  return (
    <Badge tone={AFFILIATE_TONES[status]} dot>
      {AFFILIATE_LABELS[status]}
    </Badge>
  );
}

export function FraudFlagBadges({ flags }: { flags: readonly FraudFlag[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} tone="danger" size="xs" title="Possible self-referral: review before approving">
          <Icon.AlertTriangle className="size-3" aria-hidden="true" />
          {FRAUD_FLAG_LABELS[flag]}
        </Badge>
      ))}
    </span>
  );
}

/** Amounts in several currencies, e.g. "$120.00 + €40.00" (or a zero amount in `fallbackCurrency`). */
export function moneyList(rows: readonly { currency: string; amount: number }[], fallbackCurrency: string): string {
  const shown = rows.filter((r) => r.amount !== 0);
  return shown.length ? shown.map((r) => money(r.amount, r.currency)).join(" + ") : money(0, fallbackCurrency);
}
