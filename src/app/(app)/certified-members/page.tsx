import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { getCertificationCategories, getCertifiedMembers } from "@/lib/data/certificates";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { CertifiedMemberCard } from "@/components/certificates/member-card";

export const metadata: Metadata = {
  title: "Certified Members",
  description: "Learners who earned a certificate on this platform.",
};

export default async function CertifiedMembersPage(props: PageProps<"/certified-members">) {
  const settings = await getSettings();
  if (!settings.features.certifications || !settings.features.certifiedMembers) notFound();
  const sp = await props.searchParams;
  const name = param(sp.name);
  const category = param(sp.category);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [members, categories] = await Promise.all([getCertifiedMembers({ name, category }), getCertificationCategories()]);
  const shown = members.slice(0, limit);
  const filtered = !!(name || category);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Certified Members" }]} />}
        title={`${members.length} Certified ${members.length === 1 ? "Member" : "Members"}`}
        description={`Learners who earned a certificate on ${settings.brand.name}. Click a card to view their profile.`}
        actions={
          <ButtonLink href="/courses?certification=true" variant="outline" leftIcon={<Icon.GraduationCap className="size-4" />}>
            Get Certified
          </ButtonLink>
        }
      />
      <FilterBar
        filters={[
          { param: "name", kind: "search", label: "Search", placeholder: "Search" },
          { param: "category", kind: "select", label: "Category", placeholder: "Category", options: categories.map((c) => ({ value: c, label: c })), className: "sm:w-72" },
        ]}
      />
      {members.length === 0 ? (
        <EmptyState
          icon={<Icon.ShieldCheck />}
          title={filtered ? "No certified members match these filters" : "No Certified Members Found"}
          description={
            filtered
              ? "Try another name or category."
              : "There are no certified members currently. Keep an eye out, fresh learning experiences are on the way!"
          }
          action={
            <ButtonLink href="/courses?certification=true" leftIcon={<Icon.GraduationCap className="size-4" />}>
              Browse certificate courses
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <li key={m.user.id}>
                <CertifiedMemberCard member={m} />
              </li>
            ))}
          </ul>
          <ListFooter shown={shown.length} total={members.length} size={size} pages={pages} noun="members" />
        </>
      )}
    </div>
  );
}
