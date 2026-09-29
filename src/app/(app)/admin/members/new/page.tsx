import { isAdmin, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { clampMinLength } from "@/lib/auth/password-policy";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CreateMemberForm } from "@/components/admin/settings/member-forms";

export const metadata = { title: "Add New Member" };

export default async function NewMemberPage() {
  const [viewer, settings] = await Promise.all([requireRole(["moderator"], "/admin/members/new"), getSettings()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add New Member"
        description="Create an account with a password and the roles this person needs."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Members", href: "/admin/members" },
              { label: "New" },
            ]}
          />
        }
      />
      <CreateMemberForm canGrantAdmin={isAdmin(viewer)} minPasswordLength={clampMinLength(settings.security.passwordMinLength)} />
    </div>
  );
}
