import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getInstructorOptions } from "@/lib/data/batches";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/batches/breadcrumbs";
import { NewBatchForm } from "@/components/batches/admin/batch-form";

export const metadata: Metadata = { title: "New batch" };

export default async function NewBatchPage() {
  const user = await requireRole(["moderator", "course_creator", "batch_evaluator"], "/admin/batches/new");
  const db = await getDb();
  if (!db.settings.features.batches) notFound();
  const instructors = await getInstructorOptions();
  const categories = [...db.categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <Breadcrumbs items={[{ label: "Batches", href: "/admin/batches" }, { label: "New Batch" }]} />
      <PageHeader title="New Batch" description="Start with the essentials. You'll add courses, live classes, pricing and the timetable next." />
      <NewBatchForm categories={categories} instructors={instructors} defaultInstructorId={instructors.some((i) => i.value === user.id) ? user.id : undefined} />
    </div>
  );
}
