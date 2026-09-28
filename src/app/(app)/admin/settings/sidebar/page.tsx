import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SidebarManager, type BuiltInItem } from "@/components/admin/settings/sidebar-manager";

export const metadata = { title: "Sidebar" };

export default async function SidebarSettingsPage() {
  await requireRole(["admin"], "/admin/settings/sidebar");
  const settings = await getSettings();
  const f = settings.features;
  const items = [...settings.sidebarItems].sort((a, b) => a.order - b.order);
  const contact = settings.contact.url ?? (settings.contact.email ? `mailto:${settings.contact.email}` : "");

  const builtIns: BuiltInItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: "Home", visible: true, note: "Signed-in members only" },
    { label: "Courses", href: "/courses", icon: "BookOpen", visible: f.courses, note: "Courses feature" },
    { label: "Batches", href: "/batches", icon: "Users", visible: f.batches, note: "Batches feature" },
    { label: "Programs", href: "/programs", icon: "Layers", visible: f.programs, note: "Programs feature" },
    { label: "Certified Members", href: "/certified-members", icon: "Award", visible: f.certifications && f.certifiedMembers, note: "Certifications + Certified members features" },
    { label: "Jobs", href: "/jobs", icon: "Briefcase", visible: f.jobs, note: "Jobs feature" },
    { label: "Statistics", href: "/statistics", icon: "BarChart", visible: f.statistics, note: "Statistics feature · instructors and moderators" },
    { label: "Notifications", href: "/notifications", icon: "Bell", visible: f.notifications, note: "Notifications feature · signed-in members" },
    { label: "Contact us", href: contact || "", icon: "Mail", visible: !!contact, note: contact ? contact.replace(/^mailto:/, "") : "Add a contact email or URL in General" },
  ];

  return (
    <>
      <SettingsPanelHeader title="Sidebar" description="Add custom links to the sidebar and choose their order and icons." />
      <SidebarManager items={items} builtIns={builtIns} />
    </>
  );
}
