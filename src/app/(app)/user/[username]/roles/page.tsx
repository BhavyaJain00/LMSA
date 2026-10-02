import { notFound, redirect } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getProfileView, MANAGEABLE_ROLES } from "@/lib/data/profile";
import { Icon } from "@/components/ui/icons";
import { RolesForm, type RoleOption } from "@/components/profile/roles-form";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT("account"))("profile.tabs.roles") };
}

export default async function ProfileRolesPage(props: PageProps<"/user/[username]/roles">) {
  const { username } = await props.params;
  const viewer = await requireUser(`/user/${username}/roles`);
  const [view, t] = await Promise.all([getProfileView(decodeURIComponent(username)), getT("account")]);
  if (!view) notFound();
  if (!view.canManageRoles) redirect("/forbidden");

  const viewerIsAdmin = isAdmin(viewer);
  const targetIsAdmin = view.user.roles.includes("admin");
  const options: RoleOption[] = MANAGEABLE_ROLES.filter((r) => r.role !== "admin" || viewerIsAdmin || targetIsAdmin).map((r) => {
    let lockedReason: string | undefined;
    if (targetIsAdmin && !viewerIsAdmin) lockedReason = t("profile.roles.lockedAdminTarget");
    else if (r.role === "admin" && !viewerIsAdmin) lockedReason = t("profile.roles.lockedAdminRole");
    else if (view.isSelf && (r.role === "moderator" || r.role === "admin") && view.user.roles.includes(r.role)) {
      lockedReason = t("profile.roles.lockedSelf");
    }
    return { ...r, label: t(`profile.roles.${r.role}.label`), description: t(`profile.roles.${r.role}.description`), lockedReason };
  });

  return (
    <section aria-labelledby="roles-title" className="max-w-3xl">
      <h2 id="roles-title" className="text-lg font-semibold tracking-tight text-ink">
        {t("profile.roles.title")}
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        {view.isSelf ? t("profile.roles.introSelf") : t("profile.roles.introOther", { name: view.user.name })}
      </p>
      <RolesForm userId={view.user.id} initialRoles={view.user.roles} options={options} />
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        <Icon.Info className="mt-px size-3.5 shrink-0" />
        {t("profile.roles.footnote")}
      </p>
    </section>
  );
}
