import { isAdmin, requireRole } from "@/lib/auth/session";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { MemberImport } from "@/components/admin/settings/member-import";

export const metadata = { title: "Import members" };

/** Bulk-add members from a CSV file (Frappe: Data Import for users). Moderators. */
export default async function ImportMembersPage() {
  const viewer = await requireRole(["moderator"], "/admin/members/import");
  return (
    <div>
      <PageHeader
        title="Import members"
        description="Add many members at once from a CSV file. Review every row before anything is created."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Members", href: "/admin/members" },
              { label: "Import" },
            ]}
          />
        }
        actions={
          <ButtonLink href="/admin/members/new" variant="outline" leftIcon={<Icon.UserPlus className="size-4" />}>
            Add one member
          </ButtonLink>
        }
      />
      <MemberImport canGrantAdmin={isAdmin(viewer)} />
    </div>
  );
}
