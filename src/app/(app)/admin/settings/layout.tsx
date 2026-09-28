import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { SettingsNav } from "@/components/admin/settings/settings-nav";

/**
 * Admin settings shell: page header + grouped sub-navigation. Every page and
 * Server Action below re-checks the admin role as well.
 */
export default async function SettingsLayout({ children }: LayoutProps<"/admin/settings">) {
  await requireRole(["admin"], "/admin/settings");
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure branding, features, learning rules, payments and data for the whole platform."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings" }]} />}
      />
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <SettingsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
