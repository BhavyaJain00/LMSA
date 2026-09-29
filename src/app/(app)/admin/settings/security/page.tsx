import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { hasStaffRole, isAccountLocked, isEmailVerified, isTwoFactorActive } from "@/lib/auth/account-status";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SecuritySettingsForm } from "@/components/admin/settings/security-settings-form";
import { formatNumber, percent } from "@/lib/utils";

export const metadata = { title: "Security settings" };

export default async function SecuritySettingsAdminPage() {
  const admin = await requireRole(["admin"], "/admin/settings/security");
  const db = await getDb();
  const users = db.users.filter((u) => u.enabled);
  const staff = users.filter(hasStaffRole);
  const withTwoFactor = users.filter(isTwoFactorActive).length;
  const staffWithTwoFactor = staff.filter(isTwoFactorActive).length;
  const unverified = users.filter((u) => !isEmailVerified(u)).length;
  const locked = db.users.filter((u) => isAccountLocked(u)).length;

  return (
    <>
      <SettingsPanelHeader
        title="Security"
        description="Email confirmation, two-step verification, lockout after failed sign-ins and password rules."
        actions={
          <ButtonLink href="/admin/security" variant="outline" size="sm" leftIcon={<Icon.Shield className="size-4" />}>
            Login activity
          </ButtonLink>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Two-step verification" value={`${percent(withTwoFactor, users.length)}%`} hint={`${formatNumber(withTwoFactor)} of ${formatNumber(users.length)} members`} icon={<Icon.ShieldCheck className="size-5" />} />
        <StatCard label="Staff protected" value={`${formatNumber(staffWithTwoFactor)}/${formatNumber(staff.length)}`} hint="Staff with two-step verification" icon={<Icon.Users className="size-5" />} />
        <StatCard label="Unconfirmed emails" value={formatNumber(unverified)} hint="Self-registered, not yet confirmed" icon={<Icon.Mail className="size-5" />} />
        <StatCard label="Locked right now" value={formatNumber(locked)} hint={locked ? "Unlock from Login activity" : "No accounts locked"} icon={<Icon.Lock className="size-5" />} />
      </div>
      <SecuritySettingsForm initial={db.settings.security} adminHasTwoFactor={isTwoFactorActive(admin)} />
    </>
  );
}
