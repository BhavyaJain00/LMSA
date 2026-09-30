import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canUseRubrics, listRubrics } from "@/lib/teaching/rubrics";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { RubricsTable } from "@/components/teaching/rubrics-table";

export const metadata: Metadata = { title: "Rubrics" };

const USAGE_OPTIONS = [
  { value: "used", label: "Used by an assignment" },
  { value: "unused", label: "Not used yet" },
];

export default async function RubricsPage(props: PageProps<"/admin/rubrics">) {
  const user = await requireUser("/admin/rubrics");
  if (!canUseRubrics(user)) redirect("/courses");
  const sp = await props.searchParams;
  const search = param(sp.q);
  const usage = param(sp.usage);
  const mine = param(sp.mine) === "true";
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const rows = await listRubrics(user, { search, usage, mine });
  const shown = rows.slice(0, limit);
  const filtered = !!(search || usage || mine);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments", href: "/admin/assignments" }, { label: "Rubrics" }]} />}
        title={`${rows.length} ${rows.length === 1 ? "Rubric" : "Rubrics"}`}
        description="Reusable scoring guides: criteria, performance levels and a pass mark. Attach one to an assignment to grade with it and to guide peer reviews."
        actions={
          <>
            <ButtonLink href="/peer-reviews/manage" variant="outline" leftIcon={<Icon.Users className="size-4" />}>
              Peer reviews
            </ButtonLink>
            <ButtonLink href="/admin/rubrics/new" leftIcon={<Icon.Plus className="size-4" />}>
              New rubric
            </ButtonLink>
          </>
        }
      />
      <FilterBar
        filters={[
          { param: "q", kind: "search", label: "Search", placeholder: "Search rubrics or criteria" },
          { param: "usage", kind: "select", label: "Usage", placeholder: "Any usage", options: USAGE_OPTIONS },
          { param: "mine", kind: "toggle", label: "Created by me", tone: "accent" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.ListChecks />}
          title={filtered ? "No rubrics match these filters" : "No rubrics yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Create a rubric from scratch or start from a template, then attach it to an assignment to score submissions criterion by criterion."
          }
          action={
            <ButtonLink href="/admin/rubrics/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create a rubric
            </ButtonLink>
          }
        />
      ) : (
        <>
          <RubricsTable rows={shown} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="rubrics" />
        </>
      )}
    </div>
  );
}
