import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { Tabs } from "@/components/ui/tabs";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { BadgesManager } from "@/components/admin/settings/badges-manager";
import { BadgeAssignments } from "@/components/admin/settings/badge-assignments";
import { toDateKey } from "@/lib/utils";

export const metadata = { title: "Badges" };

export default async function BadgesSettingsPage(props: PageProps<"/admin/settings/badges">) {
  await requireRole(["admin"], "/admin/settings/badges");
  const sp = await props.searchParams;
  const tab = sp.tab === "assignments" ? "assignments" : "badges";
  const db = await getDb();

  const holders = new Map<string, Set<string>>();
  for (const a of db.badgeAssignments) {
    const set = holders.get(a.badgeId) ?? new Set<string>();
    set.add(a.userId);
    holders.set(a.badgeId, set);
  }
  const badges = [...db.badges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...b, holderCount: holders.get(b.id)?.size ?? 0 }));

  const users = new Map(db.users.map((u) => [u.id, u]));
  const badgeMap = new Map(db.badges.map((b) => [b.id, b]));
  const assignments = [...db.badgeAssignments]
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
    .map((a) => {
      const u = users.get(a.userId);
      const b = badgeMap.get(a.badgeId);
      return {
        id: a.id,
        issuedOn: a.issuedOn,
        badge: b ? { id: b.id, title: b.title, imageUrl: b.imageUrl } : null,
        member: u ? { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl } : null,
      };
    });
  const members = db.users
    .filter((u) => u.enabled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }));

  return (
    <>
      <SettingsPanelHeader
        title="Badges"
        description={db.settings.features.badges ? "Define badges and the rules that award them, or assign them by hand." : "Badges are currently turned off in Features — members won't see them until you enable the feature."}
      />
      <Tabs
        className="mb-5"
        items={[
          { label: "Badges", value: "badges", count: badges.length },
          { label: "Assignments", value: "assignments", count: assignments.length },
        ]}
      />
      {tab === "badges" ? (
        <BadgesManager badges={badges} />
      ) : (
        <BadgeAssignments
          assignments={assignments}
          members={members}
          badges={badges.map((b) => ({ id: b.id, title: b.title, enabled: b.enabled, grantOnlyOnce: b.grantOnlyOnce }))}
          today={toDateKey()}
        />
      )}
    </>
  );
}
