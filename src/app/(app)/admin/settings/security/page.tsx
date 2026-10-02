import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { hasStaffRole, isAccountLocked, isEmailVerified, isTwoFactorActive } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SecuritySettingsForm } from "@/components/admin/settings/security-settings-form";
import { percent } from "@/lib/utils";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.security.metaTitle") };
}

export default async function SecuritySettingsAdminPage() {
  const t = await getT("admin");
  const admin = await requireRole(["admin"], "/admin/settings/security");
  const [db, f] = await Promise.all([getDb(), getFormatter()]);
  const formatNumber = (n: number) => f.number(n);
  const users = db.users.filter((u) => u.enabled);
  const staff = users.filter(hasStaffRole);
  const withTwoFactor = users.filter(isTwoFactorActive).length;
  const staffWithTwoFactor = staff.filter(isTwoFactorActive).length;
  const unverified = users.filter((u) => !isEmailVerified(u)).length;
  const locked = db.users.filter((u) => isAccountLocked(u)).length;

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.security.title")}
        description={t("pages.settings.security.description")}
        actions={
          <ButtonLink href="/admin/security" variant="outline" size="sm" leftIcon={<Icon.Shield className="size-4" />}>
            {t("pages.settings.security.loginActivity")}
          </ButtonLink>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label={t("pages.settings.security.stats.twoFactor")}
          value={f.percent(percent(withTwoFactor, users.length))}
          hint={t("pages.settings.security.stats.twoFactorHint", { count: withTwoFactor, total: users.length })}
          icon={<Icon.ShieldCheck className="size-5" />}
        />
        <StatCard
          label={t("pages.settings.security.stats.staff")}
          value={`${formatNumber(staffWithTwoFactor)}/${formatNumber(staff.length)}`}
          hint={t("pages.settings.security.stats.staffHint")}
          icon={<Icon.Users className="size-5" />}
        />
        <StatCard label={t("pages.settings.security.stats.unverified")} value={formatNumber(unverified)} hint={t("pages.settings.security.stats.unverifiedHint")} icon={<Icon.Mail className="size-5" />} />
        <StatCard
          label={t("pages.settings.security.stats.locked")}
          value={formatNumber(locked)}
          hint={locked ? t("pages.settings.security.stats.lockedHint") : t("pages.settings.security.stats.noneLocked")}
          icon={<Icon.Lock className="size-5" />}
        />
      </div>
      <SecuritySettingsForm initial={db.settings.security} adminHasTwoFactor={isTwoFactorActive(admin)} />
    </>
  );
}
