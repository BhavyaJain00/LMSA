import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { Breadcrumbs } from "@/components/batches/breadcrumbs";
import { ProgramDetailsForm } from "@/components/programs/admin/program-form";

export const metadata: Metadata = { title: "Create program" };

export default async function NewProgramPage() {
  await requireRole(["moderator", "course_creator"], "/admin/programs/new");
  const settings = await getSettings();
  if (!settings.features.programs) notFound();
  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <Breadcrumbs items={[{ label: "Programs", href: "/admin/programs" }, { label: "Create Program" }]} />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">Create Program</h1>
      <ProgramDetailsForm />
    </div>
  );
}
