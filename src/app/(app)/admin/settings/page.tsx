import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";

export default async function SettingsIndexPage() {
  await requireRole(["admin"], "/admin/settings");
  redirect("/admin/settings/general");
}
