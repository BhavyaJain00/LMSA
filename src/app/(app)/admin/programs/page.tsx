import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getAdminProgramSummaries, getAdminProgramTabCounts } from "@/lib/data/programs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { ListFilters } from "@/components/batches/list-filters";
import { ProgramCard } from "@/components/programs/program-card";
import type { AdminProgramTab } from "@/components/programs/types";

export const metadata: Metadata = { title: "Manage programs" };

export default async function AdminProgramsPage(props: PageProps<"/admin/programs">) {
  const user = await requireRole(["moderator", "course_creator"], "/admin/programs");
  const [settings, sp] = await Promise.all([getSettings(), props.searchParams]);
  if (!settings.features.programs) notFound();
  const tab: AdminProgramTab = sp.tab === "unpublished" ? "unpublished" : "published";
  const search = typeof sp.search === "string" ? sp.search : undefined;
  const [programs, counts] = await Promise.all([getAdminProgramSummaries(user, { tab, search }), getAdminProgramTabCounts(user)]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="All Programs"
        description="Group courses into learning paths, choose whether they unlock in order, and follow member progress."
        actions={
          <ButtonLink href="/admin/programs/new" leftIcon={<Icon.Plus className="size-4" />}>
            Create
          </ButtonLink>
        }
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          items={[
            { value: "published", label: "Published", count: counts.published },
            { value: "unpublished", label: "Unpublished", count: counts.unpublished },
          ]}
          className="sm:flex-1"
        />
        <ListFilters placeholder="Search" />
      </div>
      {programs.length === 0 ? (
        <EmptyState
          icon={<Icon.Layers />}
          title="No Programs Found"
          description={search ? "No programs match your search." : tab === "published" ? "Published programs appear here. Create one and tick Published when it's ready." : "Programs you're still preparing appear here."}
          action={
            !search ? (
              <ButtonLink href="/admin/programs/new" leftIcon={<Icon.Plus className="size-4" />}>
                Create program
              </ButtonLink>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} href={`/admin/programs/${p.id}`} showStatus />
          ))}
        </div>
      )}
    </div>
  );
}
