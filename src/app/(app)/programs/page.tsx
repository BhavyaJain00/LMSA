import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canCreateProgram, getProgramSummaries, getProgramTabCounts } from "@/lib/data/programs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { ListFilters } from "@/components/batches/list-filters";
import { ProgramCard } from "@/components/programs/program-card";
import type { ProgramListTab } from "@/components/programs/types";

export const metadata: Metadata = {
  title: "Programs",
  description: "Structured learning paths that group courses into a single journey.",
};

export default async function ProgramsPage(props: PageProps<"/programs">) {
  const [user, settings, sp] = await Promise.all([getCurrentUser(), getSettings(), props.searchParams]);
  if (!settings.features.programs) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect("/login?next=%2Fprograms");

  const tab: ProgramListTab = user && sp.tab === "enrolled" ? "enrolled" : "published";
  const search = typeof sp.search === "string" ? sp.search : undefined;
  const [programs, counts] = await Promise.all([getProgramSummaries(user, { tab, search }), getProgramTabCounts(user)]);
  const tabs = [{ value: "published", label: "Published", count: counts.published }];
  if (user) tabs.push({ value: "enrolled", label: "Enrolled", count: counts.enrolled });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="All Programs"
        description="Learning paths that bundle courses in a recommended order. Enroll once and work through them step by step."
        actions={
          user && canCreateProgram(user) ? (
            <>
              <ButtonLink href="/admin/programs" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                Manage
              </ButtonLink>
              <ButtonLink href="/admin/programs/new" leftIcon={<Icon.Plus className="size-4" />}>
                Create
              </ButtonLink>
            </>
          ) : null
        }
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs items={tabs} className="sm:flex-1" />
        <ListFilters placeholder="Search programs" />
      </div>

      {programs.length === 0 ? (
        search ? (
          <EmptyState icon={<Icon.Search />} title="No programs match your search" description="Try a different keyword or clear the search." />
        ) : (
          <EmptyState
            icon={<Icon.GraduationCap />}
            title={tab === "enrolled" ? "No Enrolled Programs Found" : "No Published Programs Found"}
            description={
              tab === "enrolled"
                ? "There are no enrolled programs currently. Browse the published programs to start a learning path."
                : "There are no published programs currently. Keep an eye out, fresh learning experiences are on the way!"
            }
            action={tab === "enrolled" && counts.published > 0 ? <ButtonLink href="/programs">Browse programs</ButtonLink> : null}
          />
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}
    </div>
  );
}
