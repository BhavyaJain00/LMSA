import { isAdmin, requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CreateMemberForm } from "@/components/admin/settings/member-forms";

export const metadata = { title: "Add New Member" };

export default async function NewMemberPage() {
  const viewer = await requireRole(["moderator"], "/admin/members/new");
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
      <CreateMemberForm canGrantAdmin={isAdmin(viewer)} />
    </div>
  );
}
