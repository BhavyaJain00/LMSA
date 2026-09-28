import { notFound, redirect } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getProfileView, MANAGEABLE_ROLES } from "@/lib/data/profile";
import { Icon } from "@/components/ui/icons";
import { RolesForm, type RoleOption } from "@/components/profile/roles-form";

export const metadata = { title: "Roles" };

export default async function ProfileRolesPage(props: PageProps<"/user/[username]/roles">) {
  const { username } = await props.params;
  const viewer = await requireUser(`/user/${username}/roles`);
  const view = await getProfileView(decodeURIComponent(username));
  if (!view) notFound();
  if (!view.canManageRoles) redirect("/forbidden");

  const viewerIsAdmin = isAdmin(viewer);
  const targetIsAdmin = view.user.roles.includes("admin");
  const options: RoleOption[] = MANAGEABLE_ROLES.filter((r) => r.role !== "admin" || viewerIsAdmin || targetIsAdmin).map((r) => {
    let lockedReason: string | undefined;
    if (targetIsAdmin && !viewerIsAdmin) lockedReason = "Only administrators can change an administrator's roles.";
    else if (r.role === "admin" && !viewerIsAdmin) lockedReason = "Only administrators can grant or remove the Admin role.";
    else if (view.isSelf && (r.role === "moderator" || r.role === "admin") && view.user.roles.includes(r.role)) {
      lockedReason = "You can't remove this role from yourself.";
    }
    return { ...r, lockedReason };
  });

  return (
    <section aria-labelledby="roles-title" className="max-w-3xl">
      <h2 id="roles-title" className="text-lg font-semibold tracking-tight text-ink">
        Settings
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        Roles decide what {view.isSelf ? "you" : view.user.name} can do on the platform. Changes are saved as soon as you flip a switch.
      </p>
      <RolesForm userId={view.user.id} initialRoles={view.user.roles} options={options} />
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        <Icon.Info className="mt-px size-3.5 shrink-0" />
        Administrators automatically have every permission. Evaluators can manage batches and grade submissions; moderators can manage every course,
        member and setting.
      </p>
    </section>
  );
}
