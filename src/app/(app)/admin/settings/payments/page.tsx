import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { getGatewayStatuses } from "@/lib/payments/gateway";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { PaymentsForm } from "@/components/admin/settings/payments-form";
import { PaymentGatewaysPanel } from "@/components/admin/settings/payment-gateways-panel";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.payments.metaTitle") };
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".local");
  } catch {
    return true;
  }
}

export default async function PaymentSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/payments");
  const settings = await getSettings();
  // Secrets never leave the server: the statuses only carry masked keys and booleans.
  const gateways = getGatewayStatuses();
  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.payments.title")}
        description={t.rich("pages.settings.payments.description", {
          transactions: (chunks) => (
            <Link href="/admin/settings/transactions" className="font-medium text-accent hover:underline">
              {chunks}
            </Link>
          ),
          coupons: (chunks) => (
            <Link href="/admin/settings/coupons" className="font-medium text-accent hover:underline">
              {chunks}
            </Link>
          ),
        })}
      />
      <div className="space-y-6">
        <PaymentGatewaysPanel gateways={gateways} activeGateway={settings.commerce.paymentGateway} localAppUrl={isLocalUrl(siteConfig.appUrl)} />
        <PaymentsForm initial={settings.commerce} gateways={gateways} />
      </div>
    </>
  );
}
