import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SidebarManager, type BuiltInItem } from "@/components/admin/settings/sidebar-manager";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.sidebar.metaTitle") };
}

export default async function SidebarSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/sidebar");
  const settings = await getSettings();
  const f = settings.features;
  const items = [...settings.sidebarItems].sort((a, b) => a.order - b.order);
  const contact = settings.contact.url ?? (settings.contact.email ? `mailto:${settings.contact.email}` : "");

  const builtIns: BuiltInItem[] = [
    { label: t("pages.settings.sidebar.items.dashboard"), href: "/dashboard", icon: "Home", visible: true, note: t("pages.settings.sidebar.notes.signedIn") },
    { label: t("pages.settings.sidebar.items.courses"), href: "/courses", icon: "BookOpen", visible: f.courses, note: t("pages.settings.sidebar.notes.courses") },
    { label: t("pages.settings.sidebar.items.batches"), href: "/batches", icon: "Users", visible: f.batches, note: t("pages.settings.sidebar.notes.batches") },
    { label: t("pages.settings.sidebar.items.programs"), href: "/programs", icon: "Layers", visible: f.programs, note: t("pages.settings.sidebar.notes.programs") },
    { label: t("pages.settings.sidebar.items.certified"), href: "/certified-members", icon: "Award", visible: f.certifications && f.certifiedMembers, note: t("pages.settings.sidebar.notes.certified") },
    { label: t("pages.settings.sidebar.items.jobs"), href: "/jobs", icon: "Briefcase", visible: f.jobs, note: t("pages.settings.sidebar.notes.jobs") },
    { label: t("pages.settings.sidebar.items.statistics"), href: "/statistics", icon: "BarChart", visible: f.statistics, note: t("pages.settings.sidebar.notes.statistics") },
    { label: t("pages.settings.sidebar.items.notifications"), href: "/notifications", icon: "Bell", visible: f.notifications, note: t("pages.settings.sidebar.notes.notifications") },
    { label: t("pages.settings.sidebar.items.contact"), href: contact || "", icon: "Mail", visible: !!contact, note: contact ? contact.replace(/^mailto:/, "") : t("pages.settings.sidebar.notes.contact") },
  ];

  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.sidebar.title")} description={t("pages.settings.sidebar.description")} />
      <SidebarManager items={items} builtIns={builtIns} />
    </>
  );
}
